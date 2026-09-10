import type { PromptItem } from "@/lib/protocol/source-fidelity-types";
import { firstText } from "@/lib/runtime/static-messages/field-helpers";

const APPROVED_TEXT: Record<string, string> = {
  "tbct-s07-n01-p01-crp-offer": "I’d like to propose that today we work through a decision that feels important but difficult using Consensual Role-Play. You will not be pressured to take the feared action; what matters is what you learn. Would you like to try it?",
  "tbct-s07-n01-p02-crp-consent": "Would you like to continue with Consensual Role-Play, knowing that ‘not ready’ is also a valid outcome?",
  "tbct-s07-n01-p03-crp-worksheet-ready": "One last thing before we start: the Consensual Role-Play worksheet sits alongside our conversation and fills in as we go — the same sheet from your guide. Do you have it in view?",
  // The protocol's default is to DETECT the language from the participant's
  // own first substantive message and lock to it silently -- asking is only
  // a fallback for genuinely ambiguous input (tbct-source-text.generated.ts:
  // 1319-1322). sessionLanguage/languageLocked are now captured from the
  // opening reply one step earlier (runtime-context.ts), so this step just
  // states the lock instead of re-asking a question nothing waits for.
  "tbct-s07-n02-p01-language-lock": "I'll continue in the language you've been using, and I'll keep the names of the technique and chair roles consistent throughout.",
  "tbct-s07-n02-p02-both-parts-healthy": "Both parts are healthy functions of the same self. Emotion protects, and Reason evaluates. Neither is superior, and the goal is not for one to defeat the other.",
  // Step 0 invites a reaction rather than moving straight on (the prompt is
  // question-typed for the same reason -- see sessions/s07.ts).
  "tbct-s07-n03-p01-ambivalence-normalization": "It is normal for one part of you to want an action while another part wants to avoid it. We will listen to both without forcing a decision. How does that land for you?",
  // Had no approved English text, so the generated fallback spoke the field
  // name back at the participant: "What would you say about desired or feared
  // action right now?"
  "tbct-s07-n04-p01-action-in-own-words": "Let's put the decision into your own words, as an action. Something concrete — \"take the lift instead of the stairs\" rather than \"stop being anxious.\" How would you say it?",
  // The source offers the anchors 60/70/80/90/100 with every weighing
  // (Steps 2 and 5) -- they were previously never mentioned.
  "tbct-s07-n05-p01-emotion-weight": "From the Emotion chair, what percentage of the weight goes to the disadvantages? The remainder goes to the advantages. If it helps, you can anchor on 60, 70, 80, 90, or 100.",
  "tbct-s07-n05-p02-reason-weight": "From the Reason chair, what percentage of the weight goes to the advantages? The remainder goes to the disadvantages. The same anchors may help: 60, 70, 80, 90, or 100.",
  // Step 3's chair moves. Without these each one fell through to the generic
  // role_transition fallback ("Let's move into that role now"), which names
  // neither the chair being left nor the chair being entered -- the one thing
  // an empty-chair transition has to make explicit for the participant to
  // know who is speaking.
  "tbct-s07-n06-p01-chair-arrangement": "Let's set up two chairs facing each other: one for Emotion and one for Reason. From here on, the two parts speak directly to each other rather than through me. Are the chairs set up and are you ready to begin?",
  "tbct-s07-n06-p02-emotion-to-reason": "Please take the Emotion chair now. Speaking as Emotion, and speaking directly to Reason in the other chair, what do you want Reason to hear?",
  "tbct-s07-n07-p01-consensus-transition": "Now please leave the Emotion and Reason chairs and take a third chair — the Consensus chair. This is the part of you that has been listening to both sides.",
  "tbct-s07-n07-p03-consensus-surprise": "Still from the Consensus chair, what surprised you about what either part had to say?",
  "tbct-s07-n07-p04-consensus-emotion-intent": "From the Consensus chair, what did Emotion turn out to be trying to do?",
  "tbct-s07-n07-p05-consensus-parts-needs": "And what did each part seem to need?",
  "tbct-s07-n09-p03-green-only-scope": "Before we build the plan, one boundary worth keeping: if this action sits at the green end of the list you sorted earlier, it is yours to practise. Anything toward the yellow or red end is done together with your therapist, never on your own. We can still decide it and plan it here either way.",
  "tbct-s07-n08-p01-consensus-weights": "From the Consensus chair, what final percentage would you give the advantages and disadvantages after hearing both parts? The two should total 100, and the same anchors may help: 60, 70, 80, 90, or 100.",
  // Step 6 records "Yes, I'm ready" or "No, I'm not ready" -- those are the
  // only two outcomes the source defines. This line used to offer a third
  // option ("undecided") that the enum has no value for, so a participant who
  // answered the question as asked was rejected as an invalid choice.
  "tbct-s07-n09-p01-readiness-decision": "After hearing both parts, what is your decision right now: ready, or not ready? Either answer is acceptable, and if you are still unsure, that counts as not ready for now.",
  "tbct-s07-n10-p01-proposed-actions": "What small action, if any, would fit the decision you reached?",
  "tbct-s07-n10-p02-possible-obstacles": "What obstacle might make that action difficult?",
  "tbct-s07-n10-p03-obstacle-solutions": "What could help you respond to that obstacle?",
  "tbct-s07-n10-p04-implementation-plan": "When and where would you try this action?",
  // Accountability is the required construct here (the source's own example
  // questions: "Who could you tell about this?", "Is there anyone who could
  // be there with you?") -- not merely non-pressuring emotional support.
  "tbct-s07-n10-p05-support-people": "Who in your life could know about this plan? Is there someone you could tell about it, or who could be there with you when you try it?",
  // Outcome-checking per the source ("How will you know whether it went the
  // way you hoped?"), not a review of what was learned.
  "tbct-s07-n10-p06-follow-up": "How will you know whether it went the way you hoped — and when would you check?",
  // Faithful to the source's Step 6 follow-up for a not-ready decision; there
  // was no approved English text, so half the source question was dropped by
  // the marker fallback.
  "tbct-s07-n09-p02-prepare-later": "Even if not now — would you like to do something to prepare yourself to be ready for this decision later?",
};

