import type { PromptItem } from "@/lib/protocol/source-fidelity-types";
import { firstText } from "@/lib/runtime/static-messages/field-helpers";

const APPROVED_TEXT: Record<string, string> = {
  "tbct-s08-n14-p04-participant-verdict": "After considering all four blocks, what verdict does the jury reach: guilty or not guilty? The verdict is yours to state.",
  "tbct-s08-n19-p02-daily-appeal-homework": "For daily appeal practice, record one piece of evidence each day that supports the more balanced or positive belief.",
  // Had no approved English text, so the marker fallback spoke the authoring
  // instruction itself at the participant -- "Positive belief must come from
  // the participant, how much you believe that?" -- which is both internal
  // wording and the wrong question (a rating instead of the belief).
  "tbct-s08-n18-p01-participant-positive-belief": "Now that the trial is done, put it into a few plain words of your own: what is the more balanced belief that takes the place of the original charge?",
  // Wise and kind, per the source's own description of the defense figure --
  // the imagery step used to describe no manner at all in English.
  "tbct-s08-n07-p02-visualize-defense": "Now picture the person who will defend you in the opposite chair — someone wise and kind, though again not anyone you actually know. Are they a man or a woman? How old are they, what do they look like, and how do they carry themselves?",
  // Key Principle 2 of this session requires every role change to be slow and
  // explicit, naming the role being left AND the role being entered. Without
  // approved text these all fell through to one generic line ("Let's move
  // into that role now"), which names neither -- so the participant was asked
  // to speak as a role nobody had told them they were now in.
  "tbct-s08-n06-p01-enter-prosecutor-role": "Please step out of the defendant's chair now and move into the prosecutor's chair. Speak of the defendant in the third person from here. Take your time, and tell me when you are ready.",
  "tbct-s08-n08-p01-enter-defense-role": "Please leave the defendant's chair and move into the defense attorney's chair. As the defense, speak about the defendant in the third person. Let me know when you are ready.",
  "tbct-s08-n10-p01-return-to-prosecutor": "Please leave the defendant's chair and return to the prosecutor's chair. Again, speak of the defendant in the third person. Tell me when you are ready.",
  "tbct-s08-n12-p01-return-to-defense": "Please leave the prosecutor's chair and return to the defense attorney's chair. Speak of the defendant in the third person. Tell me when you are ready.",
  // The participant guide names both facts about this room: the guide sits
  // with them as the second juror, and it is a space no one else may enter.
  "tbct-s08-n14-p01-enter-jury-role": "Please leave the defense chair and take the jury's seat — I will sit beside you as the second juror. This jury room is private: no one else may come in, not the prosecutor, not the defense, not the judge, not even the defendant. Speak of the defendant in the third person. Tell me when you are ready.",
  "tbct-s08-n15-p01-announce-verdict": "Now please leave the jury seat and stand as the court officer, facing the judge, to formally announce the verdict the jury reached. Please say it aloud in full.",
  "tbct-s08-n16-p01-post-verdict-defendant": "Please step out of the court officer's position and return to the defendant's chair, now that the verdict has been announced. Tell me when you are settled there.",
  // These had no approved text, so the generated fallback spoke either a
  // field name back at the participant ("how would you rate both defendant
  // post verdict belief percentage and ...") or a fragment of the therapist's
  // own instruction ("unable to find a rebuttal — what is one specific
  // example that comes to mind?", "How much they believe?"). Same wording is
  // now given in both languages. (The evidence-collection prompts themselves
  // are composed per-iteration in resolveStaticText below.)
  "tbct-s08-n08-p03-concrete-defense-evidence": "Could you make that concrete? What is one specific occasion that shows it?",
  "tbct-s08-n11-p02-unrebutted-defense-note": "The prosecution could not answer one of the defense's points. Which piece of defense evidence was left standing?",
  "tbct-s08-n16-p02-post-verdict-ratings": "Now that the verdict has been announced, from 0 to 100%: how much do you believe the charge, and how intense is the emotion?",
  "tbct-s08-n20-p01-positive-belief-rating": "From 0 to 100%, how much do you believe the positive belief you wrote at the top of the record?",
  "tbct-s08-n21-p01-original-charge-final-ratings": "Looking back at the original charge one last time, from 0 to 100%: how much do you believe it now, and how intense is the emotion?",
};

/** Clips a quoted participant answer so a composed message cannot outgrow the
 * 600-character isPatientSafeFallbackText guard, which would replace the
 * ENTIRE message with the content-free generic locale line -- total loss of
 * the quote instead of a shortened one. The full answers always remain
 * available in their own runtime fields and on the worksheet. */
