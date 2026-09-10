import type {
  ClinicalStageNode,
  ConditionExpression,
  PromptItem as SourceFidelityPromptItem,
  PromptExecutionMode,
  PromptScope,
  SessionCommonRules,
  SessionDefinition,
  SessionPlan,
  SourceFidelityEdge,
  SourceFidelityStatus,
  SourceTrace,
  ValidationRule,
} from "@/shared/protocol/source-fidelity-types";

export type ProtocolNodeType =
  | "session_start"
  | "orientation"
  | "dialogue"
  | "question"
  | "assessment"
  | "condition"
  | "activity"
  | "visualization"
  | "homework"
  | "safety_check"
  | "clinician_escalation"
  | "session_complete";

export type ProtocolNodeStatus = "draft" | "needs_review" | "approved" | "validation_error" | "published";

export type RuntimeRoleKind = "speaker" | "controller" | "evaluator";

export type RuntimeSpeakerRoleId = "tbct_guide" | "therapist" | "psychoeducation_guide" | "closing_guide";

export type RuntimeControllerRoleId = "session_manager" | "transition_controller" | "memory_manager";

export type RuntimeEvaluatorRoleId = "protocol_validator" | "safety_evaluator" | "style_evaluator";

export type RuntimeRoleId = RuntimeSpeakerRoleId | RuntimeControllerRoleId | RuntimeEvaluatorRoleId;

export interface RuntimeRoleDefinition {
  id: RuntimeRoleId | string;
  name: string;
  kind: RuntimeRoleKind;
  systemGuidance: string;
  allowedActions: string[];
  forbiddenActions: string[];
}

export interface RuntimeTransitionRule {
  id: string;
  targetNodeId: string;
  condition?: ConditionExpression;
  priority: number;
  isFallback: boolean;
}

export interface RuntimePromptItem {
  id: string;
  sessionId?: string;
  nodeId: string;
  roleId: RuntimeSpeakerRoleId | string;
  scope: PromptScope;
  sequenceIndex: number;
  executionMode: PromptExecutionMode;
  modelGuidance: string;
  requiredPatientFacingContent?: string[];
  fallbackPatientText: string;
  clarificationPatientText?: string;
  activationCondition?: ConditionExpression;
  completionCondition: ConditionExpression;
  allowedActions: string[];
  forbiddenActions: string[];
  requiredFields: string[];
  validationRules: ValidationRule[];
  maxAttempts: number;
  maxClarificationAttempts?: number;
  maxIterations?: number;
  requiresPatientInput: boolean;
  outputSchemaVersion: string;
  sourcePromptItemId?: string;
}

export interface RuntimeNode {
  id: string;
  sessionId: string;
  title: string;
  objective: string;
  speakerRoleId: RuntimeSpeakerRoleId | string;
  promptSequence: string[];
  entryCondition: ConditionExpression;
  completionCondition: ConditionExpression;
  transitionRules: RuntimeTransitionRule[];
  maxNodeIterations: number;
  safetyRuleIds: string[];
}

export interface PolicyBundle {
  globalSafetyRules: string[];
  protocolRules: string[];
  // toneGuidance: clinician-authored, per-session tone/role framing (source:
  // SessionCommonRules.roleAndStance) -- additive phrasing guidance layered
  // on top of the dialogue agent's fixed safety/behavior rules, never able
  // to override them. See anthropic-dialogue-agent.ts's systemPrompt.
  sessionPolicies?: Record<string, { safetyRules: string[]; protocolRules: string[]; toneGuidance?: string }>;
  forbiddenPatientContent: string[];
  maxPromptCharacters: number;
}

export interface RuntimeRelease {
  id: string;
  protocolId: string;
  version: string;
  roles: RuntimeRoleDefinition[];
  nodes: RuntimeNode[];
  promptItems: RuntimePromptItem[];
  policies: PolicyBundle;
  schemaVersion: string;
  contentHash: string;
  publishedAt: string;
}

export interface PromptSegment {
  priority: number;
  label: string;
  content: string;
}

export interface CompiledPromptContract {
  contractId: string;
  releaseId: string;
  nodeId: string;
  promptItemId: string;
  sessionId?: string;
  sequenceIndex?: number;
  roleId: string;
  systemSegments: PromptSegment[];
  runtimeContext: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  fallbackPatientText: string;
  contractHash: string;
}

export interface ProtocolCondition {
  id: string;
  field: string;
  operator: "equals" | "not_equals" | "contains" | "greater_than" | "less_than" | "exists" | "in" | "custom";
  value?: string | number | boolean | string[];
  expression?: string;
}

export interface RuntimeAction {
  actionType:
    | "send_message"
    | "ask_question"
    | "collect_field"
    | "start_activity"
    | "assign_homework"
    | "show_visualization"
    | "run_safety_check"
    | "escalate_clinician"
    | "complete_session";
  payload: Record<string, unknown>;
}

