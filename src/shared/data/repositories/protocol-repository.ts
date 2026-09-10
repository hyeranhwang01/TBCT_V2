import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import { saveAuditEntry } from "@/shared/data/repositories/audit-log-repository";
import type { AuditEntry } from "@/types";
import type {
  ProtocolDefinition,
  ProtocolGraphEdge,
  ProtocolGraphNode,
  ProtocolReleasePackage,
  ProtocolReleaseVersion,
  ProtocolSession,
  ProtocolValidationRun,
  RuntimeExecutionLog,
} from "@/types/protocol-runtime";

export async function getProtocolDefinition(protocolId: string) {
  return getLocalDb().protocolDefinitions.get(protocolId);
}

export async function getProtocolSession(sessionId: string) {
  return getLocalDb().protocolSessions.get(sessionId);
}

export async function getProtocolGraph(protocolId: string, sessionId?: string) {
  const db = getLocalDb();
  const nodes = sessionId
    ? await db.protocolGraphNodes.where({ protocolId, sessionId }).toArray()
    : await db.protocolGraphNodes.where("protocolId").equals(protocolId).toArray();
  const edges = sessionId
    ? await db.protocolGraphEdges.where({ protocolId, sessionId }).toArray()
    : await db.protocolGraphEdges.where("protocolId").equals(protocolId).toArray();
  return { nodes, edges };
}

export async function saveProtocolImport(
  definition: ProtocolDefinition,
  session: ProtocolSession,
  nodes: ProtocolGraphNode[],
  edges: ProtocolGraphEdge[],
  audit: AuditEntry,
) {
  const db = getLocalDb();
  await db.transaction("rw", [db.protocolDefinitions, db.protocolSessions, db.protocolGraphNodes, db.protocolGraphEdges, db.auditEntries], async () => {
    await db.protocolDefinitions.put(definition);
    await db.protocolSessions.put(session);
    await db.protocolGraphNodes.bulkPut(nodes);
    await db.protocolGraphEdges.bulkPut(edges);
    await saveAuditEntry(audit);
  });
}

export async function createProtocolNodeRecord(node: ProtocolGraphNode, audit: AuditEntry) {
  const db = getLocalDb();
  await db.protocolGraphNodes.put(node);
  const session = await db.protocolSessions.get(node.sessionId);
  if (session) {
    await db.protocolSessions.put({
      ...session,
      nodeIds: [...new Set([...session.nodeIds, node.id])],
      entryNodeId: session.entryNodeId ?? (node.type === "session_start" ? node.id : undefined),
      completionNodeIds: node.type === "session_complete" ? [...new Set([...session.completionNodeIds, node.id])] : session.completionNodeIds,
      updatedAt: new Date().toISOString(),
    });
  }
  await saveAuditEntry(audit);
}

export async function createProtocolEdgeRecord(edge: ProtocolGraphEdge, audit: AuditEntry) {
  const db = getLocalDb();
  await db.protocolGraphEdges.put(edge);
  const session = await db.protocolSessions.get(edge.sessionId);
  if (session) {
    await db.protocolSessions.put({
      ...session,
      edgeIds: [...new Set([...session.edgeIds, edge.id])],
      updatedAt: new Date().toISOString(),
    });
  }
  await saveAuditEntry(audit);
}

export async function updateProtocolNode(nodeId: string, patch: Partial<ProtocolGraphNode>, audit: AuditEntry) {
  const db = getLocalDb();
  const current = await db.protocolGraphNodes.get(nodeId);
  if (!current) throw new Error("Protocol node not found");
  const next = { ...current, ...patch, data: { ...current.data, ...patch.data, metadata: { ...current.data.metadata, updatedAt: new Date().toISOString() } } };
  await db.protocolGraphNodes.put(next);
  await saveAuditEntry(audit);
  return next;
}

export async function updateProtocolEdge(edgeId: string, patch: Partial<ProtocolGraphEdge>, audit: AuditEntry) {
  const db = getLocalDb();
  const current = await db.protocolGraphEdges.get(edgeId);
  if (!current) throw new Error("Protocol edge not found");
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await db.protocolGraphEdges.put(next);
  await saveAuditEntry(audit);
  return next;
}

