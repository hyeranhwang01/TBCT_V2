import type { PromptItem } from "@/lib/protocol/source-fidelity-types";
import { firstText } from "@/lib/runtime/static-messages/field-helpers";

const APPROVED_TEXT: Record<string, string> = {
  "tbct-s06-n01-p01-warm-opening": "Welcome. Whenever you're ready, tell me a bit about what's been difficult for you lately — I'll follow your lead.",
  "tbct-s06-n04-p01-six-anchor-symptom-scale": "For each symptom, use this 0–5 color scale: 0 Light blue, 1 Dark blue, 2 Light green, 3 Dark green, 4 Yellow, and 5 Red. Higher scores mean greater distress or difficulty.",
  "tbct-s06-n04-p02-calibration-anchor": "Before we score your own items, let's calibrate the scale. On this same 0–5 scale, how would you rate a very mild, everyday moment right now — for example, simply talking with me during this session?",
  "tbct-s06-n04-p03-color-zone-rules": "Blue and green scores describe manageable discomfort; yellow and red scores identify distress that needs more attention.",
  "tbct-s06-n06-p03-participant-capsule-summary": "In one or two sentences, how would you summarize the situations that bring up discomfort and the situations that bring up distress?",
  "tbct-s06-n08-p01-intensity": "When planning practice, consider intensity: how strong should the discomfort be so that it is challenging but still safe and manageable?",
  "tbct-s06-n08-p02-duration": "Now consider duration: how long could you remain in that safe situation without escaping or using a safety behavior?",
  "tbct-s06-n08-p03-frequency": "And frequency: how often could you repeat the practice so that new learning has a chance to develop?",
  "tbct-s06-n09-p03-overcoming-curve": "As you stay in a safe situation and practice repeatedly, the goal is not immediate relief but learning that you can tolerate and overcome the discomfort.",
  "tbct-s06-n10-p01-introduce-safety-behaviors": "Sometimes we reduce anxiety through safety behaviors. They help briefly, but can prevent us from learning that the situation is manageable. What safety behavior do you notice?",
  // Shadowed by the dynamic render-circuit-two branch below (which always
  // returns a personalized string once this ID matches) -- kept here,
  // unreachable, only because it was already part of the reviewed content
  // before that branch existed.
  "tbct-s06-n10-p03-render-circuit-two": "Circuit 2 is the repeating loop between a feared situation, anxious predictions, uncomfortable feelings, and safety behaviors. Let’s map your loop using your own example.",
  "tbct-s06-n10-p05-circuit-two-summary": "How would you summarize your Circuit 2 loop in your own words?",
  "tbct-s06-n11-p01-session-worksheet": "Your symptom hierarchy and Circuit 2 notes can be kept as a worksheet for review with your therapist.",
};

export function resolveStaticText(promptItem: PromptItem, fields: Record<string, unknown>, locale: string): string | undefined {
  const isKorean = locale.toLowerCase().startsWith("ko");
  // Every session's own "SAFETY PROTOCOL (MANDATORY)" section gives the same
  // clinical instruction (pause immediately, acknowledge with compassion,
  // direct to the therapist/a crisis line, don't resume until safety is
  // confirmed) with only the exercise name changing -- see s03's static
  // message file for the full rationale.
  if (promptItem.id === "tbct-s06-n13-p01-pause-hierarchy") {
    return "Let's pause the symptom hierarchy here for a moment. If you're feeling distressed or unsafe right now, please reach out to your therapist or a crisis line right away -- that matters more than continuing this exercise. We can pick this back up together once you're safe.";
  }
  if (promptItem.id === "tbct-s06-n10-p03-render-circuit-two") {
    // Composed per-participant, so this ID must NOT also appear in `koreanText`:
    // resolvePromptLocaleText gives a koreanText entry precedence over anything
    // returned here (see s08.ts for the same constraint). A Korean koreanText
    // entry used to exist for this ID and replaced every participant's own
    // circuit with one fixed sentence, which is why the Korean branch below is
    // composed here instead.
    const situation = firstText(fields.currentSymptomItemText) ?? firstText(fields.symptomCoreSituation) ?? (isKorean ? "말씀하신 상황" : "the situation you described");
    const assumption = firstText(fields.underlyingAssumption) ?? (isKorean ? "그때 떠오르는 생각" : "your underlying assumption");
    const behavior = firstText(fields.safetyBehaviors) ?? (isKorean ? "알아차리신 안전행동" : "the safety behavior you noticed");
    if (isKorean) {
      return `말씀하신 내용을 회로 2로 정리해 볼게요. “${situation}”에서 “${assumption}”이라는 생각이 떠오르고, 그때 불안이 올라오고, 그래서 “${behavior}”을 하게 됩니다. 그 안전행동은 잠깐 불안을 낮춰 주지만, 두려워하던 일이 실제로는 일어나지 않았을 거라는 걸 배울 기회를 막아서, 다음에 같은 상황이 오면 이 순환이 다시 반복돼요. 실제로 그렇게 느껴지시나요?`;
    }
    return `Here is your Circuit 2 loop, in your own words: “${situation}” leads to the thought “${assumption}”, which brings on anxious feelings, which leads to “${behavior}”. That safety behavior briefly relieves the anxiety but prevents you from learning the feared outcome would not have happened anyway, so the loop repeats the next time you're in that situation. Does that match what happens for you?`;
  }
  return APPROVED_TEXT[promptItem.id];
}

