import { getProtocolRelease, getProtocolReleases } from "@/lib/repositories/protocol-repository";
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
} from "@/lib/protocol/source-fidelity-catalog";
import { TBCT_SOURCE_TEXT_HASH } from "@/lib/protocol/tbct-source-text.generated";
import { isCanonicalProtocolId } from "@/lib/protocol/source-fidelity-protocol-adapter";
import { getRuntimeReleaseSourceSnapshot, loadRuntimeRelease, normalizeRuntimeSessionState } from "@/lib/runtime/runtime-release-loader";
import {
  createRuntimeSessionRecord,
  deleteRuntimeSessionRecord,
  getLatestRuntimeCheckpoint,
  getRuntimeSessionRecord,
  listRuntimeCheckpoints,
  listRuntimeEscalationsBySession,
  listRuntimeLogs,
  listRuntimeMessages,
  listRuntimeProviderEvents,
  listRuntimeSessionRecords,
  listRuntimeSessionRecordsByParticipant,
  listRuntimeValidationEvents,
  saveRuntimeCheckpoint,
  updateRuntimeSessionRecord,
} from "@/lib/repositories/runtime-session-repository";
import { attachSessionToParticipant, getOrCreateDemoParticipant, getRuntimeParticipant } from "@/lib/api/participant-api";
import { listHomeworkRecordsByParticipant } from "@/lib/repositories/homework-repository";
import { EMPTY_CONTINUITY_SEED, computeSessionContinuitySeed } from "@/lib/runtime/session-continuity";
import { listMemoryRetrievalRuns, listMemoryUsageLogs } from "@/lib/repositories/longitudinal-memory-repository";
import { getPilotParticipantByRuntimeParticipantId, getPilotStudyArm, listProtocolAssignments } from "@/lib/repositories/pilot-repository";
import { assertRuntimeTransition } from "@/lib/runtime/runtime-state-machine";
import type { PatientRuntimeReleaseOption, PatientRuntimeSessionView, RuntimeCheckpoint, RuntimeContext, RuntimeSession, RuntimeSessionView } from "@/types/runtime-session";
import type { ProtocolGraphEdge, ProtocolGraphNode, ProtocolReleaseVersion } from "@/types/protocol-runtime";

