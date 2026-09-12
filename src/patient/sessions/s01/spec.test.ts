import { beforeEach, describe, expect, it } from "vitest";
import { createCanonicalTestRuntimeSession, getRuntimeSession } from "@/shared/api/runtime-session-api";
import { startRuntimeSession, submitPatientInput } from "@/shared/api/runtime-execution-api";
import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import { S01_COGNITIVE_DISTORTIONS } from "@/patient/sessions/s01/cognitive-distortions";
import { s01PromptSlug } from "@/patient/sessions/s01/turn-rules";
import { getWorksheetView } from "@/shared/worksheet/worksheet-projection";
import type { PatientInput } from "@/types/runtime-session";

type RuntimeSessionView = NonNullable<Awaited<ReturnType<typeof getRuntimeSession>>>;

// S01 redesign (.claude/TASK_SCOPE.json note2026_09_12_s01_redesign). These
// tests replay the participant's answers from the real first session
// recorded 2026-09-11 (lightly shortened), keyed by prompt slug, and check
// the order and branches the researcher approved.
const REAL_SESSION: Record<string, string> = {
  "main-difficulty": "걱정이 많아요",
  "difficulty-example": "과제나 일을 할 때 뭔가 놓치면 어떡하지 하는 걱정이 불안으로 이어져요.",
  "other-difficulty": "계획을 반드시 세우고 그대로 해야 하는 강박이 있어요",
  "other-difficulty-more": "관계에서 좀 예민한 편이에요",
  "representative-difficulty": "첫 번째요",
  "goal-at-end": "불안을 없앨 순 없지만 다스리는 법을 배웠으면 좋겠어요.",
  "goal-benefit": "성취감이 들고 삶의 질이 높아질 것 같아요.",
  "practice-commitment": "네",
  "recent-moment": "한 일주일 반 전에 팀원들 사이에 프로젝트 진행 방식에 의견 차이가 있어서 그것 때문에 불안했던 적이 있어요.",
  "write-situation-line": "팀원들과 프로젝트 방식에 의견 차이가 있었다",
  "first-emotion": "배신감",
  "first-emotion-intensity": "50",
  "second-emotion": "공포감",
  "second-emotion-intensity": "45",
  "third-emotion": "없어요",
  "thought-behind-emotion": "제가 잘못한 게 없는데 저를 오해하고 잘못 대했다는 생각이요",
  "thought-belief": "75",
  "first-behavior": "아무것도 할 수 없어서 눈물만 났어요",
  "second-behavior": "나는 왜 그런가 하고 자책했어요",
  "body": "몸이 추운 것처럼 떨렸어요",
  "link-check": "네",
  "friend-same-thought": "아니요",
  "friend-thought": "그냥 뭐야 하고 넘겼을 것 같아요",
  "after-behavior-feeling": "괴로웠어요",
  "thought-strengthened": "내가 문제구나 하는 생각이요",
  "usual-prevention": "피하거나 계획을 엄청 세워요",
  "problem-link": "네",
  "short-long-term": "당장은 안심되는데 길게 보면 오히려 안 좋아요",
  "candidate-one-emotion": "기분이 좋고 안도감이 들 것 같아요",
  "candidate-one-thought": "나를 좋게 보고 있구나",
  "candidate-one-behavior": "저도 좋은 말로 인사할 것 같아요",
  "candidate-one-body": "몸이 편해질 것 같아요",
  "candidate-two-thought": "나쁜 의도가 있을 수도 있겠다",
  "candidate-two-behavior": "딱 자르고 차갑게 대할 것 같아요",
  "candidate-two-body": "긴장될 것 같아요",
  "candidate-three-thought": "왜 나한테 기분 나쁘게 말하지",
  "candidate-three-behavior": "왜 그렇게 말하냐고 화를 낼 것 같아요",
  "candidate-three-body": "안절부절하고 떨릴 것 같아요",
  "situation-same": "같아요",
  "feelings-compared": "달라요",
  "actions-compared": "달라요",
  "what-made-difference": "감정이요",
  "emotion-cause-follow-up": "생각이 달라서요",
  "what-made-feeling": "제가 잘못한 게 없는데 오해한다는 생각이요",
  "what-happened": "다음 날 얘기해 보니 별일 없었어요",
  "outcome-meaning": "걱정한 만큼 나쁘게 되지는 않는다는 거요",
  "participant-summary": "생각이 감정을 만들고, 그 감정 때문에 피하거나 계획을 세우면서 다시 그 생각이 강해지는 것 같아요.",
  "read-a-few": "네",
  "identify-distortion": "만약에 사고랑 자책인 것 같아요",
  "meaning-of-distortion": "그 생각을 좀 덜 믿게 될 것 같아요",
  "homework-commitment": "네 해볼게요",
};
const RATING_SLUGS = new Set(["first-emotion-intensity", "second-emotion-intensity", "third-emotion-intensity", "thought-belief"]);
const FAILED_OUTCOMES = new Set(["clarification", "fallback", "safety_override", "rejected_duplicate"]);

