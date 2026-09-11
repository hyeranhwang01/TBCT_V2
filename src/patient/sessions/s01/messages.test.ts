import { describe, expect, it } from "vitest";
import { CANONICAL_PROMPT_ITEMS } from "@/shared/protocol/source-fidelity-catalog";
import { resolveStaticPatientMessage } from "@/shared/runtime/runtime-static-message";
import { FIXED_S01_SCENE } from "@/patient/sessions/s01/generation";
import { koreanText } from "@/patient/sessions/s01/messages";
import type { RuntimeContext } from "@/types/runtime-session";

// S01 prompt ids are positional, so a renumbered id silently loses its
// Korean text (Korean participants would get a generic line). These tests
// are the guard: every key is real, every S01 prompt has Korean text, and
// nothing unresolved or banned reaches the participant.

const S01_PROMPTS = CANONICAL_PROMPT_ITEMS.filter((item) => item.sessionId === "tbct-s01");
const SCENE_ID = "tbct-s01-n10-p02-scene";

const FIELDS: Record<string, unknown> = {
  s01Problems: ["걱정이 많아요", "계획 강박"],
  s01RepresentativeProblem: "걱정이 많아요",
  situationThoughtDistinction: "팀원들과 프로젝트 방식에 의견 차이가 있었다",
  openingInitialThought: "내가 잘못한 게 없는데 오해한다",
  personalEmotion: "배신감",
  personalBehavior: "눈물을 흘렸어요",
  candidateTwoThoughtHint: FIXED_S01_SCENE.ko.hintTwo,
  candidateThreeThoughtHint: FIXED_S01_SCENE.ko.hintThree,
};

function context(fields: Record<string, unknown>): RuntimeContext {
  return { fields, riskSignals: [], iterationCounts: {}, riskLevel: "low" } as unknown as RuntimeContext;
}

const BANNED = /신념|가정|핵심\s*믿음|Intrapersonal|Intra-?TR|12번|\bbelief\b|\bassumption\b/i;

describe("S01 messages", () => {
  it("has a canonical prompt behind every Korean text key", () => {
    const ids = new Set(S01_PROMPTS.map((item) => item.id));
    for (const key of Object.keys(koreanText)) expect(ids, key).toContain(key);
  });

  it("has Korean text for every S01 prompt except the dynamic scene", () => {
    for (const item of S01_PROMPTS) {
      if (item.id === SCENE_ID) {
        expect(koreanText[item.id]).toBeUndefined();
        continue;
      }
      expect(koreanText[item.id], item.id).toBeTruthy();
    }
  });

  it("resolves every S01 prompt to Korean with no leftover placeholder or banned wording", () => {
    for (const item of S01_PROMPTS) {
      const text = resolveStaticPatientMessage(item, "ko-KR", context(FIELDS))?.patientMessage ?? "";
      expect(text, item.id).toMatch(/[가-힣]/);
      expect(text, item.id).not.toMatch(/\[[a-z][^\]]*\]/i);
      expect(text, item.id).not.toMatch(/that difficulty|that feeling|what you did|they probably say|천천히 생각해 보셔도/);
      expect(text, item.id).not.toMatch(BANNED);
    }
  });

  it("resolves every S01 prompt in English with no leftover placeholder or banned wording", () => {
    const englishFields = { ...FIELDS, s01RepresentativeProblem: "worrying a lot", personalEmotion: "betrayed", personalBehavior: "I cried" };
    for (const item of S01_PROMPTS) {
      const text = resolveStaticPatientMessage(item, "en-US", context(englishFields))?.patientMessage ?? "";
      expect(text.trim(), item.id).not.toBe("");
      expect(text, item.id).not.toMatch(/\[[a-z][^\]]*\]/i);
      expect(text, item.id).not.toMatch(BANNED);
    }
  });

  it("uses the participant's own one-line version in the bridge back to their case", () => {
    const bridge = S01_PROMPTS.find((item) => item.id.endsWith("-return-bridge"))!;
    const text = resolveStaticPatientMessage(bridge, "ko-KR", context({ ...FIELDS, situationLine: "의견 차이가 있었다" }))?.patientMessage ?? "";
    expect(text).toContain("의견 차이가 있었다");
    expect(text).not.toContain("팀원들과 프로젝트 방식에");
  });

  it("shows the stored scene, or the fixed real-session scene when none was generated", () => {
    const scene = S01_PROMPTS.find((item) => item.id === SCENE_ID)!;
    const stored = "동아리 첫 모임이 끝나고 선배가 세 사람에게 똑같이 말했어요. “오늘 와줘서 반가웠어요.”";
    expect(resolveStaticPatientMessage(scene, "ko-KR", context({ threePersonScene: stored }))?.patientMessage).toBe(stored);
    expect(resolveStaticPatientMessage(scene, "ko-KR", context({}))?.patientMessage).toBe(FIXED_S01_SCENE.ko.scene);
    expect(resolveStaticPatientMessage(scene, "en-US", context({}))?.patientMessage).toBe(FIXED_S01_SCENE.en.scene);
  });
});
