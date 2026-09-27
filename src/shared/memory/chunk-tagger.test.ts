import { afterEach, describe, expect, it, vi } from "vitest";
import { TAG_PROMPT_VERSION, setChunkTaggerForTests, tagParticipantChunks } from "@/shared/memory/chunk-tagger";
import { TAG_AXES, sanitizeTags } from "@/shared/memory/memory-tags";
import { getOrCreateParticipantForUser, recordParticipantMemoryConsent } from "@/shared/api/participant-api";
import { listMemoryChunks, saveMemoryChunks } from "@/shared/data/repositories/memory-chunk-repository";
import type { MemoryChunk } from "@/types/memory-chunks";

function chunk(participantId: string, id: string, content: string, distortionIds: string[] = []): MemoryChunk {
  return { id, participantId, runtimeSessionId: "RS-1", sessionDefinitionId: "tbct-s01", sessionIndex: 1, chunkKind: "worksheet", elementKind: "own_case", fieldNames: [], sourceMessageIds: [], content, distortionIds, sourceCreatedAt: "2026-09-20T00:00:00.000Z", indexVersion: "chunks-v1", tags: null, suppressed: false, createdAt: "2026-09-20T00:00:00.000Z" };
}

async function participantWith(decision?: "granted" | "declined") {
  const participant = await getOrCreateParticipantForUser(`auth-tag-${Math.random()}`, { locale: "ko-KR" });
  if (decision) await recordParticipantMemoryConsent(participant.id, { decision, source: "first_visit_dialog", locale: "ko" });
  return participant.id;
}

afterEach(() => {
  setChunkTaggerForTests(undefined);
  vi.unstubAllGlobals();
  delete process.env.ANTHROPIC_API_KEY;
});

describe("the tag list", () => {
  it("keeps only known ids, once, in list order", () => {
    expect(sanitizeTags({ domains: ["family", "work_study", "made_up", "family"], persons: "boss", beliefs: ["worthless"], distortions: ["mind-reading", "not-a-distortion"] })).toEqual({ domains: ["work_study", "family"], persons: [], emotions: [], beliefs: ["worthless"], distortions: ["mind-reading"] });
    expect(TAG_AXES.distortions).toHaveLength(15);
  });
});

describe("tagging a participant's chunks", () => {
  it("never sends anything for a participant who has not agreed, or who declined", async () => {
    const tagger = vi.fn();
    setChunkTaggerForTests(tagger);
    for (const decision of [undefined, "declined"] as const) {
      const participantId = await participantWith(decision);
      await saveMemoryChunks([chunk(participantId, `C-${decision}`, "팀장님이 날 무시한다")]);
      expect(await tagParticipantChunks(participantId)).toMatchObject({ status: "skipped_no_consent" });
    }
    expect(tagger).not.toHaveBeenCalled();
  });

  it("tags once, keeps distortions known from structure, and leaves a failed batch for next time", async () => {
    const participantId = await participantWith("granted");
    await saveMemoryChunks([chunk(participantId, "C1", "팀장님이 날 무시한다", ["mind-reading"]), chunk(participantId, "C2", "엄마랑 싸웠다")]);
    setChunkTaggerForTests(async () => ({ ok: false, error: "overloaded" }));
    expect(await tagParticipantChunks(participantId)).toMatchObject({ status: "failed", tagged: 0, untagged: 2 });

    setChunkTaggerForTests(async ({ chunks }) => ({
      ok: true,
      model: "scripted",
      tags: Object.fromEntries(chunks.map((item) => [item.id, item.id === "C1" ? { domains: ["work_study"], persons: ["boss"], emotions: ["anxiety"], beliefs: [], distortions: [] } : { domains: ["family"], persons: ["parent"], emotions: ["anger"], beliefs: [], distortions: [] }])),
    }));
    expect(await tagParticipantChunks(participantId)).toMatchObject({ status: "done", tagged: 2, untagged: 0 });
    const stored = await listMemoryChunks(participantId);
    expect(stored.find((item) => item.id === "C1")).toMatchObject({ tags: { domains: ["work_study"], persons: ["boss"], emotions: ["anxiety"], beliefs: [], distortions: ["mind-reading"] }, tagModel: "scripted", tagPromptVersion: TAG_PROMPT_VERSION });

    const again = vi.fn();
    setChunkTaggerForTests(again);
    expect(await tagParticipantChunks(participantId)).toMatchObject({ status: "nothing_to_tag" });
    expect(again).not.toHaveBeenCalled();
  });

  it("asks the model with the tag list as enums, identifiers removed, and ignores ids it was not asked about", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const participantId = await participantWith("granted");
    await saveMemoryChunks([chunk(participantId, "C1", "팀장님 번호 010-1234-5678로 연락이 왔다")]);
    let body: Record<string, unknown> = {};
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith("https://api.anthropic.com")) {
        body = JSON.parse(String(init?.body));
        return Response.json({ content: [{ type: "tool_use", name: "submit_chunk_tags", input: { chunks: [{ id: "C1", domains: ["work_study"], persons: ["boss"], emotions: [], beliefs: [], distortions: [] }, { id: "C-other", domains: ["family"], persons: [], emotions: [], beliefs: [], distortions: [] }] } }], usage: { input_tokens: 10, output_tokens: 5 } });
      }
      return realFetch(input, init);
    });
    expect(await tagParticipantChunks(participantId)).toMatchObject({ status: "done", tagged: 1 });
    const text = JSON.stringify(body.messages);
    expect(text).toContain("[PHONE]");
    expect(text).not.toContain("010-1234-5678");
    const items = (body.tools as Array<{ input_schema: { properties: { chunks: { items: { properties: Record<string, { items?: { enum?: string[] } }> } } } } }>)[0].input_schema.properties.chunks.items.properties;
    expect(items.persons.items?.enum).toEqual(TAG_AXES.persons);
    expect(items.distortions.items?.enum).toEqual(TAG_AXES.distortions);
  });
});