function makeId(prefix: string) {
  const webCrypto = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (typeof webCrypto?.randomUUID === "function") {
    return `${prefix}-${webCrypto.randomUUID().slice(0, 8)}`;
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function emptyContext(): RuntimeContext {
  return { fields: {}, riskSignals: [], iterationCounts: {}, activityCompletion: "not_started", homeworkStatus: "not_assigned", riskLevel: "low" };
}

/** What the participant's previous session leaves for this one -- see
 * session-continuity.ts for why the fields it seeds were previously read but
 * never written.
 *
 * Never lets a continuity lookup stop a session from starting. The two reads
 * are ordinary store fetches, and a participant who cannot open today's session
 * because last week's homework record could not be loaded is strictly worse off
 * than one who gets the first-session opening a second time. On failure this
 * degrades to exactly the previous behaviour. */
async function loadContinuitySeed(participantId: string) {
  try {
    const [priorSessions, homeworkRecords] = await Promise.all([
      listRuntimeSessionRecordsByParticipant(participantId),
      listHomeworkRecordsByParticipant(participantId),
    ]);
    return computeSessionContinuitySeed({ priorSessions, homeworkRecords });
  } catch {
    return EMPTY_CONTINUITY_SEED;
  }
}

function createCanonicalDemoRelease(): ProtocolReleaseVersion {
  const now = new Date().toISOString();
  return {
    id: "demo-release",
    protocolId: CANONICAL_PROTOCOL_ID,
    version: CANONICAL_SOURCE_VERSION,
    releasePackageId: "demo-release-package",
    publishedAt: now,
    publishedBy: "TBCT demo",
    changeSummary: "Canonical TBCT runtime release",
    immutableSnapshot: {
      // The legacy snapshot fields remain for editor compatibility. Runtime uses
      // the fully typed source-fidelity arrays below.
      nodes: CANONICAL_STAGE_NODES as unknown as ProtocolGraphNode[],
      edges: CANONICAL_SOURCE_EDGES as unknown as ProtocolGraphEdge[],
      sourceFidelity: {
        canonicalProtocolId: CANONICAL_PROTOCOL_ID,
        sourceVersion: CANONICAL_SOURCE_VERSION,
        sourceTextHash: TBCT_SOURCE_TEXT_HASH,
        sessionDefinitions: CANONICAL_SESSION_DEFINITIONS,
        sessionPlan: CANONICAL_SESSION_PLAN,
        sessionCommonRules: CANONICAL_SESSION_COMMON_RULES,
        clinicalStageNodes: CANONICAL_STAGE_NODES,
        promptItems: CANONICAL_PROMPT_ITEMS,
        sourceFidelityEdges: CANONICAL_SOURCE_EDGES,
      },
    },
  };
}

function hasRuntimeSourceSnapshot(release?: ProtocolReleaseVersion | null) {
  const snapshot = release?.immutableSnapshot.sourceFidelity;
  return Array.isArray(snapshot?.clinicalStageNodes)
    && Array.isArray(snapshot.promptItems)
    && Array.isArray(snapshot.sourceFidelityEdges);
}

export async function createRuntimeSession(input: {
  projectId: string;
  protocolId: string;
  releaseId: string;
  sessionDefinitionId: string;
  participantId?: string;
  patientAlias: string;
  locale: string;
}): Promise<RuntimeSession> {
  const now = new Date().toISOString();
  const sessionId = makeId("RTS");
  // Every session must belong to a real, persisted participant record --
  // otherwise the clinician monitoring screens (which join sessions to
  // participants by participantId) can never find it.
  const resolvedParticipantId = input.participantId ?? (await getOrCreateDemoParticipant()).id;
  const continuity = await loadContinuitySeed(resolvedParticipantId);
  const activeProtocolId = isCanonicalProtocolId(input.protocolId) ? CANONICAL_PROTOCOL_ID : input.protocolId;
  const storedRelease = await getProtocolRelease(input.releaseId);
  const release = storedRelease ?? (input.releaseId === "demo-release" && activeProtocolId === CANONICAL_PROTOCOL_ID ? createCanonicalDemoRelease() : null);
  if (!release) throw new Error(`Selected release ${input.releaseId} was not found.`);
  if (release.protocolId !== activeProtocolId) throw new Error("Selected release does not belong to this protocol.");

  const sourceFidelity = getRuntimeReleaseSourceSnapshot(release);
  const runtimeRelease = loadRuntimeRelease(release);
  const canonicalSessionId = activeProtocolId === CANONICAL_PROTOCOL_ID
    ? resolveCanonicalSessionId(input.sessionDefinitionId) ?? input.sessionDefinitionId
    : input.sessionDefinitionId;
  const definition = sourceFidelity.sessionDefinitions.find((item) => item.id === canonicalSessionId);
  if (!definition) throw new Error(`Session definition ${input.sessionDefinitionId} is not available in release ${release.id}.`);
  const entryNode = sourceFidelity.clinicalStageNodes.find((node) => node.id === definition.startNodeId)
    ?? sourceFidelity.clinicalStageNodes.find((node) => node.sessionId === definition.id && node.type === "session_start")
    ?? sourceFidelity.clinicalStageNodes.find((node) => node.sessionId === definition.id);
  if (!entryNode) throw new Error(`Session definition ${definition.id} has no entry node in release ${release.id}.`);
  const runtimeNode = runtimeRelease.nodes.find((node) => node.id === entryNode.id);
  const firstPromptItemId = runtimeNode?.promptSequence[0];

  const sessionWithoutRuntimeState: RuntimeSession = {
    id: sessionId,
    projectId: input.projectId,
    protocolId: release.protocolId,
    protocolVersion: release.version,
    releaseId: release.id,
    sessionDefinitionId: definition.id,
    participantId: input.participantId ?? "demo-participant",
    status: "created",
    currentSessionId: definition.id,
    currentNodeId: entryNode.id,
    currentPromptItemId: firstPromptItemId,
    completedPromptItemIds: [],
    skippedPromptItemIds: [],
    promptProgressionReason: "session_started",
    sourceVersion: sourceFidelity.sourceVersion,
    sourceTextHash: sourceFidelity.sourceTextHash,
    patientAlias: input.patientAlias,
    locale: input.locale,
    version: 0,
    runtimeContext: { ...emptyContext(), fields: continuity.fields, homeworkStatus: continuity.homeworkStatus },
    messageIds: [],
    executionLogIds: [],
    escalationIds: [],
    createdAt: now,
    updatedAt: now,
  };

  const sessionWithParticipant: RuntimeSession = { ...sessionWithoutRuntimeState, participantId: resolvedParticipantId };
  const session: RuntimeSession = {
    ...sessionWithParticipant,
    runtimeState: normalizeRuntimeSessionState(sessionWithParticipant, runtimeRelease),
  };
  await createRuntimeSessionRecord(session);
  await attachSessionToParticipant(resolvedParticipantId, session.id);
  return session;
}

export async function createCanonicalTestRuntimeSession(input: {
  sessionDefinitionId?: string;
  patientAlias?: string;
  locale?: string;
  participantId?: string;
} = {}) {
  return createRuntimeSession({
    projectId: "TBCT-BR-001",
    protocolId: CANONICAL_PROTOCOL_ID,
    releaseId: "demo-release",
    sessionDefinitionId: input.sessionDefinitionId ?? "tbct-s01",
    patientAlias: input.patientAlias ?? "Test Patient",
    locale: input.locale ?? "ko-KR",
    participantId: input.participantId,
  });
}

export async function listCanonicalTestSessions() {
  return CANONICAL_SESSION_DEFINITIONS
    .slice()
    .sort((left, right) => left.number - right.number)
    .map((session) => ({
      id: session.id,
      number: session.number,
      title: session.title,
      titleKo: session.titleKo,
      techniqueName: session.techniqueName,
    }));
}

export async function getRuntimeSession(sessionId: string): Promise<RuntimeSessionView | null> {
  const session = await getRuntimeSessionRecord(sessionId);
  if (!session) return null;
  const storedRelease = await getProtocolRelease(session.releaseId);
  const release: ProtocolReleaseVersion | null = storedRelease
    ?? (session.releaseId === "demo-release" && isCanonicalProtocolId(session.protocolId) ? createCanonicalDemoRelease() : null);
  if (!release || !hasRuntimeSourceSnapshot(release)) {
    throw new Error(`Runtime session ${session.id} references an unavailable immutable release.`);
  }
  const runtimeRelease = loadRuntimeRelease(release);
  const hydratedSession = session.runtimeState?.releaseId === release.id
    ? session
    : { ...session, runtimeState: normalizeRuntimeSessionState(session, runtimeRelease) };
  
  const [messages, logs, checkpoints, escalations, providerEvents, validationEvents, participant, memoryRetrievalRuns, memoryUsageLogs] = await Promise.all([
    listRuntimeMessages(sessionId),
    listRuntimeLogs(sessionId),
    listRuntimeCheckpoints(sessionId),
    listRuntimeEscalationsBySession(sessionId),
    listRuntimeProviderEvents(sessionId),
    listRuntimeValidationEvents(sessionId),
    getRuntimeParticipant(session.participantId).catch(() => null),
    listMemoryRetrievalRuns(sessionId).catch(() => []),
    listMemoryUsageLogs(sessionId).catch(() => []),
  ]);
  const sourceFidelity = getRuntimeReleaseSourceSnapshot(release);
  
  return {
    session: hydratedSession,
    release,
    participant: participant ?? undefined,
    nodes: sourceFidelity.clinicalStageNodes,
    edges: sourceFidelity.sourceFidelityEdges,
    promptItems: sourceFidelity.promptItems,
    currentPromptItem: sourceFidelity.promptItems.find((promptItem) => promptItem.id === hydratedSession.currentPromptItemId),
    messages,
    logs,
    checkpoints,
    escalations,
    providerEvents,
    validationEvents,
    memoryRetrievalRuns,
    memoryUsageLogs,
  } satisfies RuntimeSessionView;
}

/** Minimal read model for the latency-sensitive patient turn path. */
export async function getRuntimeSessionForTurn(sessionId: string): Promise<RuntimeSessionView | null> {
  const session = await getRuntimeSessionRecord(sessionId);
  if (!session) return null;
  // The canonical demo release is compiled into the application. Prefer it
  // directly so the server turn executor never tries to open browser-only
  // IndexedDB through protocol-repository.
  const storedRelease = session.releaseId === "demo-release" && isCanonicalProtocolId(session.protocolId)
    ? null
    : await getProtocolRelease(session.releaseId);
  const release: ProtocolReleaseVersion | null = storedRelease
    ?? (session.releaseId === "demo-release" && isCanonicalProtocolId(session.protocolId) ? createCanonicalDemoRelease() : null);
  if (!release || !hasRuntimeSourceSnapshot(release)) throw new Error(`Runtime session ${session.id} references an unavailable immutable release.`);
  const runtimeRelease = loadRuntimeRelease(release);
  const hydratedSession = session.runtimeState?.releaseId === release.id
    ? session
    : { ...session, runtimeState: normalizeRuntimeSessionState(session, runtimeRelease) };
  const sourceFidelity = getRuntimeReleaseSourceSnapshot(release);
  const messages = await listRuntimeMessages(sessionId);
  return {
    session: hydratedSession,
    release,
    nodes: sourceFidelity.clinicalStageNodes,
    edges: sourceFidelity.sourceFidelityEdges,
    promptItems: sourceFidelity.promptItems,
    currentPromptItem: sourceFidelity.promptItems.find((item) => item.id === hydratedSession.currentPromptItemId),
    messages,
    logs: [], checkpoints: [], escalations: [], providerEvents: [], validationEvents: [], memoryRetrievalRuns: [], memoryUsageLogs: [],
  } satisfies RuntimeSessionView;
}

export async function getPatientRuntimeSession(sessionId: string): Promise<PatientRuntimeSessionView | null> {
  const session = await getRuntimeSessionRecord(sessionId);
  if (!session) return null;
  const storedRelease = await getProtocolRelease(session.releaseId);
  const release: ProtocolReleaseVersion | null = storedRelease
    ?? (session.releaseId === "demo-release" && isCanonicalProtocolId(session.protocolId) ? createCanonicalDemoRelease() : null);
  if (!release || !hasRuntimeSourceSnapshot(release)) {
    throw new Error(`Runtime session ${session.id} references an unavailable immutable release.`);
  }
  const runtimeRelease = loadRuntimeRelease(release);
  const hydratedSession = session.runtimeState?.releaseId === release.id
    ? session
    : { ...session, runtimeState: normalizeRuntimeSessionState(session, runtimeRelease) };
  const sourceFidelity = getRuntimeReleaseSourceSnapshot(release);
  const currentNode = sourceFidelity.clinicalStageNodes.find((node) => node.id === hydratedSession.currentNodeId);
  const currentPromptItem = sourceFidelity.promptItems.find((promptItem) => promptItem.id === hydratedSession.currentPromptItemId);
  const messages = (await listRuntimeMessages(sessionId))
    .filter((message) => message.role === "patient"
      || (message.role === "assistant" && ["validated", "delivered", "replaced_by_fallback"].includes(message.status))
      || (message.role === "system" && message.metadata?.patientVisible === true))
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      status: message.status,
      createdAt: message.createdAt,
      deliveredAt: message.deliveredAt,
    }));
  return {
    session: {
      id: hydratedSession.id,
      patientAlias: hydratedSession.patientAlias,
      sessionDefinitionId: hydratedSession.sessionDefinitionId,
      status: hydratedSession.status,
      currentNodeId: hydratedSession.currentNodeId,
      currentPromptItemId: hydratedSession.currentPromptItemId,
      updatedAt: hydratedSession.updatedAt,
      version: hydratedSession.version ?? 0,
      locale: hydratedSession.locale,
      runtimeContext: { riskLevel: hydratedSession.runtimeContext.riskLevel },
    },
    currentNode: currentNode ? { id: currentNode.id, title: currentNode.title } : undefined,
    currentPromptInput: currentPromptItem ? { type: currentPromptItem.type, validation: currentPromptItem.validation, outputFields: currentPromptItem.outputFields } : undefined,
    messages,
    hasSafetyReview: hydratedSession.status === "safety_paused" || hydratedSession.status === "escalated",
  } satisfies PatientRuntimeSessionView;
}

