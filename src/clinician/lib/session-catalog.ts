import { readBrowserStorageItem, writeBrowserStorageItem } from "@/shared/browser-storage";
import {
  CANONICAL_PROTOCOL_ID,
  CANONICAL_PROMPT_ITEMS,
  CANONICAL_SESSION_COMMON_RULES,
  CANONICAL_SESSION_DEFINITIONS,
  CANONICAL_SESSION_PLAN,
  CANONICAL_SOURCE_EDGES,
  CANONICAL_SOURCE_VERSION,
  CANONICAL_STAGE_NODES,
  resolveCanonicalSessionId,
} from "@/shared/protocol/source-fidelity-catalog";
import { TBCT_SOURCE_TEXT_HASH } from "@/shared/protocol/tbct-source-text.generated";
import type { ConditionExpression, PromptExecutionMode, PromptScope, SourceFidelityBackup, SourceTrace as CanonicalSourceTrace, ValidationRule } from "@/shared/protocol/source-fidelity-types";
import type { SourceFidelityReleaseSnapshot } from "@/types/protocol-runtime";

export type SessionPlanStatus = "draft" | "validated" | "released";
export type PromptItemType = "instruction" | "opening" | "explanation" | "question" | "clarification" | "follow_up" | "confirmation" | "reflection" | "rating" | "assessment" | "summary" | "transition" | "closing" | "role_transition" | "worksheet_instruction";
export type SourceTrace = {
  sourceDocument: string;
  sourceSection: string;
  importedVersion: string;
  sessionNumber?: number;
  sourcePage?: number;
  sourceBlockId?: string;
  sourceSession?: string;
  sourceLineStart?: number;
  sourceLineEnd?: number;
  sourceTextHash?: string;
  sourceSessionHash?: string;
  rawSourceExcerpt?: string;
  reviewWarnings?: string[];
};
export type SessionDefinitionStatus = "draft" | "reviewed" | "released";
export type SourceFidelityStatus = "exact" | "structured_from_source" | "review_required" | "source_missing";
export type NodeInspectorTab = "prompt" | "flow" | "data" | "safety" | "qa";
export type ConditionGroup = { allOf?: Array<{ key: string; operator: string; value?: string | number | boolean | string[] }>; anyOf?: Array<{ key: string; operator: string; value?: string | number | boolean | string[] }>; description?: string };
export type CaptureField = { id: string; key: string; label: string; type: "string" | "number" | "boolean" | "array" | "object" | "rating" | "enum"; required: boolean; min?: number; max?: number; minItems?: number; maxItems?: number; preserveVerbatim: boolean; normalizedFieldKey?: string; sourceTurnRequired: boolean };
export type NodeTransition = { id: string; sourceNodeId: string; targetNodeId: string; label: string; condition?: ConditionGroup; priority: number; isFallback: boolean; transitionType: "default" | "conditional" | "skip" | "return" | "safety" | "pause" | "resume" };
export type SafetyRule = { id: string; name: string; scope: "global" | "session" | "node"; description: string; trigger: ConditionGroup; severity: "warning" | "pause" | "escalate" | "terminate"; assistantAction: string; routeToNodeId?: string; requiresClinicianReview: boolean; resumeCondition?: ConditionGroup };
export type PromptVariantKind = "primary" | "alternative" | "probe" | "clarification" | "reflection" | "redirect" | "fallback" | "closing";
export type PromptVariant = { id: string; label: string; kind: PromptVariantKind; content: string; trigger?: ConditionGroup; priority: number; isRequired: boolean };
export type SessionCommonRules = {
  sessionTitle: string;
  techniqueName: string;
  roleAndStance: string;
  sessionObjective: string;
  clinicalContext: string;
  previousSessionContext: string;
  languageAndTerminologyRules: string;
  toneAndInteractionRules: string;
  sessionWideRequiredActions: string[];
  sessionWideRestrictions: string[];
  safetyAndEscalationRules: string;
  defaultModalityRules: string[];
  version: string;
  status: "incomplete" | "clinical_review" | "safety_review" | "validated" | "published";
  sourceTrace?: SourceTrace;
  sourceFidelityStatus?: SourceFidelityStatus;
  languageRules?: string[];
  openingRules?: string[];
  sessionWideSafetyRules?: string[];
};

