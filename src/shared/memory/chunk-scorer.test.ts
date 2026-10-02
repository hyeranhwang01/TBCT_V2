import { describe, expect, it } from "vitest";
import { LAYER_QUOTAS, MAX_SELECTED, MAX_SELECTED_CHARS, OPENING_STEP, RECENCY_FLOOR, bigrams, containment, scoreChunks, selectChunks } from "@/shared/memory/chunk-scorer";
import { retrievalSlotsFor } from "@/shared/memory/chunk-configs";
import { levelForSession } from "@/shared/memory/session-levels";
import { authorshipViolations, bridgeTexts, retrievalProgramLines } from "@/shared/memory/memory-retrieval";
import type { MemoryChunk, MemoryChunkTags } from "@/types/memory-chunks";

let seq = 0;
function chunk(content: string, extra: Partial<MemoryChunk> = {}): MemoryChunk {
  seq += 1;
  return { id: `C${String(seq).padStart(3, "0")}`, participantId: "PT", runtimeSessionId: "RS-1", sessionDefinitionId: "tbct-s01", sessionIndex: 1, chunkKind: "worksheet", elementKind: "other", fieldNames: [], sourceMessageIds: [], content, distortionIds: [], sourceCreatedAt: "2026-09-20T00:00:00.000Z", indexVersion: "chunks-v1", author: "participant", layer: "record", sensitivityFlags: [], tags: null, suppressed: false, createdAt: "2026-09-20T00:00:00.000Z", ...extra };
}

const S02 = retrievalSlotsFor("tbct-s02");
const query = (text: string, extra: Partial<Parameters<typeof scoreChunks>[1]> = {}) => ({ text, currentSessionIndex: 2, opening: false, ...extra });
const themes = (partial: Partial<MemoryChunkTags>): MemoryChunkTags => ({ domains: [], persons: [], emotions: [], beliefs: [], distortions: [], ...partial });
const ids = (items: Array<{ chunk: MemoryChunk }>) => items.map((item) => item.chunk.id);

describe("matching words", () => {
  it("reads Korean and English as character bigrams, ignoring spacing, punctuation and the Q/A markers", () => {
    expect([...bigrams("A: 팀장 님!")]).toEqual(["팀장", "장님"]);
    expect(containment("팀장님이 무시해요", "Q: …\nA: 회의에서 팀장님이 나를 무시했다")).toBeGreaterThan(0.5);
    expect(containment("", "anything")).toBe(0);
  });
});

describe("the book's session levels", () => {
  it("allows level 1 in sessions 1-3, level 2 from 4, level 3 from 5", () => {
    expect([0, 1, 2, 3, 4, 5, 8].map(levelForSession)).toEqual([1, 1, 1, 1, 2, 3, 3]);
  });
});

describe("filters", () => {
  const own = chunk("자동적 사고: 팀장님이 나를 무시한다", { elementKind: "own_case" });
  const later = chunk("팀장님 S02에서 나온 말", { sessionIndex: 2 });
  const hidden = chunk("팀장님 얘기 숨김", { suppressed: true });
  const invalid = chunk("팀장님 얘기 무효", { validity: { state: "invalid", reason: "참가자가 정정함", createdAt: "x" } });
  const revalidated = chunk("팀장님 얘기 다시 유효", { validity: { state: "valid", reason: "다시 확인", createdAt: "x" } });
  const flagged = chunk("팀장님 얘기 안전 표시", { sensitivityFlags: ["ambiguous_safety_language"] });
  const deep = chunk("해석: 팀장님 일 밑에 '나는 가치 없다'는 핵심 신념", { author: "system", layer: "interpretation", cognitiveLevel: 3 });
  const shallow = chunk("해석: 팀장님이 무시한다는 자동적 사고", { author: "system", layer: "interpretation", cognitiveLevel: 1 });
  const unleveled = chunk("해석: 팀장님 일에 대한 해석", { author: "system", layer: "interpretation" });
  const all = [own, later, hidden, invalid, revalidated, flagged, deep, shallow, unleveled];

  it("never offers a chunk from this session or later, a suppressed, invalid or flagged one, or an interpretation deeper than the session", () => {
    const offered = ids(scoreChunks(all, query("팀장님"), S02));
    expect(offered.sort()).toEqual([own.id, revalidated.id, shallow.id].sort());
  });

  it("lets a level-2 interpretation through from S4 and level 3 from S5; the participant's own words are never gated", () => {
    const mid = chunk("해석: 팀장님 일 밑의 가정", { author: "system", layer: "interpretation", cognitiveLevel: 2 });
    expect(ids(scoreChunks([mid, deep, own], query("팀장님", { currentSessionIndex: 4 }), {}))).toEqual([mid.id, own.id]);
    expect(ids(scoreChunks([mid, deep, own], query("팀장님", { currentSessionIndex: 5 }), {}))).toEqual([mid.id, deep.id, own.id]);
  });

  it("offers everything but this session's and suppressed chunks when the filters are off (the evaluation's ablation only)", () => {
    expect(ids(scoreChunks(all, query("팀장님"), S02, { filters: false })).sort()).toEqual([own, invalid, revalidated, flagged, deep, shallow, unleveled].map((item) => item.id).sort());
  });
});

