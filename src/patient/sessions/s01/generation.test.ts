import { afterEach, describe, expect, it } from "vitest";
import { FIXED_S01_SCENE, avoidTermsFrom, generateS01Scene, generateS01SceneOnServer, validateScene } from "@/patient/sessions/s01/generation";

const context = { sessionId: "SESSION", turnId: "TURN" };
const GOOD_KO = {
  scene: "동아리 첫 모임이 끝나고 선배가 세 사람에게 똑같이 말했어요. “오늘 와줘서 반가웠어요. 좋은 분들 같아요. 다음에 또 봬요.”",
  hintTwo: "다들한테 하는 말이겠지",
  hintThree: "처음 보는데 왜 저래?",
};

describe("validateScene", () => {
  it("accepts the fixed real-session scenes and a well-formed generated one", () => {
    expect(validateScene(FIXED_S01_SCENE.ko, { locale: "ko-KR" })).toEqual({ ok: true });
    expect(validateScene(FIXED_S01_SCENE.en, { locale: "en-US" })).toEqual({ ok: true });
    expect(validateScene(GOOD_KO, { locale: "ko-KR" })).toEqual({ ok: true });
  });

  it("rejects scenes that are malformed, tense, off-form or echo the participant's case", () => {
    expect(validateScene(null, { locale: "ko-KR" })).toMatchObject({ ok: false, reason: "malformed" });
    expect(validateScene({ ...GOOD_KO, scene: "선배가 세 사람에게 비꼬듯 말했어요. “잘했네요.”" }, { locale: "ko-KR" })).toMatchObject({ ok: false, reason: "blocklisted_wording" });
    expect(validateScene({ ...GOOD_KO, scene: "선배가 세 사람에게 반갑다고 말했어요." }, { locale: "ko-KR" })).toMatchObject({ ok: false, reason: "no_quoted_remark" });
    expect(validateScene({ ...GOOD_KO, scene: "선배가 신입에게 똑같이 말했어요. “반가웠어요.”" }, { locale: "ko-KR" })).toMatchObject({ ok: false, reason: "three_people_not_mentioned" });
    expect(validateScene({ ...GOOD_KO, scene: `모임이 끝났어요. 선배가 일어났어요. 세 사람에게 말했어요. “반가웠어요.”` }, { locale: "ko-KR" })).toMatchObject({ ok: false, reason: "too_many_sentences" });
    expect(validateScene({ ...GOOD_KO, scene: `${"아주 ".repeat(60)}세 사람에게 “반가웠어요.”` }, { locale: "ko-KR" })).toMatchObject({ ok: false, reason: "scene_too_long" });
    expect(validateScene({ ...GOOD_KO, hintTwo: "가".repeat(41) }, { locale: "ko-KR" })).toMatchObject({ ok: false, reason: "bad_hint" });
    expect(validateScene({ ...GOOD_KO, scene: "팀 프로젝트 첫 회의 뒤 팀장이 세 사람에게 똑같이 말했어요. “반가웠어요. 잘 부탁해요.”" }, { locale: "ko-KR", avoidTerms: avoidTermsFrom(["팀원들과 프로젝트 방식에 의견 차이가 있었다"]) })).toMatchObject({ ok: false, reason: "echoes_participant_case" });
  });
});

describe("avoidTermsFrom", () => {
  it("keeps content words from the participant's case and drops particles and stopwords", () => {
    const terms = avoidTermsFrom(["팀원들과 프로젝트 방식에 의견 차이가 있었다", "나를 오해하고 잘못 대했다"]);
    expect(terms).toEqual(expect.arrayContaining(["팀원", "프로젝트", "방식", "의견", "차이", "오해"]));
    expect(terms).not.toContain("차");
    expect(terms).not.toContain("있었다");
  });
});

describe("scene generation fallbacks", () => {
  const saved = { mode: process.env.S01_SCENE_MODE, provider: process.env.AI_PROVIDER, key: process.env.ANTHROPIC_API_KEY };
  afterEach(() => {
    for (const [name, value] of [["S01_SCENE_MODE", saved.mode], ["AI_PROVIDER", saved.provider], ["ANTHROPIC_API_KEY", saved.key]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("returns the fixed scene when the scene mode is pinned to fixed", async () => {
    process.env.S01_SCENE_MODE = "fixed";
    expect(await generateS01Scene({ locale: "ko-KR" }, context)).toMatchObject({ ...FIXED_S01_SCENE.ko, source: "fixed_fallback", rejectReason: "scene_mode_fixed" });
  });

  it("never calls a model in mock mode or without an API key", async () => {
    delete process.env.S01_SCENE_MODE;
    process.env.AI_PROVIDER = "mock";
    expect(await generateS01SceneOnServer({ locale: "en-US" }, context)).toMatchObject({ ...FIXED_S01_SCENE.en, source: "fixed_fallback", rejectReason: "provider_disabled" });
    delete process.env.AI_PROVIDER;
    delete process.env.ANTHROPIC_API_KEY;
    expect(await generateS01SceneOnServer({ locale: "ko-KR" }, context)).toMatchObject({ source: "fixed_fallback", rejectReason: "missing_api_key" });
  });
});