export interface SessionPlanEntry { entryId: string; sessionId: string; order: number; active: boolean; occurrence: number; label: string; }
export interface SessionPlan { id: string; protocolId: string; orderedEntries: SessionPlanEntry[]; startingEntryId: string; status: SessionPlanStatus; version: string; createdAt: string; updatedAt: string; }
export interface SessionDefinition { id: string; protocolId: string; number: number; title: string; technique: string; clinicalPurpose: string; roleInstruction: string; restrictions: string[]; languageRules: string[]; status: SessionDefinitionStatus; sourceTrace: SourceTrace; sourceFidelityStatus?: SourceFidelityStatus; nodeCount: number; promptCount: number; validationStatus: "review" | "ready" | "blocked"; }
export interface ClinicalStageNode { id: string; protocolId: string; sessionId: string; title: string; type: string; clinicalPurpose: string; objective?: string; speakerRoleId?: string; entryCondition?: ConditionExpression; completionCondition?: ConditionExpression; maxNodeIterations?: number; position: { x: number; y: number }; promptItemIds?: string[]; requiredFields: string[]; completionRule: object; branchRules: object[]; restrictions: string[]; safetyRuleIds: string[]; sourceTrace: SourceTrace; sourceFidelityStatus?: SourceFidelityStatus; status: string; }
export interface PromptItem { id: string; protocolId: string; sessionId: string; nodeId: string; order: number; sequenceIndex?: number; type: PromptItemType; status: "active" | "disabled" | "deprecated"; verbatimText: string; editableText: string; aiInstruction: string; modelGuidance?: string; fallbackPatientText?: string; roleId?: string; scope?: PromptScope; executionMode?: PromptExecutionMode; activationCondition: object | null; completionCondition?: ConditionExpression; outputFields: string[]; requiredFields?: string[]; validation: object | null; validationRules?: ValidationRule[]; completionEffect: object | null; allowedActions?: string[]; forbiddenActions?: string[]; maxAttempts?: number; maxIterations?: number; outputSchemaVersion?: string; restrictions?: string[]; safetyRuleIds?: string[]; sourceTrace: SourceTrace; sourceFidelityStatus?: SourceFidelityStatus; origin?: "source_imported" | "imported" | "custom"; sourceHash?: string; sourceUpdateAvailable?: boolean; migrationHistory?: Array<{ migrationVersion: string; previousId?: string; mapping: "exact" | "conflict" | "deprecated" | "source_changed"; at: string }>; createdAt: string; updatedAt: string; updatedBy: string; }

const STORAGE_KEY = "tbct.session-catalog.v2";
const now = () => new Date().toISOString();

export const SOURCE_FIDELITY_CATALOG_BACKUP_ID = "pre-full-source-fidelity-rebuild";

const SOURCE_FIDELITY_SCHEMA_VERSION = "source-fidelity-catalog/v1";
const SOURCE_FIDELITY_BACKUP_STORAGE_KEY = `tbct.source-fidelity-backup.${SOURCE_FIDELITY_CATALOG_BACKUP_ID}`;

export type SourceFidelityCatalogConflict = {
  legacyItemId: string;
  reason: "unmapped_legacy_item" | "source_changed";
  editableText?: string;
  status?: string;
  sourceTrace?: unknown;
};

type SourceFidelityCatalogStore = {
  schemaVersion: typeof SOURCE_FIDELITY_SCHEMA_VERSION;
  sourceVersion: string;
  sourceTextHash: string;
  plan: SessionPlan;
  definitions: SessionDefinition[];
  nodes: ClinicalStageNode[];
  promptItems: PromptItem[];
  commonRules: Record<string, SessionCommonRules>;
  migrationConflicts: SourceFidelityCatalogConflict[];
};

export type SessionCatalogEntry = Pick<SessionDefinition, "id" | "number" | "title" | "technique" | "clinicalPurpose" | "nodeCount" | "promptCount" | "validationStatus" | "sourceTrace"> & {
  active: boolean;
};

function cloneSourceValue<T>(value: T): T {
  return structuredClone(value);
}

function toCatalogSourceTrace(sourceTrace: CanonicalSourceTrace): SourceTrace {
  return {
    sourceDocument: sourceTrace.sourceDocument,
    sourceSession: sourceTrace.sourceSession,
    sourceSection: sourceTrace.sourceSection,
    sourceLineStart: sourceTrace.sourceLineStart,
    sourceLineEnd: sourceTrace.sourceLineEnd,
    sourceTextHash: sourceTrace.sourceTextHash,
    sourceSessionHash: sourceTrace.sourceSessionHash,
    importedVersion: sourceTrace.importedVersion,
    rawSourceExcerpt: sourceTrace.rawSourceExcerpt,
    reviewWarnings: sourceTrace.reviewWarnings ? [...sourceTrace.reviewWarnings] : undefined,
  };
}

