import type { RuntimeAction, ProtocolReleaseVersion } from "@/types/protocol-runtime";
import type { RuntimeParticipant, MemoryRetrievalResult, MemoryUsageLog } from "@/types/longitudinal-memory";
import type { ClinicalStageNode, PromptItem, SessionDefinition, SourceFidelityEdge } from "@/shared/protocol/source-fidelity-types";

export type RuntimeSessionStatus =
  | "created"
  | "preparing"
  | "active"
  | "waiting_for_input"
  | "processing"
  | "paused"
  | "safety_paused"
  | "escalated"
  | "completed"
  | "terminated"
  | "failed";

export type RuntimeTurnOutcome = "normal" | "clarification" | "safety_override" | "fallback" | "rejected_duplicate";
export type PromptExecutionStatus = "executed" | "inactive_condition" | "not_reached" | "skipped_error" | "suspended_safety";
export type RuntimeTurnAssociation = {
  kind: "assistant_only" | "patient_assistant" | "clarification" | "safety_override";
  clientTurnId?: string;
  patientMessageId?: string;
  assistantMessageId: string;
  executionTraceId: string;
  sessionVersionBefore: number;
  sessionVersionAfter: number;
};

export type RuntimeMessageRole = "patient" | "assistant" | "system" | "clinician";

export type RuntimeMessageStatus =
  | "pending"
  | "processing"
  | "validated"
  | "delivered"
  | "failed"
  | "replaced_by_fallback";

export interface RuntimeContext {
  fields: Record<string, unknown>;
  responseCategory?: string;
  emotionalState?: string;
  activityCompletion?: "not_started" | "partial" | "completed";
  homeworkStatus?: "not_assigned" | "pending" | "completed";
  riskLevel?: "low" | "medium" | "high";
  riskSignals: string[];
  iterationCounts: Record<string, number>;
  lastPatientMessage?: string;
  lastAssistantMessage?: string;
  clarificationAttemptCount?: number;
  lastClarificationReason?: string;
  longitudinalMemory?: {
    treatmentGoals: string[];
    patientPreferences: string[];
    activeHomework: string[];
    relevantBarriers: string[];
    copingStrategies: string[];
  };
}

export interface RuntimeSessionState {
  releaseId: string;
  activeNodeId: string;
  activePromptItemId?: string;
  activePromptIndex: number;
  completedNodeIds: string[];
  completedPromptItemIds: string[];
  fields: Record<string, unknown>;
  turnCount: number;
  nodeIterationCount: number;
  /** Accepted-input count per repeat_until PromptItem id. nodeIterationCount
   * is shared by every prompt in the node, so a node with TWO repeat_until
   * prompts (S08 Step 12's surrebuttal + per-pair "Therefore") would have the
   * second loop start with the first loop's spent budget and force-complete
   * after one answer. Optional so persisted pre-existing states still load. */
  promptIterationCounts?: Record<string, number>;
}

export interface PatientProfile {
  participantId: string;
  preferredName?: string;
  locale: string;
  treatmentGoals: string[];
  patientPreferences: string[];
}

export interface SessionMemory {
  confirmedSituation?: string;
  confirmedEmotion?: string;
  confirmedThought?: string;
  confirmedBehavior?: string;
  sessionProgress: string[];
  compactSummary?: string;
}