const PLAN_SUMMARY_ID = "tbct-s07-n11-p01-plan-summary";

const PLAN_SUMMARY_PARTS: Array<{ field: string; en: string; ko: string }> = [
  { field: "proposedActions", en: "the action", ko: "행동" },
  { field: "possibleObstacles", en: "the obstacle you expect", ko: "예상되는 장애물" },
  { field: "obstacleSolutions", en: "how you would respond to it", ko: "그에 대한 대응" },
  { field: "implementationPlan", en: "when and where", ko: "언제·어디서" },
  { field: "supportPeople", en: "who will know and support you", ko: "계획을 알고 지지해 줄 사람" },
  { field: "followUpPlan", en: "how you will check how it went", ko: "결과를 확인할 방법" },
];

/**
 * Step 7 closes with the THERAPIST summarizing the completed plan back --
 * "Close by summarizing the completed plan... Summarise the plan; do not
 * deliver a verdict on the person." The approved text here used to ask the
 * participant to summarize it themselves, which both inverted the source and
 * asked a question this prompt (type `closing`, completionEffect
 * `complete_session`) never waits for: the session ended on delivery and
 * `crpPlanSummary` stayed permanently empty. Composing it from the six
 * fields the participant already supplied keeps the summary theirs, plain,
 * and free of praise or persuasion.
 *
 * Exported so runtime-execution-api.ts can persist the identical string into
 * `crpPlanSummary` when the turn completes -- the spoken summary and the
 * recorded one cannot drift apart.
 */