function createSourceFidelityStore(): SourceFidelityCatalogStore {
  const definitions = CANONICAL_SESSION_DEFINITIONS.map((definition) => ({
    id: definition.id,
    protocolId: definition.protocolId,
    number: definition.number,
    title: definition.title,
    technique: definition.technique,
    clinicalPurpose: definition.clinicalPurpose,
    roleInstruction: definition.roleInstruction,
    restrictions: [...definition.sessionWideRestrictions],
    languageRules: [...definition.languageRules],
    status: definition.status,
    sourceTrace: toCatalogSourceTrace(definition.sourceTrace),
    sourceFidelityStatus: definition.sourceFidelityStatus,
    nodeCount: definition.nodeCount,
    promptCount: definition.promptCount,
    validationStatus: definition.validationStatus,
  } satisfies SessionDefinition));
  const nodes = CANONICAL_STAGE_NODES.map((node) => ({
    ...cloneSourceValue(node),
    promptItemIds: [...node.promptItemIds],
    sourceTrace: toCatalogSourceTrace(node.sourceTrace),
  } satisfies ClinicalStageNode));
  const promptItems = CANONICAL_PROMPT_ITEMS.map((promptItem) => ({
    ...cloneSourceValue(promptItem),
    sourceTrace: toCatalogSourceTrace(promptItem.sourceTrace),
  } satisfies PromptItem));
  const commonRules = Object.fromEntries(
    Object.entries(CANONICAL_SESSION_COMMON_RULES).map(([sessionId, rules]) => [
      sessionId,
      {
        ...cloneSourceValue(rules),
        sourceTrace: toCatalogSourceTrace(rules.sourceTrace),
      } satisfies SessionCommonRules,
    ]),
  ) as Record<string, SessionCommonRules>;

  return {
    schemaVersion: SOURCE_FIDELITY_SCHEMA_VERSION,
    sourceVersion: CANONICAL_SOURCE_VERSION,
    sourceTextHash: TBCT_SOURCE_TEXT_HASH,
    plan: cloneSourceValue(CANONICAL_SESSION_PLAN),
    definitions,
    nodes,
    promptItems,
    commonRules,
    migrationConflicts: [],
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function legacyBackupFrom(value: unknown): SourceFidelityBackup {
  const record = asRecord(value) ?? {};
  const sourceTraces = [
    ...asArray(record.definitions),
    ...asArray(record.nodes),
    ...asArray(record.promptItems),
  ].flatMap((item) => {
    const sourceTrace = asRecord(item)?.sourceTrace;
    return sourceTrace ? [sourceTrace] : [];
  });

  return {
    id: SOURCE_FIDELITY_CATALOG_BACKUP_ID,
    createdAt: now(),
    migrationVersion: CANONICAL_SOURCE_VERSION,
    sessionDefinitions: asArray(record.definitions),
    nodes: asArray(record.nodes),
    edges: asArray(record.edges),
    promptItems: asArray(record.promptItems),
    sessionPlan: record.plan ?? null,
    releases: asArray(record.releases),
    runtimeReferences: asArray(record.runtimeReferences),
    sourceTraces,
  };
}

function preserveLegacyCatalogBackup(value: unknown) {
  if (readBrowserStorageItem(SOURCE_FIDELITY_BACKUP_STORAGE_KEY)) return;
  writeBrowserStorageItem(SOURCE_FIDELITY_BACKUP_STORAGE_KEY, JSON.stringify(legacyBackupFrom(value)));
}

function sourceAnchorMatches(value: unknown, sourcePrompt: PromptItem) {
  const candidate = asRecord(value);
  const sourceTrace = asRecord(candidate?.sourceTrace);
  return candidate?.id === sourcePrompt.id
    && candidate.sourceHash === sourcePrompt.sourceHash
    && sourceTrace?.sourceTextHash === sourcePrompt.sourceTrace.sourceTextHash
    && sourceTrace?.sourceLineStart === sourcePrompt.sourceTrace.sourceLineStart
    && sourceTrace?.sourceLineEnd === sourcePrompt.sourceTrace.sourceLineEnd;
}

function collectMigrationConflicts(value: unknown, baseline: SourceFidelityCatalogStore) {
  const record = asRecord(value) ?? {};
  const sourcePrompts = new Map(baseline.promptItems.map((promptItem) => [promptItem.id, promptItem]));
  return asArray(record.promptItems).flatMap((legacyPrompt): SourceFidelityCatalogConflict[] => {
    const prompt = asRecord(legacyPrompt);
    const id = typeof prompt?.id === "string" ? prompt.id : "unknown-legacy-prompt";
    const current = sourcePrompts.get(id);
    if (current && sourceAnchorMatches(prompt, current)) return [];
    return [{
      legacyItemId: id,
      reason: current ? "source_changed" : "unmapped_legacy_item",
      editableText: typeof prompt?.editableText === "string" ? prompt.editableText : undefined,
      status: typeof prompt?.status === "string" ? prompt.status : undefined,
      sourceTrace: prompt?.sourceTrace,
    }];
  });
}

function mergePersistedSourceStore(value: unknown, baseline: SourceFidelityCatalogStore) {
  const record = asRecord(value) ?? {};
  const persistedPrompts = asArray(record.promptItems);
  const persistedNodes = asArray(record.nodes);
  const persistedCommonRules = asRecord(record.commonRules) ?? {};
  const migrationConflicts = collectMigrationConflicts(value, baseline);
  const nodes = baseline.nodes.map((sourceNode) => {
    const stored = asRecord(persistedNodes.find((item) => asRecord(item)?.id === sourceNode.id));
    return {
      ...sourceNode,
      objective: typeof stored?.objective === "string" ? stored.objective : sourceNode.objective,
      speakerRoleId: typeof stored?.speakerRoleId === "string" ? stored.speakerRoleId : sourceNode.speakerRoleId,
      entryCondition: stored?.entryCondition && typeof stored.entryCondition === "object" ? stored.entryCondition as ConditionExpression : sourceNode.entryCondition,
      completionCondition: stored?.completionCondition && typeof stored.completionCondition === "object" ? stored.completionCondition as ConditionExpression : sourceNode.completionCondition,
      maxNodeIterations: typeof stored?.maxNodeIterations === "number" ? stored.maxNodeIterations : sourceNode.maxNodeIterations,
    } satisfies ClinicalStageNode;
  });
  const promptItems = baseline.promptItems.map((sourcePrompt) => {
    const storedPrompt = persistedPrompts.find((item) => asRecord(item)?.id === sourcePrompt.id);
    if (!storedPrompt) return sourcePrompt;
    const stored = asRecord(storedPrompt);
    if (!sourceAnchorMatches(stored, sourcePrompt)) {
      return {
        ...sourcePrompt,
        sourceUpdateAvailable: true,
        migrationHistory: [{ migrationVersion: CANONICAL_SOURCE_VERSION, previousId: sourcePrompt.id, mapping: "source_changed", at: now() }],
      } satisfies PromptItem;
    }
    const status = stored?.status === "disabled" ? "disabled" : "active";
    return {
      ...sourcePrompt,
      editableText: typeof stored?.editableText === "string" ? stored.editableText : sourcePrompt.editableText,
      aiInstruction: typeof stored?.aiInstruction === "string" ? stored.aiInstruction : sourcePrompt.aiInstruction,
      modelGuidance: typeof stored?.modelGuidance === "string" ? stored.modelGuidance : sourcePrompt.modelGuidance,
      fallbackPatientText: typeof stored?.fallbackPatientText === "string" ? stored.fallbackPatientText : sourcePrompt.fallbackPatientText,
      sequenceIndex: typeof stored?.sequenceIndex === "number" ? stored.sequenceIndex : sourcePrompt.sequenceIndex,
      roleId: typeof stored?.roleId === "string" ? stored.roleId : sourcePrompt.roleId,
      scope: typeof stored?.scope === "string" ? stored.scope as PromptScope : sourcePrompt.scope,
      executionMode: typeof stored?.executionMode === "string" ? stored.executionMode as PromptExecutionMode : sourcePrompt.executionMode,
      completionCondition: stored?.completionCondition && typeof stored.completionCondition === "object" ? stored.completionCondition as ConditionExpression : sourcePrompt.completionCondition,
      requiredFields: Array.isArray(stored?.requiredFields) ? stored.requiredFields.filter((value): value is string => typeof value === "string") : sourcePrompt.requiredFields,
      validationRules: Array.isArray(stored?.validationRules) ? stored.validationRules.filter((value): value is ValidationRule => Boolean(value && typeof value === "object" && typeof asRecord(value)?.id === "string")) : sourcePrompt.validationRules,
      allowedActions: Array.isArray(stored?.allowedActions) ? stored.allowedActions.filter((value): value is string => typeof value === "string") : sourcePrompt.allowedActions,
      forbiddenActions: Array.isArray(stored?.forbiddenActions) ? stored.forbiddenActions.filter((value): value is string => typeof value === "string") : sourcePrompt.forbiddenActions,
      maxAttempts: typeof stored?.maxAttempts === "number" ? stored.maxAttempts : sourcePrompt.maxAttempts,
      maxIterations: typeof stored?.maxIterations === "number" ? stored.maxIterations : sourcePrompt.maxIterations,
      outputSchemaVersion: typeof stored?.outputSchemaVersion === "string" ? stored.outputSchemaVersion : sourcePrompt.outputSchemaVersion,
      status,
      updatedAt: typeof stored?.updatedAt === "string" ? stored.updatedAt : sourcePrompt.updatedAt,
      updatedBy: typeof stored?.updatedBy === "string" ? stored.updatedBy : sourcePrompt.updatedBy,
      migrationHistory: [{ migrationVersion: CANONICAL_SOURCE_VERSION, previousId: sourcePrompt.id, mapping: "exact", at: now() }],
    } satisfies PromptItem;
  });

  const commonRules = Object.fromEntries(Object.entries(baseline.commonRules).map(([sessionId, sourceRules]) => {
    const stored = asRecord(persistedCommonRules[sessionId]);
    const textFields = ["sessionTitle", "techniqueName", "roleAndStance", "sessionObjective", "clinicalContext", "previousSessionContext", "languageAndTerminologyRules", "toneAndInteractionRules", "safetyAndEscalationRules", "version"] as const;
    const arrayFields = ["sessionWideRequiredActions", "sessionWideRestrictions", "defaultModalityRules", "languageRules", "openingRules", "sessionWideSafetyRules"] as const;
    const merged = { ...sourceRules } as SessionCommonRules;
    for (const field of textFields) {
      if (typeof stored?.[field] === "string") merged[field] = stored[field] as never;
    }
    for (const field of arrayFields) {
      if (Array.isArray(stored?.[field])) merged[field] = stored[field]!.filter((item): item is string => typeof item === "string") as never;
    }
    if (stored?.status === "incomplete" || stored?.status === "clinical_review" || stored?.status === "safety_review" || stored?.status === "validated" || stored?.status === "published") {
      merged.status = stored.status;
    }
    return [sessionId, merged];
  }));

  return { ...baseline, nodes, promptItems, commonRules, migrationConflicts };
}

function readSourceFidelityStore(): SourceFidelityCatalogStore {
  const baseline = createSourceFidelityStore();
  const raw = readBrowserStorageItem(STORAGE_KEY);
  if (!raw) return baseline;

  try {
    const parsed = JSON.parse(raw) as unknown;
    const record = asRecord(parsed);
    if (record?.schemaVersion !== SOURCE_FIDELITY_SCHEMA_VERSION) {
      preserveLegacyCatalogBackup(parsed);
      const migrated = { ...baseline, migrationConflicts: collectMigrationConflicts(parsed, baseline) };
      writeBrowserStorageItem(STORAGE_KEY, JSON.stringify(migrated));
      return migrated;
    }
    const merged = mergePersistedSourceStore(parsed, baseline);
    writeBrowserStorageItem(STORAGE_KEY, JSON.stringify(merged));
    return merged;
  } catch {
    return baseline;
  }
}

export const sessionCatalog: SessionCatalogEntry[] = [];

function synchronizeSessionCatalog(store: SourceFidelityCatalogStore) {
  const activeSessionIds = new Set(store.plan.orderedEntries.filter((entry) => entry.active).map((entry) => entry.sessionId));
  sessionCatalog.splice(
    0,
    sessionCatalog.length,
    ...store.definitions.map((definition) => ({
      id: definition.id,
      number: definition.number,
      title: definition.title,
      technique: definition.technique,
      clinicalPurpose: definition.clinicalPurpose,
      nodeCount: definition.nodeCount,
      promptCount: definition.promptCount,
      validationStatus: definition.validationStatus,
      active: activeSessionIds.has(definition.id),
      sourceTrace: definition.sourceTrace,
    })),
  );
}

let sourceFidelityStore = readSourceFidelityStore();
synchronizeSessionCatalog(sourceFidelityStore);

function getSourceFidelityStore() {
  return sourceFidelityStore;
}

function persistSourceFidelityStore(store: SourceFidelityCatalogStore) {
  // In-memory state is updated first, so a blocked write costs persistence
  // across reloads but never correctness within the session.
  sourceFidelityStore = store;
  synchronizeSessionCatalog(store);
  writeBrowserStorageItem(STORAGE_KEY, JSON.stringify(store));
}

function canonicalCatalogSessionId(sessionId?: string) {
  return resolveCanonicalSessionId(sessionId) ?? sessionId;
}

function updateSourcePrompt(sourcePrompt: PromptItem, patch: Partial<PromptItem>): PromptItem {
  return {
    ...sourcePrompt,
    editableText: typeof patch.editableText === "string" ? patch.editableText : sourcePrompt.editableText,
    aiInstruction: typeof patch.aiInstruction === "string" ? patch.aiInstruction : sourcePrompt.aiInstruction,
    modelGuidance: typeof patch.modelGuidance === "string" ? patch.modelGuidance : sourcePrompt.modelGuidance,
    fallbackPatientText: typeof patch.fallbackPatientText === "string" ? patch.fallbackPatientText : sourcePrompt.fallbackPatientText,
    sequenceIndex: typeof patch.sequenceIndex === "number" ? patch.sequenceIndex : sourcePrompt.sequenceIndex,
    roleId: typeof patch.roleId === "string" ? patch.roleId : sourcePrompt.roleId,
    scope: patch.scope ?? sourcePrompt.scope,
    executionMode: patch.executionMode ?? sourcePrompt.executionMode,
    completionCondition: patch.completionCondition ?? sourcePrompt.completionCondition,
    requiredFields: patch.requiredFields ? [...patch.requiredFields] : sourcePrompt.requiredFields,
    validationRules: patch.validationRules ? patch.validationRules.map((rule) => ({ ...rule })) : sourcePrompt.validationRules,
    allowedActions: patch.allowedActions ? [...patch.allowedActions] : sourcePrompt.allowedActions,
    forbiddenActions: patch.forbiddenActions ? [...patch.forbiddenActions] : sourcePrompt.forbiddenActions,
    maxAttempts: typeof patch.maxAttempts === "number" ? patch.maxAttempts : sourcePrompt.maxAttempts,
    maxIterations: typeof patch.maxIterations === "number" ? patch.maxIterations : sourcePrompt.maxIterations,
    outputSchemaVersion: typeof patch.outputSchemaVersion === "string" ? patch.outputSchemaVersion : sourcePrompt.outputSchemaVersion,
    status: patch.status === "disabled" ? "disabled" : patch.status === "active" ? "active" : sourcePrompt.status,
    updatedAt: now(),
    updatedBy: "Demo User",
  };
}

export function loadSessionPlan() { return getSourceFidelityStore().plan; }
export function saveSessionPlan(_plan: SessionPlan) { return loadSessionPlan(); }
export function restoreDefaultSessionPlan() {
  const next = createSourceFidelityStore();
  persistSourceFidelityStore(next);
  return next.plan;
}
export function loadSessionDefinitions() { return getSourceFidelityStore().definitions; }
export function loadStageNodes(sessionId?: string) {
  const canonicalSessionId = canonicalCatalogSessionId(sessionId);
  return canonicalSessionId ? getSourceFidelityStore().nodes.filter((node) => node.sessionId === canonicalSessionId) : getSourceFidelityStore().nodes;
}
export function loadPromptItems(sessionId?: string, nodeId?: string) {
  const canonicalSessionId = canonicalCatalogSessionId(sessionId);
  return getSourceFidelityStore().promptItems.filter((promptItem) => (!canonicalSessionId || promptItem.sessionId === canonicalSessionId) && (!nodeId || promptItem.nodeId === nodeId));
}
export function getSessionCommonRules(sessionId: string) {
  const canonicalSessionId = canonicalCatalogSessionId(sessionId);
  return canonicalSessionId ? getSourceFidelityStore().commonRules[canonicalSessionId] ?? null : null;
}
export function saveSessionCommonRules(sessionId: string, commonRules: SessionCommonRules) {
  const canonicalSessionId = canonicalCatalogSessionId(sessionId);
  if (!canonicalSessionId) return null;
  const store = getSourceFidelityStore();
  const next = { ...store, commonRules: { ...store.commonRules, [canonicalSessionId]: { ...commonRules } } };
  persistSourceFidelityStore(next);
  return next.commonRules[canonicalSessionId];
}
export function savePromptItems(updated: PromptItem[]) {
  const updates = new Map(updated.map((promptItem) => [promptItem.id, promptItem]));
  const store = getSourceFidelityStore();
  const promptItems = store.promptItems.map((promptItem) => {
    const patch = updates.get(promptItem.id);
    return patch ? updateSourcePrompt(promptItem, patch) : promptItem;
  });
  persistSourceFidelityStore({ ...store, promptItems });
}
export function updatePromptItem(promptItemId: string, patch: Partial<Omit<PromptItem, "id" | "protocolId" | "sessionId" | "nodeId" | "verbatimText" | "sourceTrace" | "sourceHash" | "origin">>) {
  const store = getSourceFidelityStore();
  const promptItems = store.promptItems.map((promptItem) => promptItem.id === promptItemId ? updateSourcePrompt(promptItem, patch) : promptItem);
  persistSourceFidelityStore({ ...store, promptItems });
  return promptItems.find((promptItem) => promptItem.id === promptItemId) ?? null;
}
export function updateSessionNodeRuntime(nodeId: string, patch: Partial<Pick<ClinicalStageNode, "objective" | "speakerRoleId" | "entryCondition" | "completionCondition" | "maxNodeIterations">>) {
  const store = getSourceFidelityStore();
  const nodes = store.nodes.map((node) => node.id === nodeId ? { ...node, ...patch } : node);
  persistSourceFidelityStore({ ...store, nodes });
  return nodes.find((node) => node.id === nodeId) ?? null;
}

export function getSessionBuilderDraftSnapshot(): SourceFidelityReleaseSnapshot {
  const draft = getSourceFidelityStore();
  return {
    canonicalProtocolId: CANONICAL_PROTOCOL_ID,
    sourceVersion: draft.sourceVersion,
    sourceTextHash: draft.sourceTextHash,
    sessionPlan: structuredClone(CANONICAL_SESSION_PLAN),
    sessionDefinitions: structuredClone(CANONICAL_SESSION_DEFINITIONS),
    sessionCommonRules: Object.fromEntries(Object.entries(CANONICAL_SESSION_COMMON_RULES).map(([sessionId, sourceRules]) => {
      const localRules = draft.commonRules[sessionId];
      return [sessionId, {
        ...structuredClone(sourceRules),
        roleAndStance: localRules?.roleAndStance ?? sourceRules.roleAndStance,
        sessionObjective: localRules?.sessionObjective ?? sourceRules.sessionObjective,
        languageRules: localRules?.languageRules ?? sourceRules.languageRules,
        openingRules: localRules?.openingRules ?? sourceRules.openingRules,
        sessionWideRequiredActions: localRules?.sessionWideRequiredActions ?? sourceRules.sessionWideRequiredActions,
        sessionWideRestrictions: localRules?.sessionWideRestrictions ?? sourceRules.sessionWideRestrictions,
        sessionWideSafetyRules: localRules?.sessionWideSafetyRules ?? sourceRules.sessionWideSafetyRules,
      }];
    })),
    clinicalStageNodes: CANONICAL_STAGE_NODES.map((sourceNode) => {
      const localNode = draft.nodes.find((node) => node.id === sourceNode.id);
      return {
        ...structuredClone(sourceNode),
        objective: localNode?.objective ?? sourceNode.objective,
        speakerRoleId: localNode?.speakerRoleId ?? sourceNode.speakerRoleId,
        entryCondition: localNode?.entryCondition ?? sourceNode.entryCondition,
        completionCondition: localNode?.completionCondition ?? sourceNode.completionCondition,
        maxNodeIterations: localNode?.maxNodeIterations ?? sourceNode.maxNodeIterations,
      };
    }),
    promptItems: CANONICAL_PROMPT_ITEMS.map((sourcePrompt) => {
      const localPrompt = draft.promptItems.find((promptItem) => promptItem.id === sourcePrompt.id);
      return {
        ...structuredClone(sourcePrompt),
        editableText: localPrompt?.editableText ?? sourcePrompt.editableText,
        aiInstruction: localPrompt?.aiInstruction ?? sourcePrompt.aiInstruction,
        modelGuidance: localPrompt?.modelGuidance ?? sourcePrompt.modelGuidance,
        fallbackPatientText: localPrompt?.fallbackPatientText ?? sourcePrompt.fallbackPatientText,
        sequenceIndex: localPrompt?.sequenceIndex ?? sourcePrompt.sequenceIndex,
        roleId: localPrompt?.roleId ?? sourcePrompt.roleId,
        scope: localPrompt?.scope ?? sourcePrompt.scope,
        executionMode: localPrompt?.executionMode ?? sourcePrompt.executionMode,
        completionCondition: localPrompt?.completionCondition ?? sourcePrompt.completionCondition,
        requiredFields: localPrompt?.requiredFields ?? sourcePrompt.requiredFields,
        validationRules: localPrompt?.validationRules ?? sourcePrompt.validationRules,
        allowedActions: localPrompt?.allowedActions ?? sourcePrompt.allowedActions,
        forbiddenActions: localPrompt?.forbiddenActions ?? sourcePrompt.forbiddenActions,
        maxAttempts: localPrompt?.maxAttempts ?? sourcePrompt.maxAttempts,
        maxIterations: localPrompt?.maxIterations ?? sourcePrompt.maxIterations,
        outputSchemaVersion: localPrompt?.outputSchemaVersion ?? sourcePrompt.outputSchemaVersion,
        status: localPrompt?.status ?? sourcePrompt.status,
      };
    }),
    sourceFidelityEdges: structuredClone(CANONICAL_SOURCE_EDGES),
  };
}
export function restorePromptItemFromVerbatim(promptItemId: string) {
  return updatePromptItem(promptItemId, { editableText: getSourceFidelityStore().promptItems.find((promptItem) => promptItem.id === promptItemId)?.verbatimText });
}
export function duplicatePromptItem(_promptItemId: string) { return null; }
export function movePromptItem(promptItemId: string, _direction: -1 | 1) { return getSourceFidelityStore().promptItems.find((promptItem) => promptItem.id === promptItemId) ?? null; }
export function togglePromptItemStatus(promptItemId: string) {
  const promptItem = getSourceFidelityStore().promptItems.find((item) => item.id === promptItemId);
  return promptItem ? updatePromptItem(promptItemId, { status: promptItem.status === "active" ? "disabled" : "active" }) : null;
}
export function getSessionById(sessionId: string) {
  const canonicalSessionId = canonicalCatalogSessionId(sessionId);
  return loadSessionDefinitions().find((definition) => definition.id === canonicalSessionId) ?? null;
}
export function getActiveSessionId() { return loadSessionPlan().orderedEntries.find((entry) => entry.active)?.sessionId ?? "tbct-s01"; }
export function getSessionTotals() {
  return loadSessionDefinitions().reduce(
    (totals, definition) => ({
      nodes: totals.nodes + loadStageNodes(definition.id).length,
      prompts: totals.prompts + loadPromptItems(definition.id).length,
      enabled: totals.enabled + Number(loadSessionPlan().orderedEntries.some((entry) => entry.sessionId === definition.id && entry.active)),
    }),
    { nodes: 0, prompts: 0, enabled: 0 },
  );
}
export function duplicateSessionEntry(_sessionId: string) { return loadSessionPlan(); }
export function reorderSessionEntry(_sessionId: string, _direction: -1 | 1) { return loadSessionPlan(); }
export function toggleSessionEntryActive(_sessionId: string) { return loadSessionPlan(); }
export function setStartingSession(_sessionId: string) { return loadSessionPlan(); }
export function getSessionNodeCount(sessionId: string) { return loadStageNodes(sessionId).length; }
export function getSessionPromptCount(sessionId: string) { return loadPromptItems(sessionId).length; }
export function getPromptValidationWarnings(promptItem: PromptItem) {
  const warnings: string[] = [];
  if (!promptItem.verbatimText.trim()) warnings.push("missing_verbatim_text");
  if (promptItem.origin !== "source_imported") warnings.push("non_source_prompt");
  if (!promptItem.sourceHash || promptItem.sourceHash !== TBCT_SOURCE_TEXT_HASH) warnings.push("source_hash_mismatch");
  if (!promptItem.sourceTrace.sourceLineStart || !promptItem.sourceTrace.sourceLineEnd) warnings.push("source_trace_missing");
  if (promptItem.sourceFidelityStatus === "review_required") warnings.push("source_review_required");
  return warnings;
}
export function getSessionNodes(sessionId: string) { return loadStageNodes(sessionId); }
export function getSessionPrompts(sessionId: string, nodeId?: string) {
  const nodeOrder = new Map(getSessionNodes(sessionId).map((node, index) => [node.id, index]));
  return loadPromptItems(sessionId, nodeId).sort((left, right) => {
    const leftNodeOrder = nodeOrder.get(left.nodeId) ?? Number.MAX_SAFE_INTEGER;
    const rightNodeOrder = nodeOrder.get(right.nodeId) ?? Number.MAX_SAFE_INTEGER;
    return leftNodeOrder - rightNodeOrder || left.order - right.order;
  });
}
export function getSourceFidelityCatalogBackup() {
  const raw = readBrowserStorageItem(SOURCE_FIDELITY_BACKUP_STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SourceFidelityBackup;
  } catch {
    return null;
  }
}
export function getSourceFidelityCatalogMigrationConflicts() { return [...getSourceFidelityStore().migrationConflicts]; }