function clipQuote(text: string, max: number) {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1).trimEnd()}…` : trimmed;
}

/** Joins a growing evidence/rebuttal list into a read-back the participant can
 * recognize as their own words. The source requires reading the pieces back
 * one at a time before each defendant re-rating, so as many items as the
 * budget allows are quoted in order -- and when long answers overflow it, the
 * remainder is summarized (" 외 N건" / " and N more") rather than letting the
 * whole message trip the 600-character guard and vanish into the generic
 * line. A budgeted recap that names what was omitted is the least-bad
 * failure mode: each piece was already read back in full on the turn it was
 * collected. */
function readBackList(value: unknown, empty: string, isKorean: boolean, budget: number) {
  const items = Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : typeof value === "string" && value.trim() ? [value.trim()] : [];
  if (!items.length) return empty;
  const parts: string[] = [];
  let used = 0;
  for (const item of items) {
    // The per-item clip must respect the list budget too: the first item
    // always ships even over budget, so a fixed 100-char clip could push a
    // three-list message (Step 13) past the 600-char guard on its own.
    const quoted = `(${parts.length + 1}) “${clipQuote(item, Math.min(100, budget))}”`;
    const cost = (parts.length ? 2 : 0) + quoted.length;
    // The first item always ships, clipped, even when it alone exceeds the
    // budget -- an empty read-back would defeat the step.
    if (parts.length && used + cost > budget) break;
    parts.push(quoted);
    used += cost;
  }
  const omitted = items.length - parts.length;
  const suffix = omitted > 0 ? (isKorean ? ` 외 ${omitted}건` : ` and ${omitted} more`) : "";
  return parts.join(", ") + suffix;
}

/** The string entries of a list field, in order. */
function stringItems(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function listCount(value: unknown) {
  return stringItems(value).length;
}

const PAIRED_RATING_QUESTION = {
  en: "As the defendant, from 0 to 100%: how much do you believe the charge now, and how intense is the emotion?",
  ko: "피고인으로서, 0에서 100% 사이로 답해 주세요: 지금 그 혐의를 얼마나 믿으시나요, 그리고 감정의 강도는 어느 정도인가요?",
};

/** The four defendant re-ratings (Steps 7, 9, 11, 13). Each is required by the
 * source to be preceded by reading the just-finished argument back to the
 * defendant; without that read-back they were delivered as a bare
 * double-rating question, so the participant re-rated without hearing what
 * they were re-rating against. */
const DEFENDANT_READBACKS: Record<string, (fields: Record<string, unknown>, isKorean: boolean) => string> = {
  "tbct-s08-n07-p01-return-to-defendant": (fields, isKorean) => {
    const evidence = readBackList(fields.prosecutionEvidence, isKorean ? "검사 측이 제시한 내용" : "what the prosecution presented", isKorean, 185);
    return isKorean
      ? `이제 검사 의자에서 나와 피고인 의자로 돌아와 주세요. 검사 측 주장을 그대로 다시 읽어 드릴게요 — ${evidence}. ${PAIRED_RATING_QUESTION.ko}`
      : `Please leave the prosecutor's chair and return to the defendant's chair. I will read back what the prosecution said — ${evidence}. ${PAIRED_RATING_QUESTION.en}`;
  },
  "tbct-s08-n09-p01-return-to-defendant": (fields, isKorean) => {
    const evidence = readBackList(fields.defenseEvidence, isKorean ? "변호 측이 제시한 내용" : "what the defense presented", isKorean, 185);
    return isKorean
      ? `이제 변호인 의자에서 나와 피고인 의자로 돌아와 주세요. 변호 측 주장을 그대로 다시 읽어 드릴게요 — ${evidence}. ${PAIRED_RATING_QUESTION.ko}`
      : `Please leave the defense attorney's chair and return to the defendant's chair. I will read back what the defense said — ${evidence}. ${PAIRED_RATING_QUESTION.en}`;
  },
  "tbct-s08-n11-p01-return-to-defendant": (fields, isKorean) => {
    const rebuttals = readBackList(fields.prosecutionRebuttals, isKorean ? "검사 측 반박" : "the prosecution's rebuttals", isKorean, 140);
    const unrebutted = firstText(fields.unrebuttedDefenseEvidence);
    const unrebuttedClause = unrebutted
      ? isKorean ? ` 검사 측이 반박하지 못한 부분도 있었어요 — “${clipQuote(unrebutted, 80)}”.` : ` The prosecution could not rebut one point — “${clipQuote(unrebutted, 80)}”.`
      : "";
    return isKorean
      ? `이제 검사 의자에서 나와 피고인 의자로 돌아와 주세요. 검사 측 반박을 하나씩 다시 읽어 드릴게요 — ${rebuttals}.${unrebuttedClause} ${PAIRED_RATING_QUESTION.ko}`
      : `Please leave the prosecutor's chair and return to the defendant's chair. I will read the prosecution's rebuttals back one at a time — ${rebuttals}.${unrebuttedClause} ${PAIRED_RATING_QUESTION.en}`;
  },
  "tbct-s08-n13-p01-return-to-defendant": (fields, isKorean) => {
    const defense = readBackList(fields.defenseEvidence, isKorean ? "변호 측 증거" : "the defense evidence", isKorean, 80);
    const surrebuttals = readBackList(fields.defenseSurrebuttals, isKorean ? "변호 측 재반박" : "the defense's responses", isKorean, 80);
    const therefore = readBackList(fields.thereforeConclusions, isKorean ? "그래서 내린 결론" : "the conclusions you drew", isKorean, 80);
    return isKorean
      ? `이제 변호인 의자에서 나와 피고인 의자로 돌아와 주세요. 변호 측의 전체 주장을 다시 읽어 드릴게요 — 증거: ${defense}; 재반박: ${surrebuttals}; 결론: ${therefore}. ${PAIRED_RATING_QUESTION.ko}`
      : `Please leave the defense attorney's chair and return to the defendant's chair. I will read the full defense argument back — evidence: ${defense}; responses: ${surrebuttals}; conclusions: ${therefore}. ${PAIRED_RATING_QUESTION.en}`;
  },
};