describe("scoring and selection", () => {
  const ownCase = chunk("상황: 팀 회의에서 팀장님이 내 보고서를 넘겼다\n자동적 사고: 팀장님이 나를 무시한다", { elementKind: "own_case", distortionIds: ["mind-reading"] });
  const sleep = chunk("어려움: 잠을 못 자요\n예: 새벽 3시에 깼어요", { elementKind: "problem" });
  const family = chunk("A: 엄마랑 통화하면 늘 싸우게 돼요", { chunkKind: "episode", elementKind: "conversation", layer: "raw", tags: themes({ domains: ["family"], persons: ["parent"], emotions: ["anger"] }) });
  const homework = chunk("과제 — 마음읽기 예시: 동료가 날 싫어한다", { chunkKind: "homework", elementKind: "homework", distortionIds: ["mind-reading"] });
  const all = [ownCase, sleep, family];

  it("brings back the participant's own moment when what they say points to it, and leaves the rest", () => {
    const selected = selectChunks(scoreChunks(all, query("팀장님이 나를 무시한다", { focusField: "distortionExamples" }), S02));
    expect(ids(selected)).toEqual([ownCase.id]);
  });

  it("finds the same person under different words through the themes", () => {
    const withThemes = selectChunks(scoreChunks(all, query("어머니랑 또 부딪혔어요", { focusField: "distortionExamples", themes: themes({ domains: ["family"], persons: ["parent"] }) }), S02));
    const without = selectChunks(scoreChunks(all, query("어머니랑 또 부딪혔어요", { focusField: "distortionExamples" }), S02));
    expect(ids(withThemes)).toContain(family.id);
    expect(ids(without)).not.toContain(family.id);
  });

  it("scores tags as the share of the themes a chunk carries, a shared distortion counting double, beliefs ignored", () => {
    const scored = scoreChunks([ownCase, family], query("", { themes: themes({ persons: ["parent"], distortions: ["mind-reading"], beliefs: ["worthless"] }) }), S02);
    expect(scored.find((item) => item.chunk.id === ownCase.id)?.parts.tags).toBeCloseTo(2 / 3, 2);
    expect(scored.find((item) => item.chunk.id === family.id)?.parts.tags).toBeCloseTo(1 / 3, 2);
  });

  it("at the S02 opening offers last week's homework and their own S01 moment, at the homework report the homework, whatever was said; nothing else without relevance", () => {
    const opening = selectChunks(scoreChunks([ownCase, sleep, homework], query("", { opening: true }), S02));
    expect(ids(opening).sort()).toEqual([ownCase.id, homework.id].sort());
    expect(opening.every((item) => item.parts.slot === 1)).toBe(true);
    expect(ids(selectChunks(scoreChunks([ownCase, sleep, homework], query("네", { focusField: "homeworkReport" }), S02)))).toEqual([homework.id]);
    expect(selectChunks(scoreChunks([ownCase, sleep, homework], query("네", { focusField: "cdQuestFrequency" }), S02))).toEqual([]);
    expect(S02[OPENING_STEP]).toBeDefined();
  });

  it("offers nothing when nothing fits", () => {
    expect(selectChunks(scoreChunks(all, query("날씨가 좋네요", { focusField: "sessionAgendaAgreed" }), S02))).toEqual([]);
  });

  it("orders by recency within relevance, with a floor for what is long ago, and never lets recency alone make a chunk relevant", () => {
    const s1 = chunk("팀장님 이야기 하나", { sessionIndex: 1 });
    const s6 = chunk("팀장님 이야기 둘", { sessionIndex: 6 });
    const scored = scoreChunks([s1, s6], query("팀장님 이야기", { currentSessionIndex: 8 }), {});
    expect(scored.find((item) => item.chunk.id === s1.id)?.parts.recency).toBe(RECENCY_FLOOR);
    expect(scored.find((item) => item.chunk.id === s6.id)?.parts.recency).toBe(0.5);
    expect(ids(selectChunks(scored))[0]).toBe(s6.id);
    expect(selectChunks(scoreChunks([s6], query("날씨", { currentSessionIndex: 8 }), {}))).toEqual([]);
  });

  it("is deterministic, and stays within the per-layer quotas, the total cap and the character budget", () => {
    const records = Array.from({ length: 6 }, (_, index) => chunk(`팀장님 이야기 기록 ${index} ${"가".repeat(60)}${index}`));
    const episodes = Array.from({ length: 6 }, (_, index) => chunk(`A: 팀장님 이야기 대화 ${index} ${"나".repeat(60)}${index}`, { chunkKind: "episode", elementKind: "conversation", layer: "raw" }));
    const many = [...records, ...episodes];
    const first = selectChunks(scoreChunks(many, query("팀장님 이야기", { focusField: "distortionExamples" }), S02));
    const again = selectChunks(scoreChunks([...many].reverse(), query("팀장님 이야기", { focusField: "distortionExamples" }), S02));
    expect(ids(first)).toEqual(ids(again));
    expect(first.length).toBeLessThanOrEqual(MAX_SELECTED);
    expect(first.filter((item) => item.chunk.layer === "record").length).toBe(LAYER_QUOTAS.record);
    expect(first.filter((item) => item.chunk.layer === "raw").length).toBe(LAYER_QUOTAS.raw);
    expect(first.reduce((sum, item) => sum + item.chunk.content.length, 0)).toBeLessThanOrEqual(MAX_SELECTED_CHARS);
    expect(selectChunks(scoreChunks(many, query("팀장님 이야기"), S02), { maxSelected: 3 })).toHaveLength(3);
  });

  it("always fits the best chunk even when it is longer than the budget for extras", () => {
    const long = chunk(`상황: 팀장님 회의 ${"가".repeat(1000)}`, { elementKind: "own_case" });
    expect(ids(selectChunks(scoreChunks([long], query("팀장님 회의", { focusField: "distortionExamples" }), S02)))).toEqual([long.id]);
  });

  it("skips a chunk that repeats one already chosen", () => {
    const situation = chunk("상황: 팀 회의에서 팀장님이 제 보고서를 그냥 넘겼어요\n생각: 팀장님이 저를 무시해요", { elementKind: "own_case" });
    const repeat = chunk("A: 팀 회의에서 팀장님이 제 보고서를 그냥 넘겼어요", { chunkKind: "episode", elementKind: "conversation", layer: "raw" });
    const selected = selectChunks(scoreChunks([situation, repeat], query("팀 회의에서 팀장님이 제 보고서를 넘겼어요"), S02));
    expect(selected).toHaveLength(1);
  });

  it("puts at most one counsellor's note in, and labels lines without telling the model what to do", () => {
    const notes = [chunk("팀장님 관련 메모 1", { chunkKind: "clinician_note", elementKind: "clinician_note", sessionIndex: 0, author: "clinician", layer: "clinician_note" }), chunk("팀장님 관련 메모 2", { chunkKind: "clinician_note", elementKind: "clinician_note", sessionIndex: 0, author: "clinician", layer: "clinician_note" })];
    const selected = selectChunks(scoreChunks([...notes, ownCase], query("팀장님", { focusField: "distortionExamples" }), S02));
    expect(selected.filter((item) => item.chunk.chunkKind === "clinician_note")).toHaveLength(1);
    const lines = retrievalProgramLines(selected.map((item) => ({ ...item, surfacedThisSession: item.chunk.id === ownCase.id })));
    expect(lines[0]).toBe("Earlier-session memory (program note):");
    expect(lines).toContain("Counsellor's note:");
    const text = lines.join("\n");
    expect(text).toContain("Session 1 · 2026-09-20 · their own moment (cognitive model) · participant · mentioned earlier today]");
    expect(text).toMatch(/earlier · 2026-09-20 · counsellor's note · clinician\]/);
    // Usage rules live in the prompt (Common §7), not here.
    expect(text).not.toMatch(/never record|check whether|do not quote|not said today/i);
  });
});

describe("the authorship guard", () => {
  const remembered = ["자동적 사고: 팀장님이 나를 무시한다"];

  it("rejects a value that is in the memory but in nothing the participant said today", () => {
    expect(authorshipViolations({ distortionExamples: ["팀장님이 나를 무시한다"] }, remembered, ["네 그런 적 있어요"])).toEqual([{ name: "distortionExamples", reason: expect.stringContaining("earlier-session memory") }]);
  });

  it("accepts it once the participant says it again today, and never touches values unrelated to the memory", () => {
    expect(authorshipViolations({ distortionExamples: ["팀장님이 나를 무시한다"] }, remembered, ["맞아요, 팀장님이 나를 무시한다고 또 생각했어요"])).toEqual([]);
    expect(authorshipViolations({ homeworkReport: "이번 주엔 과제를 두 번 했어요" }, remembered, ["네"])).toEqual([]);
    expect(authorshipViolations({ distortionExamples: ["팀장님이 나를 무시한다"] }, [], [])).toEqual([]);
  });

  it("covers the basic bridge too: S01's goal is not today's answer until they say it", () => {
    const bridge = bridgeTexts({ previousS01Goal: "회의에서 한 번은 의견 말하기", previousS01Problems: ["회의에서 말을 못 해요"], homeworkReport: "x", previousHomeworkStatus: 2 });
    expect(bridge).toEqual(["회의에서 한 번은 의견 말하기", "회의에서 말을 못 해요"]);
    expect(authorshipViolations({ cdQuestReflection: "회의에서 한 번은 의견 말하기" }, bridge, ["네"])).toHaveLength(1);
    expect(authorshipViolations({ cdQuestReflection: "회의에서 한 번은 의견 말하기" }, bridge, ["저는 회의에서 한 번은 의견 말하기가 목표예요"])).toEqual([]);
  });
});
