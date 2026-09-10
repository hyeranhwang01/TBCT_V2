export type SourceFidelityStatus = "exact" | "structured_from_source" | "review_required" | "source_missing";

export type ConditionOperator = "equals" | "not_equals" | "contains" | "greater_than" | "less_than" | "exists" | "in";

export type ConditionExpression = {
  kind?: "always" | "field";
  field?: string;
  operator?: ConditionOperator;
  value?: string | number | boolean | string[];
};

export type PromptScope = "global" | "protocol" | "session" | "node" | "step" | "turn";

export type PromptExecutionMode = "serial" | "conditional" | "repeat_until" | "optional";

export type ValidationRule = {
  id?: string;
  kind: string;
  [key: string]: unknown;
};

export type PromptItemType =
  | "instruction"
  | "opening"
  | "explanation"
  | "question"
  | "clarification"
  | "follow_up"
  | "confirmation"
  | "reflection"
  | "rating"
  | "summary"
  | "transition"
  | "closing"
  | "role_transition"
  | "worksheet_instruction";

export type SourceTrace = {
  sourceDocument: "TBCT pasted source text";
  sourceSession: string;
  sourceSection: string;
  sourceLineStart: number;
  sourceLineEnd: number;
  sourceTextHash: string;
  sourceSessionHash?: string;
  importedVersion: string;
  rawSourceExcerpt?: string;
  reviewWarnings?: string[];
};

export type SessionDefinitionStatus = "draft" | "reviewed" | "released";

export type SessionDefinition = {
  id: string;
  protocolId: string;
  number: number;
  title: string;
  /** Clinician-facing Korean session name -- purely a display label (see
   * findSessionTitle), never validated against sourceTrace/sourceFidelityStatus
   * the way title's own English wording traces back to the source manual.
   * Falls back to `title` wherever unset. */
  titleKo?: string;
  techniqueName: string;
  acronym?: string;
  contextAndPurpose: string;
  roleAndStance: string;
  sessionObjective: string;
  languageRules: string[];
  openingRules: string[];
  sessionWideRequiredActions: string[];
  sessionWideRestrictions: string[];
  sessionWideSafetyRules: string[];
  startNodeId: string;
  completionNodeId: string;
  sourceTrace: SourceTrace;
  sourceFidelityStatus: SourceFidelityStatus;
  status: SessionDefinitionStatus;
  createdAt: string;
  updatedAt: string;
  // Display and legacy-query aliases. These always derive from the canonical
  // fields above and are not independent clinical content.
  technique: string;
  clinicalPurpose: string;
  roleInstruction: string;
  nodeCount: number;
  promptCount: number;
  validationStatus: "review" | "ready" | "blocked";
};

export type ClinicalStageNode = {
  id: string;
  protocolId: string;
  sessionId: string;
  title: string;
  /** Clinician-facing Korean step name -- purely a display label (see
   * SessionDefinition.titleKo above), never validated against sourceTrace
   * the way title's own English wording traces back to the source manual. */
  titleKo?: string;
  type: string;
  clinicalPurpose: string;
  /** Overrides clinicalPurpose as the dialogue agent's "Therapeutic objective
   * for this step" grounding text (runtime-release-normalizer.ts /
   * dialogue-contract-compiler.ts both already prefer this field when set --
   * see their own `node.objective || node.clinicalPurpose` fallback). Needed
   * because clinicalPurpose is sourceText(node.source) verbatim: when a
   * node's own patient-facing content has been redesigned away from the
   * source manual's literal wording (see S01's presentation-vignette
   * redesign) but its `source` line range still spans manual text describing
   * the OLD wording, clinicalPurpose keeps handing the model stale grounding
   * -- confirmed live: several S01 Step-2 nodes' source ranges still
   * captured leftover job-interview-scenario sentences ("the interviewer's
   * reaction, positive or negative?") after the vignette was redesigned, and
   * the dialogue agent voiced them verbatim to patients even though no
   * interviewer exists anywhere in the current content. Set this whenever a
   * node's redesigned content diverges from what its own source range says. */
  objective?: string;
  /** Short (1-2 sentence), participant-facing "why this step matters" text,
   * paraphrased from this node's own clinicalPurpose/objective -- not new
   * clinical content. Optional: only populated for nodes where an
   * unfamiliar or abstract task benefits from an explicit rationale before
   * or during the exercise (dialogue-agent spec Part 8). Absent on most
   * nodes; the dialogue agent falls back to therapeuticObjective alone. */
  participantRationale?: string;
  speakerRoleId?: string;
  entryCondition?: ConditionExpression;
  completionCondition?: ConditionExpression;
  maxNodeIterations?: number;
  position: { x: number; y: number };
  promptItemIds: string[];
  requiredFields: string[];
  completionRule: Record<string, unknown>;
  branchRules: Array<Record<string, unknown>>;
  restrictions: string[];
  safetyRuleIds: string[];
  defaultNextNodeId?: string;
  fallbackNodeId?: string;
  sourceTrace: SourceTrace;
  sourceFidelityStatus: Exclude<SourceFidelityStatus, "source_missing">;
  status: "active" | "disabled" | "deprecated";
  createdAt: string;
  updatedAt: string;
};

