import { beforeEach, describe, expect, it } from "vitest";
import { createCanonicalTestRuntimeSession, getRuntimeSession } from "@/shared/api/runtime-session-api";
import { startRuntimeSession, submitPatientInput } from "@/shared/api/runtime-execution-api";
import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import { COGNITIVE_DISTORTIONS } from "@/shared/protocol/cognitive-distortions";
import { NO_EXAMPLE_MARKER, s02PromptSlug } from "@/patient/sessions/s02/turn-rules";
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

const BOOLEAN_SLUGS = new Set(["today-agenda", "agenda-continue", "homework-commitment"]);
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

async function startSession(locale = "ko-KR") {
  const session = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale });
  await startRuntimeSession(session.id);
  return session;
}

function answerFor(slug: string, view: RuntimeSessionView, overrides: Record<string, string>): PatientInput {
  if (slug === "review-distortion" && overrides["review-distortion"] === undefined) {
    // One example per pattern, in registry order -- the row count is the index.
    const index = Math.min(storedRows(view).length, OWN_EXAMPLES.length - 1);
    return { kind: "text", value: OWN_EXAMPLES[index] };
  }
  const scripted: Record<string, string> = {
    "homework-update": HOMEWORK_UPDATE,
    "today-agenda": "네",
    "agenda-concern": "생각을 다 꺼내야 하는 게 좀 부담돼요",
    "agenda-continue": "네",
    "why-distorted": "증거 없이 단정한 거라서요",
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
async function driveUntil(sessionId: string, target: string | null, overrides: Record<string, string> = {}, maxTurns = 45) {
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
    const order = ["homework-update", "today-agenda", "review-distortion", "homework-commitment"];
    const positions = order.map((slug) => visited.indexOf(slug));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));

    // Every pattern got a row, and the participant's own words were stored.
    const rows = storedRows(view);
    expect(rows).toHaveLength(COGNITIVE_DISTORTIONS.length);
    expect(rows[0]).toContain("싫어하는");
    expect(rows[13]).toContain("어떡하지");
    // The walkthrough is one turn per pattern, not one turn for all fifteen.
    expect(visited.filter((slug) => slug === "review-distortion")).toHaveLength(COGNITIVE_DISTORTIONS.length);
  }, 120_000);

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
    }
  }, 90_000);

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

  it("fills the participant's own example into the matching worksheet row", async () => {
    const session = await startSession();
    await driveUntil(session.id, "review-distortion");
    await submitPatientInput(session.id, { kind: "text", value: OWN_EXAMPLES[0] });
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