export async function listRuntimeSessions() {
  return listRuntimeSessionRecords();
}

/** A logged-in patient's own sessions only -- see listRuntimeSessionRecordsByParticipant.
 * listRuntimeSessions() (above) stays unscoped for the clinician-facing
 * Patient Monitoring roster, which is meant to see every participant. */
export async function listRuntimeSessionsForParticipant(participantId: string) {
  return listRuntimeSessionRecordsByParticipant(participantId);
}

/** Permanently deletes a runtime session and its messages/logs/checkpoints. Irreversible. */
export async function deleteRuntimeSession(sessionId: string) {
  await deleteRuntimeSessionRecord(sessionId);
}

export async function setRuntimeSessionStatus(sessionId: string, nextStatus: RuntimeSession["status"], patch: Partial<RuntimeSession> = {}) {
  const session = await getRuntimeSessionRecord(sessionId);
  if (!session) throw new Error("Runtime session not found");
  assertRuntimeTransition(session.status, nextStatus);
  return updateRuntimeSessionRecord(sessionId, { ...patch, status: nextStatus });
}

export async function createRuntimeCheckpoint(sessionId: string) {
  const session = await getRuntimeSessionRecord(sessionId);
  if (!session) throw new Error("Runtime session not found");
  const previous = await getLatestRuntimeCheckpoint(sessionId);
  const checkpoint: RuntimeCheckpoint = {
    id: makeId("RCP"),
    runtimeSessionId: sessionId,
    sequence: (previous?.sequence ?? 0) + 1,
    currentNodeId: session.currentNodeId,
    currentPromptItemId: session.currentPromptItemId,
    completedPromptItemIds: [...(session.completedPromptItemIds ?? [])],
    skippedPromptItemIds: [...(session.skippedPromptItemIds ?? [])],
    sourceVersion: session.sourceVersion,
    sourceTextHash: session.sourceTextHash,
    sessionStatus: session.status,
    runtimeContext: session.runtimeContext,
    messageIds: session.messageIds,
    executionLogIds: session.executionLogIds,
    createdAt: new Date().toISOString(),
  };
  await saveRuntimeCheckpoint(checkpoint);
  return checkpoint;
}

