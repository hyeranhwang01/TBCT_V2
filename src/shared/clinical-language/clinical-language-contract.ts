import { z } from "zod";

export const clinicalProviderNames = ["mock", "anthropic"] as const;
export type ClinicalProviderName = (typeof clinicalProviderNames)[number];

export const safetySignalSchema = z.object({
  type: z.enum(["suicidal_ideation", "self_harm", "harm_to_others", "immediate_danger", "crisis_distress", "severe_dissociation", "emotional_flooding", "other"]),
  evidence: z.string(),
  confidence: z.number().min(0).max(1),
  immediacy: z.enum(["none", "unclear", "possible", "immediate"]),
});

const compiledPromptSegmentSchema = z.object({
  priority: z.number().int().positive(),
  label: z.string().min(1),
  content: z.string(),
});

export const compiledPromptContractSchema = z.object({
  contractId: z.string().min(1),
  releaseId: z.string().min(1),
  nodeId: z.string().min(1),
  promptItemId: z.string().min(1),
  roleId: z.string().min(1),
  systemSegments: z.array(compiledPromptSegmentSchema),
  runtimeContext: z.record(z.unknown()),
  outputSchema: z.record(z.unknown()),
  fallbackPatientText: z.string().min(1),
  contractHash: z.string().min(1),
});

export const clinicalProviderResponseSchema = z.object({
  requestId: z.string(),
  patientMessage: z.string().min(1),
  actionType: z.string().min(1),
  proposedFields: z.record(z.unknown()),
  completionEvidence: z.array(z.string()),
  detectedLanguage: z.string().min(1),
  completionStatus: z.enum(["incomplete", "complete", "needs_clarification", "safety_review", "safety_hold"]),
  extractedFields: z.record(z.unknown()),
  safetySignals: z.array(safetySignalSchema),
  recommendedTransition: z.enum(["stay", "advance", "clarify", "safety"]),
  nextActionRecommendation: z.enum(["stay", "advance", "clarify", "safety"]),
  providerMetadata: z.object({
    provider: z.enum(clinicalProviderNames),
    model: z.string().optional(),
    providerRequestId: z.string().optional(),
    latencyMs: z.number().optional(),
  }),
});

export const clinicalInputAssessmentRequestSchema = z.object({
  requestId: z.string(),
  idempotencyKey: z.string(),
  locale: z.string().min(1),
  patientMessage: z.string(),
  prompt: z.object({
    type: z.string().min(1),
    validationKind: z.string().optional(),
    guidance: z.string().min(1),
    requiredFields: z.array(z.string()),
  }),
});

export const clinicalInputAssessmentResponseSchema = z.object({
  requestId: z.string(),
  accepted: z.boolean(),
  confidence: z.number().min(0).max(1),
  reason: z.enum(["meaningful_response", "needs_clarification"]),
  providerMetadata: z.object({
    provider: z.enum(clinicalProviderNames),
    model: z.string().optional(),
    providerRequestId: z.string().optional(),
    latencyMs: z.number().optional(),
  }),
});

export const clinicalProviderRequestSchema = z.object({
  requestId: z.string(),
  idempotencyKey: z.string(),
  protocolId: z.string(),
  protocolVersion: z.string(),
  sessionPlanEntryId: z.string(),
  sessionId: z.string(),
  sessionNumber: z.number(),
  nodeId: z.string(),
  nodeTitle: z.string(),
  clinicalPurpose: z.string(),
  promptItemId: z.string(),
  promptItemType: z.string(),
  editableText: z.string(),
  aiInstruction: z.string(),
  compiledPrompt: compiledPromptContractSchema.optional(),
  activationCondition: z.record(z.unknown()).nullable(),
  outputFields: z.array(z.string()),
  validation: z.record(z.unknown()).nullable(),
  completionEffect: z.record(z.unknown()).nullable(),
  participantMessage: z.string(),
  detectedLanguage: z.string().optional(),
  relevantFields: z.record(z.unknown()),
  recentMessages: z.array(z.object({ role: z.enum(["participant", "assistant"]), content: z.string() })),
  safetyContext: z.object({
    activeSafetyRuleIds: z.array(z.string()),
    currentSafetyStatus: z.string(),
  }),
});

export type ClinicalProviderRequest = z.infer<typeof clinicalProviderRequestSchema>;
export type ClinicalProviderResponse = z.infer<typeof clinicalProviderResponseSchema>;
export type ClinicalInputAssessmentRequest = z.infer<typeof clinicalInputAssessmentRequestSchema>;
export type ClinicalInputAssessmentResponse = z.infer<typeof clinicalInputAssessmentResponseSchema>;
