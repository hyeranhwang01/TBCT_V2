// @vitest-environment node
// Memory chunk provenance and validity against real Postgres (PGlite) with
// every migration applied (sql/043, sql/044): the backfill, the immutable
// tuple of the guard, append-only validity events, and the store reading the
// latest event. .claude/TASK_SCOPE.json note2026_10_02_memory_rag_v2_phase_a.
import { beforeAll, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ pool: null as unknown }));
vi.mock("@/shared/data/db/pg-pool", () => ({ getPgPool: () => db.pool }));

// Repositories called from server code dispatch in process (to PGlite).
import "@/shared/data/server/runtime-request-context";
import { createTestDatabase, type TestPool } from "@/test/pglite/pglite-db";
import { listMemoryChunks, listMemoryChunksBySession, recordMemoryConsent, saveMemoryChunkRetrieval, saveMemoryChunks, saveParticipant, setMemoryChunkValidity, suppressMemoryChunk } from "@/shared/data/server/participant-store";
import { retrievalProgramLines, retrieveForTurn } from "@/shared/memory/memory-retrieval";
import { MEMORY_CONSENT_TEXT_VERSION } from "@/shared/memory/memory-consent";
import { buildSessionChunks, clinicianNoteChunk } from "@/shared/memory/chunk-builder";
import { worksheetChunkerFor } from "@/shared/memory/chunk-configs";
import type { MemoryChunk } from "@/types/memory-chunks";

function pool() {
  return db.pool as TestPool;
}

const insertLegacy = (id: string, kind: string) =>
  pool().query(
    `INSERT INTO participant_memory_chunks (id, participant_id, runtime_session_id, session_definition_id, session_index, chunk_kind, element_kind, content, source_created_at, index_version, created_at)
     VALUES ($1, 'PT-legacy', 'RS-legacy', 'tbct-s01', 1, $2, 'other', $3, now(), 'chunks-v1', now())`,
    [id, kind, `legacy ${kind}`],
  );