export function resolveStaticText(promptItem: PromptItem, fields: Record<string, unknown>, locale: string): string | undefined {
  const isKorean = locale.toLowerCase().startsWith("ko");
  // Step 3's own source line (tbct-source-text.generated.ts:1584) states the
  // charge with an illustrative example -- 'For example: "The charge is: I
  // am a failure."' -- and the marker-extraction in source-fidelity-catalog
  // captured that example quote verbatim as this prompt's fallback/verbatim
  // text, so every participant heard the textbook example instead of the
  // core belief they themselves gave two steps earlier (downward-arrow's
  // coreBelief). The "charge" field also had no writer anywhere -- nothing
  // ever copied coreBelief into it -- so the worksheet's Defendant box
  // stayed empty even after this line was delivered. Build the real charge
  // from the participant's own coreBelief instead; runtime-execution-api.ts's
  // "copy_field" completion effect persists the same value into the charge
  // field once this turn is delivered.
  if (promptItem.id === "tbct-s08-n03-p02-state-charge") {
    const charge = firstText(fields.coreBelief);
    if (!charge) return undefined;
    // Clipped for the same reason as clipQuote everywhere else: an
    // over-length core belief would push this line past the 600-character
    // guard and the participant would never hear the charge at all. The
    // copy_field effect still records the full coreBelief into the charge
    // field regardless of what is spoken.
    // The participant's own core belief often already ends in a full stop, so
    // appending one produced 'The charge is: "I am not good enough.."'
    const quoted = clipQuote(charge, 400).replace(/[.。]+$/, "");
    return isKorean ? `이 법정에서 다뤄질 혐의는 이것입니다 — "${quoted}"` : `The charge is: "${quoted}."`;
  }
  // Every session's own "SAFETY PROTOCOL (MANDATORY)" section gives the same
  // clinical instruction (pause immediately, acknowledge with compassion,
  // direct to the therapist/a crisis line, don't resume until safety is
  // confirmed) with only the exercise name changing -- see s03's static
  // message file for the full rationale.
  if (promptItem.id === "tbct-s08-n22-p01-stop-trial") {
    return isKorean
      ? "지금 잠시 재판을 멈출게요. 지금 괴롭거나 안전하지 않다고 느끼신다면, 이 활동을 계속하는 것보다 치료사나 위기상담 전화에 바로 연락하는 게 더 중요해요. 안전해지시면 우리 함께 다시 이어갈 수 있어요."
      : "Let's pause the trial here for a moment. If you're feeling distressed or unsafe right now, please reach out to your therapist or a crisis line right away -- that matters more than continuing this exercise. We can pick this back up together once you're safe.";
  }
  const readBack = DEFENDANT_READBACKS[promptItem.id];
  if (readBack) return readBack(fields, isKorean);
  // Step 6/8/19 evidence collection: composed per-iteration so each turn asks
  // for exactly one NEXT piece and names the source's own limit (up to three,
  // exceptionally four; the appeal record takes two to three).
  if (promptItem.id === "tbct-s08-n06-p02-prosecution-evidence") {
    const count = listCount(fields.prosecutionEvidence);
    if (count === 0) {
      return isKorean
        ? "검사로서, 이 혐의를 뒷받침하는 증거를 한 번에 하나씩 제시해 주세요. 최근 일만이 아니라 피고인의 삶 전체에서 찾아도 됩니다. 첫 번째 증거는 무엇인가요?"
        : "As the prosecutor, present the evidence supporting this charge one piece at a time, drawing on the defendant's whole life. What is the first piece of evidence?";
    }
    return isKorean
      ? `지금까지 검사 측 증거를 ${count}개 들었어요. 다음 증거가 있나요? 최대 3개, 예외적으로 4개까지 제시할 수 있어요. 더 없으면 '없어요'라고 말씀해 주세요.`
      : `The court has heard ${count} piece${count === 1 ? "" : "s"} of prosecution evidence. Is there another? Up to three — exceptionally four — may be presented. If there is nothing more, say "no more".`;
  }
  if (promptItem.id === "tbct-s08-n08-p02-defense-evidence") {
    const count = listCount(fields.defenseEvidence);
    if (count === 0) {
      return isKorean
        ? "변호인으로서, 이 혐의에 반대되는 증거를 한 번에 하나씩 제시해 주세요. 구체적인 실제 사례일수록 좋아요. 첫 번째 증거는 무엇인가요?"
        : "As the defense attorney, present the evidence against this charge one piece at a time — concrete, specific occasions are strongest. What is the first piece?";
    }
    return isKorean
      ? `지금까지 변호 측 증거를 ${count}개 들었어요. 다음 증거가 있나요? 최대 3개, 예외적으로 4개까지 제시할 수 있어요. 더 없으면 '없어요'라고 말씀해 주세요.`
      : `The court has heard ${count} piece${count === 1 ? "" : "s"} of defense evidence. Is there another? Up to three — exceptionally four — may be presented. If there is nothing more, say "no more".`;
  }
  if (promptItem.id === "tbct-s08-n19-p01-appeal-evidence") {
    const count = listCount(fields.appealEvidence);
    if (count === 0) {
      return isKorean
        ? "그 새로운 믿음을 뒷받침하는 증거를 하나씩 말씀해 주세요. 최소 두 가지가 필요하고, 세 가지까지 적을 수 있어요. 첫 번째는 무엇인가요?"
        : "Now the appeal record: give evidence supporting that new belief, one piece at a time. It needs at least two, and can hold three. What is the first?";
    }
    return isKorean
      ? `항소 기록에 ${count}가지를 적었어요. 하나 더 있을까요? 세 가지까지 적을 수 있어요.`
      : `The appeal record holds ${count} piece${count === 1 ? "" : "s"} so far. Is there another? It can hold up to three.`;
  }
  // Step 10: one rebuttal PER defense item -- each iteration quotes the next
  // unrebutted item and asks for an emphasized "BUT..." answer to that item
  // alone, never the grouped list.
  if (promptItem.id === "tbct-s08-n10-p02-rebut-each-defense-item") {
    const defense = stringItems(fields.defenseEvidence ?? fields.evidenceAgainst);
    const done = listCount(fields.prosecutionRebuttals);
    const index = Math.min(done, Math.max(defense.length - 1, 0));
    const evidence = clipQuote(defense[index] ?? (isKorean ? "변호 측이 제시한 증거" : "the defense evidence you gave"), 140);
    return isKorean
      ? `변호 측의 ${index + 1}번째 주장은 이랬어요: “${evidence}” 검사로서 이 주장 하나에만, “하지만(BUT)…”으로 시작해 반박해 주세요. 반박할 수 없다면 '반박할 수 없어요'라고 말씀해 주세요.`
      : `The defense's point ${index + 1} was: “${evidence}” As the prosecutor, answer this one point only, beginning with “BUT…”. If you cannot rebut it, say "cannot rebut".`;
  }
  // Step 12a: one surrebuttal PER rebuttal -- each iteration reads the pair
  // back (the defense's own evidence and the prosecution's rebuttal of it).
  if (promptItem.id === "tbct-s08-n12-p02-surrebut-each-pair") {
    const defense = stringItems(fields.defenseEvidence ?? fields.evidenceAgainst);
    const rebuttals = stringItems(fields.prosecutionRebuttals);
    const done = listCount(fields.defenseSurrebuttals);
    const index = Math.min(done, Math.max(rebuttals.length - 1, 0));
    const rebuttal = clipQuote(rebuttals[index] ?? (isKorean ? "검사 측 반박" : "the prosecution's rebuttal"), 120);
    const evidence = clipQuote(defense[Math.min(index, Math.max(defense.length - 1, 0))] ?? (isKorean ? "변호 측 증거" : "the defense evidence"), 100);
    return isKorean
      ? `변호 측 증거는 이랬어요: “${evidence}” 이에 대한 검사 측 반박은 이랬어요: “${rebuttal}” 변호인으로서 이 반박 하나에 “하지만…”으로 답해 주세요 — 이 증거는 피고인에 대해 실제로 무엇을 말해 주나요?`
      : `The defense's evidence was: “${evidence}” The prosecution's rebuttal of it was: “${rebuttal}” As the defense, answer this one rebuttal beginning with “BUT…” — what does that evidence really say about the defendant?`;
  }
  // Step 12b: each surrebutted pair receives its own participant-completed
  // "Therefore..." conclusion.
  if (promptItem.id === "tbct-s08-n12-p03-participant-therefore") {
    const surrebuttals = stringItems(fields.defenseSurrebuttals);
    const done = listCount(fields.thereforeConclusions);
    const index = Math.min(done, Math.max(surrebuttals.length - 1, 0));
    const answer = clipQuote(surrebuttals[index] ?? (isKorean ? "변호 측의 답변" : "the defense's answer"), 140);
    return isKorean
      ? `방금 변호 측이 내놓은 이 답변을 두고 — “${answer}” — “그러므로…”로 시작하는 결론을 직접 완성해 주세요. 이것은 피고인에 대해 무엇을 의미하나요?`
      : `Take this answer the defense gave — “${answer}” — and complete its conclusion yourself, beginning with “Therefore…”. What does it mean about the defendant?`;
  }
  // Composed per-participant, so this ID must NOT also appear in `koreanText`:
  // resolvePromptLocaleText gives a koreanText entry precedence over anything
  // returned here, which used to replace the personalized block-by-block
  // review with one fixed line for every Korean session.
  //
  // The source assigns each block its own jury question: the prosecution's
  // blocks (1 and 3) are examined for cognitive distortions -- and, even
  // where factually true, for whether they are relevant enough to convict --
  // while the defense's blocks (2 and 4) are checked for being factual and
  // true, with the surrebuttals presented in their answer-then-conclusion
  // form. One generic "what stands out?" asked four times did none of that.
  if (promptItem.id === "tbct-s08-n14-p03-review-four-blocks") {
    const reviewed = listCount(fields.juryReview);
    const blockIndex = Math.min(reviewed, 3);
    // Budgets are sized per block against the 600-character delivery guard so
    // the jury actually HEARS every piece in the block it is examining. At
    // the old flat 140 a four-piece block was read back as one piece "and 3
    // more", so the jury was asked to weigh evidence it had never been read
    // -- the opposite of going through every piece one at a time.
    if (blockIndex === 0) {
      const detail = readBackList(fields.prosecutionEvidence, isKorean ? "검사 측이 제시한 증거" : "what the prosecution presented", isKorean, 300);
      return isKorean
        ? `배심원으로서 검사 측 증거만 따로 검토해 주세요 — ${detail}. 여기에 흑백논리, 과잉일반화, 재앙화 같은 인지왜곡이 보이나요? 사실인 내용이 있더라도, 유죄 평결을 내리기에 충분히 관련이 있나요?`
        : `As jurors, examine the prosecution's evidence on its own — ${detail}. Do you see any cognitive distortions in it, such as all-or-nothing thinking, overgeneralization, or catastrophizing? Even where something is factually true, is it relevant enough to convict?`;
    }
    if (blockIndex === 1) {
      const detail = readBackList(fields.defenseEvidence, isKorean ? "변호 측이 제시한 증거" : "what the defense presented", isKorean, 430);
      return isKorean
        ? `이번에는 변호 측 증거만 따로 검토해 주세요 — ${detail}. 이 내용들은 사실이고 진실인가요?`
        : `Now examine the defense's evidence on its own — ${detail}. Are these factual and true?`;
    }
    if (blockIndex === 2) {
      const detail = readBackList(fields.prosecutionRebuttals, isKorean ? "검사 측 반박" : "the prosecution's rebuttals", isKorean, 400);
      return isKorean
        ? `이번에는 검사 측 반박만 검토해 주세요 — ${detail}. 여기에도 인지왜곡이 보이나요? 이 반박들이 유죄 평결을 뒷받침할 만큼 관련이 있나요?`
        : `Now the prosecution's rebuttals — ${detail}. Do you see cognitive distortions here too, and are these rebuttals relevant enough to support a conviction?`;
    }
    const answers = readBackList(fields.defenseSurrebuttals, isKorean ? "변호 측 재반박" : "the defense's responses", isKorean, 235);
    const conclusions = readBackList(fields.thereforeConclusions, isKorean ? "그래서 내린 결론" : "the conclusions drawn", isKorean, 185);
    return isKorean
      ? `마지막으로 변호 측 재반박을 답변→결론의 흐름으로 살펴봐 주세요 — 답변: ${answers}; 결론: ${conclusions}. 이 내용들은 사실이고 진실인가요?`
      : `Finally, the defense's responses in their full form — the answers: ${answers}; and the conclusions drawn: ${conclusions}. Are these factual and true?`;
  }
  if (promptItem.id === "tbct-s08-n21-p02-trial-closing") {
    return composeTrialClosingSummary(fields, locale);
  }
  return APPROVED_TEXT[promptItem.id];
}