export const koreanText: Record<string, string> = {
  "tbct-s06-n01-p01-warm-opening": "환영합니다. 준비가 되시면, 최근에 힘들었던 일에 대해 편하게 말씀해 주세요 — 말씀하시는 대로 따라갈게요.",
  "tbct-s06-n04-p01-six-anchor-symptom-scale": "각 증상에 대해 이 0~5 색상 척도를 사용해 주세요: 0 연한 파란색, 1 진한 파란색, 2 연한 초록색, 3 진한 초록색, 4 노란색, 5 빨간색. 점수가 높을수록 괴로움이나 어려움이 크다는 뜻이에요.",
  "tbct-s06-n04-p02-calibration-anchor": "자신의 항목들을 평가하기 전에, 척도를 먼저 조정해 볼게요. 같은 0~5 척도에서, 지금 이 순간처럼 아주 가벼운 상황 — 예를 들어 저와 이렇게 대화하는 것 — 은 몇 점 정도일까요?",
  "tbct-s06-n04-p03-color-zone-rules": "파란색과 초록색 점수는 감당할 수 있는 불편감을 나타내고, 노란색과 빨간색 점수는 더 많은 주의가 필요한 괴로움을 나타내요.",
  // n02 fires only when a safety behavior is observed in-session.
  "tbct-s06-n02-p01-notice-going-quiet": "지금 조금 조용해지신 것 같아요. 어떤 마음이 드셨는지 말씀해 주실 수 있을까요?",
  "tbct-s06-n02-p02-check-going-quiet": "'조용해지기'는 앞서 적어 주신 목록에도 있었어요. 지금 이 순간에도 그런 일이 일어나고 있는 걸까요?",
  // n03 (symptom list and modifier walk) is deliberately left without static
  // text: that step is an adaptive multi-turn decomposition ("is it harder with
  // your manager than with a teammate?") and a single fixed line, which is what
  // a koreanText entry becomes, would collapse it into one question.
  // [item] is substituted from currentSymptomItemText by resolveBracketPlaceholders,
  // which runs after this text is chosen -- keep the bracket.
  "tbct-s06-n05-p01-item-score": "“[item]” — 우리가 함께 본 0~5 색상 척도로는 몇 점 정도일까요?",
  "tbct-s06-n06-p01-value-linked-discomfort": "잠깐 다른 이야기를 해볼게요. 힘들어도 계속 해내고 계신 일이 있다면, 그건 무엇 때문일까요?",
  "tbct-s06-n06-p02-professional-effort": "사람들이 몇 년씩 공부하거나 훈련을 견디는 건 왜일까요? 그 과정이 편해서일까요?",
  "tbct-s06-n06-p03-participant-capsule-summary": "한두 문장으로, 불편감을 느끼는 상황과 괴로움을 느끼는 상황을 어떻게 정리해 볼 수 있을까요?",
  "tbct-s06-n07-p01-choose-green-items": "이번 주에 연습할 항목을 함께 정해볼게요. 초록색으로 표시된 항목(2점 또는 3점) 중에서 2~3개를 직접 골라 주세요. 노란색이나 빨간색 항목은 아직 혼자 연습하지 않습니다.",
  "tbct-s06-n07-p02-accountability-partner": "이 연습을 함께 확인해 줄 수 있는 분이 주변에 계실까요?",
  "tbct-s06-n07-p03-plan-b": "만약 계획대로 하지 못하게 되면, 대신 어떻게 해보시겠어요?",
  "tbct-s06-n08-p01-intensity": "연습을 계획할 때 강도를 고려해 보세요: 도전이 되지만 여전히 안전하고 감당할 수 있으려면 불편감이 얼마나 강해야 할까요?",
  "tbct-s06-n08-p02-duration": "이번엔 지속 시간을 생각해 볼게요: 도망치거나 안전행동을 사용하지 않고 그 안전한 상황에 얼마나 머물 수 있을까요?",
  "tbct-s06-n08-p03-frequency": "그리고 빈도를 생각해 볼게요: 새로운 학습이 일어나려면 이 연습을 얼마나 자주 반복할 수 있을까요?",
  // Confirms the homework that n07 collected. In testing this step asserted
  // "the green items you chose" in a session where every item had scored 5
  // (red) and n07 had fallen through to the generic fallback, so nothing green
  // had been chosen at all. Worded here to confirm rather than to assert, but
  // the underlying gap is that the yellow/red block (n12) did not fire.
  "tbct-s06-n08-p04-homework-confirmation": "그러면 이번 주에는 방금 고르신 초록색 항목들을 연습해 보기로 할게요. 불편함이 올라와도 그 상황을 피하지 않고 머물러 보시는 것이 이번 주 과제예요. 이렇게 진행해도 괜찮을까요?",
  // n09-p01/p02: the catalog markers for these two are the source's *example*
  // wording ("When you go quiet in a meeting" / "And the next meeting"), which
  // reached participants verbatim and asked about meetings even when the
  // participant's hierarchy had nothing to do with meetings. Phrased here
  // against whatever safety behavior the participant actually named.
  "tbct-s06-n09-p01-relief-curve": "그 안전행동을 하는 바로 그 순간, 불안은 올라가나요 내려가나요?",
  "tbct-s06-n09-p02-next-meeting": "그럼 다음에 같은 상황이 왔을 때는 어떤가요?",
  "tbct-s06-n09-p03-overcoming-curve": "안전한 상황에 머물며 반복해서 연습하는 목표는 즉각적인 안도감이 아니라, 그 불편감을 견디고 극복할 수 있다는 것을 배우는 거예요.",
  "tbct-s06-n10-p01-introduce-safety-behaviors": "때때로 우리는 안전행동을 통해 불안을 줄이려고 해요. 이런 행동은 잠깐 도움이 되지만, 그 상황이 감당할 수 있다는 것을 배우지 못하게 막을 수도 있어요. 어떤 안전행동을 알아차리셨나요?",
  // "tbct-s06-n10-p03-render-circuit-two" is deliberately absent: resolveStaticText
  // composes that line per participant, and a koreanText entry would take
  // precedence over it (resolvePromptLocaleText) -- which is exactly what used to
  // replace every Korean participant's own circuit with one fixed sentence.
  "tbct-s06-n10-p05-circuit-two-summary": "회로 2의 순환을 자신의 말로 어떻게 정리해 보시겠어요?",
  "tbct-s06-n10-p04-place-on-diagram": "방금 만든 그 문장은 회로의 어느 자리에 놓으면 좋을까요?",
  "tbct-s06-n11-p01-session-worksheet": "증상 계층과 회로 2 노트는 치료사와 함께 검토할 워크시트로 보관하실 수 있어요.",
  // Safety rule TBCT-S06-NO-YELLOW-RED-HOMEWORK. Reached only when a yellow or
  // red item is proposed for independent practice, so it never appeared in
  // testing -- but it must not be the one message that comes out in English (or
  // as the generic locale fallback) at the moment the rule actually fires.
  "tbct-s06-n12-p01-block-independent-homework": "그 항목은 노란색이나 빨간색이라, 이번 주에 혼자 연습하기에는 아직 부담이 큰 단계예요. 초록색으로 표시한 항목 중에서 골라 주시고, 노란색과 빨간색 항목은 치료사와 함께 다룰게요.",
  "tbct-s06-n13-p01-pause-hierarchy": "지금 잠시 증상 계층 작업을 멈출게요. 지금 괴롭거나 안전하지 않다고 느끼신다면, 이 활동을 계속하는 것보다 치료사나 위기상담 전화에 바로 연락하는 게 더 중요해요. 안전해지시면 우리 함께 다시 이어갈 수 있어요.",
};
