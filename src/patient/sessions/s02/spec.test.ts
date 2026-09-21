import { beforeEach, describe, expect, it } from "vitest";
import { createCanonicalTestRuntimeSession, getRuntimeSession } from "@/shared/api/runtime-session-api";
import { startRuntimeSession, submitPatientInput } from "@/shared/api/runtime-execution-api";
import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import { CANONICAL_PROMPT_ITEMS } from "@/shared/protocol/source-fidelity-catalog";
import { isSafetyCriticalPrompt } from "@/shared/dialogue-agent/dialogue-agent-orchestrator";
import { COGNITIVE_DISTORTIONS } from "@/shared/protocol/cognitive-distortions";
import { NO_EXAMPLE_MARKER, normalizeExampleForWorksheet, s02PromptSlug } from "@/patient/sessions/s02/turn-rules";
import { getWorksheetView } from "@/shared/worksheet/worksheet-projection";
import type { PatientInput } from "@/types/runtime-session";

type RuntimeSessionView = NonNullable<Awaited<ReturnType<typeof getRuntimeSession>>>;

// S02 redesign (.claude/TASK_SCOPE.json note2026_09_21_s02_cognitive_distortions).
// These tests replay the real second session recorded 2026-09-18: the homework
// review, today's order, then the fifteen patterns one at a time. The fifteen
// examples below are the participant's own, lightly shortened, in the order the
// recording walked them -- which is also the registry's order.
const OWN_EXAMPLES = [
  "인사를 안 했으니 저를 싫어하는 거라고 생각했어요",
  "계획에 실패하면 모든 게 무너질 거라고 생각했어요",
  "토플 점수가 안 떨어진 건 그냥 운이 좋았던 거라고 생각했어요",
  "이상하게 불안하면 곧 큰일이 일어날 거라고 믿었어요",
  "친절하지 않았던 사람을 원래 안 좋은 사람이라고 봤어요",
  "원하던 모습이 됐지만 성공한 건 아니라고 생각했어요",
  "꼼꼼하다는 칭찬도 완벽하지 않으니 그냥 해준 말이라고 봤어요",
  "그만둔 걸 보고 사람들이 끈기 없다고 생각했을 거라고 봤어요",
  "한두 번 말투가 차가웠는데 늘 그렇다고 느꼈어요",
  "안내데스크 직원이 기분 안 좋아 보인 게 제 탓이라고 생각했어요",
  "무슨 일이 있어도 모든 게 완벽해야 한다고 생각해요",
  "못 보고 지나간 지인이 저를 무시한 거라고 결론 내렸어요",
  "실수하면 내가 부족해서 그렇다고 스스로를 탓해요",
  "교수님이 싫어하면 어떡하지 하는 생각이 들어요",
  "아이비리그 간 사람과 비교하면 저는 보잘것없다고 느껴요",
];

// 01:30 of the recording, almost verbatim: the participant reports that telling
// the fifteen categories apart was the hard part.
const HOMEWORK_UPDATE = "틈틈이 적어봤는데, 15개 카테고리 중에 어떤 게 해당되는지 구분이 잘 안 되는 어려움이 있었어요.";

// The fifteen CD-Quest answers as the recording settled them (44:00-49:00), in
// the same order. Their grid total is 34, which is the total the counselor
// states at 49:05; cdquest-grid.test.ts pins that arithmetic on its own.
const REAL_SCORE_ANSWERS = [
  "3에서 5일 정도, 약간의 강도예요",
  "하루 이틀 정도인데 강한 정도예요",
  "3에서 5일 정도 조금이요",
  "3에서 5일 정도 강하게요",
  "3에서 5일 정도 약간이요",
  "2점인 것 같아요",
  "2점인 것 같아요",
  "6에서 7일 정도, 약간의 강도예요",
  "6에서 7일 정도 조금씩이요",
  "1점인 것 같아요",
  "1점인 것 같아요",
  "3에서 5일 정도 조금씩이요",
  "6에서 7일 정도 조금씩이요",
  "6일에서 7일 정도 강하게요",
  "3에서 5일 정도 조금씩이요",
];
const REAL_SCORES = [2, 2, 2, 3, 2, 2, 2, 3, 3, 1, 1, 2, 3, 4, 2];

// What the participant says back once the guide has pointed at part of their own
// example. Deliberately short: the discussion turn must accept it as a whole
// answer and move on.
const DISCUSSION_REPLY = "네, 그런 것 같아요";

const BOOLEAN_SLUGS = new Set(["today-agenda", "agenda-continue", "understanding-check", "homework-commitment"]);
const FAILED_OUTCOMES = new Set(["clarification", "fallback", "safety_override", "rejected_duplicate"]);

