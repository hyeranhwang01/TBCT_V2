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

  // The second turn on each pattern (note2026_09_21_s02_walkthrough_discussion).
  // What it is allowed to claim is the whole point: it confirms the ONE pattern
  // the loop named, and may say others show through too, but never re-files the
  // example and never issues a verdict.
  describe("talking about the example just given", () => {
    const id = "tbct-s02-n05-p01-review-distortion";

    function discussing(count: number, rows?: string[]) {
      return intent(id, {
        s02PatternPhase: "discuss",
        distortionExamples: rows ?? Array.from({ length: count }, (_, index) => `예시 ${index + 1}`),
      })!;
    }

    it("is about the pattern just answered, not the next one", () => {
      const resolved = discussing(1);
      expect(resolved.obtain).toContain(COGNITIVE_DISTORTIONS[0].nameKo);
      expect(resolved.obtain).not.toContain(COGNITIVE_DISTORTIONS[1].nameKo);
      // Their own example is put in front of the guide, so it has something to
      // point at rather than inventing one.
      expect(resolved.obtain).toContain("예시 1");
    });

    it("points at the fifteenth pattern on the fifteenth, where the ask pointer has already clamped", () => {
      const resolved = discussing(COGNITIVE_DISTORTIONS.length);
      expect(resolved.obtain).toContain(COGNITIVE_DISTORTIONS[14].nameKo);
      expect(resolved.obtain).toContain("예시 15");
    });

    it("gives the guide a way out when the pattern does not show in what they said", () => {
      expect(discussing(1).obtain).toMatch(/does not really show|say that instead/i);
    });

    it("requires the pattern's name and rejects a turn that only talks about the example", () => {
      const taskIntent = { ...discussing(1), asksParticipant: true };
      expect(taskIntentGaps("방금 말씀하신 부분이 좀 극단적으로 들리네요.", taskIntent)).toHaveLength(1);
      expect(taskIntentGaps(`방금 말씀하신 '싫어할 거야' 부분이 ${COGNITIVE_DISTORTIONS[0].nameKo}에 해당한다고 볼 수 있겠죠?`, taskIntent)).toEqual([]);
    });

    // An evaluation of an LLM cognitive-restructuring chatbot found users read
    // "a classic example" as being judged.
    it("rejects calling it a classic example", () => {
      const taskIntent = { ...discussing(1), asksParticipant: true };
      const judged = `이건 ${COGNITIVE_DISTORTIONS[0].nameKo}의 전형적인 예예요.`;
      expect(taskIntentGaps(judged, taskIntent).length).toBeGreaterThan(0);
    });

    it("rejects re-filing the example under a different pattern, but allows saying others show through", () => {
      const taskIntent = { ...discussing(1), asksParticipant: true };
      const refiled = `이건 ${COGNITIVE_DISTORTIONS[0].nameKo} 유형이 아니라 다른 쪽에 가까워요.`;
      expect(taskIntentGaps(refiled, taskIntent).length).toBeGreaterThan(0);
      // What the recording's counselor actually said, and what must stay allowed.
      const plural = `${COGNITIVE_DISTORTIONS[0].nameKo}가 보이고, 다른 유형도 조금 비치네요. 어떤 유형에 속할지는 나중에 같이 보기로 해요.`;
      expect(taskIntentGaps(plural, taskIntent)).toEqual([]);
      // And the way out itself: saying this pattern does not show is not a verdict.
      const doesNotFit = `말씀해 주신 내용에서는 ${COGNITIVE_DISTORTIONS[0].nameKo}가 잘 안 보이네요. 다음으로 가볼게요.`;
      expect(taskIntentGaps(doesNotFit, taskIntent)).toEqual([]);
    });
  });

  describe("the CD-Quest grid explanation", () => {
    const id = S02_PROMPTS.find((item) => item.id.endsWith("-cdquest-explain"))!.id;

    // The bands are the one place in the session where the numbers have to be
    // exact: a turn that explains the grid without them leaves the participant
    // guessing what they are scoring against.
    it("requires both sets of bands, so a band cannot go missing", () => {
      const taskIntent = { ...intent(id)!, asksParticipant: false };
      expect(taskIntentGaps("유형마다 얼마나 자주 그랬고 얼마나 강하게 믿었는지를 점수로 매겨볼게요.", taskIntent)).toHaveLength(2);
      // Frequency bands present, intensity percentages missing.
      expect(taskIntentGaps("1~2일, 3~5일, 6~7일 중에 고르시면 돼요.", taskIntent)).toHaveLength(1);
      const full =
        "유형마다 두 가지를 적어요. 지난 한 주에 1~2일이었는지, 3~5일이었는지, 6~7일이었는지. 그리고 그 순간 얼마나 믿었는지 -- 약간(30%까지), 꽤(31~70%), 아주 강하게(70% 넘게)요.";
      expect(taskIntentGaps(full, taskIntent)).toEqual([]);
    });
  });

  describe("scoring a pattern", () => {
    const id = "tbct-s02-n07-p01-score-distortion";

    it("names the pattern the scoring loop is on, and moves with the stored scores", () => {
      for (const [index, distortion] of COGNITIVE_DISTORTIONS.entries()) {
        const fields = { cdQuestScores: Array.from({ length: index }, () => 2) };
        const resolved = intent(id, fields)!;
        expect(resolved.obtain, distortion.id).toContain(distortion.nameKo);
        expect(resolved.obtain).toContain(`pattern ${index + 1} of 15`);
      }
    });

    it("does not run off the end once all fifteen are scored", () => {
      const fields = { cdQuestScores: Array.from({ length: COGNITIVE_DISTORTIONS.length }, () => 2) };
      expect(intent(id, fields)!.obtain).toContain(COGNITIVE_DISTORTIONS.at(-1)!.nameKo);
    });

    it("requires this pattern's name, so a bare 'how often was it' is caught", () => {
      const taskIntent = { ...intent(id, {})!, asksParticipant: true };
      expect(taskIntentGaps("이건 이번 주에 며칠 있었고 얼마나 강했나요?", taskIntent)).toHaveLength(1);
      expect(taskIntentGaps(`${COGNITIVE_DISTORTIONS[0].nameKo}은 이번 주에 며칠 정도였고, 그 순간 얼마나 믿었나요?`, taskIntent)).toEqual([]);
    });
  });

  describe("the total", () => {
    const id = S02_PROMPTS.find((item) => item.id.endsWith("-total"))!.id;

    // 49:20 of the recording: the counselor says there is no cut-off. Without
    // it a total reads like a test result.
    it("requires the no-cut-off framing", () => {
      const taskIntent = { ...intent(id)!, asksParticipant: false };
      expect(taskIntentGaps("다 더하면 34점이에요.", taskIntent)).toHaveLength(1);
      expect(taskIntentGaps("다 더하면 34점인데, 여기에는 정해진 기준점이 없어요. 지난 한 주의 모습일 뿐이에요.", taskIntent)).toEqual([]);
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
