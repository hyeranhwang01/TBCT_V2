import { describe, expect, it } from "vitest";
import { spec } from "@/patient/sessions/s01/spec";
import { koreanText } from "@/patient/sessions/s01/messages";
import { CANONICAL_PROMPT_ITEMS } from "@/shared/protocol/source-fidelity-catalog";
import { missingIntentContent } from "@/shared/dialogue-agent/dialogue-agent-orchestrator";
import { resolveS01TaskIntent, S01_FIXED_TASK_SLUGS, S01_TASK_INTENT_SLUGS, s01TaskIntent, s01TaskIntentsEnabled } from "@/patient/sessions/s01/task-intents";

// Task intents (.claude/TASK_SCOPE.json note2026_09_19_s01_task_intents).

const s01Prompts = CANONICAL_PROMPT_ITEMS.filter((item) => item.sessionId === "tbct-s01");
const specSlugs = spec.nodes.flatMap((node) => node.prompts.map((prompt) => prompt.slug));
const englishTextBySlug = new Map(spec.nodes.flatMap((node) => node.prompts.map((prompt) => [prompt.slug, prompt.patientText ?? ""] as const)));
const slugOf = (id: string) => /^tbct-s01-n\d+-p\d+-(.+)$/.exec(id)?.[1] ?? "";

describe("S01 task intents", () => {
  it("covers every S01 step: an intent, or deliberately fixed text", () => {
    for (const slug of specSlugs) {
      expect(S01_TASK_INTENT_SLUGS.includes(slug) || S01_FIXED_TASK_SLUGS.has(slug), slug).toBe(true);
    }
    for (const slug of S01_TASK_INTENT_SLUGS) expect(specSlugs, slug).toContain(slug);
    expect(s01Prompts.length).toBe(specSlugs.length);
  });

  it("gives no intent for the fixed scene and the registry-validated candidate list", () => {
    const scene = s01Prompts.find((item) => item.id.endsWith("-scene"));
    const candidates = s01Prompts.find((item) => item.id.endsWith("-suggested-candidates"));
    expect(scene && s01TaskIntent(scene.id)).toBeUndefined();
    expect(candidates && s01TaskIntent(candidates.id)).toBeUndefined();
  });

  // The approved sentence is the fallback when a turn leaves the content
  // out -- it has to pass the same check, in both languages.
  it("is satisfied by the approved sentence it replaces, in Korean and English", () => {
    const fields = { candidateTwoThoughtHint: "그냥 다들 하는 말이겠지", candidateThreeThoughtHint: "왜 나한테 저런 말을 하지" };
    for (const item of s01Prompts) {
      for (const locale of ["ko-KR", "en-US"]) {
        const intent = resolveS01TaskIntent(item.id, locale, { fields });
        if (!intent?.mustMention.length) continue;
        const approved = locale === "ko-KR" ? koreanText[item.id] : englishTextBySlug.get(slugOf(item.id));
        const text = (approved ?? "").replace("[person two hint]", fields.candidateTwoThoughtHint).replace("[person three hint]", fields.candidateThreeThoughtHint);
        expect(missingIntentContent(text, intent), `${item.id} ${locale}`).toEqual([]);
      }
    }
  });

  it("flags a turn that asks the rating without the scale's two ends", () => {
    const rating = s01Prompts.find((item) => item.id.endsWith("-first-emotion-intensity"));
    const intent = resolveS01TaskIntent(rating!.id, "ko-KR", { fields: {} });
    expect(missingIntentContent("그 감정은 어느 정도로 강했나요?", intent)).toHaveLength(1);
    expect(missingIntentContent("전혀 없으면 0, 가장 강하면 100이라고 할 때 어느 정도였어요?", intent)).toEqual([]);
    expect(missingIntentContent("10점 중에 몇 점이었나요?", intent), "'10' is not '0'").toHaveLength(1);
  });

  it("fills placeholders, and holds a hint turn to the stored hint only when there is one", () => {
    const goal = s01Prompts.find((item) => item.id.endsWith("-goal-at-end"));
    expect(resolveS01TaskIntent(goal!.id, "ko-KR", { fields: { s01RepresentativeProblem: "사람들과의 관계에서 예민해져요" } })?.obtain).toContain("사람들과의 관계에서 예민해져요");
    const hint = s01Prompts.find((item) => item.id.endsWith("-candidate-two-thought-hint"));
    expect(resolveS01TaskIntent(hint!.id, "ko-KR", { fields: {} })?.mustMention).toEqual([]);
    const withHint = resolveS01TaskIntent(hint!.id, "ko-KR", { fields: { candidateTwoThoughtHint: "그냥 (인사치레)겠지?" } });
    expect(missingIntentContent("예를 들면 ‘그냥 (인사치레)겠지?’ 같은 생각이요.", withHint)).toEqual([]);
    expect(missingIntentContent("예를 들면 인사치레라고 생각했을 수도 있어요.", withHint)).toHaveLength(1);
  });

  it("can be switched off", () => {
    expect(s01TaskIntentsEnabled({})).toBe(true);
    expect(s01TaskIntentsEnabled({ S01_TASK_INTENTS: "off" })).toBe(false);
  });
});
