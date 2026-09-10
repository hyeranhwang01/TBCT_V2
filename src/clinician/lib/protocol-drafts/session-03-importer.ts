import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import { createMemoryAuditEntry } from "@/shared/memory/memory-helpers";
import { saveProtocolImport } from "@/shared/data/repositories/protocol-repository";
import type { ProtocolGraphEdge, ProtocolGraphNode, ProtocolImportResult, ProtocolSession } from "@/types/protocol-runtime";
import { REAL_SESSION_03_EDGES, REAL_SESSION_03_ID, REAL_SESSION_03_NODES, REAL_SESSION_03_PROTOCOL_ID, REAL_SESSION_03_SESSION, REAL_SESSION_03_TITLE, REAL_SESSION_03_VERSION } from "@/clinician/lib/protocol-drafts/session-03-real";

function needsSeed(existingNodes: ProtocolGraphNode[], existingEdges: ProtocolGraphEdge[]) {
  if (!existingNodes.length && !existingEdges.length) return true;
  const existingNodeIds = new Set(existingNodes.map((node) => node.id));
  const existingEdgeIds = new Set(existingEdges.map((edge) => edge.id));
  return REAL_SESSION_03_NODES.some((node) => !existingNodeIds.has(node.id)) || REAL_SESSION_03_EDGES.some((edge) => !existingEdgeIds.has(edge.id));
}

export async function importRealSession03(force = false): Promise<ProtocolImportResult> {
  const db = getLocalDb();
  const [existingNodes, existingEdges, existingDefinition, existingSession] = await Promise.all([
    db.protocolGraphNodes.where({ protocolId: REAL_SESSION_03_PROTOCOL_ID, sessionId: REAL_SESSION_03_ID }).toArray(),
    db.protocolGraphEdges.where({ protocolId: REAL_SESSION_03_PROTOCOL_ID, sessionId: REAL_SESSION_03_ID }).toArray(),
    db.protocolDefinitions.get(REAL_SESSION_03_PROTOCOL_ID),
    db.protocolSessions.get(REAL_SESSION_03_ID),
  ]);

  if (!force && !needsSeed(existingNodes, existingEdges) && existingDefinition && existingSession) {
    return {
      candidateId: "real-session-03",
      protocolId: REAL_SESSION_03_PROTOCOL_ID,
      sessionId: REAL_SESSION_03_ID,
      createdNodeIds: [],
      createdEdgeIds: [],
      skippedItemIds: REAL_SESSION_03_NODES.map((node) => node.data.protocolNodeId),
      conflictIds: [],
      warnings: [],
    };
  }

  const now = new Date().toISOString();
  const definition = existingDefinition ?? {
    id: REAL_SESSION_03_PROTOCOL_ID,
    projectId: "TBCT-BR-001",
    title: "TBCT Brazil Pilot Protocol",
    locale: "pt-BR",
    country: "BR",
    currentVersion: REAL_SESSION_03_VERSION,
    status: "draft" as const,
    sessionIds: [REAL_SESSION_03_SESSION.id],
    globalSafetyRuleIds: ["GLOBAL-RISK-01", "GLOBAL-RISK-02", "SESSION-03-MOOD"],
    runtimeSchemaVersion: "1.0",
    createdAt: now,
    updatedAt: now,
  };
  const session: ProtocolSession = existingSession ?? { ...REAL_SESSION_03_SESSION, createdAt: now, updatedAt: now };
  const nodeById = new Map(existingNodes.map((node) => [node.id, node]));
  const edgeById = new Map(existingEdges.map((edge) => [edge.id, edge]));
  const createdNodeIds: string[] = [];
  const createdEdgeIds: string[] = [];
  const skippedItemIds: string[] = [];

  const nextNodes = REAL_SESSION_03_NODES.map((node) => {
    const existing = nodeById.get(node.id);
    if (existing) {
      skippedItemIds.push(node.id);
      return { ...existing, ...node, data: { ...existing.data, ...node.data } };
    }
    createdNodeIds.push(node.id);
    return node;
  });

  const nextEdges = REAL_SESSION_03_EDGES.map((edge) => {
    const existing = edgeById.get(edge.id);
    if (existing) {
      skippedItemIds.push(edge.id);
      return { ...existing, ...edge };
    }
    createdEdgeIds.push(edge.id);
    return edge;
  });

  await saveProtocolImport(
    { ...definition, updatedAt: now },
    {
      ...session,
      title: REAL_SESSION_03_TITLE,
      nodeIds: nextNodes.map((node) => node.id),
      edgeIds: nextEdges.map((edge) => edge.id),
      entryNodeId: "S03-START-001",
      completionNodeIds: ["S03-COMPLETE-001"],
      updatedAt: now,
    },
    nextNodes,
    nextEdges,
    createMemoryAuditEntry({
      action: force ? "Real Session 03 re-import" : "Real Session 03 import",
      resource: REAL_SESSION_03_ID,
      version: REAL_SESSION_03_VERSION,
      newValue: JSON.stringify({ createdNodeIds: createdNodeIds.length, createdEdgeIds: createdEdgeIds.length }),
      reason: "Session 03 real protocol seed imported",
    }),
  );

  return {
    candidateId: "real-session-03",
    protocolId: REAL_SESSION_03_PROTOCOL_ID,
    sessionId: REAL_SESSION_03_ID,
    createdNodeIds,
    createdEdgeIds,
    skippedItemIds,
    conflictIds: [],
    warnings: [],
  };
}