export type PromptItem = {
  id: string;
  protocolId: string;
  sessionId: string;
  nodeId: string;
  order: number;
  sequenceIndex?: number;
  type: PromptItemType;
  verbatimText: string;
  editableText: string;
  /** @deprecated Use modelGuidance for runtime compilation. */
  aiInstruction: string;
  modelGuidance?: string;
  fallbackPatientText?: string;
  /**
   * Short natural-language cue copied from the authoring spec's `marker`.
   * Used only when `verbatimText` collapses to a full source paragraph
   * (marker not found as an isolated quote) so the runtime fallback
   * generator has real clinical wording to build a patient-facing
   * question from instead of a generic instruction-shaped template.
   */
  markerHint?: string;
  roleId?: string;
  scope?: PromptScope;
  executionMode?: PromptExecutionMode;
  activationCondition: Record<string, unknown> | null;
  completionCondition?: ConditionExpression;
  outputFields: string[];
  requiredFields?: string[];
  validation: Record<string, unknown> | null;
  validationRules?: ValidationRule[];
  completionEffect: Record<string, unknown> | null;
  allowedActions?: string[];
  forbiddenActions?: string[];
  maxAttempts?: number;
  maxIterations?: number;
  outputSchemaVersion?: string;
  restrictions: string[];
  safetyRuleIds: string[];
  sourceTrace: SourceTrace;
  sourceFidelityStatus: Exclude<SourceFidelityStatus, "source_missing">;
  origin: "source_imported" | "custom";
  sourceHash: string;
  status: "active" | "disabled" | "deprecated";
  createdAt: string;
  updatedAt: string;
  updatedBy: string;
  sourceUpdateAvailable?: boolean;
  migrationHistory?: Array<{
    migrationVersion: string;
    previousId?: string;
    mapping: "exact" | "conflict" | "deprecated" | "source_changed";
    at: string;
  }>;
};

export type SessionPlanStatus = "draft" | "validated" | "released";

export type SessionPlanEntry = {
  entryId: string;
  sessionId: string;
  order: number;
  active: boolean;
  occurrence: number;
  label: string;
};

export type SessionPlan = {
  id: string;
  protocolId: string;
  orderedEntries: SessionPlanEntry[];
  startingEntryId: string;
  status: SessionPlanStatus;
  version: string;
  createdAt: string;
  updatedAt: string;
};

export type SessionCommonRules = {
  sessionTitle: string;
  techniqueName: string;
  roleAndStance: string;
  sessionObjective: string;
  languageRules: string[];
  openingRules: string[];
  sessionWideRequiredActions: string[];
  sessionWideRestrictions: string[];
  sessionWideSafetyRules: string[];
  sourceTrace: SourceTrace;
  sourceFidelityStatus: SourceFidelityStatus;
  version: string;
  status: "incomplete" | "clinical_review" | "safety_review" | "validated" | "published";
  // Compatibility fields maintained as derived display values until the
  // existing Inspector is switched fully to the canonical names.
  clinicalContext: string;
  previousSessionContext: string;
  languageAndTerminologyRules: string;
  toneAndInteractionRules: string;
  safetyAndEscalationRules: string;
  defaultModalityRules: string[];
};

export type SourceFidelityEdge = {
  id: string;
  protocolId: string;
  sessionId: string;
  source: string;
  target: string;
  edgeType: "default" | "conditional" | "fallback" | "safety" | "completion";
  label?: string;
  condition?: {
    field: string;
    operator: "equals" | "not_equals" | "contains" | "greater_than" | "less_than" | "exists" | "in";
    value?: string | number | boolean | string[];
  };
  priority: number;
  isFallback: boolean;
  sourceTrace: SourceTrace;
};

export type SourceFidelitySessionSeed = {
  definition: SessionDefinition;
  commonRules: SessionCommonRules;
  nodes: ClinicalStageNode[];
  promptItems: PromptItem[];
  edges: SourceFidelityEdge[];
};

export type SourceFidelityBackup = {
  id: "pre-full-source-fidelity-rebuild";
  createdAt: string;
  migrationVersion: string;
  sessionDefinitions: unknown[];
  nodes: unknown[];
  edges: unknown[];
  promptItems: unknown[];
  sessionPlan: unknown | null;
  releases: unknown[];
  runtimeReferences: unknown[];
  sourceTraces: unknown[];
};