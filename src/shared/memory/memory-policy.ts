import { z } from "zod";
import type { MemoryType } from "@/types/longitudinal-memory";

// The longitudinal-memory rules that are the PI's decision, in one place
// (.claude/TASK_SCOPE.json note2026_09_13_ari_memory_pipeline_plumbing and
// note2026_09_21_memory_always_on, PDF "TBCT_V2 RAG 채울부분" 3장 ①): on
// which turns cross-session memory may appear, how many items per node,
// which memory types, and what a new participant's cross-session consent
// defaults to. These are part of the intervention and must be frozen with
// the model snapshot and prompts, so the resolved policy has a version that
// is recorded on every turn that used it (see dialogue-agent-orchestrator.ts
// memoryPolicyVersion).
//
// ALWAYS ON (clinical decision, 2026-09-21): cross-session memory is a
// required part of the intervention, so there is deliberately no on/off
// switch here -- no `enabled` flag, no "inject nowhere" scope, and no
// zero-item cap. Every value below shapes HOW memory is used, never WHETHER.
// Two gates that are not a global switch still stand and must keep standing:
// a participant who has not consented to cross-session use
// (consent.crossSessionUseAllowed) never has memory retrieved, and
// safety_relevant / clinician_note memories are never injected (RET-SAFE in
// retention-policies.ts). Withdrawing the feature mid-trial would be an
// intervention change, so it takes a code change and a version bump --
// deliberately not an environment variable someone can flip silently.
//
// Precedence: the LONGITUDINAL_MEMORY_POLICY environment variable (a JSON
// object with any subset of the fields below) is merged over
// DEFAULT_LONGITUDINAL_MEMORY_POLICY and validated. Same deployment-level
// mechanism as ANTHROPIC_MODEL, so the two AI arms of the RCT get one
// identical rule set from one setting. An invalid value never changes the
// intervention silently: it is logged once and the default applies.

export const MEMORY_INJECTION_SCOPES = [
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
  /** On which turns memory may appear on the dialogue contract. Every scope
   * puts memory on SOME turn: there is no "nowhere" option, by design (see
   * the ALWAYS ON note above). */
  injectionScope: z.enum(MEMORY_INJECTION_SCOPES),
  /** Retrieval cap per node ("몇 개"). At least 1 -- a zero cap would be an
   * off switch wearing a number. */
  maxItemsPerNode: z.number().int().min(1).max(50),
  /** Restrict retrieval to these types ("무엇을"); absent = every type the
   * retention policies allow. safety_relevant / clinician_note stay excluded
   * by RET-SAFE regardless of what is listed here. An empty list is rejected
   * rather than silently read as "no restriction". */
  allowedMemoryTypes: z.array(z.enum(MEMORY_TYPES)).min(1).optional(),
  /** consent.crossSessionUseAllowed for a NEWLY created participant. The RCT
   * consent form item (pilot-study-api.ts crossSessionMemoryAllowed) is the
   * intended source of truth; this is the value before that is wired. */
  crossSessionConsentDefault: z.boolean(),
});
export type LongitudinalMemoryPolicy = z.infer<typeof longitudinalMemoryPolicySchema>;

export const DEFAULT_LONGITUDINAL_MEMORY_POLICY: LongitudinalMemoryPolicy = {
  version: "2026-09-21-always-on",
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

/** Whether a turn with these ownership facts may carry memory under `scope`.
 * Every scope returns true for at least one kind of turn -- the feature is
 * always on, and this function only shapes where it lands. */
export function memoryAllowedOnTurn(scope: MemoryInjectionScope, turn: { participantOwned: boolean; nodeRequiresProtectedField: boolean }): boolean {
  switch (scope) {
    case "administrative_only":
      return !turn.participantOwned && !turn.nodeRequiresProtectedField;
    case "unprotected_nodes":
      return !turn.nodeRequiresProtectedField;
    case "all_turns":
      return true;
  }
}