export async function getProtocolNode(nodeId: string) {
  return getLocalDb().protocolGraphNodes.get(nodeId);
}

export async function getProtocolEdge(edgeId: string) {
  return getLocalDb().protocolGraphEdges.get(edgeId);
}

export async function deleteProtocolNodeRecord(nodeId: string, audit: AuditEntry) {
  const db = getLocalDb();
  const node = await db.protocolGraphNodes.get(nodeId);
  if (!node) throw new Error("Protocol node not found");
  const outgoing = await db.protocolGraphEdges.where("source").equals(nodeId).toArray();
  const incoming = await db.protocolGraphEdges.where("target").equals(nodeId).toArray();
  await db.transaction("rw", [db.protocolGraphNodes, db.protocolGraphEdges, db.protocolSessions, db.auditEntries], async () => {
    await db.protocolGraphNodes.delete(nodeId);
    await db.protocolGraphEdges.bulkDelete([...outgoing, ...incoming].map((edge) => edge.id));
    const session = await db.protocolSessions.get(node.sessionId);
    if (session) {
      await db.protocolSessions.put({
        ...session,
        nodeIds: session.nodeIds.filter((id) => id !== nodeId),
        edgeIds: session.edgeIds.filter((id) => ![...outgoing, ...incoming].some((edge) => edge.id === id)),
        entryNodeId: session.entryNodeId === nodeId ? session.nodeIds.find((id) => id !== nodeId) : session.entryNodeId,
        completionNodeIds: session.completionNodeIds.filter((id) => id !== nodeId),
        updatedAt: new Date().toISOString(),
      });
    }
    await saveAuditEntry(audit);
  });
}

export async function deleteProtocolEdgeRecord(edgeId: string, audit: AuditEntry) {
  const db = getLocalDb();
  const edge = await db.protocolGraphEdges.get(edgeId);
  if (!edge) throw new Error("Protocol edge not found");
  await db.protocolGraphEdges.delete(edgeId);
  const session = await db.protocolSessions.get(edge.sessionId);
  if (session) {
    await db.protocolSessions.put({ ...session, edgeIds: session.edgeIds.filter((id) => id !== edgeId), updatedAt: new Date().toISOString() });
  }
  await saveAuditEntry(audit);
}

export async function saveValidationRun(run: ProtocolValidationRun, audit: AuditEntry) {
  const db = getLocalDb();
  await db.protocolValidationRuns.put(run);
  await saveAuditEntry(audit);
}

export async function getValidationRun(protocolId: string) {
  return getLocalDb().protocolValidationRuns.where("protocolId").equals(protocolId).last();
}

export async function saveRuntimeExecutionLog(log: RuntimeExecutionLog, audit: AuditEntry) {
  const db = getLocalDb();
  await db.runtimeExecutionLogs.put(log);
  await saveAuditEntry(audit);
}

export async function saveReleasePackage(pkg: ProtocolReleasePackage, release: ProtocolReleaseVersion, audit: AuditEntry) {
  const db = getLocalDb();
  await db.transaction("rw", [db.protocolReleasePackages, db.protocolReleaseVersions, db.protocolDefinitions, db.auditEntries], async () => {
    await db.protocolReleasePackages.put(pkg);
    await db.protocolReleaseVersions.put(release);
    const definition = await db.protocolDefinitions.get(pkg.protocolId);
    if (definition) {
      await db.protocolDefinitions.put({ ...definition, currentVersion: release.version, status: "published", updatedAt: new Date().toISOString() });
    }
    await saveAuditEntry(audit);
  });
}

export async function getProtocolReleases(protocolId: string) {
  const releases = await getLocalDb().protocolReleaseVersions.where("protocolId").equals(protocolId).toArray();
  return releases.sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
}

export async function getProtocolRelease(releaseId: string) {
  return getLocalDb().protocolReleaseVersions.get(releaseId);
}

export async function getReleasePackage(packageId: string) {
  return getLocalDb().protocolReleasePackages.get(packageId);
}
