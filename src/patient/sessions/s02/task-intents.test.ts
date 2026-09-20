import { describe, expect, it } from "vitest";
import { CANONICAL_PROMPT_ITEMS } from "@/shared/protocol/source-fidelity-catalog";
import { COGNITIVE_DISTORTIONS } from "@/shared/protocol/cognitive-distortions";
import { taskIntentGaps } from "@/shared/dialogue-agent/dialogue-agent-orchestrator";
import { S02_FIXED_TASK_SLUGS, S02_TASK_INTENT_SLUGS, resolveS02TaskIntent, s02TaskIntentsEnabled } from "@/patient/sessions/s02/task-intents";

const S02_PROMPTS = CANONICAL_PROMPT_ITEMS.filter((item) => item.sessionId === "tbct-s02");

function slugOf(id: string) {
  return /^tbct-s02-n\d+-p\d+-(.+)$/.exec(id)?.[1] ?? "";
}

function intent(id: string, fields: Record<string, unknown> = {}) {
  return resolveS02TaskIntent(id, "ko-KR", { fields });
}

describe("S02 task intents", () => {
  // Two-way, like s01/task-intents.test.ts: a step with neither an intent nor a
  // place on the fixed list would silently fall back to paraphrasing the
  // approved sentence, which is the behaviour this change replaces.
  it("covers every S02 prompt, and names no slug that does not exist", () => {
    const slugs = S02_PROMPTS.map((item) => slugOf(item.id));
    const uncovered = slugs.filter((slug) => !S02_TASK_INTENT_SLUGS.includes(slug) && !S02_FIXED_TASK_SLUGS.has(slug));
    expect(uncovered).toEqual([]);
    const unknown = S02_TASK_INTENT_SLUGS.filter((slug) => !slugs.includes(slug));
    expect(unknown).toEqual([]);
  });

  it("leaves the safety pause grounded on its fixed text", () => {
    const safety = S02_PROMPTS.find((item) => item.id.endsWith("-pause-and-escalate"));
    expect(safety).toBeTruthy();
    expect(intent(safety!.id)).toBeUndefined();
  });

  // Reachability through the dialogue contract is covered in
  // shared/dialogue-agent/task-intent.test.ts, which already has the harness.
  it("can be switched off with S02_TASK_INTENTS=off", () => {
    expect(s02TaskIntentsEnabled({ S02_TASK_INTENTS: "off" })).toBe(false);
    expect(s02TaskIntentsEnabled({ S02_TASK_INTENTS: "OFF" })).toBe(false);
    expect(s02TaskIntentsEnabled({})).toBe(true);
  });

  describe("the research citation", () => {
    const id = S02_PROMPTS.find((item) => item.id.endsWith("-research-evidence"))!.id;

    it("requires the source and the sample size, so neither can be dropped", () => {
      const taskIntent = { ...intent(id)!, asksParticipant: false };
      expect(taskIntentGaps("이런 생각 패턴이 우울과 불안과 함께 높게 나타났습니다.", taskIntent)).toHaveLength(2);
      expect(taskIntentGaps("브라질 바이아 연방대학교에서 대학생 184명을 대상으로 한 연구에서, 이런 패턴이 잦은 분들은 우울·불안 점수도 함께 높았습니다.", taskIntent)).toEqual([]);
    });

    it("rejects the causal claim the recording makes, since the study is correlational", () => {
      const taskIntent = { ...intent(id)!, asksParticipant: false };
      const causal = "바이아 연방대학교의 대학생 184명 연구를 보면, 이 왜곡을 줄이면 우울과 불안도 낮아집니다.";
      expect(taskIntentGaps(causal, taskIntent).length).toBeGreaterThan(0);
    });
  });

  describe("the fifteen-pattern walkthrough", () => {
    const id = "tbct-s02-n05-p01-review-distortion";

    it("names the pattern the loop is on, and moves with the stored rows", () => {
      for (const [index, distortion] of COGNITIVE_DISTORTIONS.entries()) {
        const fields = { distortionExamples: Array.from({ length: index }, (_, position) => `row ${position}`) };
        const resolved = intent(id, fields)!;
        expect(resolved.obtain, distortion.id).toContain(distortion.nameKo);
        expect(resolved.obtain).toContain(`Pattern ${index + 1} of 15`);
      }
    });

    it("requires the pattern's name in the turn, so a vague ask is caught", () => {
      const taskIntent = { ...intent(id, {})!, asksParticipant: true };
      expect(taskIntentGaps("이런 예가 있으신가요?", taskIntent)).toHaveLength(1);
      expect(taskIntentGaps(`${COGNITIVE_DISTORTIONS[0].nameKo}에 해당하는 예가 있으신가요?`, taskIntent)).toEqual([]);
    });
  });

  describe("the closing recap", () => {
    const id = S02_PROMPTS.find((item) => item.id.endsWith("-session-recap"))!.id;

    it("requires the fifteen patterns and forbids a feedback question", () => {
      const taskIntent = { ...intent(id)!, asksParticipant: false };
      expect(taskIntentGaps("오늘은 과제를 살펴봤어요.", taskIntent)).toHaveLength(1);
      expect(taskIntentGaps("오늘은 과제를 살펴보고 15가지 패턴을 하나씩 짚어봤어요.", taskIntent)).toEqual([]);
      // A question at all is caught separately (NO_QUESTION_ON_NON_INPUT_TURN);
      // this is the feedback wording itself.
      expect(taskIntentGaps("오늘은 15가지 패턴을 살펴봤어요. 오늘 어떠셨어요", taskIntent).length).toBeGreaterThan(0);
    });
  });
});