async function currentView(sessionId: string): Promise<RuntimeSessionView> {
  const view = await getRuntimeSession(sessionId);
  if (!view) throw new Error(`Session ${sessionId} not found.`);
  return view;
}

function currentSlug(view: RuntimeSessionView) {
  const id = view.currentPromptItem?.id;
  return id ? s01PromptSlug(id) : null;
}

// These prompts declare validation.kind "boolean" (spec.ts), so the
// participant answers them with the yes/no buttons rather than free text --
// the replay has to send the same shape the UI does.
const BOOLEAN_SLUGS = new Set(["practice-commitment", "link-check", "friend-same-thought", "read-a-few", "homework-commitment"]);

function answerFor(slug: string, overrides: Record<string, string>): PatientInput {
  const text = overrides[slug] ?? REAL_SESSION[slug];
  if (text === undefined) throw new Error(`No scripted answer for ${slug}.`);
  if (RATING_SLUGS.has(slug)) return { kind: "rating", value: text };
  if (BOOLEAN_SLUGS.has(slug)) return { kind: "boolean", value: !/^(아니|no)/i.test(text.trim()) };
  return { kind: "text", value: text };
}

async function startSession(locale = "ko-KR") {
  const session = await createCanonicalTestRuntimeSession({ locale });
  await startRuntimeSession(session.id);
  return session;
}

/** Answers with the real-session script until the active prompt's slug is
 * `target`, or until the session completes when target is null. */
async function driveUntil(sessionId: string, target: string | null, overrides: Record<string, string> = {}, maxTurns = 90) {
  const visited: string[] = [];
  for (let turn = 0; turn < maxTurns; turn += 1) {
    const view = await currentView(sessionId);
    if (view.session.status === "completed") return { view, visited };
    const slug = currentSlug(view);
    if (!slug) throw new Error("Waiting session has no S01 prompt.");
    if (slug === target) return { view, visited };
    visited.push(slug);
    const result = await submitPatientInput(sessionId, answerFor(slug, overrides));
    if (FAILED_OUTCOMES.has(result.turnOutcome ?? "")) throw new Error(`${slug} produced ${result.turnOutcome}.`);
  }
  throw new Error(`Did not reach ${target ?? "completion"} within ${maxTurns} turns.`);
}

function assistantTexts(view: RuntimeSessionView) {
  return view.messages.filter((message) => message.role === "assistant").map((message) => message.content);
}