describe("memory chunk provenance and validity on Postgres", () => {
  let migrate: (all?: boolean) => Promise<unknown>;
  beforeAll(async () => {
    const created = await createTestDatabase();
    db.pool = created.pool;
    migrate = created.migrate;
  }, 60_000);

  it("backfills author and layer from the kind of a chunk stored before sql/043, and re-applying changes nothing", async () => {
    // A row as the old code wrote it: the new columns at their defaults.
    for (const kind of ["worksheet", "episode", "homework", "clinician_note"]) await insertLegacy(`MCH-legacy-${kind}`, kind);
    await migrate(true);
    const { rows } = await pool().query<{ id: string; author: string; layer: string; cognitive_level: number | null; sensitivity_flags: string[] }>(
      "SELECT id, author, layer, cognitive_level, sensitivity_flags FROM participant_memory_chunks WHERE participant_id = 'PT-legacy' ORDER BY id",
    );
    expect(rows.map((row) => [row.id.replace("MCH-legacy-", ""), row.author, row.layer])).toEqual([
      ["clinician_note", "clinician", "clinician_note"],
      ["episode", "participant", "raw"],
      ["homework", "participant", "record"],
      ["worksheet", "participant", "record"],
    ]);
    expect(rows.every((row) => row.cognitive_level === null && row.sensitivity_flags.length === 0)).toBe(true);
    await migrate(true);
    expect((await pool().query("SELECT count(*)::int AS n FROM participant_memory_chunks WHERE participant_id = 'PT-legacy'")).rows[0]).toEqual({ n: 4 });
  }, 120_000);

  it("refuses to change provenance after insert, but still lets a clinician suppress", async () => {
    const [chunk] = buildSessionChunks({ participantId: "PT-guard", runtimeSessionId: "RS-guard", sessionDefinitionId: "tbct-s06", locale: "ko-KR", fields: { automaticThought: "나는 늘 실패해" }, messages: [], completedAt: "2026-09-20T01:00:00.000Z" });
    expect(await saveMemoryChunks([chunk])).toBe(1);
    for (const change of ["author = 'system'", "layer = 'interpretation'", "cognitive_level = 3", "sensitivity_flags = '{ambiguous_safety_language}'"]) {
      await expect(pool().query(`UPDATE participant_memory_chunks SET ${change} WHERE id = $1`, [chunk.id])).rejects.toThrow(/immutable/);
    }
    await expect(pool().query("UPDATE participant_memory_chunks SET author = 'nobody' WHERE id = $1", [chunk.id])).rejects.toThrow();
    expect(await suppressMemoryChunk({ op: "suppressMemoryChunk", chunkId: chunk.id, reason: "test", actorUserId: "clin-1" })).toMatchObject({ suppressed: true, author: "participant", layer: "record" });
  });

  it("stores provenance as the builder sets it and reads it back", async () => {
    const note = clinicianNoteChunk({ id: "MEM-1", participantId: "PT-read", sourceSessionId: "RS-read", content: "직장 스트레스가 큼", createdAt: "2026-09-20T00:00:00.000Z" })!;
    const interpretation: MemoryChunk = { ...note, id: "MCH-interp", chunkKind: "worksheet", elementKind: "other", author: "system", layer: "interpretation", cognitiveLevel: 3, sensitivityFlags: ["ambiguous_safety_language"], sessionIndex: 1, content: "해석: 핵심 신념" };
    await saveMemoryChunks([note, interpretation]);
    const read = await listMemoryChunks({ op: "listMemoryChunks", participantId: "PT-read" });
    expect(read.find((item) => item.id === note.id)).toMatchObject({ author: "clinician", layer: "clinician_note", sensitivityFlags: [] });
    expect(read.find((item) => item.id === note.id)?.cognitiveLevel).toBeUndefined();
    expect(read.find((item) => item.id === "MCH-interp")).toMatchObject({ author: "system", layer: "interpretation", cognitiveLevel: 3, sensitivityFlags: ["ambiguous_safety_language"] });
  });

  it("keeps validity as an append-only history whose latest event decides what retrieval sees", async () => {
    const [chunk] = buildSessionChunks({ participantId: "PT-valid", runtimeSessionId: "RS-valid", sessionDefinitionId: "tbct-s06", locale: "ko-KR", fields: { automaticThought: "나는 늘 실패해" }, messages: [], completedAt: "2026-09-20T01:00:00.000Z" });
    await saveMemoryChunks([chunk]);
    const listed = async (includeInvalid = false) => (await listMemoryChunks({ op: "listMemoryChunks", participantId: "PT-valid", includeInvalid })).map((item) => item.id);
    expect(await listed()).toEqual([chunk.id]);

    await expect(setMemoryChunkValidity({ op: "setMemoryChunkValidity", chunkId: chunk.id, state: "invalid", reason: "  " })).rejects.toThrow(/reason/);
    await expect(setMemoryChunkValidity({ op: "setMemoryChunkValidity", chunkId: "MCH-none", state: "invalid", reason: "x" })).rejects.toThrow(/not found/);
    const invalid = await setMemoryChunkValidity({ op: "setMemoryChunkValidity", chunkId: chunk.id, state: "invalid", reason: "참가자가 정정함", actorUserId: "clin-1" });
    expect(invalid).toMatchObject({ content: chunk.content, validity: { state: "invalid", reason: "참가자가 정정함", actor: "clin-1" } });
    expect(await listed()).toEqual([]);
    expect(await listed(true)).toEqual([chunk.id]);
    expect((await listMemoryChunksBySession("RS-valid"))[0].validity?.state).toBe("invalid");

    await setMemoryChunkValidity({ op: "setMemoryChunkValidity", chunkId: chunk.id, state: "valid", reason: "다시 같은 말을 함", actorUserId: "clin-1" });
    expect(await listed()).toEqual([chunk.id]);

    const { rows } = await pool().query<{ state: string; participant_id: string }>("SELECT state, participant_id FROM memory_chunk_validity_events WHERE chunk_id = $1 ORDER BY created_at", [chunk.id]);
    expect(rows).toEqual([{ state: "invalid", participant_id: "PT-valid" }, { state: "valid", participant_id: "PT-valid" }]);
    await expect(pool().query("UPDATE memory_chunk_validity_events SET state = 'valid' WHERE chunk_id = $1", [chunk.id])).rejects.toThrow(/append-only/);
    await expect(pool().query("DELETE FROM memory_chunk_validity_events WHERE chunk_id = $1", [chunk.id])).rejects.toThrow(/append-only/);
    await expect(pool().query("INSERT INTO memory_chunk_validity_events (id, chunk_id, participant_id, state, reason) VALUES ('x', $1, 'PT-valid', 'maybe', 'r')", [chunk.id])).rejects.toThrow();
  });

  it("retrieves through the real store: v2 on record, nothing invalidated, no usage instructions, and a repeat marked", async () => {
    const now = new Date().toISOString();
    await saveParticipant({ id: "PT-flow", projectId: "tbct", alias: "F", locale: "ko", status: "active", runtimeSessionIds: [], longitudinalRecordId: "L-flow", createdAt: now, updatedAt: now } as never);
    await recordMemoryConsent({ op: "recordMemoryConsent", participantId: "PT-flow", decision: "granted", textVersion: MEMORY_CONSENT_TEXT_VERSION, source: "first_visit_dialog", locale: "ko" });
    const chunks = buildSessionChunks({ participantId: "PT-flow", runtimeSessionId: "RS-flow-s01", sessionDefinitionId: "tbct-s01", locale: "ko-KR", fields: { s01Problems: ["회의에서 말을 못 해요"], situationLine: "팀 회의에서 팀장님이 내 보고서를 넘겼다", thoughtLine: "팀장님이 나를 무시한다" }, messages: [], completedAt: "2026-09-20T01:00:00.000Z", worksheetChunker: worksheetChunkerFor("tbct-s01") });
    await saveMemoryChunks(chunks);
    const own = chunks.find((item) => item.elementKind === "own_case")!;
    const input = { participantId: "PT-flow", runtimeSessionId: "RS-flow-s02", sessionDefinitionId: "tbct-s02", queryText: "팀장님이 나를 무시한다", focusField: "distortionExamples", opening: false };

    const first = await retrieveForTurn(input);
    expect(first.record).toMatchObject({ consentState: "granted", algorithmVersion: "retrieval-v2", indexVersion: "chunks-v1" });
    expect(first.selected.map((item) => item.chunk.id)).toEqual([own.id]);
    expect(first.selected[0]).toMatchObject({ surfacedThisSession: false, chunk: { author: "participant", layer: "record" } });
    const lines = retrievalProgramLines(first.selected).join("\n");
    expect(lines).toContain("Earlier-session memory (program note):");
    expect(lines).not.toMatch(/never record|check whether|not said today|do not quote/i);

    await saveMemoryChunkRetrieval({ ...first.record, id: "MCR-flow-1", messageId: "MSG-1", createdAt: new Date().toISOString() });
    const second = await retrieveForTurn(input);
    expect(second.selected[0].surfacedThisSession).toBe(true);
    expect(retrievalProgramLines(second.selected).join("\n")).toContain("participant · mentioned earlier today]");

    await setMemoryChunkValidity({ op: "setMemoryChunkValidity", chunkId: own.id, state: "invalid", reason: "참가자가 정정함" });
    const third = await retrieveForTurn(input);
    expect(third.selected).toEqual([]);
    // Not offered, and not among the texts the authorship guard checks either:
    // the store leaves it out entirely.
    expect(third.earlierTexts).not.toContain(own.content);
  });
});
