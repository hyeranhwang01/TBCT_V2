import type { PromptItem } from "@/lib/protocol/source-fidelity-types";

// Source (tbct-source-text.generated.ts:57-69) gives a single worked
// "Example:" of this mandatory opening move -- a hypothetical participant
// who opens with anxiety/couples-therapy/nursing content, acknowledged
// with "That sounds like a lot to be carrying." The marker-extraction in
// source-fidelity-catalog previously pulled that example's therapist line
// out verbatim as this prompt's fallback text, so every participant's
// session opened with a fabricated acknowledgment of content they never
// said. This runtime has no captured field for whatever a participant
// volunteers before Step 1 (unlike S08's charge, which reuses the
// already-collected coreBelief), so there's nothing patient-specific to
// substitute in -- a warm, content-neutral opening that doesn't claim
// anything false is the safe reading of "acknowledge warmly... then
// redirect immediately to the Step 1 opening question."
const APPROVED_TEXT: Record<string, string> = {
  "tbct-s01-n01-p01-warm-acknowledgement": "Thank you for being here. I'd like us to start with something that will help us look at everything more clearly together.",
};

function normalizedAnswer(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[^a-z0-9가-힣]+/g, " ").trim() : "";
}

function hasDifferentAnswers(values: unknown[]) {
  const answers = values.map(normalizedAnswer).filter(Boolean);
  return answers.length === values.length && new Set(answers).size > 1;
}

export function resolveStaticText(promptItem: PromptItem, fields: Record<string, unknown> = {}, locale?: string): string | undefined {
  if (promptItem.id === "tbct-s01-n07-p01-three-person-insight") {
    const emotionsDiffer = hasDifferentAnswers([fields.candidateOneEmotion, fields.candidateTwoEmotion, fields.candidateThreeEmotion]);
    const behaviorsDiffer = hasDifferentAnswers([fields.candidateOneBehavior, fields.candidateTwoBehavior, fields.candidateThreeBehavior]);
    const isKorean = (locale ?? "").toLowerCase().startsWith("ko");
    if (emotionsDiffer && behaviorsDiffer) {
      return isKorean
        ? "세 사람 모두 똑같은 말을 들었지만, 생각이 서로 달랐죠. 그리고 그 생각에 따라 기분과 행동도 달라졌습니다. 여기서 어떤 점이 보이시나요?"
        : "All three people heard the same words, but their thoughts were different — and their feelings and actions differed too. What do you notice from that?";
    }
    return isKorean
      ? "세 사람 모두 똑같은 말을 들었지만 서로 다른 생각을 했죠. 방금 답에서는 기분이나 행동이 비슷하게 느껴진 부분도 있었고요. 생각이 달라질 때 반응에 어떤 영향을 줄 수 있다고 보시나요?"
      : "All three people heard the same words but had different thoughts. Some of the feelings or actions you pictured were similar. How do you think a different thought could still influence a person's response?";
  }
  return APPROVED_TEXT[promptItem.id];
}