async function currentView(sessionId: string): Promise<RuntimeSessionView> {
  const view = await getRuntimeSession(sessionId);
  if (!view) throw new Error(`Session ${sessionId} not found.`);
  return view;
}

function currentSlug(view: RuntimeSessionView) {
  const id = view.currentPromptItem?.id;
  return id ? s02PromptSlug(id) : null;
}

function storedRows(view: RuntimeSessionView): string[] {
  const value = view.session.runtimeContext.fields.distortionExamples;
  return Array.isArray(value) ? (value as string[]) : [];
}

function storedScores(view: RuntimeSessionView): number[] {
  const value = view.session.runtimeContext.fields.cdQuestScores;
  return Array.isArray(value) ? (value as unknown[]).filter((item): item is number => typeof item === "number") : [];
}

async function startSession(locale = "ko-KR") {
  const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale });
  await startRuntimeSession(session.id);
  return session;
}

function answerFor(slug: string, view: RuntimeSessionView, overrides: Record<string, string>): PatientInput {
  if (slug === "review-distortion" && overrides["review-distortion"] === undefined) {
    // Two turns per pattern. On the discussion turn the participant is
    // responding to what the guide said about their example, not giving a new
    // one, so a short acknowledgement is the realistic answer.
    if (view.session.runtimeContext.fields.s02PatternPhase === "discuss") return { kind: "text", value: DISCUSSION_REPLY };
    // One example per pattern, in registry order -- the row count is the index.
    const index = Math.min(storedRows(view).length, OWN_EXAMPLES.length - 1);
    return { kind: "text", value: OWN_EXAMPLES[index] };
  }
  if (slug === "score-distortion" && overrides["score-distortion"] === undefined) {
    // Same pointer, one score per pattern: the score count is the index.
    const index = Math.min(storedScores(view).length, REAL_SCORE_ANSWERS.length - 1);
    return { kind: "text", value: REAL_SCORE_ANSWERS[index] };
  }
  const scripted: Record<string, string> = {
    "homework-update": HOMEWORK_UPDATE,
    "today-agenda": "네",
    "agenda-concern": "생각을 다 꺼내야 하는 게 좀 부담돼요",
    "agenda-continue": "네",
    "understanding-check": "네",
    "how-do-you-feel": "생각보다 자주 하고 있었네요",
    "what-to-adjust": "감정적 추론이랑 과잉 일반화, What if 이 세 가지요",
    "homework-commitment": "네",
    ...overrides,
  };
  const text = scripted[slug];
  if (text === undefined) throw new Error(`No scripted answer for ${slug}.`);
  if (BOOLEAN_SLUGS.has(slug)) return { kind: "boolean", value: !/^(아니|no)/i.test(text.trim()) };
  return { kind: "text", value: text };
}

/** Answers the script until the active prompt's slug is `target`, or until the
 * session leaves the waiting state when target is null. */
async function driveUntil(sessionId: string, target: string | null, overrides: Record<string, string> = {}, maxTurns = 90) {
  const visited: string[] = [];
  for (let turn = 0; turn < maxTurns; turn += 1) {
    const view = await currentView(sessionId);
    if (view.session.status === "completed" || view.session.status === "paused") return { view, visited };
    const slug = currentSlug(view);
    if (!slug) throw new Error("Waiting session has no S02 prompt.");
    if (slug === target) return { view, visited };
    visited.push(slug);
    const result = await submitPatientInput(sessionId, answerFor(slug, view, overrides));
    if (FAILED_OUTCOMES.has(result.turnOutcome ?? "")) throw new Error(`${slug} produced ${result.turnOutcome}.`);
  }
  throw new Error(`Did not reach ${target ?? "the end"} within ${maxTurns} turns.`);
}

function assistantTexts(view: RuntimeSessionView) {
  return view.messages.filter((message) => message.role === "assistant").map((message) => message.content);
}

