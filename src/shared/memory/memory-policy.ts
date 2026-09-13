import { z } from "zod";
import type { MemoryType } from "@/types/longitudinal-memory";

// The longitudinal-memory rules that are the PI's decision, in one place
// (.claude/TASK_SCOPE.json note2026_09_13_ari_memory_pipeline_plumbing,
// PDF "TBCT_V2 RAG 채울부분" 3장 ①): whether cross-session memory is part
// of the intervention at all, on which turns it may appear, how many items
// per node, which memory types, and what a new participant's cross-session
// consent defaults to. These are part of the intervention and must be
// frozen with the model snapshot and prompts, so the resolved policy has a
// version that is recorded on every turn that used it (see
// dialogue-agent-orchestrator.ts memoryPolicyVersion).
//
// Precedence: the LONGITUDINAL_MEMORY_POLICY environment variable (a JSON
// object with any subset of the fields below) is merged over
// DEFAULT_LONGITUDINAL_MEMORY_POLICY and validated. Same deployment-level
// mechanism as ANTHROPIC_MODEL, so the two AI arms of the RCT get one
// identical rule set from one setting. An invalid value never changes the
// intervention silently: it is logged once and the default applies.
//
// Default: DISABLED. Until the PI decides, no memory reaches the dialogue
// model; the pipeline's other stages (summary -> candidates -> clinician
// approval) keep running so nothing is lost when it is switched on.

export const MEMORY_INJECTION_SCOPES = [
  // Never put memory on the contract (stage 4 off; retrieval still runs when enabled).
  "none",
  // Only on turns that ask for no participant-owned content AND whose node
  // has no protected field -- the strict reading of the PDF (2-C), and the
  // most conservative option under the Patient Authorship Invariant.
  "administrative_only",
  // Any turn except those in a node with a protected field (S02/S03
  // identifiers etc.); participant-owned turns elsewhere do get context.
  "unprotected_nodes",
  // Every turn the dialogue agent handles. The quote gate
  // (message-composition.ts) still never accepts a memory as a quote.
  "all_turns",
] as const;
export type MemoryInjectionScope = (typeof MEMORY_INJECTION_SCOPES)[number];

const MEMORY_TYPES = [
  "session_goal",
  "treatment_goal",
  "patient_preference",
  "communication_preference",
  "reported_context",
  "activity_history",
  "homework_assignment",
  "homework_outcome",
  "barrier",
  "coping_strategy",
  "progress_marker",
  "clinician_note",
  "safety_relevant",
  "temporary_session_fact",
] as const satisfies readonly MemoryType[];

export const longitudinalMemoryPolicySchema = z.object({
  /** Bumped whenever any value below changes -- the frozen-intervention id. */
  version: z.string().min(1),
  /** PI decision ①: is cross-session memory part of the intervention? When
   * false, no retrieval runs and nothing reaches the contract; summaries,
   * candidates and clinician review continue unchanged. */
  enabled: z.boolean(),
  /** On which turns memory may appear on the dialogue contract. */
  injectionScope: z.enum(MEMORY_INJECTION_SCOPES),
  /** Retrieval cap per node ("몇 개"). 0 disables injection without disabling retrieval logging. */
  maxItemsPerNode: z.number().int().min(0).max(50),
  /** Restrict retrieval to these types ("무엇을"); absent = every type the
   * retention policies allow. safety_relevant / clinician_note stay excluded
   * by RET-SAFE regardless of what is listed here. */
  allowedMemoryTypes: z.array(z.enum(MEMORY_TYPES)).optional(),
  /** consent.crossSessionUseAllowed for a NEWLY created participant. The RCT
   * consent form item (pilot-study-api.ts crossSessionMemoryAllowed) is the
   * intended source of truth; this is the value before that is wired. */
  crossSessionConsentDefault: z.boolean(),
});
export type LongitudinalMemoryPolicy = z.infer<typeof longitudinalMemoryPolicySchema>;

export const DEFAULT_LONGITUDINAL_MEMORY_POLICY: LongitudinalMemoryPolicy = {
  version: "2026-09-13-default-disabled",
  enabled: false,
  injectionScope: "administrative_only",
  maxItemsPerNode: 5,
  crossSessionConsentDefault: true,
};

export const LONGITUDINAL_MEMORY_POLICY_ENV = "LONGITUDINAL_MEMORY_POLICY";

let warnedFor: string | undefined;

/** The policy in force for this process: default merged with the
 * LONGITUDINAL_MEMORY_POLICY override, validated. Cheap and uncached so a
 * test (or a hot-reloaded dev server) sees the current value. */
export function resolveLongitudinalMemoryPolicy(env: NodeJS.ProcessEnv = process.env): LongitudinalMemoryPolicy {
  const raw = env[LONGITUDINAL_MEMORY_POLICY_ENV]?.trim();
  if (!raw) return { ...DEFAULT_LONGITUDINAL_MEMORY_POLICY };
  try {
    const override = JSON.parse(raw) as unknown;
    if (!override || typeof override !== "object" || Array.isArray(override)) throw new Error("must be a JSON object");
    return longitudinalMemoryPolicySchema.parse({ ...DEFAULT_LONGITUDINAL_MEMORY_POLICY, ...(override as Record<string, unknown>) });
  } catch (error) {
    if (warnedFor !== raw) {
      warnedFor = raw;
      console.warn(`[memory-policy] ${LONGITUDINAL_MEMORY_POLICY_ENV} is invalid; using the default policy (${DEFAULT_LONGITUDINAL_MEMORY_POLICY.version})`, error instanceof Error ? error.message : String(error));
    }
    return { ...DEFAULT_LONGITUDINAL_MEMORY_POLICY };
  }
}

/** Whether a turn with these ownership facts may carry memory under `scope`. */
export function memoryAllowedOnTurn(scope: MemoryInjectionScope, turn: { participantOwned: boolean; nodeRequiresProtectedField: boolean }): boolean {
  switch (scope) {
    case "none":
      return false;
    case "administrative_only":
      return !turn.participantOwned && !turn.nodeRequiresProtectedField;
    case "unprotected_nodes":
      return !turn.nodeRequiresProtectedField;
    case "all_turns":
      return true;
  }
}
