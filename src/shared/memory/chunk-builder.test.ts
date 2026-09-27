import { describe, expect, it } from "vitest";
import { MAX_CHUNK_CHARS, buildHomeworkChunks, buildSessionChunks, defaultWorksheetChunks, episodeChunks, sessionIndexOf } from "@/shared/memory/chunk-builder";
import { worksheetChunkerFor } from "@/shared/memory/chunk-configs";
import { COGNITIVE_DISTORTIONS } from "@/shared/protocol/cognitive-distortions";
import type { RuntimeMessage } from "@/types/runtime-session";
import type { HomeworkEntryRecord, HomeworkRecord } from "@/types/homework";

let clock = 0;
function message(role: "patient" | "assistant", content: string, extra: Partial<RuntimeMessage> = {}): RuntimeMessage {
  clock += 1;
  return { id: `M${clock}`, runtimeSessionId: "RS-1", role, content, status: "delivered", createdAt: new Date(Date.UTC(2026, 8, 20, 0, 0, clock)).toISOString(), ...extra };
}
const ask = (content: string, focusField?: string, extra: Record<string, unknown> = {}) => message("assistant", content, { metadata: { focusField, ...extra } });
const say = (content: string) => message("patient", content);

function sessionInput(sessionDefinitionId: string, fields: Record<string, unknown>, messages: RuntimeMessage[] = []) {
  return { participantId: "PT-1", runtimeSessionId: `RS-${sessionDefinitionId}`, sessionDefinitionId, locale: "ko-KR", fields, messages, completedAt: "2026-09-20T10:00:00.000Z", worksheetChunker: worksheetChunkerFor(sessionDefinitionId) };
}

describe("S01 worksheet chunks", () => {
  const fields = {
    s01Problems: ["회사에서 자꾸 긴장해요", "잠을 못 자요"],
    s01ProblemExample: ["회의 때 말을 못 했어요", "새벽 3시에 깼어요"],
    s01RepresentativeProblem: "남들이 나를 무시할까 봐 걱정해요",
    s01Goal: "회의에서 한 번은 의견을 말하기",
    situationLine: "팀 회의에서 팀장님이 내 보고서를 넘겼다",
    personalEmotion: "불안",
    personalEmotionIntensity: 80,
    thoughtLine: "팀장님이 나를 무시한다",
    s01ThoughtBeliefPercent: 90,
    personalBehavior: "아무 말도 안 했다",
    participantSelectedDistortions: ["마음읽기", "성급한 결론"],
    candidateOneEmotion: "기쁨",
    candidateTwoThought: "빈말이겠지",
    threePersonScene: "상담자가 처음 만난 세 사람에게…",
    friendThought: "팀장님이 바빴나 보다",
  };
  const chunks = buildSessionChunks(sessionInput("tbct-s01", fields));

  it("pairs each difficulty with its example and keeps the one underneath", () => {
    const problems = chunks.filter((chunk) => chunk.elementKind === "problem").map((chunk) => chunk.content);
    expect(problems).toEqual(["어려움: 회사에서 자꾸 긴장해요\n예: 회의 때 말을 못 했어요", "어려움: 잠을 못 자요\n예: 새벽 3시에 깼어요", "다른 어려움들 밑에 있는 어려움: 남들이 나를 무시할까 봐 걱정해요"]);
  });

  it("keeps the participant's own moment together, with strengths and the distortions they recognized", () => {
    const ownCase = chunks.find((chunk) => chunk.elementKind === "own_case");
    expect(ownCase?.content).toBe("상황: 팀 회의에서 팀장님이 내 보고서를 넘겼다\n감정: 불안 (80)\n자동적 사고: 팀장님이 나를 무시한다 (믿음 90%)\n행동: 아무 말도 안 했다\n알아차린 왜곡: 마음읽기, 성급한 결론");
    expect(ownCase?.distortionIds).toEqual(["mind-reading", "jumping-to-conclusions"]);
    expect(ownCase).toMatchObject({ chunkKind: "worksheet", sessionIndex: 1, participantId: "PT-1" });
  });

  it("leaves out the three-person example, which is the program's, not the participant's life", () => {
    expect(chunks.some((chunk) => /기쁨|빈말|세 사람에게/.test(chunk.content))).toBe(false);
  });

  it("gives the same ids when rebuilt, and different ones for another session", () => {
    const again = buildSessionChunks(sessionInput("tbct-s01", fields));
    expect(again.map((chunk) => chunk.id)).toEqual(chunks.map((chunk) => chunk.id));
    const other = buildSessionChunks({ ...sessionInput("tbct-s01", fields), runtimeSessionId: "RS-other" });
    expect(other.some((chunk) => chunks.some((mine) => mine.id === chunk.id))).toBe(false);
  });
});