describe("S02 redesign: real second session replay", () => {
  beforeEach(async () => {
    const db = getLocalDb();
    await db.transaction("rw", db.tables, async () => {
      await Promise.all(db.tables.map((table) => table.clear()));
    });
  });

  it("walks the approved order end to end: homework review, today's order, then the fifteen patterns", async () => {
    const session = await startSession();
    const { view, visited } = await driveUntil(session.id, null);
    expect(view.session.status).toBe("completed");

    // The order the recording used. The homework review comes BEFORE today's
    // order -- the counselor takes the difficulty just reported and turns it
    // into the plan -- which is the opposite of S01, where the agenda is first.
    const order = [
      "homework-update",
      "today-agenda",
      "review-distortion",
      "understanding-check",
      "score-distortion",
      "how-do-you-feel",
      "what-to-adjust",
      "homework-commitment",
    ];
    const positions = order.map((slug) => visited.indexOf(slug));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));

    // Every pattern got a row, and the participant's own words were stored.
    const rows = storedRows(view);
    expect(rows).toHaveLength(COGNITIVE_DISTORTIONS.length);
    expect(rows[0]).toContain("싫어하는");
    expect(rows[13]).toContain("어떡하지");
    // Two turns per pattern -- ask, then talk about the answer -- which is what
    // the recording did and what the first build of this step left out.
    expect(visited.filter((slug) => slug === "review-distortion")).toHaveLength(COGNITIVE_DISTORTIONS.length * 2);
    // And so is the scoring: the grid is explained once, then fifteen turns.
    expect(visited.filter((slug) => slug === "score-distortion")).toHaveLength(COGNITIVE_DISTORTIONS.length);
    // Every pattern is looked at before any of them is scored -- the recording
    // finished the walkthrough at 43:00 and only then brought out the grid.
    expect(visited.lastIndexOf("review-distortion")).toBeLessThan(visited.indexOf("score-distortion"));
  }, 180_000);

  it("says the overlap is normal when the participant reports trouble telling the patterns apart", async () => {
    const session = await startSession();
    const { view } = await driveUntil(session.id, "today-agenda");
    expect(view.session.runtimeContext.fields.s02TypeConfusion).toBe(true);
    // The normalizing step ran before today's order, and asks nothing.
    const texts = assistantTexts(view);
    const normalized = texts.find((text) => text.includes("겹치는") || text.includes("잘못된 게 아니"));
    expect(normalized).toBeTruthy();
  }, 60_000);

  it("names the pattern being asked about, one at a time and in the registry's order", async () => {
    const session = await startSession();
    await driveUntil(session.id, "review-distortion");
    for (const [index, distortion] of COGNITIVE_DISTORTIONS.slice(0, 4).entries()) {
      const view = await currentView(session.id);
      expect(currentSlug(view)).toBe("review-distortion");
      expect(storedRows(view)).toHaveLength(index);
      const asked = assistantTexts(view).at(-1) ?? "";
      expect(asked, `pattern ${index + 1}`).toContain(distortion.nameKo);
      await submitPatientInput(session.id, { kind: "text", value: OWN_EXAMPLES[index] });
      // The discussion turn for this same pattern comes next; answering it is
      // what moves the walkthrough on to the following pattern.
      const discussing = await currentView(session.id);
      expect(discussing.session.runtimeContext.fields.s02PatternPhase, `pattern ${index + 1}`).toBe("discuss");
      expect(assistantTexts(discussing).at(-1) ?? "", `pattern ${index + 1} discussion`).toContain(distortion.nameKo);
      await submitPatientInput(session.id, { kind: "text", value: DISCUSSION_REPLY });
    }
  }, 120_000);

  it("takes 'nothing comes to mind' as a real answer, records an empty row and moves on", async () => {
    const session = await startSession();
    await driveUntil(session.id, "review-distortion");
    await submitPatientInput(session.id, { kind: "text", value: "딱히 없어요" });

    const view = await currentView(session.id);
    const rows = storedRows(view);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toBe(NO_EXAMPLE_MARKER);
    // Moved on to the second pattern rather than re-asking the first.
    expect(currentSlug(view)).toBe("review-distortion");
    expect(assistantTexts(view).at(-1) ?? "").toContain(COGNITIVE_DISTORTIONS[1].nameKo);
  }, 60_000);

  // "I don't see why this is a distortion" is not an example: nothing is stored
  // and the same pattern is asked about again, where the step's guidance tells
  // Claude to ask what feels off rather than explain it. No flag is set for
  // this -- a turn the engine does not accept never commits its fields.
  it("stores nothing and stays on the same pattern when the participant does not see why it is a distortion", async () => {
    const session = await startSession();
    await driveUntil(session.id, "review-distortion");
    await submitPatientInput(session.id, { kind: "text", value: "이게 왜 왜곡인지 잘 모르겠어요" });

    const view = await currentView(session.id);
    expect(storedRows(view)).toHaveLength(0);
    expect(currentSlug(view)).toBe("review-distortion");
    // Still the first pattern, not advanced past it.
    expect(assistantTexts(view).at(-1) ?? "").not.toContain(COGNITIVE_DISTORTIONS[1].nameKo);
  }, 60_000);

  it("hears a no to today's order, and pauses the session on a second no", async () => {
    const session = await startSession();
    const { view: declined } = await driveUntil(session.id, "agenda-concern", { "today-agenda": "아니요" });
    expect(declined.session.runtimeContext.fields.s02AgendaDeclined).toBe(true);

    await submitPatientInput(session.id, { kind: "text", value: "생각을 다 꺼내야 하는 게 좀 부담돼요" });
    await submitPatientInput(session.id, { kind: "boolean", value: false });

    const paused = await currentView(session.id);
    expect(paused.session.status).toBe("paused");
    expect(paused.session.runtimeContext.fields.s02SessionDeclined).toBe(true);
    // Nothing of the walkthrough was started.
    expect(storedRows(paused)).toHaveLength(0);
  }, 60_000);

  // Same contract S01's closing recap has (note2026_09_21_s01_closing_recap):
  // what was DONE, none of the participant's answers, no question, no feedback.
  it("recaps the session before the homework and reads none of the participant's answers back", async () => {
    const session = await startSession();
    const { view } = await driveUntil(session.id, null);
    expect(view.session.status).toBe("completed");

    const assistant = view.messages.filter((message) => message.role === "assistant");
    const recapIndex = assistant.findIndex((message) => message.promptItemId?.endsWith("-session-recap"));
    const homeworkIndex = assistant.findIndex((message) => message.promptItemId?.endsWith("-homework-assignment"));
    const goodbyeIndex = assistant.findIndex((message) => message.promptItemId?.endsWith("-goodbye"));
    expect(recapIndex).toBeGreaterThanOrEqual(0);
    // The recording's order: recap, then the practice, then the goodbye.
    expect(homeworkIndex).toBeGreaterThan(recapIndex);
    expect(goodbyeIndex).toBeGreaterThan(homeworkIndex);

    const recap = assistant[recapIndex].content;
    expect(recap).toMatch(/(15|십오)\s*가지/);
    for (const own of ["싫어하는", "토플", "아이비리그"]) expect(recap, own).not.toContain(own);
    expect(recap).not.toMatch(/[?？]/);
    expect(recap).not.toMatch(/피드백|어떠셨|어떠세요|feedback/i);
    // The guards that would silently swap the message for the generic line.
    expect(recap.length).toBeLessThanOrEqual(600);
    expect(recap).not.toMatch(/\[[a-z][^\]]*\]/i);

    // An assistant recap is never written to a field or projected.
    expect(Object.keys(view.session.runtimeContext.fields)).not.toContain("s02SessionRecap");
  }, 120_000);

  // ------------------------------------------------------- the discussion turn
  //
  // Two thirds of the real session was talking about the examples, not
  // collecting them (note2026_09_21_s02_walkthrough_discussion). The first build
  // of this step stored the answer and moved straight on, which made the
  // walkthrough read as a form being filled in.

  it("spends a second turn on each pattern, talking about the example just given", async () => {
    const session = await startSession();
    await driveUntil(session.id, "review-distortion");
    await submitPatientInput(session.id, { kind: "text", value: OWN_EXAMPLES[0] });

    const view = await currentView(session.id);
    // The example is already stored, and the pointer has NOT moved on.
    expect(storedRows(view)).toEqual([normalizeExampleForWorksheet(OWN_EXAMPLES[0])]);
    expect(view.session.runtimeContext.fields.s02PatternPhase).toBe("discuss");
    expect(currentSlug(view)).toBe("review-distortion");
    // Still the first pattern: the second one has not been introduced.
    const said = assistantTexts(view).at(-1) ?? "";
    expect(said).toContain(COGNITIVE_DISTORTIONS[0].nameKo);
    expect(said).not.toContain(COGNITIVE_DISTORTIONS[1].nameKo);

    // Answering the discussion is what moves it on.
    await submitPatientInput(session.id, { kind: "text", value: DISCUSSION_REPLY });
    const next = await currentView(session.id);
    expect(next.session.runtimeContext.fields.s02PatternPhase).toBe("ask");
    expect(assistantTexts(next).at(-1) ?? "").toContain(COGNITIVE_DISTORTIONS[1].nameKo);
  }, 90_000);

  it("takes a bare 'yes' as a whole answer on the discussion turn", async () => {
    const session = await startSession();
    await driveUntil(session.id, "review-distortion");
    await submitPatientInput(session.id, { kind: "text", value: OWN_EXAMPLES[0] });
    const result = await submitPatientInput(session.id, { kind: "text", value: "네" });
    expect(FAILED_OUTCOMES.has(result.turnOutcome ?? "")).toBe(false);
    expect(storedRows(await currentView(session.id))).toHaveLength(1);
  }, 90_000);

  // The participant swapping her own example for a better one is a real move:
  // at lines 150-159 of the transcript she volunteers a different example than
  // the one she had written down. The replacement text below is her own fuller
  // wording for this pattern, from lines 94-97 ("나를 못 봐서 인사를 안 했지만,
  // 인사를 안 했기 때문에 나를 싫어할 거야"); only the "그것보다는" cue is added,
  // to put it on the discussion turn rather than the first answer.
  // The pattern never changes; only which of her examples fills the row.
  it("replaces the row when the participant offers a better example for the same pattern", async () => {
    const session = await startSession();
    await driveUntil(session.id, "review-distortion");
    await submitPatientInput(session.id, { kind: "text", value: OWN_EXAMPLES[0] });
    await submitPatientInput(session.id, {
      kind: "text",
      value: "그것보다는, 저를 못 봐서 인사를 안 했을 수도 있는데 인사를 안 했기 때문에 저를 싫어할 거라고 생각한 게 더 맞아요",
    });

    const view = await currentView(session.id);
    const rows = storedRows(view);
    // Still one row -- the first pattern's -- and it now holds the later example.
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("못 봐서 인사를 안 했을 수도");
    // A replacement is new content, so the pattern stays open one more turn to
    // talk about the example that replaced it -- which is what the recording did
    // at line 325 ("좋은 예예요, 그 예를 좀 써봅시다").
    expect(view.session.runtimeContext.fields.s02PatternPhase).toBe("discuss");
    expect(assistantTexts(view).at(-1) ?? "").not.toContain(COGNITIVE_DISTORTIONS[1].nameKo);

    // Agreeing then moves it on.
    await submitPatientInput(session.id, { kind: "text", value: DISCUSSION_REPLY });
    const next = await currentView(session.id);
    expect(storedRows(next)).toHaveLength(1);
    expect(assistantTexts(next).at(-1) ?? "").toContain(COGNITIVE_DISTORTIONS[1].nameKo);
  }, 90_000);

  // 578-596 of the transcript: the counselor stayed on overgeneralization while
  // the participant kept adding, and stopped when she simply agreed. How long it
  // runs is the program's decision, not the guide's -- step order belongs to the
  // program here -- with a hard ceiling so no pattern can hold the session open.
  it("stays on a pattern while the participant keeps adding, up to a ceiling", async () => {
    const session = await startSession();
    await driveUntil(session.id, "review-distortion");
    await submitPatientInput(session.id, { kind: "text", value: OWN_EXAMPLES[0] });

    // Two substantive replies in a row: still the same pattern both times.
    for (const reply of ["그때는 사실 확인을 해본 게 아니었어요", "생각해보면 인사를 못 본 걸 수도 있어요"]) {
      await submitPatientInput(session.id, { kind: "text", value: reply });
      const view = await currentView(session.id);
      expect(assistantTexts(view).at(-1) ?? "", reply).not.toContain(COGNITIVE_DISTORTIONS[1].nameKo);
    }
    // The third exhausts the ceiling, so it moves on even though they added more.
    await submitPatientInput(session.id, { kind: "text", value: "다른 사람들한테도 비슷하게 생각한 적이 있어요" });
    const after = await currentView(session.id);
    expect(after.session.runtimeContext.fields.s02PatternPhase).toBe("ask");
    expect(storedRows(after)).toHaveLength(1);
    expect(assistantTexts(after).at(-1) ?? "").toContain(COGNITIVE_DISTORTIONS[1].nameKo);
  }, 90_000);

  it("lets go of a reading the participant does not agree with, instead of pressing it", async () => {
    const session = await startSession();
    await driveUntil(session.id, "review-distortion");
    await submitPatientInput(session.id, { kind: "text", value: OWN_EXAMPLES[0] });
    // A disagreement is not an acknowledgement, but it must still end the
    // discussion -- otherwise the guide gets another turn to argue.
    await submitPatientInput(session.id, { kind: "text", value: "그건 아닌 것 같은데요" });

    const view = await currentView(session.id);
    expect(view.session.runtimeContext.fields.s02PatternPhase).toBe("ask");
    // The example they gave is kept; disagreeing with a reading is not
    // withdrawing the example.
    expect(storedRows(view)).toEqual([normalizeExampleForWorksheet(OWN_EXAMPLES[0])]);
    expect(assistantTexts(view).at(-1) ?? "").toContain(COGNITIVE_DISTORTIONS[1].nameKo);
  }, 90_000);

  // The explanation that opens each pattern invites a "네 알겠습니다", which
  // answers the explanation and not the question. While distortionExamples was
  // the prompt's own output field the shared list path caught this; the two-turn
  // rhythm moved the field out of outputFields, so s02/turn-rules.ts catches it.
  it("does not record an acknowledgement of the explanation as the participant's example", async () => {
    const session = await startSession();
    await driveUntil(session.id, "review-distortion");
    await submitPatientInput(session.id, { kind: "text", value: "네 알겠습니다." });

    const view = await currentView(session.id);
    expect(storedRows(view)).toHaveLength(0);
    expect(view.session.runtimeContext.fields.s02PatternPhase).not.toBe("discuss");
    // Still the first pattern.
    expect(assistantTexts(view).at(-1) ?? "").not.toContain(COGNITIVE_DISTORTIONS[1].nameKo);
  }, 90_000);

  // Reported from a live session: the cell held the whole sentence, reporting
  // frame and all. The cell takes the thought; the chat keeps what they typed.
  it("files the thought in the worksheet cell and keeps their sentence in the chat", async () => {
    const session = await startSession();
    await driveUntil(session.id, "review-distortion");
    const said = "저 사람이 나한테 인사를 안했으니까, 나를 싫어할꺼야 라고 생각했습니다";
    await submitPatientInput(session.id, { kind: "text", value: said });

    const view = await currentView(session.id);
    expect(storedRows(view)).toEqual(["저 사람이 나한테 인사를 안했으니까, 나를 싫어할꺼야"]);
    // Their own message is untouched -- the cleanup is for the cell only.
    const theirs = view.messages.filter((message) => message.role === "patient").map((message) => message.content);
    expect(theirs).toContain(said);
  }, 90_000);

  it("skips the discussion when there was no example to talk about", async () => {
    const session = await startSession();
    await driveUntil(session.id, "review-distortion");
    await submitPatientInput(session.id, { kind: "text", value: "딱히 없어요" });

    const view = await currentView(session.id);
    expect(view.session.runtimeContext.fields.s02PatternPhase).toBe("ask");
    expect(storedRows(view)).toEqual([NO_EXAMPLE_MARKER]);
    // Straight on to the second pattern: one turn, not two.
    expect(assistantTexts(view).at(-1) ?? "").toContain(COGNITIVE_DISTORTIONS[1].nameKo);
  }, 90_000);

  // The repeat budget counts accepted patient turns, not patterns
  // (runtime-state-reducer.ts). At the old value of fifteen the loop
  // force-completed around the eighth pattern and the walkthrough was silently
  // cut short, with no error anywhere.
  it("gets through all fifteen patterns without the repeat budget cutting it short", async () => {
    const session = await startSession();
    const { view } = await driveUntil(session.id, "cdquest-explain");
    expect(storedRows(view)).toHaveLength(COGNITIVE_DISTORTIONS.length);
    expect(view.session.runtimeContext.fields.allDistortionsReviewed).toBe(true);
    // The fifteenth pattern was talked about too, not just recorded.
    expect(view.session.runtimeContext.fields.s02PatternPhase).toBe("ask");
  }, 180_000);

  // ------------------------------------------------------------- CD-Quest
  //
  // 43:00-52:00 of the recording: the grid is explained, the fifteen patterns
  // are scored one at a time, the total is spoken, and the participant says
  // which patterns to work on. The grid arithmetic itself is pinned separately
  // in cdquest-grid.test.ts; these tests are about the flow around it.

  it("scores the fifteen patterns one at a time and reaches the recording's own total", async () => {
    const session = await startSession();
    await driveUntil(session.id, "score-distortion");

    for (const [index, answer] of REAL_SCORE_ANSWERS.entries()) {
      const view = await currentView(session.id);
      expect(currentSlug(view), `pattern ${index + 1}`).toBe("score-distortion");
      expect(storedScores(view)).toHaveLength(index);
      // The turn names the pattern it is asking about, in the registry's order.
      expect(assistantTexts(view).at(-1) ?? "", `pattern ${index + 1}`).toContain(COGNITIVE_DISTORTIONS[index].nameKo);
      await submitPatientInput(session.id, { kind: "text", value: answer });
    }

    const view = await currentView(session.id);
    const fields = view.session.runtimeContext.fields;
    expect(storedScores(view)).toEqual(REAL_SCORES);
    expect(fields.allDistortionsScored).toBe(true);
    // 49:05 of the recording.
    expect(fields.cdQuestTotal).toBe(34);
    // Only What if came out at 4 or above.
    expect(fields.cdQuestHighCount).toBe(1);

    // The score's two halves are kept alongside it, and stay null for the items
    // the participant answered with a score outright ("2점인 것 같아요").
    const frequency = fields.cdQuestFrequency as Array<number | null>;
    expect(frequency).toHaveLength(COGNITIVE_DISTORTIONS.length);
    expect(frequency[0]).toBe(2);
    expect(frequency[5]).toBeNull();
    expect((fields.cdQuestIntensity as Array<number | null>)[5]).toBeNull();

    // The total is spoken, not asked: the step moves straight on to the
    // reflection question without waiting on the total itself.
    expect(currentSlug(view)).toBe("how-do-you-feel");
    const spoken = assistantTexts(view).find((text) => text.includes("34"));
    expect(spoken).toBeTruthy();
    // 49:20: "there is no cut-off" is the counselor's own framing.
    expect(spoken).toMatch(/기준점|컷오프|잘라|합격|좋은 점수도|나쁜 점수도/);
    expect(spoken?.length ?? 0).toBeLessThanOrEqual(600);
  }, 180_000);

  it("asks the same pattern again when only one half of the answer arrived, and stores nothing", async () => {
    const session = await startSession();
    await driveUntil(session.id, "score-distortion");
    // A frequency with no intensity: not a score yet.
    await submitPatientInput(session.id, { kind: "text", value: "3에서 5일 정도요" });

    const view = await currentView(session.id);
    expect(storedScores(view)).toHaveLength(0);
    expect(currentSlug(view)).toBe("score-distortion");
    // Still the first pattern, not advanced past it.
    expect(assistantTexts(view).at(-1) ?? "").not.toContain(COGNITIVE_DISTORTIONS[1].nameKo);

    // The missing half completes it, and only then does the pointer move.
    await submitPatientInput(session.id, { kind: "text", value: "3에서 5일 정도, 약간이요" });
    const after = await currentView(session.id);
    expect(storedScores(after)).toEqual([2]);
    expect(assistantTexts(after).at(-1) ?? "").toContain(COGNITIVE_DISTORTIONS[1].nameKo);
  }, 120_000);

  it("takes a pattern that did not come up as a zero without asking for an intensity", async () => {
    const session = await startSession();
    await driveUntil(session.id, "score-distortion");
    await submitPatientInput(session.id, { kind: "text", value: "이건 이번 주에 없었어요" });

    const view = await currentView(session.id);
    expect(storedScores(view)).toEqual([0]);
    expect(assistantTexts(view).at(-1) ?? "").toContain(COGNITIVE_DISTORTIONS[1].nameKo);
  }, 120_000);

  // 50:10: the participant had taken the anxiety as something she was simply
  // born with, and the counselor separated what is inborn from what was learned.
  it("separates inborn from learned only when the participant reads the pattern as innate", async () => {
    const session = await startSession();
    await driveUntil(session.id, "how-do-you-feel");
    await submitPatientInput(session.id, { kind: "text", value: "저는 그냥 원래 불안한 사람인 것 같아요" });

    const view = await currentView(session.id);
    expect(view.session.runtimeContext.fields.s02InnateAttribution).toBe(true);
    const fired = view.messages.some((message) => message.promptItemId?.endsWith("-innate-vs-learned"));
    expect(fired).toBe(true);
  }, 120_000);

  it("leaves the inborn explanation out when nothing in the answer calls for it", async () => {
    const session = await startSession();
    await driveUntil(session.id, "what-to-adjust");
    const view = await currentView(session.id);
    expect(view.session.runtimeContext.fields.s02InnateAttribution).toBeUndefined();
    expect(view.messages.some((message) => message.promptItemId?.endsWith("-innate-vs-learned"))).toBe(false);
  }, 120_000);

  it("keeps the participant's own choice of what to work on, without picking for them", async () => {
    const session = await startSession();
    const { view } = await driveUntil(session.id, null);
    const chosen = view.session.runtimeContext.fields.cdQuestPriorityTypes;
    expect(Array.isArray(chosen) ? chosen.join(" ") : String(chosen)).toContain("감정적 추론");

    // The step that asks never names the patterns for them.
    const asked = view.messages.find((message) => message.promptItemId?.endsWith("-what-to-adjust"));
    expect(asked).toBeTruthy();
    for (const name of ["감정적 추론", "과잉 일반화", "What if"]) expect(asked?.content, name).not.toContain(name);
  }, 180_000);

  it("projects the total onto the worksheet as a calculated value, beside the fifteen scores", async () => {
    const session = await startSession();
    await driveUntil(session.id, "how-do-you-feel");

    const worksheet = await getWorksheetView(session.id, "tbct-s02");
    const scores = worksheet?.fields.find((item) => item.binding.canonicalFieldKey === "cdQuestScores");
    const total = worksheet?.fields.find((item) => item.binding.canonicalFieldKey === "cdQuestTotal");
    expect((scores?.value?.value ?? []) as unknown[]).toHaveLength(COGNITIVE_DISTORTIONS.length);
    expect(String(total?.value?.displayValue ?? "")).toContain("34");
    // The scores are the participant's; the total is the program's arithmetic.
    expect(scores?.binding.participantOwned).toBe(true);
    expect(scores?.binding.assistantMustNotSupply).toBe(true);
    expect(total?.binding.participantOwned).toBe(false);
    expect(total?.value?.provenance).toBe("system_calculated");
    expect(scores?.value?.provenance).toBe("participant_verbatim");
  }, 180_000);

  it("fills the participant's own example into the matching worksheet row", async () => {
    const session = await startSession();
    await driveUntil(session.id, "review-distortion");
    await submitPatientInput(session.id, { kind: "text", value: OWN_EXAMPLES[0] });
    // The discussion turn for the first pattern, then the second pattern.
    await submitPatientInput(session.id, { kind: "text", value: DISCUSSION_REPLY });
    await submitPatientInput(session.id, { kind: "text", value: "딱히 없어요" });

    const worksheet = await getWorksheetView(session.id, "tbct-s02");
    const field = worksheet?.fields.find((item) => item.binding.canonicalFieldKey === "distortionExamples");
    expect(field).toBeTruthy();
    const rows = (field?.value?.value ?? []) as string[];
    expect(rows[0]).toContain("싫어하는");
    expect(rows[1]).toBe(NO_EXAMPLE_MARKER);
    // The guide never supplies an example on the participant's behalf.
    expect(field?.binding.participantOwned).toBe(true);
    expect(field?.binding.assistantMustNotSupply).toBe(true);
  }, 60_000);
});

