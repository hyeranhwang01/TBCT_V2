import type { PromptItem } from "@/lib/protocol/source-fidelity-types";

// Every session's own "SAFETY PROTOCOL (MANDATORY)" section gives the same
// clinical instruction (pause immediately, acknowledge with compassion,
// direct to a crisis resource, don't resume until safety is confirmed) with
// only the exercise name changing -- see e.g.
// tbct-source-text.generated.ts:465-471 for this session's wording, mirrored
// in every other session that has a safety-pause node.
const APPROVED_TEXT: Record<string, string> = {
  // §7.3 [신규 B-7], §Appendix A-13: "your therapist" assumed a role
  // Protocol V9 Arm 3 (AI-Only) participants don't have -- neutralized to
  // "study clinician" per the participant manual's own arm-neutral distress
  // wording. Also drops the closing "we can pick this back up together"
  // line, which implied the AI could decide to resume the exercise itself
  // (§6.1.4: resumption requires human review under Protocol V9, not an
  // autonomous AI decision).
  "tbct-s03-n15-p01-pause-and-escalate": "Let's pause the Intra-TR here for a moment. If you're feeling distressed or unsafe right now, please reach out to your study clinician or your local emergency services right away — that matters more than continuing this exercise.",
};

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function resolveStaticText(promptItem: PromptItem, fields: Record<string, unknown>, locale?: string): string | undefined {
  const isKorean = (locale ?? "").toLowerCase().startsWith("ko");

  // §6.5 [신규 B-5], Q2b: readbacks whichever thought is actually being
  // rated (workingAutomaticThought after the factual-AT branch, otherwise
  // automaticThought) and offers the "believed it more at the time than
  // now" choice inline, per the manual's timing clarification.
  if (promptItem.id === "tbct-s03-n06-p01-rate-at-belief") {
    const at = (fields.workingAutomaticThought as string | undefined) || (fields.automaticThought as string | undefined);
    if (!at) return undefined;
    return isKorean
      ? `그러면 지금 그 생각 — '${at}' — 을 얼마나 믿으시나요? 0에서 100% 중으로 말씀해 주세요. 만약 그 당시에 더 강하게 믿으셨고 지금은 다르다면, 그때와 지금 중 더 생생하고 중요하게 느껴지는 쪽을 기준으로 답해 주셔도 괜찮아요.`
      : `So, how much do you believe that thought — '${at}' — right now, from 0 to 100%? If you believed it more at the time than you do now, feel free to rate whichever version feels more alive and important to examine.`;
  }

  // §6.10, Q10, §Appendix A-9 -- P0-04 fix (정적분석 리포트): this prompt and
  // conclusion-belief are two separate PromptItems (readback confirmation
  // outputs conclusionReadBackComplete; the next prompt outputs the actual
  // 0-100 conclusionBeliefPercent). The original text here asked the rating
  // question too, so whatever the participant said in reply to THIS prompt
  // (e.g. "70") got stored as conclusionReadBackComplete -- a string, not
  // the real rating -- and conclusion-belief then asked a near-duplicate
  // question a turn later. Readback + confirmation only; the rating
  // question now lives solely on conclusion-belief below. Only generates
  // once both halves of the conclusion exist -- otherwise this prompt is
  // skipped entirely (handled upstream by conclusion-belief's requiresField
  // gate) rather than leaking "[initial conclusion]"/"[extended conclusion]"
  // literals.
  if (promptItem.id === "tbct-s03-n11-p03-full-conclusion-readback") {
    const conclusion = fields.balancedConclusion as string | undefined;
    const therefore = fields.conclusionTherefore as string | undefined;
    if (!conclusion || !therefore) return undefined;
    return isKorean
      ? `그러면 결론은 이렇게 되네요. '${conclusion}, 따라서 ${therefore}.' 정확히 맞게 정리된 건가요?`
      : `So your conclusion is: '${conclusion}, therefore ${therefore}.' Does that capture your conclusion accurately?`;
  }

  // P0-04 fix (정적분석 리포트): conclusion-belief previously had no
  // dedicated branch here, so it fell to the shared generic fallback
  // generator using the same broad source block as full-conclusion-readback
  // -- producing near-identical wording. Explicit branch: rating question
  // only, with a short conclusion reference for context (readback/
  // confirmation was already done by the prior turn).
  if (promptItem.id === "tbct-s03-n11-p04-conclusion-belief") {
    const conclusion = fields.balancedConclusion as string | undefined;
    const therefore = fields.conclusionTherefore as string | undefined;
    if (!conclusion || !therefore) return undefined;
    return isKorean
      ? `이 전체 결론 — '${conclusion}, 따라서 ${therefore}' — 을 지금 0에서 100% 중 어느 정도로 믿으시나요?`
      : `How much do you believe that entire conclusion — '${conclusion}, therefore ${therefore}' — from 0 to 100%?`;
  }

  // §6.11, Q11a Step 2, §Appendix A-10: substitutes the real Q3a emotion;
  // never introduces a new negative emotion the participant didn't name.
  if (promptItem.id === "tbct-s03-n12-p02-original-negative-emotion") {
    const emotion = fields.primaryEmotion as string | undefined;
    if (!emotion) return undefined;
    return isKorean
      ? `그러면 ${emotion}은 어떠신가요? 달라졌을까요? 아직 남아 있다면, 조금 줄어들었나요?`
      : `And what about ${emotion}? Has that changed? Is it still present, and if so, has it decreased?`;
  }

  // §6.12, Q11b, §Appendix A-11: names which emotion(s) are being rated --
  // this prompt has no marker/patientText at all in the source, which
  // otherwise guarantees a generic fallback. Scope limited to
  // positiveEmotions + (if still present) primaryEmotion, matching
  // allowedEmotionSources in s03.ts.
  if (promptItem.id === "tbct-s03-n12-p03-emotion-intensities") {
    const positive = stringList(fields.positiveEmotions);
    const original = fields.primaryEmotion as string | undefined;
    const emotions = original ? [...positive, original] : positive;
    if (emotions.length === 0) return undefined;
    const list = isKorean ? emotions.join(", ") : emotions.join(", ");
    return isKorean
      ? `이제 방금 말씀하신 감정들이 지금 얼마나 강한지 평가해 볼게요 — ${list} — 0에서 100% 사이로요. 0은 전혀 없음, 100은 상상할 수 있는 가장 강한 정도입니다.`
      : `Now let's rate how strong each of those feels right now — ${list} — from 0 to 100%, where 0 is not at all and 100 is the strongest you can imagine.`;
  }

  // §6.14, Q13, §Appendix A-12: repeatExactField in s03.ts documents intent,
  // but the participant-facing readback here follows the working-AT
  // priority (workingAutomaticThought ?? automaticThought) so a
  // factual-AT-branch participant re-rates the thought actually worked with.
  if (promptItem.id === "tbct-s03-n13-p04-repeat-exact-at") {
    const at = (fields.workingAutomaticThought as string | undefined) || (fields.automaticThought as string | undefined);
    if (!at) return undefined;
    return isKorean
      ? `이제 처음의 자동적 사고 — '${at}' — 를 0에서 100% 중 어느 정도로 믿으시나요?`
      : `How much do you now believe the original automatic thought — '${at}' — from 0 to 100%?`;
  }

  return APPROVED_TEXT[promptItem.id];
}