export async function restoreRuntimeSession(sessionId: string) {
  const session = await getRuntimeSessionRecord(sessionId);
  const checkpoint = await getLatestRuntimeCheckpoint(sessionId);
  if (!session || !checkpoint) throw new Error("Runtime checkpoint not found");
  const nextStatus = session.status === "processing" ? "paused" : checkpoint.sessionStatus;
  return updateRuntimeSessionRecord(sessionId, {
    currentNodeId: checkpoint.currentNodeId,
    currentPromptItemId: checkpoint.currentPromptItemId,
    completedPromptItemIds: checkpoint.completedPromptItemIds,
    skippedPromptItemIds: checkpoint.skippedPromptItemIds,
    sourceVersion: checkpoint.sourceVersion,
    sourceTextHash: checkpoint.sourceTextHash,
    runtimeContext: checkpoint.runtimeContext,
    messageIds: checkpoint.messageIds,
    executionLogIds: checkpoint.executionLogIds,
    status: nextStatus,
  });
}

export async function getDefaultPublishedRelease(protocolId = "TBCT-BR-001") {
  const activeProtocolId = isCanonicalProtocolId(protocolId) ? CANONICAL_PROTOCOL_ID : protocolId;
  const releases = await listAvailableRuntimeReleases(activeProtocolId);
  return releases.find((release) => release.immutableSnapshot.sourceFidelity?.canonicalProtocolId === CANONICAL_PROTOCOL_ID) ?? null;
}

export async function listAvailableRuntimeReleases(protocolId = "TBCT-BR-001") {
  const activeProtocolId = isCanonicalProtocolId(protocolId) ? CANONICAL_PROTOCOL_ID : protocolId;
  const releases = await getProtocolReleases(activeProtocolId);
  return releases
    .filter((release) => hasRuntimeSourceSnapshot(release))
    .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
}

export async function listPatientAvailableRuntimeReleases(protocolId = "TBCT-BR-001"): Promise<PatientRuntimeReleaseOption[]> {
  const releases = await listAvailableRuntimeReleases(protocolId);
  return releases.map((release) => ({
    id: release.id,
    version: release.version,
    publishedAt: release.publishedAt,
    changeSummary: release.changeSummary,
    sessions: release.immutableSnapshot.sourceFidelity?.sessionDefinitions.map(({ id, number, title }) => ({ id, number, title })) ?? [],
  }));
}