export interface ProtocolGraphNodeData {
  protocolNodeId: string;
  protocolId: string;
  sessionId: string;
  nodeType: ProtocolNodeType;
  title: string;
  clinicalIntent?: string;
  content?: string;
  required: boolean;
  status: ProtocolNodeStatus;
  sourceStructuredItemIds: string[];
  sourceEvidenceIds: string[];
  safetyRuleIds: string[];
  completionConditionIds: string[];
  canonicalNodeId?: string;
  promptItemIds?: string[];
  sourceTrace?: SourceTrace;
  sourceFidelityStatus?: SourceFidelityStatus;
  runtimeAction?: RuntimeAction;
  metadata: {
    createdBy: string;
    createdAt: string;
    updatedBy: string;
    updatedAt: string;
    reviewStatus?: string;
    importedFromCandidateId?: string;
    importedFromSourceDraftId?: string;
  };
}

export interface ProtocolGraphNode {
  id: string;
  protocolId: string;
  sessionId: string;
  type: ProtocolNodeType;
  position: { x: number; y: number };
  data: ProtocolGraphNodeData;
}

export type ProtocolEdgeType = "default" | "conditional" | "fallback" | "safety" | "completion";

export interface ProtocolGraphEdge {
  id: string;
  protocolId: string;
  sessionId: string;
  source: string;
  target: string;
  edgeType: ProtocolEdgeType;
  label?: string;
  condition?: ProtocolCondition;
  priority: number;
  isFallback: boolean;
  sourceStructuredItemId?: string;
  sourceEvidenceIds: string[];
  sourceTrace?: SourceTrace;
  sourceFidelityStatus?: SourceFidelityStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ProtocolSession {
  id: string;
  protocolId: string;
  title: string;
  order: number;
  goals: string[];
  entryNodeId?: string;
  completionNodeIds: string[];
  nodeIds: string[];
  edgeIds: string[];
  status: ProtocolNodeStatus;
  locale: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProtocolDefinition {
  id: string;
  projectId: string;
  title: string;
  description?: string;
  locale: string;
  country: string;
  currentVersion: string;
  status: "draft" | "clinical_review" | "validated" | "published" | "archived";
  sessionIds: string[];
  globalSafetyRuleIds: string[];
  runtimeSchemaVersion: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProtocolImportWarning {
  id: string;
  severity: "critical" | "warning" | "information";
  structuredItemId?: string;
  message: string;
  suggestedAction?: string;
}

export interface ProtocolImportResult {
  candidateId: string;
  protocolId: string;
  sessionId: string;
  createdNodeIds: string[];
  createdEdgeIds: string[];
  skippedItemIds: string[];
  conflictIds: string[];
  warnings: ProtocolImportWarning[];
}

export interface ProtocolValidationIssue {
  id: string;
  protocolId: string;
  sessionId?: string;
  nodeId?: string;
  edgeId?: string;
  severity: "critical" | "warning" | "information";
  category: string;
  message: string;
  suggestedAction?: string;
}

export interface ProtocolValidationRun {
  id: string;
  protocolId: string;
  executedAt: string;
  summary: {
    critical: number;
    warning: number;
    information: number;
    passedChecks: number;
    sourceCoverage: number;
    runtimeCompatibility: "ready" | "review" | "blocked";
  };
  issues: ProtocolValidationIssue[];
}

export interface RuntimeExecutionLog {
  id: string;
  protocolId: string;
  sessionId: string;
  startedAt: string;
  steps: Array<{
    nodeId: string;
    actionType?: string;
    selectedEdgeId?: string;
    nextNodeId?: string;
    conditionSummary: string[];
  }>;
}

export interface ProtocolReleasePackage {
  id: string;
  protocolId: string;
  protocolVersion: string;
  targetEnvironment: "development" | "staging" | "pilot";
  packageChecksum: string;
  files: Record<string, string>;
  generatedAt: string;
  generatedBy: string;
}

export interface SourceFidelityReleaseSnapshot {
  canonicalProtocolId: string;
  sourceVersion: string;
  sourceTextHash: string;
  sessionPlan: SessionPlan;
  sessionDefinitions: SessionDefinition[];
  sessionCommonRules: Record<string, SessionCommonRules>;
  clinicalStageNodes: ClinicalStageNode[];
  promptItems: SourceFidelityPromptItem[];
  sourceFidelityEdges: SourceFidelityEdge[];
}

export interface ProtocolReleaseVersion {
  id: string;
  protocolId: string;
  version: string;
  releasePackageId: string;
  publishedAt: string;
  publishedBy: string;
  changeSummary: string;
  immutableSnapshot: {
    nodes: ProtocolGraphNode[];
    edges: ProtocolGraphEdge[];
    sourceFidelity?: SourceFidelityReleaseSnapshot;
    runtimeRelease?: RuntimeRelease;
  };
}