describe("S01 redesign: real first session replay", () => {
  beforeEach(async () => {
    const db = getLocalDb();
    await db.transaction("rw", db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
  });

  it("walks the approved order end to end and takes the branches the answers call for", async () => {
    const session = await startSession();
    const { view, visited } = await driveUntil(session.id, null);
    expect(view.session.status).toBe("completed");

    const order = ["main-difficulty", "practice-commitment", "recent-moment", "first-emotion", "thought-behind-emotion", "first-behavior", "link-check", "after-behavior-feeling", "candidate-one-emotion", "candidate-two-thought", "what-made-difference", "what-made-feeling", "participant-summary", "identify-distortion", "homework-commitment"];
    const positions = order.map((slug) => visited.indexOf(slug));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));

    // Long situation -> participant writes the line; "감정이요" -> follow-up;
    // "별일 없었어요" -> outcome meaning; "없어요" ends the extra emotions.
    expect(visited).toEqual(expect.arrayContaining(["write-situation-line", "emotion-cause-follow-up", "outcome-meaning", "second-emotion-intensity"]));
    for (const skipped of ["third-emotion-intensity", "situation-examples", "write-thought-line", "suggested-candidates", "behavior-examples", "candidate-two-thought-hint"]) {
      expect(visited).not.toContain(skipped);
    }

    const fields = view.session.runtimeContext.fields;
    expect(fields.s01RepresentativeProblem).toBe("걱정이 많아요");
    expect(fields.situationThoughtDistinction).toContain("의견 차이가 있어서");
    expect(fields.situationLine).toBe("팀원들과 프로젝트 방식에 의견 차이가 있었다");
    expect(fields.personalEmotion).toBe("배신감");
    expect(fields.personalSecondEmotion).toBe("공포감");
    expect(fields.personalThirdEmotion).toBeUndefined();
    expect(fields.candidateTwoEmotion).toBe("의심");
    expect(fields.candidateThreeEmotion).toBe("화");
    expect(typeof fields.threePersonScene).toBe("string");
    expect(fields.threePersonSceneSource).toBe("fixed_fallback");

    const texts = assistantTexts(view);
    for (const text of texts) {
      expect(text).not.toMatch(/신념|가정|핵심\s*믿음|Intrapersonal|Intra-?TR|12번|천천히 생각해 보셔도/);
      expect(text).not.toMatch(/\[[a-z][^\]]*\]/i);
    }
    // The bridge back to the participant's own case uses their own line.
    expect(texts.some((text) => text.includes("팀원들과 프로젝트 방식에 의견 차이가 있었다"))).toBe(true);

    // The two worksheets beside the chat filled as the participant answered:
    // their own words, the gauges, and the scene/given feelings marked as
    // written by the session rather than the participant.
    const worksheet = await getWorksheetView(session.id, "tbct-s01");
    const cell = (key: string) => worksheet?.fields.find((item) => item.definition.worksheetFieldKey === key)?.value;
    expect(cell("situationLine")?.value).toBe("팀원들과 프로젝트 방식에 의견 차이가 있었다");
    expect(cell("personalEmotion")?.value).toBe("배신감");
    expect(Number(cell("personalEmotionIntensity")?.value)).toBeGreaterThan(0);
    expect(Number(cell("s01ThoughtBeliefPercent")?.value)).toBeGreaterThan(0);
    expect(cell("candidateOneThought")?.provenance).toBe("participant_verbatim");
    expect(cell("threePersonScene")?.value).toBe(fields.threePersonScene);
    expect(cell("threePersonScene")?.provenance).toBe("system_calculated");
    expect(cell("candidateTwoEmotion")?.provenance).toBe("system_calculated");
    expect(cell("participantSummary")?.value).toBeTruthy();
  }, 90_000);

  it("stops collecting difficulties on '없어요' and skips the representative question when only one was named", async () => {
    const session = await startSession();
    const { view, visited } = await driveUntil(session.id, "goal-at-end", { "other-difficulty": "없어요" }, 20);
    expect(visited).not.toContain("other-difficulty-more");
    // Asking "which of these is the biggest" about a list of one reads as if
    // the session were not listening (2026-09-13 live session), so the single
    // difficulty is recorded as the representative one and the question is skipped.
    expect(visited).not.toContain("representative-difficulty");
    expect(view.session.runtimeContext.fields.s01Problems).toEqual(["걱정이 많아요"]);
    expect(view.session.runtimeContext.fields.s01RepresentativeProblem).toBe("걱정이 많아요");
  }, 30_000);

  it("treats '아니요 없습니다' as the end of the list instead of storing it as a difficulty", async () => {
    const session = await startSession();
    const { view, visited } = await driveUntil(session.id, "goal-at-end", { "other-difficulty": "아니요 없습니다" }, 20);
    expect(view.session.runtimeContext.fields.s01Problems).toEqual(["걱정이 많아요"]);
    expect(visited).not.toContain("other-difficulty-more");
  }, 30_000);

  it("still asks which difficulty is the biggest when the participant named several", async () => {
    const session = await startSession();
    const { view, visited } = await driveUntil(session.id, "goal-at-end", { "representative-difficulty": "두 번째요" }, 25);
    expect(visited).toContain("representative-difficulty");
    expect(view.session.runtimeContext.fields.s01RepresentativeProblem).toBe("계획을 반드시 세우고 그대로 해야 하는 강박이 있어요");
  }, 30_000);

  it("accepts 'ㅇㅇ' as yes, and asks plainly again for a bare 'ㄴ'", async () => {
    // Without a model the deterministic clarification is what actually ships
    // -- which is the wording this test is about. (With one, the dialogue
    // agent rephrases the same question instead.)
    const previousProvider = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = "mock";
    try {
      const session = await startSession();
      await driveUntil(session.id, "practice-commitment", {}, 25);
      // A bare "ㄴ" is either the first letter of "네" or "노" -- never guessed at.
      const ambiguous = await submitPatientInput(session.id, { kind: "text", value: "ㄴ" });
      expect(ambiguous.turnOutcome).toBe("clarification");
      const afterAmbiguous = await currentView(session.id);
      expect(currentSlug(afterAmbiguous)).toBe("practice-commitment");
      // The point of the boolean validation: a yes/no question must never be
      // re-asked with "give me a short, concrete example" (2026-09-13 live
      // session). The exact re-ask wording is not asserted here because the
      // test suite always answers with a stubbed dialogue agent, which
      // rephrases the question itself; without a model the deterministic
      // "네 또는 아니요로 간단히 답해 주시겠어요?" ships instead.
      expect(assistantTexts(afterAmbiguous).at(-1)).not.toMatch(/구체적인 예/);

      const accepted = await submitPatientInput(session.id, { kind: "text", value: "ㅇㅇ" });
      expect(accepted.turnOutcome).toBe("normal");
      expect(currentSlug(await currentView(session.id))).not.toBe("practice-commitment");
    } finally {
      if (previousProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = previousProvider;
    }
  }, 30_000);

  it("redirects small talk at the situation question without storing it", async () => {
    const session = await startSession();
    await driveUntil(session.id, "recent-moment", {}, 20);
    const result = await submitPatientInput(session.id, { kind: "text", value: "오늘 날씨가 어때?" });
    expect(result.turnOutcome).toBe("clarification");
    const after = await currentView(session.id);
    expect(currentSlug(after)).toBe("recent-moment");
    expect(after.session.runtimeContext.fields.situationThoughtDistinction).toBeUndefined();
  }, 30_000);

  it("offers everyday examples when the participant cannot think of a moment", async () => {
    const session = await startSession();
    await driveUntil(session.id, "recent-moment", {}, 20);
    const result = await submitPatientInput(session.id, { kind: "text", value: "잘 모르겠어요" });
    expect(result.turnOutcome).toBe("normal");
    expect(currentSlug(await currentView(session.id))).toBe("situation-examples");
  }, 30_000);

  it("accepts uncertainty at the thought question instead of stalling", async () => {
    const session = await startSession();
    await driveUntil(session.id, "thought-behind-emotion", {}, 30);
    const result = await submitPatientInput(session.id, { kind: "text", value: "잘 모르겠어요" });
    expect(result.turnOutcome).toBe("normal");
    expect(currentSlug(await currentView(session.id))).toBe("thought-belief");
  }, 30_000);

  it("stays on the thought question when the participant asks why it is being asked", async () => {
    const previousProvider = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = "mock";
    try {
      const session = await startSession();
      await driveUntil(session.id, "thought-behind-emotion", {}, 30);
      const result = await submitPatientInput(session.id, { kind: "text", value: "왜 이걸 물어봐요?" });
      expect(result.generatedMessage?.content).toBeTruthy();
      expect(currentSlug(await currentView(session.id))).toBe("thought-behind-emotion");
    } finally {
      if (previousProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = previousProvider;
    }
  }, 30_000);
});