describe("S02 worksheet chunks", () => {
  const examples = COGNITIVE_DISTORTIONS.map(() => "—");
  examples[7] = "팀장님이 날 한심하게 볼 거야";
  const scores = COGNITIVE_DISTORTIONS.map(() => 0);
  scores[7] = 4;
  const chunks = buildSessionChunks(sessionInput("tbct-s02", { distortionExamples: examples, cdQuestScores: scores, cdQuestFrequency: scores.map((score) => (score ? 2 : 0)), cdQuestIntensity: scores.map((score) => (score ? 3 : 0)), cdQuestPriorityTypes: ["마음읽기"], cdQuestReflection: "생각보다 높아서 놀랐어요", cdQuestTotal: 4 }));

  it("makes one chunk per pattern with an example, carrying its score, and none for '—'", () => {
    const rows = chunks.filter((chunk) => chunk.elementKind === "distortion_example");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ content: "마음읽기 예시: 팀장님이 날 한심하게 볼 거야 · CD-Quest 4점 (빈도 2, 확신 3)", distortionIds: ["mind-reading"], sessionIndex: 2 });
  });

  it("keeps the patterns to work on and what they made of the total", () => {
    expect(chunks.find((chunk) => chunk.elementKind === "distortion_priority")).toMatchObject({ content: "앞으로 다루고 싶은 패턴: 마음읽기", distortionIds: ["mind-reading"] });
    expect(chunks.find((chunk) => chunk.elementKind === "reflection")?.content).toBe("CD-Quest 총점을 보고 든 생각 (총점 4/75): 생각보다 높아서 놀랐어요");
  });
});

describe("conversation episodes", () => {
  it("cuts where the step changes and keeps the tail of the question with each answer", () => {
    const drafts = episodeChunks([
      ask("안녕하세요. 오늘은 어떤 일이 있었는지부터 이야기해 볼게요. 요즘 가장 힘든 일이 뭔가요?", "s01Problems"),
      say("회사에서 발표할 때마다 너무 긴장돼요"),
      ask("그 상황을 좀 더 말해 주세요.", "s01Problems"),
      say("손이 떨리고 목소리가 작아져요"),
      ask("그때 어떤 감정이 들었나요?", "personalEmotion"),
      say("창피하고 불안했어요"),
    ]);
    expect(drafts.map((draft) => draft.content)).toEqual([
      "Q: 안녕하세요. 오늘은 어떤 일이 있었는지부터 이야기해 볼게요. 요즘 가장 힘든 일이 뭔가요?\nA: 회사에서 발표할 때마다 너무 긴장돼요\nQ: 그 상황을 좀 더 말해 주세요.\nA: 손이 떨리고 목소리가 작아져요",
      "Q: 그때 어떤 감정이 들었나요?\nA: 창피하고 불안했어요",
    ]);
    expect(drafts[0].fieldNames).toEqual(["s01Problems"]);
    expect(drafts[1].messageIds).toHaveLength(2);
  });

  it("leaves out what the program answered with a safety turn, the answer to the safety question, and any risk wording", () => {
    const drafts = episodeChunks([
      ask("요즘 어떠세요?", "s01Problems"),
      say("그냥 다 끝내고 싶어요 정말로요"),
      ask("혹시 스스로를 해칠 생각을 말씀하신 건가요?", "s01Problems", { clarificationReason: "safety_clarification" }),
      say("아니요 그런 뜻은 아니었어요"),
      ask("알겠어요. 요즘 힘든 일을 말해 주세요.", "s01Problems"),
      say("요즘 죽고 싶다는 생각이 들어요"),
      ask("말씀해 주셔서 고마워요.", "s01Problems", { turnOutcome: "safety_override" }),
      ask("다시 이어서 해 볼게요. 회사 일은 어떠세요?", "s01Problems"),
      say("회사에서는 계속 실수만 하는 것 같아요"),
    ]);
    const text = drafts.map((draft) => draft.content).join("\n");
    expect(text).not.toMatch(/끝내고 싶어요|그런 뜻은|죽고 싶|해칠|고마워요/);
    expect(text).toContain("A: 회사에서는 계속 실수만 하는 것 같아요");
  });

  it("drops an episode with almost nothing from the participant, and splits a long one without cutting an answer", () => {
    expect(episodeChunks([ask("준비되셨나요?", "sessionAgendaAgreed"), say("네")])).toEqual([]);
    const long = Array.from({ length: 12 }, (_, index) => [ask(`질문 ${index}`, "s01Problems"), say(`${index}번째 답: ${"가".repeat(150)}`)]).flat();
    const drafts = episodeChunks(long);
    expect(drafts.length).toBeGreaterThan(1);
    for (const draft of drafts) {
      expect(draft.content.length).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
      expect(draft.content.startsWith("Q: ") || draft.content.startsWith("A: ")).toBe(true);
      expect(draft.messageIds?.length).toBeGreaterThan(0);
    }
    expect(new Set(drafts.map((draft) => draft.key)).size).toBe(drafts.length);
  });
});