export function composeCrpPlanSummary(fields: Record<string, unknown>, locale: string) {
  const isKorean = locale.toLowerCase().startsWith("ko");
  // Each of the six answers is clipped so the whole summary stays under the
  // 600-character isPatientSafeFallbackText guard -- an over-length summary
  // would be replaced WHOLESALE by the content-free generic locale line,
  // losing the entire closing. The full answers remain in their own fields
  // and on the worksheet; the summary is a recap, not the record.
  const clip = (text: string) => (text.length > 50 ? `${text.slice(0, 49).trimEnd()}…` : text);
  const items = PLAN_SUMMARY_PARTS.map((part) => {
    const value = firstText(fields[part.field]);
    return { label: isKorean ? part.ko : part.en, value: value ? clip(value) : (isKorean ? "아직 정하지 않음" : "not yet decided") };
  });
  const body = items.map((item) => `${item.label}: ${item.value}`).join(isKorean ? " / " : "; ");
  return isKorean
    ? `지금까지 세우신 계획을 정리하면 이렇습니다 — ${body}. 결정은 여전히 본인의 것이에요.`
    : `Here is the plan as you set it out — ${body}. The decision remains yours.`;
}

function listCount(value: unknown) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()).length : 0;
}

/**
 * Step 2 closes by NAMING the split -- "a conflict between your Reason and
 * your Emotion" -- and then letting it stand. Composed from the two recorded
 * weights so it states what the participant actually said, and deliberately
 * carries no interpretation: no "significant", no "that's a big gap", no
 * suggestion of which side should win. When the two weights happen to agree,
 * saying "the two disagree" would be false, so that case is named as
 * agreement instead.
 */
function composeSplitNaming(fields: Record<string, unknown>, isKorean: boolean) {
  const emotion = Number(fields.emotionDisadvantageWeight);
  const reason = Number(fields.reasonAdvantageWeight);
  if (!Number.isFinite(emotion) || !Number.isFinite(reason)) {
    return isKorean
      ? "정리하면, 감정(Emotion)이 두는 무게와 이유(Reason)가 두는 무게가 서로 다른 곳을 향하고 있어요. 이것이 지금 마음속에 있는 갈등이에요."
      : "So there it is: the weight your Emotion gives and the weight your Reason gives point in different directions. That is the conflict as it stands.";
  }
  // Both are stated on the SAME axis (share of the disadvantages) so the two
  // numbers are directly comparable rather than quietly measuring opposites.
  const reasonDisadvantage = 100 - reason;
  const agree = Math.abs(emotion - reasonDisadvantage) <= 10;
  if (isKorean) {
    return agree
      ? `감정(Emotion)은 단점에 ${emotion}%, 이유(Reason)는 단점에 ${reasonDisadvantage}%(장점 ${reason}%)의 무게를 두셨어요. 이번에는 두 부분이 서로 비슷한 곳을 보고 있네요.`
      : `감정(Emotion)은 단점에 ${emotion}%, 이유(Reason)는 단점에 ${reasonDisadvantage}%(장점 ${reason}%)의 무게를 두셨어요. 본인의 이유와 감정 사이에 이런 갈등이 있는 거예요.`;
  }
  return agree
    ? `Your Emotion puts ${emotion}% of the weight on the disadvantages, and your Reason puts ${reasonDisadvantage}% there (${reason}% on the advantages). This time the two parts are looking in much the same direction.`
    : `Your Emotion puts ${emotion}% of the weight on the disadvantages, and your Reason puts ${reasonDisadvantage}% there (${reason}% on the advantages). So this is a conflict between your Reason and your Emotion.`;
}

