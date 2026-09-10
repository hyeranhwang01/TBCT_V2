import { beforeEach, describe, expect, it } from "vitest";
import { createCanonicalProtocolReleaseSnapshot } from "@/shared/protocol/source-fidelity-protocol-adapter";
import { ensureSourceFidelityBackup, getLocalDb, SOURCE_FIDELITY_BACKUP_ID } from "@/shared/data/db/tbct-local-db";
import type { ProtocolDefinition, ProtocolReleaseVersion, ProtocolSession } from "@/types/protocol-runtime";
import type { RuntimeSession } from "@/types/runtime-session";

describe("source-fidelity legacy backup", () => {
  beforeEach(async () => {
    const db = getLocalDb();
    await ensureSourceFidelityBackup();
    await db.transaction("rw", db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
    window.localStorage.clear();
  });

  it("captures legacy graph, release, runtime references, and catalog edits exactly once", async () => {
    const db = getLocalDb();
    const snapshot = createCanonicalProtocolReleaseSnapshot();
    const now = "2025-01-01T00:00:00.000Z";
    const definition: ProtocolDefinition = {
      id: "TBCT-BR-001",
      projectId: "TBCT-BR-001",
      title: "Legacy TBCT",
      locale: "pt-BR",
      country: "BR",
      currentVersion: "0.3.0",
      status: "published",
      sessionIds: ["SESSION-03"],
      globalSafetyRuleIds: [],
      runtimeSchemaVersion: "1.0",
      createdAt: now,
      updatedAt: now,
    };
    const session: ProtocolSession = {
      id: "SESSION-03",
      protocolId: definition.id,
      title: "Legacy Session 03",
      order: 3,
      goals: [],
      entryNodeId: snapshot.nodes[0].id,
      completionNodeIds: [snapshot.nodes.at(-1)?.id ?? snapshot.nodes[0].id],
      nodeIds: snapshot.nodes.map((node) => node.id),
      edgeIds: snapshot.edges.map((edge) => edge.id),
      status: "published",
      locale: "pt-BR",
      createdAt: now,
      updatedAt: now,
    };
    const release: ProtocolReleaseVersion = {
      id: "REL-LEGACY-1",
      protocolId: definition.id,
      version: "0.3.0",
      releasePackageId: "PKG-LEGACY-1",
      publishedAt: now,
      publishedBy: "Demo User",
      changeSummary: "Legacy graph retained for migration backup",
      immutableSnapshot: snapshot,
    };
    const runtimeSession: RuntimeSession = {
      id: "RTS-LEGACY-1",
      projectId: "TBCT-BR-001",
      protocolId: definition.id,
      protocolVersion: "0.3.0",
      releaseId: release.id,
      sessionDefinitionId: session.id,
      participantId: "PARTICIPANT-PRIVATE",
      status: "paused",
      currentNodeId: snapshot.nodes[0].id,
      patientAlias: "Private Participant",
      locale: "pt-BR",
      runtimeContext: { fields: {}, riskSignals: [], iterationCounts: {} },
      messageIds: [],
      executionLogIds: [],
      escalationIds: [],
      createdAt: now,
      updatedAt: now,
    };
    await db.protocolDefinitions.put(definition);
    await db.protocolSessions.put(session);
    await db.protocolGraphNodes.bulkPut(snapshot.nodes.map((node) => ({ ...node, protocolId: definition.id, sessionId: session.id })));
    await db.protocolGraphEdges.bulkPut(snapshot.edges.map((edge) => ({ ...edge, protocolId: definition.id, sessionId: session.id })));
    await db.protocolReleaseVersions.put(release);
    await db.runtimeSessions.put(runtimeSession);
    window.localStorage.setItem("tbct.session-catalog.v2", JSON.stringify({
      definitions: [{ id: "SESSION-03" }],
      nodes: [{ id: "LEGACY-NODE", sourceTrace: { sourceLineStart: 1, sourceLineEnd: 2 } }],
      promptItems: [{ id: "LEGACY-PROMPT", editableText: "Preserved editable legacy text" }],
      plan: { id: "legacy-plan" },
    }));

    const first = await ensureSourceFidelityBackup();
    window.localStorage.setItem("tbct.session-catalog.v2", JSON.stringify({ promptItems: [{ id: "LATER", editableText: "Must not overwrite the first backup" }] }));
    const second = await ensureSourceFidelityBackup();

    expect(first?.id).toBe(SOURCE_FIDELITY_BACKUP_ID);
    expect(first?.protocolDefinitions).toHaveLength(1);
    expect(first?.protocolSessions).toHaveLength(1);
    expect(first?.nodes).toHaveLength(snapshot.nodes.length + 1);
    expect(first?.edges).toHaveLength(snapshot.edges.length);
    expect(first?.releases.map((item) => item.id)).toEqual([release.id]);
    expect(first?.runtimeReferences).toHaveLength(1);
    expect(first?.runtimeReferences[0]).not.toHaveProperty("participantId");
    expect(first?.promptItems).toEqual([{ id: "LEGACY-PROMPT", editableText: "Preserved editable legacy text" }]);
    expect(first?.sourceTraces.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
    expect(await db.sourceFidelityBackups.count()).toBe(1);
  });
});