describe("sessions without their own cut", () => {
  it("makes one chunk per recorded text value and skips what the program writes", () => {
    const drafts = defaultWorksheetChunks({ automaticThought: "나는 늘 실패해", evidenceFor: ["지난주 실수"], previousS01Goal: "x", promptFocusField: "y", turnCount: 3 });
    expect(drafts.map((draft) => [draft.key, draft.content])).toEqual([["field:automaticThought:0", "나는 늘 실패해"], ["field:evidenceFor:0", "지난주 실수"]]);
  });

  it("reads the session number from the definition id", () => {
    expect([sessionIndexOf("tbct-s01"), sessionIndexOf("tbct-s08"), sessionIndexOf("other")]).toEqual([1, 8, 0]);
  });
});

describe("homework chunks", () => {
  const record = (sessionDefinitionId: string): HomeworkRecord => ({ id: `HW-${sessionDefinitionId}`, runtimeSessionId: `RS-${sessionDefinitionId}`, sessionDefinitionId, participantId: "PT-1", status: "in_progress", createdAt: "x", updatedAt: "x", data: {} });
  const entry = (id: string, entryType: string, data: Record<string, unknown>): HomeworkEntryRecord => ({ id, homeworkRecordId: "HW", entryType, createdAt: "2026-09-23T00:00:00.000Z", data });

  it("reads S01's distortion examples and S02's CD-Quest rows, and belongs to the session that assigned them", () => {
    const s01 = buildHomeworkChunks({ record: record("tbct-s01"), entries: [entry("E1", "distortion_example", { distortionId: "mind-reading", date: "2026-09-22", text: "동료가 나를 싫어한다고 생각했다" })], locale: "ko-KR" });
    expect(s01).toEqual([expect.objectContaining({ chunkKind: "homework", sessionIndex: 1, distortionIds: ["mind-reading"], content: "과제 (2026-09-22) — 마음읽기 예시: 동료가 나를 싫어한다고 생각했다", sourceRef: "E1" })]);
    const s02 = buildHomeworkChunks({ record: record("tbct-s02"), entries: [entry("E2", "cdquest_round", { date: "2026-09-29", rows: [{ distortionId: "labeling", example: "나는 바보야", score: 3 }, { distortionId: "mind-reading", example: "", score: 0 }] })], locale: "ko-KR" });
    expect(s02.map((chunk) => chunk.content)).toEqual(["과제 CD-Quest (2026-09-29) — 낙인찍기 예시: 나는 바보야 · 점수 3"]);
  });

  it("keeps any other entry as one chunk of its text", () => {
    const chunks = buildHomeworkChunks({ record: record("tbct-s06"), entries: [entry("E3", "try", { schemaVersion: 1, situation: "마트에 갔다", result: "생각보다 괜찮았다" })], locale: "ko-KR" });
    expect(chunks.map((chunk) => chunk.content)).toEqual(["과제 — 마트에 갔다 / 생각보다 괜찮았다"]);
  });
});