export const koreanText: Record<string, string> = {
  // "많은 것을 감당해 오신 것 같아요" (mirroring the English fallback fix
  // above) used to open every Korean session by claiming a burden the
  // participant never described -- the source manual's "That sounds like a
  // lot to be carrying" is one worked example's acknowledgment, not
  // universal script text.
  "tbct-s01-n01-p01-warm-acknowledgement": "여기 와 주셔서 감사합니다. 이 모든 일을 함께 더 분명하게 살펴보는 데 도움이 되는 것부터 시작하겠습니다.",

  // Opening redesign (Phase 1B "Personal Situation Seed" / Phase 1C
  // "Initial Thought Probe" -- see .claude/TASK_SCOPE.json's
  // note2026_08_17b entry): a natural, low-effort recall prompt instead of
  // the source's more abstract "telegraphic description" framing, followed
  // by a first-pass, uncertainty-tolerant look at the automatic thought.
  "tbct-s01-n01-p02-telegraphic-situation": "최근에 마음이 조금 불편하거나 신경 쓰였던 순간이 있었나요? 아주 큰 일이 아니어도 괜찮습니다.",
  "tbct-s01-n02-p02-initial-thought-probe": "그 일이 있었을 때, 머릿속에 어떤 생각이 가장 먼저 스쳐 지나갔나요? 정확한 문장이 아니어도 괜찮아요.",
  "tbct-s01-n02-p03-personal-example-redirect": "말씀해주셔서 감사해요. 이렇게 일찍 본인의 생각을 여쭤본 게 조금 낯설게 느껴지실 수 있어요. 그래서 먼저 간단한 예시 하나를 같이 살펴보고, 다시 방금 말씀해주신 내용으로 돌아올게요.",

  "tbct-s01-n03-p01-preview-candidates": "본인의 상황을 보기 전에, 똑같은 상황에 있는 세 사람을 먼저 살펴보려고 해요. 중립적인 예시에서 패턴을 보는 게 훨씬 명확하고, 그다음에 본인의 상황을 보면 한결 수월하고 부담도 덜하거든요.",
  "tbct-s01-n11-p01-daily-observation-practice": "다음 세션 전까지, 인지 왜곡 목록의 개인 예시 칸을 활용해서 매일 자동적 사고를 알아차리는 연습을 해보세요. 앞으로의 세션에서 이 생각들을 더 깊이 다루기 위해 Intrapersonal Thought Record를 소개해 드릴게요. 오늘 함께해 주셔서 감사합니다.",

  // §4.2 (v3 P0, 이번에 마저 반영): 핵심 prompt 12개 — 원문(tbct-source-text.
  // generated.ts) 복원 patientText의 한국어 대응.
  "tbct-s01-n09-p01-participant-summary": "다음으로 넘어가기 전에 여쭤보고 싶은 게 있어요. 그 상황에서 생각, 감정, 행동이 어떻게 연결되는지, 스스로 알아차리거나 이해하신 걸 본인의 말로 표현해 주시겠어요?",

  // 세션로그 §9-1/§9-5 잔여 커버리지: 위 §4.2 배치 이후 patientText가
  // 새로 추가된 항목들의 한국어 대응.
  "tbct-s01-n02-p01-situation-or-thought": "흥미롭네요 — 그게 상황인가요, 아니면 생각일 수도 있을까요?",
  "tbct-s01-n08-p05-outcome-gap": "그러면 두려워하셨던 일이 실제로는 일어나지 않았다는 것이, 어떤 의미가 있을까요?",
  "tbct-s01-n10-p03-meaning-of-distortion": "만약 이 생각이 인지 왜곡 — 일종의 사고의 오류 — 일 수도 있다는 걸 알게 되신다면, 어떤 차이가 있을까요?",

  // Cognitive Distortions redesign (registry-driven candidates, no external
  // list required -- see s01-cognitive-distortions.ts / s01-distortion-candidates.ts).
  "tbct-s01-n10-p01-intro-distortions": "지금까지 살펴본 이런 부정적인 자동적 사고들 — 인지치료에서는 이를 부르는 이름이 있습니다. 바로 인지 왜곡(cognitive distortion)이라고 해요. 모든 자동적 사고가 왜곡인 것은 아니지만, 그중 일부는 살펴볼 만한 사고의 오류나 과장인 경우가 있습니다.",
  // Only the last-resort static fallback -- normally overridden by the
  // dynamically composed, registry-validated candidate list (runtime-orchestrator.ts).
  "tbct-s01-n10-p02-identify-distortion": "그 상황에서 머릿속에 스쳐 지나간 생각을 살펴볼 때 — 이 중에 해당하는 왜곡이 있나요? 없다고 느끼셔도 괜찮습니다.",

  // Neutral Example redesign (presentation vignette): each person's flow is
  // Emotion + Behavior only, with the counselor stating the automatic
  // thought in the same line that asks for the emotion.
  "tbct-s01-n03-p02-set-up-candidates": "세 사람이 각각 발표를 마쳤다고 상상해 보세요. 발표가 끝난 뒤, 누군가 세 사람 모두에게 똑같이 말합니다: “발표 잘 들었어요.”",
  "tbct-s01-n04-p01-candidate-one-emotion": "첫 번째 사람은 “내 발표가 괜찮았나 보다”라고 생각했습니다. 그러면 어떤 기분이 들 것 같나요?",
  "tbct-s01-n04-p02-candidate-one-behavior": "그러면 어떻게 행동할 것 같나요?",
  "tbct-s01-n05-p01-candidate-two-emotion": "이번엔 두 번째 사람입니다. 그 사람은 “그냥 빈말 같은데”라고 생각했습니다. 그러면 어떤 기분이 들 것 같나요?",
  "tbct-s01-n05-p02-candidate-two-behavior": "그러면 어떻게 행동할 것 같나요?",
  "tbct-s01-n06-p01-candidate-three-emotion": "그리고 세 번째 사람입니다. 그 사람은 “혹시 비꼬는 건가?”라고 생각했습니다. 그러면 어떤 기분이 들 것 같나요?",
  "tbct-s01-n06-p02-candidate-three-behavior": "그러면 어떻게 행동할 것 같나요?",
  // three-person-insight is intentionally resolved above from the three
  // participant-provided emotion/behavior pairs. Keeping a fixed entry here
  // would make resolvePromptLocaleText overwrite that contextual Korean text.

  // Return to the participant's own situation+thought (Phase 4), and the
  // new discrete Emotion/Behavior/Body prompts that replace the old
  // "returning arrows" link-recognition cycle.
  "tbct-s01-n07-p02-return-to-personal-example": "이제 아까 말씀해주신 내용으로 다시 돌아가볼게요 — [their situation], 그리고 그때 떠올랐던 생각: “[their initial thought]”. 방금 살펴본 내용을 바탕으로, 이게 본인의 감정과 행동에 어떻게 연결되는지 함께 살펴볼게요.",
  "tbct-s01-n08-p01-personal-emotion": "그런 생각이 들었을 때, 어떤 기분이 들었나요?",
  "tbct-s01-n08-p02-personal-behavior": "그리고 그런 기분이었을 때, 어떻게 행동하셨나요? 또는 무엇을 하고 싶으셨나요?",
  "tbct-s01-n08-p03-personal-body": "그 순간 몸에서 느껴진 게 있었나요 — 예를 들어 심장이 빨리 뛰거나, 어딘가 긴장되는 느낌이요. 아주 작은 것이라도 괜찮아요.",
};