// The defect this guards against produced no error anywhere and a green audit:
// a PromptItem inherits its node's safetyRuleIds, isSafetyCriticalPrompt treats
// any prompt carrying one as a turn Claude must never see, and the resulting
// deterministic turns are deliberately NOT counted as fallbacks. S02 had them on
// every node, so all 24 prompts were excluded and the whole session ran on its
// approved text -- which is what "it reads like a questionnaire" turned out to
// be (note2026_09_21_s02_safety_ids_disabled_claude).
describe("S02 and the dialogue agent", () => {
  const S02_PROMPTS = CANONICAL_PROMPT_ITEMS.filter((item) => item.sessionId === "tbct-s02");

  it("keeps Claude out of the crisis instruction and nowhere else", () => {
    const excluded = S02_PROMPTS.filter((item) => isSafetyCriticalPrompt(item)).map((item) => item.id);
    expect(excluded).toEqual(["tbct-s02-n11-p01-pause-and-escalate"]);
  });

  it("lets Claude phrase the steps the session is actually made of", () => {
    for (const slug of ["review-distortion", "score-distortion", "homework-update", "total", "what-to-adjust", "session-recap"]) {
      const prompt = S02_PROMPTS.find((item) => item.id.endsWith(`-${slug}`));
      expect(prompt, slug).toBeTruthy();
      expect(isSafetyCriticalPrompt(prompt!), slug).toBe(false);
    }
  });

  // Removing the ids has to leave the crisis path exactly as it was. It does,
  // because that path never went through them: a risk disclosure is caught
  // before the step's own handling and overrides the turn at session level
  // (deliverSafetyOverrideTurn), which is why it fires mid-walkthrough here.
  it("still stops the session on a risk disclosure, mid-walkthrough", async () => {
    const session = await startSession();
    await driveUntil(session.id, "review-distortion");
    const result = await submitPatientInput(session.id, { kind: "text", value: "사실 요즘 죽고 싶다는 생각이 들어요" });

    expect(result.turnOutcome).toBe("safety_override");
    const view = await currentView(session.id);
    expect(view.session.status).toBe("escalated");
    // The walkthrough did not quietly take the disclosure as an example.
    expect(storedRows(view)).toHaveLength(0);
  }, 90_000);
});

describe("S02 registry order", () => {
  // The fifteen-pattern order is load-bearing: it is the order the real session
  // walked, the order of the CD-Quest items stage 2 will score, and the order
  // the worksheet rows are rendered in. Rearranging the registry would silently
  // change all three.
  it("matches the order of the real second session", () => {
    expect(COGNITIVE_DISTORTIONS.map((item) => item.id)).toEqual([
      "dichotomous-thinking",
      "fortune-telling-catastrophizing",
      "discounting-positive",
      "emotional-reasoning",
      "labeling",
      "magnification-minimization",
      "selective-abstraction",
      "mind-reading",
      "overgeneralization",
      "personalizing",
      "should-statements",
      "jumping-to-conclusions",
      "blaming",
      "what-if",
      "unfair-comparisons",
    ]);
  });
});