export const koreanText: Record<string, string> = {
  "tbct-s03-n15-p01-pause-and-escalate": "지금 잠시 Intra-TR을 멈출게요. 지금 괴롭거나 안전하지 않다고 느끼신다면, 이 활동을 계속하는 것보다 연구 임상의나 지역 응급 서비스에 바로 연락하시는 것이 훨씬 중요해요.",
  // 세션로그 §12-1 [P0]
  "tbct-s03-n01-p01-safety-check": "시작하기 전에, 오늘은 좀 어떠신가요? 시작하기 전에 제가 알아야 할 급하거나 힘든 일이 있으실까요?",
  // 세션로그 §12-2 [P0]
  "tbct-s03-n02-p01-fourteen-question-introduction": "오늘은 Intrapersonal Thought Record, 줄여서 Intra-TR이라는 걸 함께 해보려고 해요. 지금 힘들게 하는 생각 하나를 살펴보는 데 도움이 되는, 14개의 질문으로 이루어진 구조화된 과정이에요. 한 단계씩 같이 해나갈게요. 맞고 틀린 답은 없어요 — 솔직하게 답해 주시는 게 가장 중요해요.",
  "tbct-s03-n02-p02-ccd-connection": "전에 함께 살펴봤던 그림, 기억하실 거예요 — 상황, 자동적 사고, 감정, 행동으로 이루어진 그거요. Intra-TR도 똑같은 요소들을 쓰는데, 거기서 한 걸음 더 나아가서 새로운 결론과 새로운 느낌·행동 방식까지 다루게 돼요.",

  // 세션로그 §12-3 [P1]: Q1~Q14 나머지 노드 verbatim 전체 복원.
  "tbct-s03-n03-p02-specific-moment": "구체적인 순간 하나만 말씀해 주시겠어요 — 장소, 시간, 실제로 있었던 일 같은 거요.",
  "tbct-s03-n04-p01-automatic-thought": "그 순간 정확히 어떤 생각이 스쳐 지나갔나요? 자동적으로 떠오른 생각이 무엇이었나요?",
  "tbct-s03-n04-p02-emotion-to-thought-redirect": "그 순간 압도되는 느낌이 들 때, 그 밑에 깔린 생각은 무엇이었나요 — 무슨 일이 일어나고 있다고, 또는 무엇이 사실이라고 마음속에서 말하고 있었나요?",
  "tbct-s03-n05-p01-factual-thought-meaning": "그게 사실이라는 걸 알겠어요. 그 생각에서 가장 힘든 부분은 무엇인가요? 그게 본인에게 어떤 의미인가요 — 혹은 그 결과로 무엇이 일어날까 봐 두려우신가요?",
  "tbct-s03-n05-p02-confirm-working-thought": "그러면 우리가 다룰 생각은 단순히 [factual event]가 일어난다는 것이 아니라, [underlying belief]라는 거네요. 맞게 이해했을까요?",
  "tbct-s03-n07-p01-primary-emotion": "그 생각이 들 때, 어떤 감정이 느껴지시나요?",
  "tbct-s03-n07-p02-strongest-emotion": "지금 가장 강하게 느껴지는 건 어느 감정인가요?",
  "tbct-s03-n07-p03-emotion-intensity": "그 감정은 얼마나 강한가요, 0에서 100% 중으로요?",
  "tbct-s03-n08-p01-behavior": "그 생각이 들고 그 감정을 느낄 때, 어떻게 행동하시나요? 어떤 충동이 드나요 — 실제로 무엇을 하시거나, 하고 싶어지시나요?",
  "tbct-s03-n08-p02-body-sensations": "그 순간 몸에서는 무엇이 느껴지시나요?",
  "tbct-s03-n08-p04-cycle-note": "이 패턴이 스스로를 어떻게 유지시키는지 보이시죠 — 생각이 감정을 키우고, 감정이 행동을 이끌고, 행동이 다시 그 생각을 강화해요. 지금 느끼시는 것과 비슷한가요, 아니면 다르게 느껴지는 부분이 있으신가요? 이제 좀 더 자세히 살펴볼게요.",
  "tbct-s03-n09-p04-cognitive-distortion": "자동적 사고를 살펴볼 때 — 가지고 계신 인지 왜곡 목록을 참고해서 — 이 생각이 어떤 왜곡에 해당하는 것 같나요?",
  "tbct-s03-n10-p01-evidence-for": "이 자동적 사고를 뒷받침하는 증거가 있을까요 — 그게 사실이라고 확인해 주는 것들이요? 가능하면 두세 가지 예를 떠올려 보세요.",
  "tbct-s03-n10-p02-evidence-for-more": "한두 가지만 더 떠올려 보시겠어요 — 구체적으로 떠오르는 예가 있을까요?",
  "tbct-s03-n10-p03-evidence-against": "이번엔 반대쪽인데요 — 이 생각을 뒷받침하지 않는 증거가 있을까요? 그 생각이 완전히 맞지는 않을 수도 있다고 알려주는 것들이요. 이것도 두세 가지 떠올려 보세요.",
  "tbct-s03-n11-p01-balanced-conclusion": "지금까지의 증거를 모두 종합해 보면 — 그 생각을 뒷받침하는 것과 반박하는 것 둘 다요 — 어떤 결론을 내리시겠어요? 전체적으로 보면 무엇을 알 수 있을까요?",
  "tbct-s03-n11-p02-therefore-extension": "그 결론을 조금 더 이어가 볼 수 있을까요? 그게 앞으로 본인에게 어떤 의미가 될까요? '따라서…'로 시작해서 말씀해 주세요.",
  "tbct-s03-n12-p01-positive-emotions-first": "이 결론에 다다르고 나니, 혹시 어떤 긍정적인 감정이 드시나요 — 있다면요?",
  "tbct-s03-n13-p01-intended-action": "이 새로운 결론을 바탕으로, 지금 무엇을 해보고 싶으신가요? 구체적으로 떠오르는 행동이 있을까요?",
  "tbct-s03-n13-p02-action-plan-bridge": "그건 실행 계획의 시작처럼 들리네요. 지금, 또는 다음 세션에서 더 자세히 구체화해 볼 수 있어요.",
  "tbct-s03-n13-p03-new-body-sensations": "지금 몸에서는 무엇이 느껴지시나요, 아까와 비교해서요?",
  "tbct-s03-n13-p05-global-evaluation": "전체적으로, 이 활동을 시작했을 때와 비교하면 지금은 어떠신가요? 같다, 조금 나아졌다, 많이 나아졌다 — 어느 쪽에 가까우신가요?",
  "tbct-s03-n14-p01-closing-review": "오늘 정말 중요한 작업을 하셨어요. 힘들게 하는 생각 하나를 붙잡고 솔직하고 꼼꼼하게 살펴보셨네요. 지금 다다르신 결론은 본인의 것이에요 — 본인이 찾은 증거와 본인의 논리로 만드신 거니까요. 오늘 정리하신 내용을 다시 한번 읽어보시고, 가능하다면 다음 진료 때 담당 연구 임상의와 나눠보시길 권해드려요.",
  "tbct-s03-n14-p02-action-plan-offer": "원하시면 지금 말씀하신 내용을 바탕으로 실행 계획을 함께 세워볼 수도 있어요. 말씀만 해주세요.",

  // §7.1 locale parity: Korean counterparts for the inline patientText
  // added to protocol/sessions/s03.ts (§6.3, §6.4, §6.6, §6.7, §6.9).
  "tbct-s03-n02-p03-redirection-contract": "진행 중에 제가 가끔 방향을 돌릴 수 있어요 — 말씀하시는 내용이 중요하지 않아서가 아니라, 열네 개 질문을 함께 끝까지 마치기 위해서예요. 괜찮으실까요?",
  "tbct-s03-n02-p04-worksheet-readiness-check": "시작하기 전에, Intra-TR 워크시트를 옆에 펼쳐 두셨거나 가지고 계신가요? 열네 개 질문이 인쇄되어 있어서, 따라오실 때 도움이 될 수 있어요.",
  "tbct-s03-n03-p01-describe-situation": "최근에 힘들었던 상황을 하나 말씀해 주실 수 있을까요? 지금 그 일이 일어나고 있는 것처럼 구체적으로 이야기해 주세요 — 무슨 일이 있었나요?",
  "tbct-s03-n08-p03-participant-summary": "계속하기 전에, 지금까지 다룬 내용을 본인의 말로 정리해 주실 수 있을까요? 상황, 그때의 생각, 감정, 그리고 몸에서 일어나는 반응까지요.",
  "tbct-s03-n09-p01-behavior-pros": "그렇게 행동하는 것에 — 비록 일시적이더라도 — 어떤 이점이나 도움이 되는 부분이 있을까요? 아주 작은 안도감이라도 괜찮아요.",
  "tbct-s03-n09-p02-behavior-pros-follow-up": "우리는 보통 이유가 있어서 어떤 행동을 해요, 그게 장기적으로 도움이 되지 않더라도요. 거기에 잠깐이라도 위안이나 안도감이 있었을까요?",
  "tbct-s03-n09-p03-behavior-cons": "그렇게 행동하는 것의 단점이나 대가는 무엇일까요?",
  "tbct-s03-n10-p04-evidence-against-direction": "최근 며칠이나 몇 주를 떠올려 보세요 — 이 생각과 어긋나는 행동을 하신 적이 있나요, 부분적으로라도요? 도움이 될 만한 방향들: 전반적인 건강 상태, 최근의 행동들, 이전에 대처했던 경험, 다른 사람들의 피드백, 또는 객관적인 사실들.",
};