// S01-only repeatedFallback exception (task redesign brief §4-9): when the
// dialogue agent falls back to identical approved text 3 turns in a row,
// runtime-orchestrator.ts's generic override asks a Personal-Example-shaped
// question ("share one specific moment when it felt strongest") regardless
// of which session/phase is active. For S01 specifically that can jump
// straight out of the Neutral Example or Initial Thought Probe into a new
// personal-experience question -- exactly what this session's phase
// boundaries must never do. This table gives each S01 prompt a
// goal-preserving rephrase instead; runtime-orchestrator.ts calls
// resolveRepeatedFallbackText() only for sessionDefinitionId "tbct-s01" and
// leaves every other session's override untouched.
const REPEATED_FALLBACK_REPHRASE: Record<string, { en: string; ko: string }> = {
  "tbct-s01-n01-p02-telegraphic-situation": {
    en: "No pressure at all -- even something small is fine. Was there a recent moment that felt a little off or stuck with you?",
    ko: "부담 갖지 않으셔도 괜찮아요. 아주 작은 일이어도 좋아요 — 최근에 조금 마음에 걸렸던 순간이 있었을까요?",
  },
  "tbct-s01-n02-p02-initial-thought-probe": {
    en: "Right now we're not trying to describe the situation more -- just whatever thought went through your mind at that moment, even roughly.",
    ko: "지금은 상황을 더 자세히 설명하시는 것보다, 그 순간 머릿속에 어떤 생각이 스쳐 지나갔는지만 한 번 떠올려보시면 됩니다.",
  },
  "tbct-s01-n04-p01-candidate-one-emotion": {
    en: "Just thinking about that first person again -- if that thought went through their mind, what feeling do you think would come with it?",
    ko: "다시 첫 번째 사람을 생각해볼게요 — 그런 생각이 들었다면 어떤 기분이 함께 들 것 같나요?",
  },
  "tbct-s01-n04-p02-candidate-one-behavior": {
    en: "Just the behavior part -- with that feeling, how do you think they'd act?",
    ko: "이번엔 행동 부분만요 — 그런 기분이었다면 어떻게 행동할 것 같나요?",
  },
  "tbct-s01-n05-p01-candidate-two-emotion": {
    en: "Thinking about the second person again -- with that thought in mind, what feeling do you think would come with it?",
    ko: "다시 두 번째 사람을 생각해볼게요 — 그런 생각이 들었다면 어떤 기분이 함께 들 것 같나요?",
  },
  "tbct-s01-n05-p02-candidate-two-behavior": {
    en: "Just the behavior part -- with that feeling, how do you think they'd act?",
    ko: "이번엔 행동 부분만요 — 그런 기분이었다면 어떻게 행동할 것 같나요?",
  },
  "tbct-s01-n06-p01-candidate-three-emotion": {
    en: "Thinking about the third person again -- with that thought in mind, what feeling do you think would come with it?",
    ko: "다시 세 번째 사람을 생각해볼게요 — 그런 생각이 들었다면 어떤 기분이 함께 들 것 같나요?",
  },
  "tbct-s01-n06-p02-candidate-three-behavior": {
    en: "Just the behavior part -- with that feeling, how do you think they'd act?",
    ko: "이번엔 행동 부분만요 — 그런 기분이었다면 어떻게 행동할 것 같나요?",
  },
  "tbct-s01-n07-p01-three-person-insight": {
    en: "Let me put it more simply: the words were the same, but each person interpreted them differently. How might those different thoughts influence a person's response?",
    ko: "조금 더 쉽게 말씀드릴게요. 들은 말은 같았지만 세 사람은 서로 다르게 해석했어요. 이런 서로 다른 생각이 사람의 반응에 어떤 영향을 줄 수 있을까요?",
  },
  "tbct-s01-n08-p01-personal-emotion": {
    en: "Thinking back to that thought you mentioned -- what feeling came with it?",
    ko: "아까 말씀해주신 그 생각으로 다시 돌아가볼게요 — 그때 어떤 기분이 함께 들었나요?",
  },
  "tbct-s01-n08-p02-personal-behavior": {
    en: "Just the behavior part -- what did you do, or want to do, when you felt that?",
    ko: "이번엔 행동만요 — 그런 기분이었을 때 어떻게 하셨나요, 또는 뭘 하고 싶으셨나요?",
  },
  "tbct-s01-n08-p03-personal-body": {
    en: "Even something small is fine -- did you notice anything at all in your body in that moment?",
    ko: "아주 사소한 것도 괜찮아요 — 그 순간 몸에서 느껴진 게 있었을까요?",
  },
};

/**
 * Phase-preserving replacement for runtime-orchestrator.ts's generic
 * repeatedFallback override, S01 only. Falls back to a locale-aware "let's
 * try that more simply" prefix in front of the prompt's own already-approved
 * text for any prompt not explicitly listed above -- so every S01 prompt is
 * covered, not just the ones with a hand-tuned rephrase, and none of them can
 * ever resolve to a new personal-experience question.
 */
export function resolveRepeatedFallbackText(input: { promptItemId: string; approvedPatientText: string; locale?: string }): string {
  const isKorean = (input.locale ?? "").toLowerCase().startsWith("ko");
  const specific = REPEATED_FALLBACK_REPHRASE[input.promptItemId];
  if (specific) return isKorean ? specific.ko : specific.en;
  return isKorean ? `조금 더 간단하게 다시 여쭤볼게요. ${input.approvedPatientText}` : `Let's take that a little more simply. ${input.approvedPatientText}`;
}
