import type { PromptItem } from "@/lib/protocol/source-fidelity-types";

const APPROVED_TEXT: Record<string, string> = {
  "tbct-s05-n05-p02-new-contributor-next-round": "For the next round, is there another person, circumstance, or factor that contributed to what happened?",
  // Language Rules (tbct-source-text.generated.ts:922): "Never use the words
  // 'responsibility' or 'responsible' in the closing step -- use 'values'
  // instead." The technique's own name is also Participation Grid, not
  // "responsibility grid".
  "tbct-s05-n10-p01-participant-summary-table": "Let’s review the Participation Grid you created, including each contributor and the values you assigned.",
};

export function resolveStaticText(promptItem: PromptItem, fields: Record<string, unknown>, locale: string): string | undefined {
  const isKorean = locale.toLowerCase().startsWith("ko");
  // Every session's own "SAFETY PROTOCOL (MANDATORY)" section gives the same
  // clinical instruction (pause immediately, acknowledge with compassion,
  // direct to the therapist/a crisis line, don't resume until safety is
  // confirmed) with only the exercise name changing -- see s03's static
  // message file for the full rationale.
  if (promptItem.id === "tbct-s05-n11-p01-pause-grid") {
    return "Let's pause the Participation Grid here for a moment. If you're feeling distressed or unsafe right now, please reach out to your therapist or a crisis line right away -- that matters more than continuing this exercise. We can pick this back up together once you're safe.";
  }
  if (promptItem.id === "tbct-s05-n06-p01-updated-percentage") {
    // "Return to each contributor in order and ask for an updated
    // percentage" (tbct-source-text.generated.ts:854) -- repeated once per
    // contributor per round via repeat_until; currentParticipationContributorText
    // is recomputed each turn in runtime-context.ts as the round fills in.
    // Composed per-participant, so this ID must NOT also appear in `koreanText`:
    // a koreanText entry takes precedence over anything returned here
    // (resolvePromptLocaleText) and would replace the named contributor with one
    // fixed sentence for every Korean round. Same constraint as s08's composed
    // branches; the Korean wording is therefore built here.
    const contributor = fields.currentParticipationContributorText;
    if (typeof contributor !== "string" || !contributor) return undefined;
    return isKorean
      ? `지금까지 이야기 나눈 내용을 바탕으로, ${contributor}의 참여 비율은 몇 퍼센트라고 보시나요?`
      : `Now that we've talked it through, what would you say ${contributor}'s participation percentage is?`;
  }
  return APPROVED_TEXT[promptItem.id];
}