describe("S01 redesign: cognitive distortions follow the manual", () => {
  beforeEach(async () => {
    const db = getLocalDb();
    await db.transaction("rw", db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
  });

  const namesKo = S01_COGNITIVE_DISTORTIONS.map((distortion) => distortion.nameKo);

  it("asks the participant to choose without naming any distortion, and suggests registry names only when asked", async () => {
    const session = await startSession();
    const { view } = await driveUntil(session.id, "identify-distortion");
    const question = assistantTexts(view).at(-1) ?? "";
    expect(namesKo.some((name) => question.includes(name))).toBe(false);

    const result = await submitPatientInput(session.id, { kind: "text", value: "어떤 게 맞는지 추천해 주세요" });
    expect(result.turnOutcome).toBe("normal");
    const after = await currentView(session.id);
    expect(currentSlug(after)).toBe("suggested-candidates");
    const suggestion = assistantTexts(after).at(-1) ?? "";
    expect(namesKo.some((name) => suggestion.includes(name))).toBe(true);
  }, 90_000);

  it("moves on when none of the distortions seem to fit", async () => {
    const session = await startSession();
    await driveUntil(session.id, "identify-distortion");
    const result = await submitPatientInput(session.id, { kind: "text", value: "없는 것 같아요." });
    expect(result.turnOutcome).toBe("normal");
    expect(currentSlug(await currentView(session.id))).toBe("meaning-of-distortion");
  }, 90_000);
});