/**
 * Step 21 closes by comparing the final ratings with the baseline "warmly"
 * (the source's own instruction) -- an acknowledgment of having seen the
 * trial through, not a verdict on the person. Exported so
 * runtime-execution-api.ts can persist the identical string into
 * `trialClosingSummary` when the closing prompt completes on delivery --
 * the spoken comparison and the stored one cannot drift (same pattern as
 * S07's composeCrpPlanSummary).
 */
export function composeTrialClosingSummary(fields: Record<string, unknown>, locale: string) {
  const isKorean = locale.toLowerCase().startsWith("ko");
  const pct = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? `${value}%` : isKorean ? "기록 없음" : "not recorded");
  const baselineBelief = pct(fields.coreBeliefBaselinePercent);
  const baselineEmotion = pct(fields.baselineEmotionIntensityPercent);
  const finalBelief = pct(fields.originalChargeFinalBeliefPercent);
  const finalEmotion = pct(fields.originalChargeFinalEmotionIntensityPercent);
  return isKorean
    ? `재판을 시작할 때 혐의에 대한 믿음은 ${baselineBelief}, 감정의 강도는 ${baselineEmotion}였어요. 재판을 모두 마친 지금은 각각 ${finalBelief}, ${finalEmotion}예요. 숫자가 어떻든, 오늘 피고인·검사·변호인·배심원의 자리를 모두 지나며 이 재판을 끝까지 함께해 주셨어요. 항소 기록은 매일 하나씩 계속 쌓아 가실 수 있어요.`
    : `When the trial began, your belief in the charge stood at ${baselineBelief} and the emotion's intensity at ${baselineEmotion}. Now, with the trial complete, they stand at ${finalBelief} and ${finalEmotion}. Whatever the numbers say, you moved through every chair in this courtroom — defendant, prosecutor, defense, and jury — and saw the trial through. The appeal record is yours to keep building, one piece each day.`;
}