export interface RuntimeSession {
  id: string;
  projectId: string;
  protocolId: string;
  protocolVersion: string;
  releaseId: string;
  sessionDefinitionId: string;
  participantId: string;
  status: RuntimeSessionStatus;
  currentSessionId?: string;
  currentNodeId?: string;
  previousNodeId?: string;
  currentPromptItemId?: string;
  completedPromptItemIds?: string[];
  skippedPromptItemIds?: string[];
  promptExecutionStatuses?: Record<string, PromptExecutionStatus>;
  runtimeState?: RuntimeSessionState;
  promptProgressionReason?: "session_started" | "prompt_delivered" | "prompt_completed" | "prompt_skipped" | "node_completed" | "clarification_sent" | "safety_paused";
  sourceVersion?: string;
  sourceTextHash?: string;
  startedAt?: string;
  pausedAt?: string;
  resumedAt?: string;
  completedAt?: string;
  terminatedAt?: string;
  patientAlias: string;
  locale: string;
  version?: number;
  pendingTurnId?: string;
  lastCompletedTurnId?: string;
  runtimeContext: RuntimeContext;
  messageIds: string[];
  executionLogIds: string[];
  escalationIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeMessage {
  id: string;
  runtimeSessionId: string;
  role: RuntimeMessageRole;
  content: string;
  status: RuntimeMessageStatus;
  nodeId?: string;
  promptItemId?: string;
  actionType?: RuntimeAction["actionType"];
  sourceEvidenceIds?: string[];
  createdAt: string;
  deliveredAt?: string;
  replacedMessageId?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionExecutionLog {
  id: string;
  runtimeSessionId: string;
  timestamp: string;
  stage:
    | "session"
    | "input"
    | "state_extraction"
    | "node_resolution"
    | "condition_evaluation"
    | "safety_check"
    | "language_generation"
    | "output_validation"
    | "response_delivery"
    | "escalation"
    | "completion"
    | "error";
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  nodeId?: string;
  edgeId?: string;
  summary: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
  durationMs?: number;
  error?: string;
}

export interface ClinicianEscalationEvent {
  id: string;
  runtimeSessionId: string;
  protocolId: string;
  protocolVersion: string;
  sessionDefinitionId: string;
  nodeId: string;
  safetyRuleId?: string;
  linkedSafetyEventId?: string;
  executionSequence?: number;
  severity: "medium" | "high";
  triggerSummary: string;
  status: "created" | "acknowledged" | "in_review" | "resolved" | "closed";
  createdAt: string;
  acknowledgedAt?: string;
  resolvedAt?: string;
  resolutionNote?: string;
}

export interface RuntimeCheckpoint {
  id: string;
  runtimeSessionId: string;
  sequence: number;
  currentNodeId?: string;
  currentPromptItemId?: string;
  completedPromptItemIds?: string[];
  skippedPromptItemIds?: string[];
  sourceVersion?: string;
  sourceTextHash?: string;
  sessionStatus: RuntimeSessionStatus;
  runtimeContext: RuntimeContext;
  messageIds: string[];
  executionLogIds: string[];
  createdAt: string;
}

export interface RuntimeProviderEvent {
  id: string;
  runtimeSessionId: string;
  provider: string;
  model: string;
  nodeId?: string;
  promptItemId?: string;
  latencyMs?: number;
  inputSummary: string;
  outputText?: string;
  createdAt: string;
  error?: string;
  // Populated only for dialogue-agent turns (src/shared/dialogue-agent/) -- the
  // agent's own decision classification, kept separate from provider/model
  // above so clinical QA can query "how often did Claude think the
  // participant was confused" without joining to message metadata. Never
  // hidden reasoning, only the explicit structured-output fields.
  dialogueResponseType?: string;
  dialogueParticipantResponseState?: string;
  dialogueFallbackUsed?: boolean;
}

export interface RuntimeValidationEvent {
  id: string;
  runtimeSessionId: string;
  nodeId?: string;
  promptItemId?: string;
  accepted: boolean;
  corrected: boolean;
  rejected: boolean;
  issues: string[];
  finalText?: string;
  fallbackRequired: boolean;
  createdAt: string;
}

export interface TurnFidelityResult {
  activePromptFidelity: "pass" | "partial" | "fail";
  sequenceFidelity: "pass" | "partial" | "fail";
  roleFidelity: "pass" | "partial" | "fail";
  responseContingency: "pass" | "partial" | "fail";
  languageFidelity: "pass" | "partial" | "fail";
  safetyFidelity: "pass" | "critical_fail";
  transitionFidelity: "pass" | "partial" | "fail";
  exposureSafety: "pass" | "fail";
  responsiveness: "pass" | "fail";
  reasons: string[];
}

export interface RuntimeExecutionTrace {
  id: string;
  runtimeSessionId: string;
  releaseId: string;
  nodeId: string;
  promptItemId: string;
  sessionId?: string;
  sequenceIndex?: number;
  roleId: string;
  provider: string;
  model?: string;
  contractHash: string;
  validation: OutputValidationResult;
  fallbackUsed: boolean;
  transitionDecision: string;
  modelRecommendedTransition?: string;
  deterministicTransitionEvaluation?: string;
  committedTransition?: string;
  committedNextNodeId?: string;
  committedNextPromptItemId?: string;
  turnAssociation?: RuntimeTurnAssociation;
  promptExecutionStatuses?: Record<string, PromptExecutionStatus>;
  stateChanges: Record<string, unknown>;
  fidelity: TurnFidelityResult;
  timestamp: string;
}

export interface PatientInput {
  kind: "text" | "single_choice" | "multi_choice" | "rating" | "boolean" | "activity_completion" | "homework_status";
  value: string | string[] | number | boolean;
}

export interface StateExtractionResult {
  fields: Record<string, unknown>;
  responseCategory?: string;
  emotionalState?: string;
  activityCompletion?: "not_started" | "partial" | "completed";
  homeworkStatus?: "not_assigned" | "pending" | "completed";
  riskLevel: "low" | "medium" | "high";
  riskSignals: string[];
  confidence?: number;
  missingFields: string[];
  /**
   * Phase 3 (runtime orchestration simplification): distinguishes a genuine
   * accepted clinical answer from a participant-driven state correction
   * (e.g. "this isn't a goal, remove it") -- both persist `fields` and both
   * report `missingFields: []`, but they must not be treated identically by
   * the reducer: a correction must never consume a repeat_until prompt's
   * iteration budget or be counted as "one more rating given". Optional and
   * defaults to the existing "answer_accepted" behavior everywhere it isn't
   * explicitly set, so every extraction path outside S02's rating-correction
   * gate (runtime-context.ts) is unaffected. "clarification_required" exists
   * for completeness/symmetry with the reducer event naming; in practice
   * every current clarification path already signals via a non-empty
   * `missingFields` instead of setting this.
   */
  inputDisposition?: "answer_accepted" | "state_corrected" | "clarification_required";
}

export interface SafetyOrchestrationResult {
  triggered: boolean;
  severity?: "low" | "medium" | "high";
  ruleIds: string[];
  action: "continue" | "show_fixed_response" | "pause_session" | "escalate_clinician" | "terminate_session";
  fixedResponse?: string;
  escalationRequired: boolean;
  reason?: string;
}

export interface LanguageGenerationInput {
  locale: string;
  protocolNode: ClinicalStageNode;
  promptItem: PromptItem;
  runtimeContext: RuntimeContext;
  lastPatientMessage?: string;
  safetyResult: SafetyOrchestrationResult;
}

export interface LanguageGenerationResult {
  text?: string;
  provider: string;
  model: string;
  latencyMs: number;
  metadata?: Record<string, unknown>;
  error?: string;
}

export interface OutputValidationResult {
  accepted: boolean;
  corrected: boolean;
  rejected: boolean;
  issues: string[];
  finalText?: string;
  fallbackRequired: boolean;
}

export interface RuntimeCycleResult {
  sessionId: string;
  previousNodeId?: string;
  currentNodeId: string;
  currentPromptItemId?: string;
  nextPromptItemId?: string;
  selectedEdgeId?: string;
  nextNodeId?: string;
  stateExtraction?: StateExtractionResult;
  safetyResult: SafetyOrchestrationResult;
  safetyTriggerSuppressed?: boolean;
  suppressionId?: string;
  suppressionReason?: string;
  reusedSafetyEventId?: string;
  generatedMessage?: RuntimeMessage;
  outputValidation?: OutputValidationResult;
  turnOutcome?: RuntimeTurnOutcome;
  fallbackUsed: boolean;
  sessionStatus: RuntimeSessionStatus;
  logIds: string[];
}

export interface RuntimeSessionView {
  session: RuntimeSession;
  release: ProtocolReleaseVersion;
  participant?: RuntimeParticipant;
  nodes: ClinicalStageNode[];
  edges: SourceFidelityEdge[];
  promptItems: PromptItem[];
  currentPromptItem?: PromptItem;
  messages: RuntimeMessage[];
  logs: SessionExecutionLog[];
  checkpoints: RuntimeCheckpoint[];
  escalations: ClinicianEscalationEvent[];
  providerEvents: RuntimeProviderEvent[];
  validationEvents: RuntimeValidationEvent[];
  memoryRetrievalRuns?: MemoryRetrievalResult[];
  memoryUsageLogs?: MemoryUsageLog[];
}

export type PatientRuntimeSession = Pick<RuntimeSession, "id" | "patientAlias" | "sessionDefinitionId" | "status" | "currentNodeId" | "currentPromptItemId" | "updatedAt" | "version" | "locale"> & {
  runtimeContext: Pick<RuntimeContext, "riskLevel">;
};

export type PatientRuntimeMessage = Pick<RuntimeMessage, "id" | "role" | "content" | "status" | "createdAt" | "deliveredAt">;

export interface PatientRuntimeSessionView {
  session: PatientRuntimeSession;
  currentNode?: Pick<ClinicalStageNode, "id" | "title">;
  currentPromptInput?: Pick<PromptItem, "type" | "validation" | "outputFields">;
  messages: PatientRuntimeMessage[];
  hasSafetyReview: boolean;
}

export interface PatientRuntimeReleaseOption {
  id: string;
  version: string;
  publishedAt: string;
  changeSummary: string;
  sessions: Array<Pick<SessionDefinition, "id" | "number" | "title">>;
}
