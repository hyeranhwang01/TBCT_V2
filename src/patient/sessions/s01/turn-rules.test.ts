import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PromptItem } from "@/shared/protocol/source-fidelity-types";
import type { StateExtractionResult } from "@/types/runtime-session";
import { FIXED_S01_SCENE } from "@/patient/sessions/s01/generation";
import { applyS01TurnRules, fearedOutcomeDidNotHappen, isBareYesNo, isLongAnswer, isStopAnswer, isUncertainAnswer, namesEmotionNotThought, parseOrdinal, s01PromptSlug } from "@/patient/sessions/s01/turn-rules";

function prompt(slug: string, outputField: string, sessionId = "tbct-s01"): PromptItem {
  return { id: `${sessionId}-n05-p01-${slug}`, sessionId, nodeId: `${sessionId}-n05-node`, order: 1, type: "question", outputFields: [outputField], validation: null, activationCondition: null, completionEffect: null } as unknown as PromptItem;
}

function extraction(fields: Record<string, unknown>, missingFields: string[] = [], riskSignals: string[] = []): StateExtractionResult {
  return { fields, missingFields, riskLevel: riskSignals.length ? "high" : "low", riskSignals };
}

function run(slug: string, field: string, rawText: string, fields: Record<string, unknown> = {}, missing: string[] = [], options: { riskSignals?: string[]; sessionId?: string; locale?: string } = {}) {
  return applyS01TurnRules({ extracted: extraction(fields, missing, options.riskSignals), promptItem: prompt(slug, field, options.sessionId), rawText, locale: options.locale ?? "ko-KR", sessionId: "SESSION", turnId: "TURN" });
}

describe("s01PromptSlug", () => {
  it("reads the slug from a positional S01 prompt id and ignores other sessions", () => {
    expect(s01PromptSlug("tbct-s01-n12-p03-candidate-two-thought")).toBe("candidate-two-thought");
    expect(s01PromptSlug("tbct-s02-n03-p01-problem-framing")).toBeNull();
  });
});

describe("answer classifiers", () => {
  it("recognizes bare yes/no, stop and not-sure answers only as whole answers", () => {
    expect(isBareYesNo("네.")).toBe(true);
    expect(isBareYesNo("달라요")).toBe(true);
    expect(isBareYesNo("네 그런데 좀 헷갈려요")).toBe(false);
    expect(isStopAnswer("없어요")).toBe(true);
    expect(isStopAnswer("더 이상 없는 것 같아요")).toBe(true);
    expect(isStopAnswer("의욕이 없어요")).toBe(false);
    expect(isUncertainAnswer("잘 모르겠어요")).toBe(true);
    expect(isUncertainAnswer("모르겠는데 아마 무시당한 느낌?")).toBe(false);
  });

  it("flags long situation/thought answers for a one-line rewrite", () => {
    expect(isLongAnswer("팀원들 간에 뭔가 이슈가 있었어 가지고 그런 것 때문에 뭔가 불안했던 적이 있던 것 같습니다", "ko-KR")).toBe(true);
    expect(isLongAnswer("팀원들과 의견 차이가 있었다", "ko-KR")).toBe(false);
    expect(isLongAnswer("We disagreed about the project.", "en-US")).toBe(false);
  });

  it("detects a conclusion that names the emotion instead of the thought", () => {
    expect(namesEmotionNotThought("감정이 달라서요")).toBe(true);
    expect(namesEmotionNotThought("생각이 달라서")).toBe(false);
    expect(namesEmotionNotThought("기분이랑 생각이 달라서요")).toBe(false);
    expect(namesEmotionNotThought("Their feelings were different")).toBe(true);
    expect(namesEmotionNotThought("They thought differently")).toBe(false);
  });

  it("only treats a clear 'it turned out fine' as the feared outcome not happening", () => {
    expect(fearedOutcomeDidNotHappen("다음 날 얘기해 보니 별일 없었어요")).toBe(true);
    expect(fearedOutcomeDidNotHappen("오해가 풀렸어요")).toBe(true);
    expect(fearedOutcomeDidNotHappen("결국 싸웠어요")).toBe(false);
    expect(fearedOutcomeDidNotHappen("안 괜찮았어요")).toBe(false);
    expect(fearedOutcomeDidNotHappen("그냥 그랬어요")).toBe(false);
    expect(fearedOutcomeDidNotHappen("It turned out fine")).toBe(true);
  });

  it("parses ordinal picks", () => {
    expect(parseOrdinal("두 번째요")).toBe(1);
    expect(parseOrdinal("1번이요")).toBe(0);
    expect(parseOrdinal("the third one")).toBe(2);
    expect(parseOrdinal("불안이요")).toBeNull();
  });
});