// P1-3: same phase-preserving fallback pattern as static-messages/s01.ts's
// resolveRepeatedFallbackText (see that file for the full rationale).
// Without this, runtime-orchestrator.ts's generic repeatedFallback override
// could replace an Intra-TR construct question (situation/thought/emotion/
// body) with an unrelated "share one specific moment" personal-example
// prompt, which is exactly the situation-vs-thought-vs-emotion construct
// bleed this session's 14-question structure must never allow. The core
// construct prompts get a hand-tuned, construct-preserving rephrase; every
// other S03 prompt falls back to the same "let's try that more simply"
// prefix in front of its OWN already-approved text.
const REPEATED_FALLBACK_REPHRASE: Record<string, { en: string; ko: string }> = {
  "tbct-s03-n03-p01-describe-situation": {
    en: "Just the situation itself for now -- what actually happened, as plainly as you can put it.",
    ko: "지금은 실제로 있었던 상황만요 -- 무슨 일이 있었는지 담백하게 말씀해 주시면 돼요.",
  },
  "tbct-s03-n04-p01-automatic-thought": {
    en: "Just the thought that went through your mind at that moment -- not the feeling, just what you were thinking.",
    ko: "그 순간 머릿속에 스쳐 지나간 생각만요 -- 감정 말고, 그때 어떤 생각을 하셨는지요.",
  },
  "tbct-s03-n07-p01-primary-emotion": {
    en: "Just the emotion itself -- one word for how you felt is enough.",
    ko: "감정 하나만요 -- 그때 느끼신 감정을 한 단어로 말씀해 주셔도 괜찮아요.",
  },
  "tbct-s03-n07-p03-emotion-intensity": {
    en: "Just a number from 0 to 100% for how strong that emotion was.",
    ko: "그 감정이 얼마나 강했는지, 0에서 100% 사이의 숫자로만 답해 주세요.",
  },
  "tbct-s03-n08-p01-behavior": {
    en: "Just the behavior -- what you actually did, or wanted to do.",
    ko: "행동만요 -- 실제로 무엇을 하셨는지, 또는 하고 싶으셨는지요.",
  },
  "tbct-s03-n08-p02-body-sensations": {
    en: "Just what you noticed in your body in that moment -- anything at all, even something small.",
    ko: "그 순간 몸에서 느껴진 것만요 -- 아주 작은 것이라도 괜찮아요.",
  },
};

export function resolveRepeatedFallbackText(input: { promptItemId: string; approvedPatientText: string; locale?: string }): string {
  const isKorean = (input.locale ?? "").toLowerCase().startsWith("ko");
  const specific = REPEATED_FALLBACK_REPHRASE[input.promptItemId];
  if (specific) return isKorean ? specific.ko : specific.en;
  return isKorean ? `조금 더 간단하게 다시 여쭤볼게요. ${input.approvedPatientText}` : `Let's take that a little more simply. ${input.approvedPatientText}`;
}