export const koreanText: Record<string, string> = {
  // Confirmed against a live Korean run: with no Korean entry, these steps
  // fell through resolveLocaleFallbackPatientText's locale check (their
  // source text is English-only) to the generic "천천히 생각해 보셔도 괜찮습니다"
  // line -- so whenever the dialogue agent did not rescue the turn, the
  // participant was asked nothing at all. S08's opening question was one of
  // them.
  // NOTE: prosecution-evidence / defense-evidence / appeal-evidence /
  // participant-therefore are deliberately ABSENT here -- they are composed
  // per-iteration in resolveStaticText above (a koreanText entry would take
  // precedence and freeze each loop on its first-item wording).
  "tbct-s08-n01-p01-trial-materials-ready": "시작하기 전에 하나만 확인할게요. Trial One 워크시트와 '항소 준비(Preparation for the Appeal)' 기록지가 대화 옆에 함께 표시되고, 진행하면서 채워집니다. 안내서에 있던 그 양식들이에요. 지금 화면에서 보이시나요?",
  "tbct-s08-n01-p02-belief-as-charge-orientation": "본격적으로 시작하기 전에, 오늘 방법의 바탕이 되는 생각을 짧게 말씀드릴게요. 자기 자신에 대한 가혹한 믿음은 사실 오래 지고 다닌 '고발장'과 비슷해요 — 한 번도 답변할 기회를 얻지 못한 채로요. 우리는 보통 '나는 부족한 사람이다' 같은 말을 검토할 수 있는 주장이 아니라 그냥 사실처럼 받아들이거든요. 오늘 하는 일은 그 믿음을 실제 법정만큼 공정하게 한 번 제대로 검토해 보는 거예요.",
  "tbct-s08-n01-p03-orientation-reaction": "이 이야기가 어떻게 들리시나요?",
  "tbct-s08-n01-p04-distressing-situation": "힘들었던 상황과 그때 떠오른 자동적 사고를 하나 떠올려 주세요. 실제로 무슨 일이 있었고, 어떤 생각이 스쳐 지나갔나요?",
  "tbct-s08-n01-p05-downward-arrow": "그 생각이 사실이라면, 그것은 본인에 대해 무엇을 의미하나요?",
  "tbct-s08-n18-p01-participant-positive-belief": "이 재판을 거친 지금, 원래의 혐의를 대신할 만한 더 균형 잡힌 믿음을 본인의 말로 표현한다면 무엇일까요?",
  "tbct-s08-n03-p01-roles-orientation": "지금부터 마음속의 핵심 믿음 하나를 상징적인 법정에서 함께 살펴볼 거예요. 제가 진행을 안내하는 동안, 피고인 · 검사 · 변호인 · 배심원의 자리를 차례로 옮겨 가며 이야기하시게 됩니다. 잠시 후 이 법정에서 다룰 혐의를 말씀드릴게요.",
  "tbct-s08-n02-p01-core-belief-rating": "0에서 100% 사이로, 지금 이 핵심 믿음을 얼마나 믿고 계신가요?",
  "tbct-s08-n02-p02-baseline-emotion": "이 혐의를 믿을 때 어떤 감정이 드시나요?",
  "tbct-s08-n02-p03-baseline-emotion-rating": "0에서 100% 사이로, 지금 그 감정의 강도는 어느 정도인가요?",
  "tbct-s08-n04-p02-defendant-pre-prosecution-ratings": "피고인으로서 두 가지를 0에서 100% 사이로 답해 주세요: 그 혐의를 얼마나 믿으시는지, 그리고 감정의 강도는 어느 정도인지요.",
  "tbct-s08-n05-p01-visualize-prosecutor": "당신을 고발할 사람을 떠올려 보세요. 남성인가요, 여성인가요? 어떤 모습인가요? 자세히 묘사해 주세요. 가까운 가족이나 친구는 피해 주세요.",
  "tbct-s08-n07-p02-visualize-defense": "이번에는 맞은편 의자에 당신을 변호해 줄 사람을 떠올려 보세요. 지혜롭고 따뜻한 사람이면 좋겠어요. 다만 이번에도 실제로 아는 사람은 피해 주세요. 남성인가요, 여성인가요? 나이는 어느 정도이고, 어떤 모습이며, 어떤 태도로 서 있나요?",
  "tbct-s08-n08-p03-concrete-defense-evidence": "조금 더 구체적으로 말씀해 주시겠어요? 그것을 보여 주는 실제 사례 하나는 무엇인가요?",
  "tbct-s08-n11-p02-unrebutted-defense-note": "검사 측이 변호 측 주장 하나에는 답하지 못했어요. 반박되지 않고 남은 변호 측 증거는 무엇인가요?",
  "tbct-s08-n14-p05-guilty-verdict-recheck": "판결을 선고하기 전에, 변호 측 증거와 검사 측 주장에 대한 변호 측의 답변을 한 번 더 살펴봐 주세요. 네 가지를 모두 다시 고려했을 때, 여전히 유죄인가요, 아니면 판결이 달라지나요?",
  "tbct-s08-n16-p02-post-verdict-ratings": "판결이 선고된 지금, 0에서 100% 사이로 답해 주세요: 그 혐의를 얼마나 믿으시나요, 그리고 감정의 강도는 어느 정도인가요?",
  "tbct-s08-n20-p01-positive-belief-rating": "0에서 100% 사이로, 기록 맨 위에 적으신 그 긍정적 믿음을 얼마나 믿고 계신가요?",
  "tbct-s08-n21-p01-original-charge-final-ratings": "마지막으로 처음의 혐의를 다시 돌아볼게요. 0에서 100% 사이로: 지금은 그것을 얼마나 믿으시나요, 그리고 감정의 강도는 어느 정도인가요?",
  "tbct-s08-n04-p01-enter-defendant-role": "이제 피고인 의자로 옮겨 앉아 주세요. 잠시 그 자리에 자리 잡으신 뒤에 이어가겠습니다.",
  "tbct-s08-n06-p01-enter-prosecutor-role": "이제 피고인 의자에서 나와 검사 의자로 옮겨 앉아 주세요. 여기서부터는 피고인을 3인칭으로 지칭해 주세요. 천천히 하셔도 되고, 준비되시면 말씀해 주세요.",
  "tbct-s08-n08-p01-enter-defense-role": "이제 피고인 의자에서 나와 변호인 의자로 옮겨 앉아 주세요. 변호인으로서 피고인을 3인칭으로 지칭해 주세요. 준비되시면 알려 주세요.",
  "tbct-s08-n10-p01-return-to-prosecutor": "이제 피고인 의자에서 나와 다시 검사 의자로 돌아와 주세요. 여기서도 피고인을 3인칭으로 지칭해 주세요. 준비되시면 말씀해 주세요.",
  "tbct-s08-n12-p01-return-to-defense": "이제 검사 의자에서 나와 다시 변호인 의자로 돌아와 주세요. 피고인을 3인칭으로 지칭해 주세요. 준비되시면 말씀해 주세요.",
  "tbct-s08-n14-p01-enter-jury-role": "이제 변호인 의자에서 나와 배심원석에 앉아 주세요. 저는 두 번째 배심원으로 옆에 함께 앉을게요. 이 배심원실은 비공개예요. 검사도, 변호인도, 판사도, 심지어 피고인도 이곳에 들어올 수 없습니다. 피고인을 3인칭으로 지칭해 주세요. 준비되시면 말씀해 주세요.",
  "tbct-s08-n14-p02-juror-role": "배심원의 역할은 무엇이라고 생각하시나요?",
  "tbct-s08-n14-p04-participant-verdict": "네 가지를 모두 고려한 후, 배심원의 판결은 무엇인가요: 유죄 또는 무죄? 판결은 본인이 내리는 거예요.",
  "tbct-s08-n15-p01-announce-verdict": "이제 배심원석에서 나와 법정 담당관으로서 판사를 향해 서 주세요. 배심원단이 내린 판결을 공식적으로 선고해 주세요. 소리 내어 온전히 말씀해 주세요.",
  "tbct-s08-n16-p01-post-verdict-defendant": "이제 법정 담당관 자리에서 나와, 판결이 선고된 상태로 피고인 의자에 돌아와 주세요. 자리에 앉으시면 말씀해 주세요.",
  // Step 17's discussion questions come from a bulleted list in the source,
  // so they were both English-only and (before the catalog's bullet strip)
  // prefixed with the raw list glyph.
  "tbct-s08-n17-p01-trial-experience": "이 재판을 직접 겪어 보니 어떠셨나요?",
  "tbct-s08-n17-p02-prosecution-satisfaction": "검사 측은 자기 주장에 만족했을까요?",
  "tbct-s08-n17-p03-defense-demonstration": "변호 측은 무엇을 보여 주고 싶어 했을까요?",
  "tbct-s08-n17-p04-preferred-ally": "당신 편에 서 줄 사람으로 누구를 더 원하시나요?",
  "tbct-s08-n17-p05-good-defense": "좋은 변호인은 어떤 일을 한다고 생각하시나요?",
  "tbct-s08-n17-p06-what-defines-person": "한 사람을 정의하는 것은 무엇이라고 생각하시나요?",
  "tbct-s08-n17-p07-upward-arrow": "변호 측과 배심원이 옳다면, 그것은 당신에 대해 무엇을 말해 주나요?",
  "tbct-s08-n19-p02-daily-appeal-homework": "매일의 항소(appeal) 연습을 위해, 더 균형 잡히거나 긍정적인 믿음을 지지하는 증거를 하루에 하나씩 기록해 주세요.",
  "tbct-s08-n22-p01-stop-trial": "지금 잠시 재판을 멈출게요. 지금 괴롭거나 안전하지 않다고 느끼신다면, 이 활동을 계속하는 것보다 치료사나 위기상담 전화에 바로 연락하는 게 더 중요해요. 안전해지시면 우리 함께 다시 이어갈 수 있어요.",
};
