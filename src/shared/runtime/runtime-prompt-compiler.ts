import type { CompiledPromptContract, PromptSegment, RuntimeRelease } from "@/types/protocol-runtime";
import type { PatientProfile, RuntimeMessage, RuntimeSessionState, SessionMemory } from "@/types/runtime-session";
import type { RuntimeActiveStep } from "@/shared/runtime/runtime-step-resolver";
import { resolvePromptLocaleText } from "@/shared/runtime/runtime-release-normalizer";
import { resolveBracketPlaceholders } from "@/shared/runtime/runtime-static-message";

export type CompileRuntimePromptInput = {
  release: RuntimeRelease;
  state: RuntimeSessionState;
  activeStep: RuntimeActiveStep;
  locale: string;
  patientProfile?: PatientProfile;
  sessionMemory?: SessionMemory;
  recentMessages?: RuntimeMessage[];
  safetyContext?: { activeSafetyRuleIds: string[]; currentSafetyStatus: string };
};

function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function hashContract(value: unknown) {
  const text = canonicalStringify(value);
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest)).map((item) => item.toString(16).padStart(2, "0")).join("");
  }

  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) hash = (hash * 33) ^ text.charCodeAt(index);
  return `fallback-${(hash >>> 0).toString(16)}`;
}

function truncate(value: string, maximum = 800) {
  return value.length <= maximum ? value : `${value.slice(0, maximum)}...`;
}

function compactMemory(input: CompileRuntimePromptInput) {
  return {
    locale: input.locale,
    patientProfile: input.patientProfile ? {
      participantId: input.patientProfile.participantId,
      preferredName: input.patientProfile.preferredName,
      treatmentGoals: input.patientProfile.treatmentGoals.slice(0, 8),
      patientPreferences: input.patientProfile.patientPreferences.slice(0, 8),
    } : undefined,
    sessionMemory: input.sessionMemory ? {
      confirmedSituation: input.sessionMemory.confirmedSituation,
      confirmedEmotion: input.sessionMemory.confirmedEmotion,
      confirmedThought: input.sessionMemory.confirmedThought,
      confirmedBehavior: input.sessionMemory.confirmedBehavior,
      sessionProgress: input.sessionMemory.sessionProgress.slice(-8),
      compactSummary: input.sessionMemory.compactSummary ? truncate(input.sessionMemory.compactSummary) : undefined,
    } : undefined,
    confirmedFields: input.state.fields,
  };
}

function compactRecentMessages(messages: RuntimeMessage[] | undefined) {
  return (messages ?? [])
    .filter((message) => message.role === "patient" || message.role === "assistant")
    .slice(-8)
    .map((message) => ({ role: message.role, content: truncate(message.content, 600) }));
}

function ratingComparisonGuidance(fields: Record<string, unknown>, requiredFields: string[]) {
  const pairs: Array<[string, string]> = [
    ["automaticThoughtBeliefPercent", "revisedAutomaticThoughtBeliefPercent"],
    ["coreBeliefBaselinePercent", "originalChargeFinalBeliefPercent"],
    ["guiltBeliefBaselinePercent", "guiltBeliefFinalPercent"],
    ["shameIntensityBaselinePercent", "shameIntensityFinalPercent"],
  ];
  return pairs.flatMap(([beforeField, afterField]) => {
    if (!(afterField in fields) && !requiredFields.includes(afterField)) return [];
    const before = Number(fields[beforeField]);
    const after = Number(fields[afterField]);
    if (!Number.isFinite(before) || !Number.isFinite(after)) return [`${beforeField} or ${afterField} is missing: do not claim change.`];
    return [`Stored comparison: ${beforeField}=${before}, ${afterField}=${after}. ${after < before ? "Describe a decrease accurately." : after > before ? "Describe an increase accurately." : "Explicitly state that the rating stayed the same; do not call this movement or progress."}`];
  });
}