export function resolveStaticText(promptItem: PromptItem, fields: Record<string, unknown>, locale: string): string | undefined {
  const isKorean = locale.toLowerCase().startsWith("ko");
  // Composed per-participant, so this ID must NOT also appear in `koreanText`
  // (a koreanText entry takes precedence -- see resolvePromptLocaleText).
  if (promptItem.id === "tbct-s07-n05-p03-name-the-split") return composeSplitNaming(fields, isKorean);
  // Step 1's two lists are collected one item at a time (repeat_until, up to
  // the source's seven) -- composed per-iteration, so these IDs must NOT
  // appear in `koreanText` (a koreanText entry would override this and repeat
  // the first-item wording forever).
  if (promptItem.id === "tbct-s07-n04-p02-disadvantages-first") {
    const count = listCount(fields.disadvantages);
    if (count === 0) {
      return isKorean
        ? "먼저 단점부터 하나씩 들어볼게요. 그 행동을 했을 때의 단점 중 첫 번째로 떠오르는 것은 무엇인가요?"
        : "We look at the downsides first, one at a time. What is the first downside of taking that action?";
    }
    return isKorean
      ? `지금까지 단점을 ${count}가지 말씀해 주셨어요. 또 있을까요? 최대 7가지까지 들어볼 수 있어요. 더 없으면 '없어요'라고 말씀해 주세요.`
      : `You've named ${count} downside${count === 1 ? "" : "s"} so far. Is there another? We can note up to seven — if nothing more comes to mind, just say "no more".`;
  }
  if (promptItem.id === "tbct-s07-n04-p03-advantages-second") {
    const count = listCount(fields.advantages);
    if (count === 0) {
      return isKorean
        ? "이번에는 장점을 하나씩 들어볼게요. 그 행동을 했을 때 좋은 점 중 첫 번째로 떠오르는 것은 무엇인가요?"
        : "Now the upsides, one at a time. What is the first upside of taking that action?";
    }
    return isKorean
      ? `지금까지 장점을 ${count}가지 말씀해 주셨어요. 또 있을까요? 최대 7가지까지 들어볼 수 있어요. 더 없으면 '없어요'라고 말씀해 주세요.`
      : `You've named ${count} upside${count === 1 ? "" : "s"} so far. Is there another? We can note up to seven — if nothing more comes to mind, just say "no more".`;
  }
  // Step 3's continuation: alternate the chairs (the allowed intervention set
  // is "direct them to speak to the chair / invite the other part to answer /
  // invite a switch") instead of a flat "Is there more?", and when a part
  // stops early, invite it to stay rather than closing the step.
  if (promptItem.id === "tbct-s07-n06-p03-continue-dialogue") {
    const speakers = Array.isArray(fields.emotionReasonSpeakers) ? (fields.emotionReasonSpeakers as string[]) : [];
    const nextIsEmotion = speakers[speakers.length - 1] === "reason";
    const stoppedEarly = fields.emotionReasonDialogueNoMore === true && listCount(fields.emotionReasonDialogue) < 3;
    const stayPrefix = stoppedEarly
      ? (isKorean ? "서두르지 않으셔도 돼요 — 조금만 더 이 대화에 머물러 볼게요. " : "There's no need to hurry — let's stay with this dialogue a little longer. ")
      : "";
    const move = nextIsEmotion
      ? (isKorean
        ? "다시 감정(Emotion) 의자로 옮겨 앉아 주세요. 감정으로서, 방금 이유(Reason)가 한 말에 직접 답해 주세요. 이유가 꼭 더 들었으면 하는 말이 있나요?"
        : "Please return to the Emotion chair. Speaking as Emotion, answer Reason directly — what more do you want Reason to hear?")
      : (isKorean
        ? "이제 이유(Reason) 의자로 옮겨 앉아 주세요. 이유로서, 방금 감정(Emotion)이 한 말에 직접 답해 주세요."
        : "Now please move to the Reason chair. Speaking as Reason, answer Emotion directly — what do you want to say back?");
    return `${stayPrefix}${move}`;
  }
  // Step 4 collects at least two learnings, one at a time.
  if (promptItem.id === "tbct-s07-n07-p02-consensus-learning") {
    const count = listCount(fields.consensusLearning);
    if (count === 0) {
      return isKorean
        ? "합의(Consensus) 의자에서, 양쪽 이야기를 다 들은 지금 무엇을 알게 되셨나요? 한 번에 하나씩, 적어도 두 가지를 들어볼게요."
        : "From the Consensus chair, having heard both parts, what did you learn? Let's gather at least two learnings, one at a time.";
    }
    return isKorean
      ? "하나 알게 되셨네요. 두 부분의 이야기에서 또 알게 된 것은 무엇인가요?"
      : "That's one learning. What is another thing you learned from hearing the two parts?";
  }
  // Every session's own "SAFETY PROTOCOL (MANDATORY)" section gives the same
  // clinical instruction (pause immediately, acknowledge with compassion,
  // direct to the therapist/a crisis line, don't resume until safety is
  // confirmed) with only the exercise name changing -- see s03's static
  // message file for the full rationale.
  if (promptItem.id === "tbct-s07-n12-p01-stop-crp") {
    return locale.toLowerCase().startsWith("ko")
      ? "지금 잠시 역할극을 멈출게요. 지금 괴롭거나 안전하지 않다고 느끼신다면, 이 활동을 계속하는 것보다 치료사나 위기상담 전화에 바로 연락하는 게 더 중요해요. 안전해지시면 우리 함께 다시 이어갈 수 있어요."
      : "Let's pause the role-play here for a moment. If you're feeling distressed or unsafe right now, please reach out to your therapist or a crisis line right away -- that matters more than continuing this exercise. We can pick this back up together once you're safe.";
  }
  // Composed per-participant, so it must NOT also live in `koreanText` --
  // resolvePromptLocaleText gives a koreanText entry precedence over anything
  // returned here, which would replace the real summary with a fixed line.
  if (promptItem.id === PLAN_SUMMARY_ID) return composeCrpPlanSummary(fields, locale);
  return APPROVED_TEXT[promptItem.id];
}