describe("applyS01TurnRules", () => {
  it("leaves other sessions, unknown slugs and risk turns untouched", async () => {
    const base = { fields: { a: 1 }, missing: ["x"] };
    for (const result of [
      await run("practice-commitment", "treatmentCommitment", "네", base.fields, base.missing, { sessionId: "tbct-s02" }),
      await run("unknown-slug", "x", "네", base.fields, base.missing),
      await run("practice-commitment", "treatmentCommitment", "네", base.fields, ["treatmentCommitment"], { riskSignals: ["suicidal_ideation_ko"] }),
    ]) {
      expect(result.logs).toEqual([]);
    }
    const risky = await run("practice-commitment", "treatmentCommitment", "네", {}, ["treatmentCommitment"], { riskSignals: ["suicidal_ideation_ko"] });
    expect(risky.extracted.missingFields).toEqual(["treatmentCommitment"]);
  });

  it("accepts a bare yes on a commitment/comparison question", async () => {
    const result = await run("practice-commitment", "treatmentCommitment", "네", {}, ["treatmentCommitment"]);
    expect(result.extracted.fields.treatmentCommitment).toBe("네");
    expect(result.extracted.missingFields).toEqual([]);
  });

  it("ends the extra-emotion collection on a stop answer without storing it", async () => {
    const result = await run("second-emotion", "personalSecondEmotion", "없어요", { personalSecondEmotion: "없어요" });
    expect(result.extracted.fields.personalSecondEmotion).toBeUndefined();
    expect(result.extracted.fields.personalEmotionsNoMore).toBe(true);
  });

  it("routes 'not sure' to an examples follow-up, and accepts a second 'not sure' there", async () => {
    const first = await run("first-behavior", "personalBehavior", "잘 모르겠어요", {}, ["personalBehavior"]);
    expect(first.extracted.fields.personalBehaviorNeedsExamples).toBe(true);
    expect(first.extracted.missingFields).toEqual([]);
    const second = await run("behavior-examples", "personalBehavior", "잘 모르겠어요", {}, ["personalBehavior"]);
    expect(second.extracted.fields.personalBehavior).toBe("잘 모르겠어요");
    expect(second.extracted.missingFields).toEqual([]);
  });

  it("uses the stored hint when the participant accepts it for person 2", async () => {
    const result = await run("candidate-two-thought-hint", "candidateTwoThought", "네", { candidateTwoThoughtHint: "빈말이겠지" }, ["candidateTwoThought"]);
    expect(result.extracted.fields.candidateTwoThought).toBe("빈말이겠지");
    expect(result.extracted.fields.candidateTwoThoughtSource).toBe("accepted_hint");
  });

  it("asks for a one-line version only when the situation answer is long", async () => {
    const long = await run("recent-moment", "situationThoughtDistinction", "x", { situationThoughtDistinction: "팀원들 간에 뭔가 이슈가 있었어 가지고 그런 것 때문에 뭔가 불안했던 적이 있던 것 같습니다" });
    expect(long.extracted.fields.situationNeedsLine).toBe(true);
    const short = await run("recent-moment", "situationThoughtDistinction", "x", { situationThoughtDistinction: "팀원들과 의견 차이가 있었다" });
    expect(short.extracted.fields.situationNeedsLine).toBe(false);
    const skipped = await run("write-situation-line", "situationLine", "모르겠어요", {}, ["situationLine"]);
    expect(skipped.extracted.fields.situationLineSkipped).toBe(true);
    expect(skipped.extracted.fields.situationLine).toBeUndefined();
    expect(skipped.extracted.missingFields).toEqual([]);
  });

  it("maps an ordinal to the participant's own listed difficulty", async () => {
    const result = await run("representative-difficulty", "s01RepresentativeProblem", "두 번째요", { s01Problems: ["걱정이 많다", "계획 강박", "관계에서 예민함"], s01RepresentativeProblem: "두 번째요" });
    expect(result.extracted.fields.s01RepresentativeProblem).toBe("계획 강박");
    expect(result.extracted.fields.s01RepresentativeProblemSource).toBe("ordinal");
  });

  it("writes the conclusion and feared-outcome flags on accepted answers", async () => {
    const conclusion = await run("what-made-difference", "threePersonModelInsight", "감정이요", { threePersonModelInsight: "감정이요" });
    expect(conclusion.extracted.fields.conclusionAnsweredEmotion).toBe(true);
    const outcome = await run("what-happened", "ownCaseActualOutcome", "결국 싸웠어요", { ownCaseActualOutcome: "결국 싸웠어요" });
    expect(outcome.extracted.fields.fearedOutcomeDidNotMaterialize).toBe(false);
  });

  it("turns an explicit distortion-suggestion request into a flag instead of an answer", async () => {
    const result = await run("identify-distortion", "participantSelectedDistortions", "어떤 게 맞는지 추천해 주세요", { participantSelectedDistortions: "어떤 게 맞는지 추천해 주세요" });
    expect(result.extracted.fields.participantSelectedDistortions).toBeUndefined();
    expect(result.extracted.fields.distortionSuggestionRequested).toBe(true);
  });

  describe("three-person scene", () => {
    const previousMode = process.env.S01_SCENE_MODE;
    beforeEach(() => { process.env.S01_SCENE_MODE = "fixed"; });
    afterEach(() => {
      if (previousMode === undefined) delete process.env.S01_SCENE_MODE;
      else process.env.S01_SCENE_MODE = previousMode;
    });

    it("sets the scene, hints and given emotions once, after the cycle's last answer", async () => {
      const result = await run("short-long-term", "cycleShortLongTermEffect", "당장은 안심돼요", { cycleShortLongTermEffect: "당장은 안심돼요" });
      const fields = result.extracted.fields;
      expect(fields.threePersonScene).toBe(FIXED_S01_SCENE.ko.scene);
      expect(fields.candidateTwoThoughtHint).toBe(FIXED_S01_SCENE.ko.hintTwo);
      expect(fields.candidateTwoEmotion).toBe("의심");
      expect(fields.candidateThreeEmotion).toBe("화");
      expect(fields.threePersonSceneSource).toBe("fixed_fallback");
      expect(result.logs).toHaveLength(1);

      const again = await run("short-long-term", "cycleShortLongTermEffect", "당장은 안심돼요", { ...fields });
      expect(again.logs).toHaveLength(0);
    });
  });
});