// Keys are position-derived (`tbct-s05-n{nodeIndex}-p{promptIndex}-{slug}`, see
// source-fidelity-catalog.ts), so reordering or inserting a node/prompt in
// sessions/s05.ts shifts every later ID and silently unmatches these entries.
//
// "tbct-s05-n06-p01-updated-percentage" is deliberately absent -- resolveStaticText
// composes it per contributor and a koreanText entry would override that.
export const koreanText: Record<string, string> = {
  // Step 1 -- baseline. These two are different registers (a cognitive belief
  // rating and an emotional intensity rating) asked back to back, so each has to
  // say which one it is; sharing one generic line makes the two baselines
  // indistinguishable to the participant.
  "tbct-s05-n01-p01-guilt-belief-baseline": "그 일에 대해 자신에게 책임이 있다는 생각을, 지금 얼마나 믿고 계신가요? 0에서 100% 사이의 숫자로 말씀해 주세요.",
  "tbct-s05-n01-p02-shame-intensity-baseline": "그 일을 떠올릴 때 느껴지는 감정의 크기는 어느 정도인가요? 0에서 100 사이의 숫자로 말씀해 주세요.",

  // Step 2 -- language substitution. Validated as a boolean, and the yes_no
  // contract carries no terminology or scale explanation to the model, so the
  // expected answer format has to be in the wording itself.
  "tbct-s05-n02-p01-participation-language": "앞으로는 '죄책감'이나 '잘못' 대신 '참여'라는 표현을 쓸게요. 누가 잘못했는지를 따지려는 것이 아니라, 각자가 그 일에 어떻게 관여했는지를 함께 살펴보려는 것입니다. 이렇게 진행해도 괜찮을까요? (예 / 아니요로 답해 주세요)",

  // Step 3 -- populate the grid. Everything downstream (deepening, percentages,
  // re-rating rounds, the summary table) is keyed off this list, so losing this
  // question invalidates the rest of the session.
  "tbct-s05-n03-p01-list-contributors": "그 일에 관련된 사람들을 모두 말씀해 주세요. 사람뿐 아니라 상황이나 조건도 포함될 수 있어요. 본인은 마지막에 다룰 테니, 먼저 다른 분들부터 떠올려 주시면 됩니다.",
  "tbct-s05-n03-p02-participant-last": "본인은 마지막에 살펴볼게요. 먼저 다른 분들의 참여부터 하나씩 짚어보겠습니다.",

  // Step 4 -- first round of percentages
  "tbct-s05-n04-p01-rate-other-contributors": "이제 각 기여자에게 참여 비율을 나눠 볼게요. 전체가 100%가 되도록 하고, 본인 몫은 마지막에 정하겠습니다.",
  "tbct-s05-n04-p02-participant-remainder": "다른 분들의 비율을 모두 더하고 남은 만큼이 본인의 참여 비율이 됩니다. 어떻게 보이시나요?",
  // Fires only when the participant rejects the computed remainder.
  "tbct-s05-n04-p03-guilt-distortion-check": "본인의 참여 비율을 떠올릴 때, 지금 어떤 생각이 함께 올라오나요?",

  // Step 5 -- Socratic deepening
  "tbct-s05-n05-p01-deepen-each-contributor": "다음 평가로 넘어가기 전에, 이 분이 그 일에서 어떤 역할을 했는지 조금 더 이야기해 주시겠어요? 그때 무엇을 알고 있었는지, 어떤 책임이 있었는지도 함께요.",
  "tbct-s05-n05-p02-new-contributor-next-round": "다음 라운드에서, 이 일에 관련된 다른 사람이나 상황, 요인이 더 있을까요?",

  // Step 6 -- re-rating rounds (p01 is composed in resolveStaticText, see above)
  "tbct-s05-n06-p02-reflect-without-interpretation": "지금은 어떻게 느껴지시나요?",

  // Step 7 -- guilt and shame re-rating
  "tbct-s05-n07-p01-guilt-belief-final": "지금은 그 생각을 얼마나 믿고 계신가요? 0에서 100% 사이의 숫자로 말씀해 주세요.",
  "tbct-s05-n07-p02-shame-intensity-final": "지금 느껴지는 그 감정의 크기는 어느 정도인가요? 0에서 100 사이의 숫자로 말씀해 주세요.",

  // Step 8 -- values. The source forbids "responsibility"/"responsible" in the
  // closing step, so this asks about what matters rather than about blame.
  "tbct-s05-n08-p01-values": "지금 이 시점에서, 당신에게 가장 중요한 것은 무엇인가요?",

  // Step 9 -- downward arrow on residual shame (conditional)
  "tbct-s05-n09-p01-residual-shame-meaning": "그 일을 떠올릴 때, 어떤 생각이 함께 올라오나요?",
  "tbct-s05-n09-p02-residual-shame-probe": "그것은 당신에 대해 무엇을 의미한다고 느껴지시나요?",

  "tbct-s05-n10-p01-participant-summary-table": "함께 만든 참여도 그리드(Participation Grid)를 살펴볼게요. 각 기여자와 부여하신 값들을 함께 확인해요.",
  "tbct-s05-n11-p01-pause-grid": "지금 잠시 참여도 그리드(Participation Grid)를 멈출게요. 지금 괴롭거나 안전하지 않다고 느끼신다면, 이 활동을 계속하는 것보다 치료사나 위기상담 전화에 바로 연락하는 게 더 중요해요. 안전해지시면 우리 함께 다시 이어갈 수 있어요.",
};