export const koreanText: Record<string, string> = {
  // See the same note in static-messages/s08.ts: without a Korean entry this
  // step degraded to the generic locale line in a live Korean session.
  // NOTE: disadvantages-first / advantages-second / continue-dialogue /
  // consensus-learning are deliberately ABSENT here -- they are composed
  // per-iteration in resolveStaticText above (a koreanText entry would take
  // precedence and freeze the loop on its first-item wording).
  "tbct-s07-n04-p01-action-in-own-words": "지금 마음에 두고 계신 그 행동을, 본인의 말로 한 문장으로 표현해 주시겠어요?",
  "tbct-s07-n02-p03-live-avoidance-notice": "방금 잠시 말씀이 멈추신 것 같아요 — 무슨 일이 있었나요?",
  "tbct-s07-n09-p02-prepare-later": "지금은 아니더라도, 나중에 이 결정을 할 준비가 되도록 무언가 해 보고 싶으신가요?",
  "tbct-s07-n01-p01-crp-offer": "오늘은 중요하지만 어려운 결정을 합의적 역할극(Consensual Role-Play)을 통해 함께 다뤄보고 싶어요. 두려운 행동을 강요받지 않을 거예요; 중요한 건 무엇을 배우는가예요. 한번 해보시겠어요?",
  "tbct-s07-n01-p02-crp-consent": "'아직 준비가 안 됐다'는 것도 충분히 괜찮은 결과라는 걸 알고, 합의적 역할극을 계속 진행해 보시겠어요?",
  "tbct-s07-n01-p03-crp-worksheet-ready": "시작하기 전에 하나만요. 합의적 역할극(CRP) 워크시트가 대화 옆에 함께 표시되고, 진행하면서 자동으로 채워져요. 안내서에 있던 그 양식이에요. 지금 화면에서 보이시나요?",
  "tbct-s07-n02-p01-language-lock": "지금까지 사용하신 언어로 계속 진행할게요. 그리고 기법과 의자 역할의 이름은 계속 일관되게 사용할게요.",
  "tbct-s07-n02-p02-both-parts-healthy": "두 부분 모두 같은 자아의 건강한 기능이에요. 감정(Emotion)은 보호하고, 이유(Reason)는 판단해요. 둘 중 하나가 더 우월한 게 아니고, 목표는 한쪽이 다른 쪽을 이기는 게 아니에요.",
  "tbct-s07-n03-p01-ambivalence-normalization": "한쪽은 어떤 행동을 원하고 다른 한쪽은 피하고 싶어하는 건 자연스러운 일이에요. 결정을 강요하지 않고 양쪽 모두의 이야기를 들어볼게요. 이 이야기가 지금 본인 상황에 어떻게 와닿나요?",
  "tbct-s07-n05-p01-emotion-weight": "감정(Emotion) 의자에서, 단점 쪽에 몇 퍼센트의 무게를 두시겠어요? 남은 퍼센트는 장점 쪽으로 갈게요. 가늠이 어려우시면 60, 70, 80, 90, 100 중에서 골라 보셔도 좋아요.",
  "tbct-s07-n05-p02-reason-weight": "이유(Reason) 의자에서, 장점 쪽에 몇 퍼센트의 무게를 두시겠어요? 남은 퍼센트는 단점 쪽으로 갈게요. 마찬가지로 60, 70, 80, 90, 100 앵커를 사용하셔도 좋아요.",
  "tbct-s07-n06-p01-chair-arrangement": "의자 두 개를 마주 보게 놓을게요. 하나는 감정(Emotion) 의자, 다른 하나는 이유(Reason) 의자예요. 지금부터 두 부분은 저를 거치지 않고 서로에게 직접 이야기하게 됩니다. 의자 배치가 되셨고, 시작할 준비가 되셨을까요?",
  "tbct-s07-n06-p02-emotion-to-reason": "이제 감정(Emotion) 의자에 앉아 주세요. 감정으로서, 맞은편 이유(Reason) 의자를 향해 직접 이야기해 주세요. 이유가 꼭 들었으면 하는 말은 무엇인가요?",
  "tbct-s07-n07-p01-consensus-transition": "이제 감정 의자와 이유 의자에서 나와, 세 번째 의자인 합의(Consensus) 의자에 앉아 주세요. 양쪽의 이야기를 모두 듣고 있던 부분이에요.",
  "tbct-s07-n07-p03-consensus-surprise": "같은 합의(Consensus) 의자에서, 두 부분의 이야기 중 뜻밖이었던 점은 무엇인가요?",
  "tbct-s07-n07-p04-consensus-emotion-intent": "합의(Consensus) 의자에서 보시기에, 감정(Emotion)은 결국 무엇을 하려던 것 같나요?",
  "tbct-s07-n07-p05-consensus-parts-needs": "그리고 두 부분은 각각 무엇을 필요로 하는 것 같았나요?",
  "tbct-s07-n09-p03-green-only-scope": "계획을 세우기 전에 한 가지만 짚어 둘게요. 이 행동이 지난 회기에 정리하신 목록에서 초록색 쪽이라면 혼자 연습하셔도 괜찮아요. 노랑이나 빨강 쪽에 가깝다면 그 행동은 혼자가 아니라 치료사와 함께 하시는 게 원칙이에요. 어느 쪽이든 결정과 계획은 여기서 함께 세울 수 있어요.",
  "tbct-s07-n08-p01-consensus-weights": "합의(Consensus) 의자에서, 양쪽 이야기를 다 들은 후 장점과 단점에 최종적으로 몇 퍼센트씩 부여하시겠어요? 두 값의 합이 100이 되게요. 앞서와 같은 60, 70, 80, 90, 100 앵커를 사용하셔도 좋아요.",
  "tbct-s07-n09-p01-readiness-decision": "양쪽 이야기를 들은 후, 지금 이 순간의 결정은 무엇인가요: 준비됨, 아니면 아직 준비 안 됨? 어느 쪽이든 괜찮고, 아직 확실하지 않다면 지금은 '아직 준비 안 됨'으로 두면 돼요.",
  "tbct-s07-n10-p01-proposed-actions": "그 결정에 맞는 작은 행동이 있다면 무엇일까요?",
  "tbct-s07-n10-p02-possible-obstacles": "그 행동을 어렵게 만들 수 있는 장애물은 무엇일까요?",
  "tbct-s07-n10-p03-obstacle-solutions": "그 장애물에 대응하는 데 도움이 될 만한 것은 무엇일까요?",
  "tbct-s07-n10-p04-implementation-plan": "언제, 어디서 이 행동을 시도해 보시겠어요?",
  "tbct-s07-n10-p05-support-people": "이 계획을 알고 있어 줄 사람은 누구일까요? 계획을 미리 말해 두거나, 시도할 때 곁에 있어 줄 수 있는 사람이 있나요?",
  "tbct-s07-n10-p06-follow-up": "그 행동이 바라던 대로 되었는지 어떻게 알 수 있을까요? 언제 확인해 보시겠어요?",
};