function createOutputSchema(input: CompileRuntimePromptInput) {
  return {
    type: "object",
    required: ["patientMessage", "actionType", "proposedFields", "completionEvidence", "detectedLanguage", "completionStatus", "extractedFields", "safetySignals", "recommendedTransition", "nextActionRecommendation"],
    properties: {
      patientMessage: { type: "string", maxLength: 600 },
      actionType: { type: "string", enum: input.activeStep.promptItem.allowedActions },
      proposedFields: { type: "object", required: input.activeStep.promptItem.requiredFields },
      completionEvidence: { type: "array", items: { type: "string" } },
      detectedLanguage: { type: "string" },
      completionStatus: { type: "string", enum: ["incomplete", "complete", "needs_clarification", "safety_review", "safety_hold"] },
      extractedFields: { type: "object" },
      safetySignals: { type: "array", items: { type: "object" } },
      recommendedTransition: { type: "string", enum: ["stay", "advance", "clarify", "safety"] },
      nextActionRecommendation: { type: "string", enum: ["stay", "advance", "clarify", "safety"] },
    },
  };
}

export async function compileRuntimePrompt(input: CompileRuntimePromptInput): Promise<CompiledPromptContract> {
  const { release, state, activeStep } = input;
  const memory = compactMemory(input);
  const recentMessages = compactRecentMessages(input.recentMessages);
  const outputSchema = createOutputSchema(input);
  const activeSessionPolicy = release.policies.sessionPolicies?.[activeStep.node.sessionId];
  const comparisons = ratingComparisonGuidance(state.fields, activeStep.promptItem.requiredFields);
  const systemSegments: PromptSegment[] = [
    { priority: 1, label: "global-safety", content: [...release.policies.globalSafetyRules, ...(activeSessionPolicy?.safetyRules ?? [])].join("\n") },
    { priority: 2, label: "protocol-rules", content: [...release.policies.protocolRules, ...(activeSessionPolicy?.protocolRules ?? [])].join("\n") },
    { priority: 3, label: "active-speaker-role", content: activeStep.role.systemGuidance },
    { priority: 4, label: "node-objective", content: activeStep.node.objective },
    { priority: 5, label: "active-prompt-guidance", content: activeStep.promptItem.modelGuidance },
    { priority: 6, label: "required-patient-facing-content", content: (activeStep.promptItem.requiredPatientFacingContent ?? []).join("\n") },
    { priority: 7, label: "response-contingency", content: ["Acknowledge the patient respectfully, but do not affirm factual, numerical, or protocol interpretations unless supported by current session fields and the active PromptItem.", ...comparisons].join("\n") },
    {
      priority: 8,
      label: "action-boundaries",
      content: `Allowed actions: ${activeStep.promptItem.allowedActions.join(", ")}. Forbidden actions: ${activeStep.promptItem.forbiddenActions.join(", ")}.`,
    },
    { priority: 9, label: "output-schema", content: canonicalStringify(outputSchema) },
  ];
  const runtimeContext = {
    locale: input.locale,
    releaseId: release.id,
    activeNodeId: activeStep.node.id,
    activePromptItemId: activeStep.promptItem.id,
    roleId: activeStep.role.id,
    allowedActions: activeStep.promptItem.allowedActions,
    forbiddenActions: activeStep.promptItem.forbiddenActions,
    requiredFields: activeStep.promptItem.requiredFields,
    memory,
    recentMessages,
    safetyContext: input.safetyContext ?? { activeSafetyRuleIds: activeStep.node.safetyRuleIds, currentSafetyStatus: "active" },
  };
  const contractId = `contract-${release.id}-${activeStep.node.id}-${activeStep.promptItem.id}-${state.turnCount + 1}`;
  const baseContract = {
    contractId,
    releaseId: release.id,
    nodeId: activeStep.node.id,
    promptItemId: activeStep.promptItem.id,
    sessionId: activeStep.node.sessionId,
    sequenceIndex: activeStep.promptItem.sequenceIndex,
    roleId: activeStep.role.id,
    systemSegments,
    runtimeContext,
    outputSchema,
    // Bracket-resolved here (not just inside resolveStaticPatientMessage's
    // own call chain) because this fallbackPatientText is the deterministic
    // safety net every consumer falls back to -- the dialogue-agent
    // validator's own unresolved-template check proved that, unresolved,
    // this text can itself contain "[initial conclusion]"-style
    // placeholders (feedback v2 #5), which would otherwise leak straight
    // through as "the safe fallback."
    fallbackPatientText: resolveBracketPlaceholders(resolvePromptLocaleText(activeStep.promptItem.id, activeStep.promptItem.fallbackPatientText, input.locale), { fields: input.state.fields }),
    contractHash: "",
  } satisfies CompiledPromptContract;

  return { ...baseContract, contractHash: await hashContract(baseContract) };
}
