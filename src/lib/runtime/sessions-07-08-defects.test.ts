import { describe, expect, it } from "vitest";
import { CANONICAL_PROMPT_ITEMS, CANONICAL_STAGE_NODES } from "@/lib/protocol/source-fidelity-catalog";
import { extractRuntimeState } from "@/lib/runtime/runtime-context";
import { matchEnumChoice, parseDeterministicPromptInput } from "@/lib/runtime/runtime-deterministic-input";
import { composeCrpPlanSummary, resolveStaticText as resolveS07StaticText } from "@/patient/sessions/s07/messages";
import { composeTrialClosingSummary, resolveStaticText as resolveS08StaticText } from "@/patient/sessions/s08/messages";
import { stepSpecificGuidanceFor } from "@/lib/dialogue-agent/dialogue-contract-compiler";
import { courtroomRoleNameForNode } from "@/lib/api/runtime-execution-api";
import { computeDefaultPathNodeIds, computeMissingFields } from "@/lib/runtime/testing/simulated-patient-runner";
import { defaultFallbackPatientText, isPatientSafeFallbackText, normalizeRuntimePromptItem, promptRequiresPatientInput, resolvePromptLocaleText } from "@/lib/runtime/runtime-release-normalizer";
import type { ClinicalStageNode, PromptItem } from "@/lib/protocol/source-fidelity-types";
import type { RuntimeContext } from "@/types/runtime-session";

const promptById = (id: string) => {
  const promptItem = CANONICAL_PROMPT_ITEMS.find((item) => item.id === id);
  if (!promptItem) throw new Error(`Unknown PromptItem ${id}`);
  return promptItem;
};

const emptyContext = (fields: Record<string, unknown> = {}): RuntimeContext => ({
  fields,
  iterationCounts: {},
} as unknown as RuntimeContext);

const nodeFor = (promptItem: PromptItem) => ({ id: promptItem.nodeId, requiredFields: promptItem.outputFields } as unknown as ClinicalStageNode);

describe("S07/S08 decision points accept the answer they ask for", () => {
  const readiness = () => promptById("tbct-s07-n09-p01-readiness-decision");
  const verdict = () => promptById("tbct-s08-n14-p04-participant-verdict");

  it("resolves natural and Korean phrasings to the canonical enum value", () => {
    const readinessValues = (readiness().validation as { values: string[]; aliases?: Record<string, string[]> });
    const verdictValues = (verdict().validation as { values: string[]; aliases?: Record<string, string[]> });
    // The exact strings a participant types or a transcript produces -- all
    // of which the old exact-match rejected, burning three clarification
    // attempts and pausing the session at the single most important turn.
    expect(matchEnumChoice("not ready", readinessValues.values, readinessValues.aliases)).toBe("not_ready");
    expect(matchEnumChoice("Not Ready", readinessValues.values, readinessValues.aliases)).toBe("not_ready");
    expect(matchEnumChoice("undecided", readinessValues.values, readinessValues.aliases)).toBe("not_ready");
    expect(matchEnumChoice("아직 준비 안 됐어요", readinessValues.values, readinessValues.aliases)).toBe("not_ready");
    expect(matchEnumChoice("준비됐어요", readinessValues.values, readinessValues.aliases)).toBe("ready");
    expect(matchEnumChoice("not guilty", verdictValues.values, verdictValues.aliases)).toBe("not_guilty");
    expect(matchEnumChoice("무죄", verdictValues.values, verdictValues.aliases)).toBe("not_guilty");
    expect(matchEnumChoice("유죄", verdictValues.values, verdictValues.aliases)).toBe("guilty");
    // Still rejects an answer the catalog does not define.
    expect(matchEnumChoice("maybe tomorrow", readinessValues.values, readinessValues.aliases)).toBeNull();
  });

  it("stores the canonical value so branch conditions keep matching", () => {
    const parsed = parseDeterministicPromptInput({ kind: "text", value: "not guilty" }, verdict().validation);
    expect(parsed).toMatchObject({ handled: true, valid: true, value: "not_guilty" });
  });

  it("offers exactly the choices the enum actually has, with no unacceptable or duplicate option", () => {
    const enumPrompts = CANONICAL_PROMPT_ITEMS.filter((promptItem) => (promptItem.validation as { kind?: string } | null)?.kind === "enum");
    expect(enumPrompts.length).toBeGreaterThan(0);
    let checked = 0;
    for (const promptItem of enumPrompts) {
      const validation = promptItem.validation as { values: string[]; aliases?: Record<string, string[]> };
      const spoken = [
        [resolveS07StaticText(promptItem, {}, "en-US"), "s07/en"],
        [resolveS07StaticText(promptItem, {}, "ko-KR"), "s07/ko"],
        [resolveS08StaticText(promptItem, {}, "en-US"), "s08/en"],
        [resolveS08StaticText(promptItem, {}, "ko-KR"), "s08/ko"],
      ].filter((entry): entry is [string, string] => Boolean(entry[0]));
      for (const [text, label] of spoken) {
        const offered = (text.split(":")[1]?.split("?")[0] ?? "").split(/,| or |아니면 /).map((part) => part.trim().replace(/\.$/, "")).filter(Boolean);
        if (offered.length < 2) continue;
        checked += 1;
        const resolved = offered.map((option) => matchEnumChoice(option, validation.values, validation.aliases));
        // Every option named must be answerable...
        expect(resolved, `${promptItem.id} (${label}) offers an option the enum cannot accept: ${JSON.stringify(offered)}`).not.toContain(null);
        // ...and no two options may collapse to the same value. The readiness
        // question used to present "ready, not ready, or undecided" as three
        // choices when Step 6 records only two outcomes -- a false choice.
        expect(new Set(resolved).size, `${promptItem.id} (${label}) offers ${offered.length} options for ${new Set(resolved).size} distinct values`).toBe(offered.length);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("S07 locks onto the participant's own language", () => {
  const extract = (promptItemId: string, patientInput: Parameters<typeof extractRuntimeState>[0]["patientInput"], locale: string) => {
    const promptItem = promptById(promptItemId);
    return extractRuntimeState({ patientInput, currentPromptItem: promptItem, currentNode: nodeFor(promptItem), currentContext: emptyContext(), locale });
  };

  it("falls back to the session locale when the answer is a button press", async () => {
    // crp-consent is a boolean, so its raw value is "true"/"false" -- script
    // detection on that always returned en-US and locked every Korean
    // session into English.
    const result = await extract("tbct-s07-n01-p02-crp-consent", { kind: "boolean", value: true }, "ko-KR");
    expect(result.fields.sessionLanguage).toBe("ko-KR");
    expect(result.fields.languageLocked).toBe(true);
  });

  it("detects the language from the first substantive message when there is one", async () => {
    const result = await extract("tbct-s07-n01-p01-crp-offer", { kind: "text", value: "네, 한번 해보고 싶어요." }, "en-US");
    expect(result.fields.sessionLanguage).toBe("ko-KR");
  });

  it("accepts a plain consent answer instead of treating it as filler", async () => {
    // "yes"/"네" are in NON_ANSWER_TEXT for ordinary questions, which sent a
    // participant who answered exactly what was asked into a clarification
    // loop on S07's very first turn.
    for (const value of ["yes", "네", "해볼게요"]) {
      const result = await extract("tbct-s07-n01-p01-crp-offer", { kind: "text", value }, "en-US");
      expect(result.missingFields, value).toEqual([]);
    }
  });

  it("keeps consent single-writer so the boolean cannot overwrite the participant's words", () => {
    expect(promptById("tbct-s07-n01-p01-crp-offer").outputFields).toEqual(["crpOfferResponse"]);
    expect(promptById("tbct-s07-n01-p02-crp-consent").outputFields).toEqual(["crpConsent"]);
  });
});

describe("S07 closing summarizes the plan it recorded", () => {
  const planFields = {
    proposedActions: "Send one short message to my brother",
    possibleObstacles: "I'll talk myself out of it by the evening",
    obstacleSolutions: "Write it in the morning before work",
    implementationPlan: "Saturday morning, at home",
    supportPeople: "My partner",
    followUpPlan: "Check back at our next session",
  };

  it("speaks the participant's own six action-plan fields", () => {
    const summary = resolveS07StaticText(promptById("tbct-s07-n11-p01-plan-summary"), planFields, "en-US");
    expect(summary).toBeDefined();
    for (const value of Object.values(planFields)) expect(summary).toContain(value);
    // The source closes by summarizing, not by praising or persuading.
    expect(summary).not.toMatch(/\b(?:great|well done|proud|amazing|you should)\b/i);
  });

  it("composes the identical string the runtime records into crpPlanSummary", () => {
    const spoken = resolveS07StaticText(promptById("tbct-s07-n11-p01-plan-summary"), planFields, "ko-KR");
    expect(spoken).toBe(composeCrpPlanSummary(planFields, "ko-KR"));
    expect(spoken).toMatch(/[가-힣]/);
  });
});

describe("S08 reads the argument back before each defendant re-rating", () => {
  const trialFields = {
    prosecutionEvidence: ["He missed the deadline in March"],
    defenseEvidence: ["He delivered every other project on time"],
    prosecutionRebuttals: ["But the March one was the important one"],
    defenseSurrebuttals: ["The March delay was caused by a supplier"],
    thereforeConclusions: ["Therefore one late project does not define him"],
  };

  it("quotes the just-finished argument at all four re-rating points", () => {
    const expectations: Array<[string, string]> = [
      ["tbct-s08-n07-p01-return-to-defendant", "He missed the deadline in March"],
      ["tbct-s08-n09-p01-return-to-defendant", "He delivered every other project on time"],
      ["tbct-s08-n11-p01-return-to-defendant", "But the March one was the important one"],
      ["tbct-s08-n13-p01-return-to-defendant", "The March delay was caused by a supplier"],
    ];
    for (const [promptItemId, quoted] of expectations) {
      const text = resolveS08StaticText(promptById(promptItemId), trialFields, "en-US");
      expect(text, promptItemId).toContain(quoted);
      expect(text, promptItemId).toMatch(/defendant/i);
    }
  });

  it("keeps the read-backs available in Korean", () => {
    const text = resolveS08StaticText(promptById("tbct-s08-n07-p01-return-to-defendant"), trialFields, "ko-KR");
    expect(text).toMatch(/[가-힣]/);
    expect(text).toContain("He missed the deadline in March");
  });
});

describe("S07/S08 role transitions name the role", () => {
  it("names the chair being entered on every role transition", () => {
    const roleTransitions = CANONICAL_PROMPT_ITEMS.filter((promptItem) => promptItem.type === "role_transition" && /^tbct-s0[78]-/.test(promptItem.id));
    expect(roleTransitions.length).toBeGreaterThan(10);
    for (const promptItem of roleTransitions) {
      const text = resolveS07StaticText(promptItem, {}, "en-US") ?? resolveS08StaticText(promptItem, {}, "en-US") ?? promptItem.fallbackPatientText ?? "";
      expect(text, promptItem.id).toMatch(/defendant|prosecutor|defense|jury|juror|court officer|Emotion|Reason|Consensus|chair/i);
      // The old generic fallback named no role at all.
      expect(text, promptItem.id).not.toBe("Let's move into that role now. Take a moment to settle there before we continue.");
    }
  });

  it("asks every S07/S08 question in Korean instead of the content-free generic line", () => {
    // Confirmed live: a prompt with no Korean entry and English-only source
    // text resolves to defaultFallbackPatientText("ko") -- "천천히 생각해
    // 보셔도 괜찮습니다..." -- which asks nothing. Whenever the dialogue agent
    // did not rescue the turn, the participant simply was not asked the
    // question. S08's opening was one of these.
    const generic = defaultFallbackPatientText("ko-KR");
    // Every prompt the participant actually hears, passive ones included -- a
    // spoken orientation that says nothing is no better than a question that
    // says nothing.
    const spokenPrompts = CANONICAL_PROMPT_ITEMS.filter((promptItem) => /^tbct-s0[78]-/.test(promptItem.id) && !promptItem.nodeId.endsWith("safety-pause"));
    expect(spokenPrompts.length).toBeGreaterThan(30);
    // Prompts composed from runtime fields (the charge, the read-backs) need
    // those fields present to resolve -- with an empty context they correctly
    // decline, which is not the defect under test.
    const midSessionFields: Record<string, unknown> = {
      coreBelief: "나는 부족한 사람이다",
      prosecutionEvidence: ["증거 1"],
      defenseEvidence: ["증거 2"],
      prosecutionRebuttals: ["반박 1"],
      defenseSurrebuttals: ["재반박 1"],
      thereforeConclusions: ["결론 1"],
      proposedActions: "행동",
      possibleObstacles: "장애물",
      obstacleSolutions: "대응",
      implementationPlan: "토요일",
      supportPeople: "가족",
      followUpPlan: "다음 상담",
    };
    const contentFree = spokenPrompts.filter((promptItem) => {
      const approved = resolveS07StaticText(promptItem, midSessionFields, "ko-KR") ?? resolveS08StaticText(promptItem, midSessionFields, "ko-KR");
      const text = resolvePromptLocaleText(promptItem.id, approved ?? promptItem.fallbackPatientText ?? promptItem.verbatimText, "ko-KR");
      return text === generic;
    });
    expect(contentFree.map((promptItem) => promptItem.id)).toEqual([]);
  });

  it("never ships a raw source list bullet to the patient", () => {
    for (const promptItem of CANONICAL_PROMPT_ITEMS) {
      expect(promptItem.verbatimText.trimStart(), promptItem.id).not.toMatch(/^[•▪◦‣·]/);
      expect((promptItem.fallbackPatientText ?? "").trimStart(), promptItem.id).not.toMatch(/^[•▪◦‣·]/);
    }
  });
});

describe("long participant answers survive the 600-char fallback guard", () => {
  // resolveLocaleFallbackPatientText replaces any text over 600 characters
  // with the content-free generic locale line. A composed message built from
  // the participant's own answers -- the read-backs, the four-block review,
  // the CRP plan summary -- scales with those answers, so long answers used
  // to evict the entire composed message at exactly the moments it carries
  // the most content.
  const longAnswer = (seed: string) => `${seed} ${"그날 회의에서 있었던 일을 아주 자세하게 설명하는 긴 문장입니다. ".repeat(9)}`.trim();
  const longFields: Record<string, unknown> = {
    coreBelief: longAnswer("결국 나는 부족한 사람이라는 뜻이에요."),
    prosecutionEvidence: [longAnswer("증거 하나."), longAnswer("증거 둘."), longAnswer("증거 셋."), longAnswer("증거 넷.")],
    defenseEvidence: [longAnswer("변호 하나."), longAnswer("변호 둘."), longAnswer("변호 셋."), longAnswer("변호 넷.")],
    prosecutionRebuttals: [longAnswer("반박 하나."), longAnswer("반박 둘."), longAnswer("반박 셋."), longAnswer("반박 넷.")],
    defenseSurrebuttals: [longAnswer("재반박 하나."), longAnswer("재반박 둘."), longAnswer("재반박 셋."), longAnswer("재반박 넷.")],
    thereforeConclusions: [longAnswer("그러므로 하나."), longAnswer("그러므로 둘."), longAnswer("그러므로 셋."), longAnswer("그러므로 넷.")],
    unrebuttedDefenseEvidence: longAnswer("반박되지 않은 증거."),
    juryReview: [],
    proposedActions: longAnswer("행동."),
    possibleObstacles: longAnswer("장애물."),
    obstacleSolutions: longAnswer("대응."),
    implementationPlan: longAnswer("토요일 오전."),
    supportPeople: longAnswer("남편."),
    followUpPlan: longAnswer("다음 상담."),
  };
  // The per-item prompts quote the NEXT item still to be answered, not
  // item #1 -- with four of each already recorded, that is the fourth.
  const targets: Array<[string, string]> = [
    ["tbct-s08-n07-p01-return-to-defendant", "증거 하나."],
    ["tbct-s08-n09-p01-return-to-defendant", "변호 하나."],
    ["tbct-s08-n11-p01-return-to-defendant", "반박 하나."],
    ["tbct-s08-n13-p01-return-to-defendant", "변호 하나."],
    ["tbct-s08-n14-p03-review-four-blocks", "증거 하나."],
    ["tbct-s08-n10-p02-rebut-each-defense-item", "변호 넷."],
    ["tbct-s08-n12-p02-surrebut-each-pair", "반박 넷."],
    ["tbct-s07-n11-p01-plan-summary", "행동."],
  ];

  it.each(["ko-KR", "en-US"])("keeps every composed message deliverable in %s", (locale) => {
    const generic = defaultFallbackPatientText(locale);
    for (const [promptItemId, mustQuote] of targets) {
      const promptItem = promptById(promptItemId);
      const approved = resolveS07StaticText(promptItem, longFields, locale) ?? resolveS08StaticText(promptItem, longFields, locale);
      expect(approved, promptItemId).toBeDefined();
      const resolved = resolvePromptLocaleText(promptItem.id, approved, locale);
      expect(resolved, `${promptItemId} was evicted to the generic line`).not.toBe(generic);
      expect(resolved, `${promptItemId} lost the participant's own words`).toContain(mustQuote);
    }
  });
});

describe("S08 argues each piece of evidence individually", () => {
  // Source: "presenting each piece of evidence individually and separately --
  // one at a time, never grouped", with its own "Therefore..." per pairing.
  // Every one of these prompts used to be a single turn that could only ever
  // quote evidence #1, so the second, third and fourth items were never
  // argued at all.
  const perItemPrompts = [
    "tbct-s08-n10-p02-rebut-each-defense-item",
    "tbct-s08-n12-p02-surrebut-each-pair",
    "tbct-s08-n12-p03-participant-therefore",
  ];

  it("repeats each per-item prompt until every item has been answered", () => {
    for (const promptItemId of perItemPrompts) {
      const promptItem = promptById(promptItemId);
      expect(promptItem.executionMode, promptItemId).toBe("repeat_until");
      expect(promptItem.completionCondition, promptItemId).toMatchObject({ operator: "equals", value: true });
      expect((promptItem.completionCondition as { field: string }).field, promptItemId).toMatch(/Complete$/);
    }
  });

  it("quotes the next unanswered item on every iteration, not always the first", () => {
    const fields: Record<string, unknown> = {
      defenseEvidence: ["defense one", "defense two", "defense three"],
      prosecutionRebuttals: ["rebuttal one", "rebuttal two", "rebuttal three"],
      defenseSurrebuttals: ["answer one", "answer two", "answer three"],
    };
    const quoted = (promptItemId: string, done: Record<string, unknown>) =>
      resolveS08StaticText(promptById(promptItemId), { ...fields, ...done }, "en-US") ?? "";
    // Rebuttals advance through the defense's items.
    expect(quoted("tbct-s08-n10-p02-rebut-each-defense-item", { prosecutionRebuttals: [] })).toContain("defense one");
    expect(quoted("tbct-s08-n10-p02-rebut-each-defense-item", { prosecutionRebuttals: ["r1"] })).toContain("defense two");
    expect(quoted("tbct-s08-n10-p02-rebut-each-defense-item", { prosecutionRebuttals: ["r1", "r2"] })).toContain("defense three");
    // Surrebuttals answer one specific rebuttal each time.
    expect(quoted("tbct-s08-n12-p02-surrebut-each-pair", { defenseSurrebuttals: [] })).toContain("rebuttal one");
    expect(quoted("tbct-s08-n12-p02-surrebut-each-pair", { defenseSurrebuttals: ["s1", "s2"] })).toContain("rebuttal three");
    // Each "Therefore..." is drawn from its own pair.
    expect(quoted("tbct-s08-n12-p03-participant-therefore", { thereforeConclusions: ["t1"] })).toContain("answer two");
  });

  it("asks for the emphasized BUT the source requires", () => {
    const fields = { defenseEvidence: ["defense one"], prosecutionRebuttals: ["rebuttal one"] };
    for (const promptItemId of ["tbct-s08-n10-p02-rebut-each-defense-item", "tbct-s08-n12-p02-surrebut-each-pair"]) {
      expect(resolveS08StaticText(promptById(promptItemId), fields, "en-US"), promptItemId).toContain("BUT");
      expect(resolveS08StaticText(promptById(promptItemId), fields, "ko-KR"), promptItemId).toContain("하지만");
    }
  });
});

describe("evidence collection reaches the source's own limits", () => {
  const extract = async (promptItemId: string, value: string, fields: Record<string, unknown>) => {
    const promptItem = promptById(promptItemId);
    return extractRuntimeState({
      patientInput: { kind: "text", value },
      currentPromptItem: promptItem,
      currentNode: nodeFor(promptItem),
      currentContext: emptyContext(fields),
      locale: "en-US",
    });
  };

  it("keeps inviting evidence past the second piece", async () => {
    // The old rule flipped `sufficient` as soon as two pieces existed, so the
    // loop closed there and the source's third (exceptionally fourth) piece
    // was never invited.
    const two = await extract("tbct-s08-n06-p02-prosecution-evidence", "They missed a third deadline.", { prosecutionEvidence: ["first piece"] });
    expect(two.fields.prosecutionEvidenceSufficient).toBe(false);
    const four = await extract("tbct-s08-n06-p02-prosecution-evidence", "A fourth occasion too.", { prosecutionEvidence: ["one", "two", "three"] });
    expect(four.fields.prosecutionEvidenceSufficient).toBe(true);
  });

  it("honors an explicit 'no more' once the minimum is met", async () => {
    const early = await extract("tbct-s08-n06-p02-prosecution-evidence", "no more", { prosecutionEvidence: ["only one"] });
    expect(early.fields.prosecutionEvidenceSufficient, "one piece plus 'no more' is below the floor").toBe(false);
    const settled = await extract("tbct-s08-n06-p02-prosecution-evidence", "no more", { prosecutionEvidence: ["one", "two"] });
    expect(settled.fields.prosecutionEvidenceSufficient).toBe(true);
  });

  it("does not close S07's empty chair after two utterances", async () => {
    const two = await extract("tbct-s07-n06-p03-continue-dialogue", "Reason answers back.", { emotionReasonDialogue: ["emotion spoke"] });
    expect(two.fields.emotionReasonDialogueSufficient, "'several exchanges is a floor, not a target'").toBe(false);
  });

  it("pairs each rebuttal with one defense item before completing", async () => {
    const partial = await extract("tbct-s08-n10-p02-rebut-each-defense-item", "BUT that was one occasion.", {
      defenseEvidence: ["one", "two", "three"],
      prosecutionRebuttals: ["first rebuttal"],
    });
    expect(partial.fields.prosecutionRebuttalsComplete).toBe(false);
    const complete = await extract("tbct-s08-n10-p02-rebut-each-defense-item", "BUT the third one hardly counts.", {
      defenseEvidence: ["one", "two", "three"],
      prosecutionRebuttals: ["first", "second"],
    });
    expect(complete.fields.prosecutionRebuttalsComplete).toBe(true);
  });
});

describe("S08 corrects a first-person slip once, then proceeds", () => {
  // Source CRITICAL POINT: "I noticed you said 'I' -- remember, right now you
  // are the prosecutor..." The check existed but no prompt carried
  // requiresThirdPerson, so it was dead code and the slip went uncorrected.
  const extract = (value: string, clarificationAttemptCount: number) => {
    const promptItem = promptById("tbct-s08-n06-p02-prosecution-evidence");
    return extractRuntimeState({
      patientInput: { kind: "text", value },
      currentPromptItem: promptItem,
      currentNode: nodeFor(promptItem),
      currentContext: { ...emptyContext(), clarificationAttemptCount } as unknown as RuntimeContext,
      locale: "en-US",
    });
  };

  it("routes a first-person courtroom answer to a correction", async () => {
    const slip = await extract("I missed the March deadline and let everyone down.", 0);
    expect(slip.missingFields).toEqual(["prosecutionEvidence"]);
  });

  it("accepts the same answer after the one correction, rather than looping", async () => {
    // A participant who keeps their phrasing must not be walked into a
    // max-clarification-attempts pause over a pronoun.
    const retry = await extract("I missed the March deadline and let everyone down.", 1);
    expect(retry.missingFields).toEqual([]);
  });

  it("names the role the participant is actually in", () => {
    // Step 10's prompt slug is "rebut-each-defense-item" but the role
    // arguing it is the PROSECUTOR -- naming the role off the slug would
    // correct the participant into the wrong chair.
    const thirdPersonPrompts = CANONICAL_PROMPT_ITEMS.filter(
      (promptItem) => (promptItem.validation as { requiresThirdPerson?: boolean } | null)?.requiresThirdPerson);
    for (const promptItem of thirdPersonPrompts) {
      expect(courtroomRoleNameForNode(promptItem.nodeId), promptItem.id).toBeDefined();
    }
    expect(courtroomRoleNameForNode("tbct-s08-n10-prosecution-rebuttal")?.en).toBe("the prosecutor");
    expect(courtroomRoleNameForNode("tbct-s08-n12-defense-surrebuttal")?.en).toBe("the defense attorney");
    expect(courtroomRoleNameForNode("tbct-s08-n06-prosecution-evidence")?.en).toBe("the prosecutor");
    expect(courtroomRoleNameForNode("tbct-s08-n08-defense-evidence")?.en).toBe("the defense attorney");
  });

  it("accepts third-person answers and role-ending phrases untouched", async () => {
    const proper = await extract("They missed the March deadline and the team covered for them.", 0);
    expect(proper.missingFields).toEqual([]);
    const done = await extract("no more", 0);
    expect(done.fields.prosecutionEvidenceNoMore).toBe(true);
  });
});

describe("S08's jury examines each block on its own terms", () => {
  const trialFields = {
    prosecutionEvidence: ["they missed the March deadline"],
    defenseEvidence: ["they delivered every other project"],
    prosecutionRebuttals: ["but March was the important one"],
    defenseSurrebuttals: ["but a supplier caused that delay"],
    thereforeConclusions: ["therefore one delay does not define them"],
  };
  const blockText = (reviewed: number, locale: string) =>
    resolveS08StaticText(promptById("tbct-s08-n14-p03-review-four-blocks"), { ...trialFields, juryReview: Array.from({ length: reviewed }, (_, i) => `review ${i}`) }, locale) ?? "";

  it.each(["en-US", "ko-KR"])("asks for distortions on the prosecution's blocks and factual confirmation on the defense's (%s)", (locale) => {
    const distortion = locale === "ko-KR" ? /인지왜곡/ : /cognitive distortion/i;
    const factual = locale === "ko-KR" ? /사실이고 진실/ : /factual and true/i;
    // Blocks 1 and 3 are the prosecution's; 2 and 4 are the defense's. All
    // four used to receive the identical "What stands out to you about it?".
    expect(blockText(0, locale)).toMatch(distortion);
    expect(blockText(2, locale)).toMatch(distortion);
    expect(blockText(1, locale)).toMatch(factual);
    expect(blockText(3, locale)).toMatch(factual);
  });

  it("reads every piece of an ordinary block back, not just the first", () => {
    // "Together you'll go back through every piece of evidence, one at a
    // time." At the old flat 140-character budget a four-piece block was read
    // back as one piece plus "and 3 more", so the jury was asked to weigh
    // evidence it had never actually been read.
    const four = (prefix: string) => Array.from({ length: 4 }, (_, i) => `${prefix} ${i + 1}: a specific thing that happened that week.`);
    const fields = {
      prosecutionEvidence: four("Prosecution"),
      defenseEvidence: four("Defense"),
      prosecutionRebuttals: four("BUT rebuttal"),
      defenseSurrebuttals: four("BUT answer"),
      thereforeConclusions: four("Therefore"),
    };
    for (const locale of ["en-US", "ko-KR"]) {
      for (const [blockIndex, prefix] of [[0, "Prosecution"], [1, "Defense"], [2, "BUT rebuttal"]] as const) {
        const text = resolveS08StaticText(
          promptById("tbct-s08-n14-p03-review-four-blocks"),
          { ...fields, juryReview: Array.from({ length: blockIndex }, () => "reviewed") },
          locale,
        ) ?? "";
        for (let piece = 1; piece <= 4; piece += 1) {
          expect(text, `block ${blockIndex + 1} (${locale}) omits piece ${piece}`).toContain(`${prefix} ${piece}`);
        }
        // ...and the whole thing must still survive the delivery guard.
        expect(isPatientSafeFallbackText(text), `block ${blockIndex + 1} (${locale}) was evicted`).toBe(true);
      }
    }
  });

  it("quotes a different block's own content each time", () => {
    expect(blockText(0, "en-US")).toContain("March deadline");
    expect(blockText(1, "en-US")).toContain("every other project");
    expect(blockText(2, "en-US")).toContain("March was the important one");
    expect(blockText(3, "en-US")).toContain("supplier caused that delay");
  });
});

describe("the protocol's live conduct rules reach the dialogue agent", () => {
  // These are CRITICAL POINTs no deterministic branch can perform. They used
  // to reach the model only by accident -- when the raw source excerpt that
  // happened to contain them fell inside a node's therapeuticObjective -- and
  // several never reached it at all.
  const guidanceFor = (promptItemId: string) => stepSpecificGuidanceFor(promptById(promptItemId))?.join("\n") ?? "";

  it("tells the agent to stay silent during S07's empty chair", () => {
    const guidance = guidanceFor("tbct-s07-n06-p02-emotion-to-reason");
    expect(guidance).toMatch(/do not summarise/i);
    expect(guidance).toMatch(/directly to each other/i);
  });

  it("forbids coaching the prosecution", () => {
    for (const promptItemId of ["tbct-s08-n06-p02-prosecution-evidence", "tbct-s08-n10-p02-rebut-each-defense-item"]) {
      expect(guidanceFor(promptItemId), promptItemId).toMatch(/never coach the prosecution/i);
    }
  });

  it("carries the defense-step interventions the source requires", () => {
    const guidance = guidanceFor("tbct-s08-n08-p02-defense-evidence");
    expect(guidance, "the 'who is speaking?' challenge").toMatch(/who is speaking/i);
    expect(guidance, "replacing a passive defense attorney").toMatch(/replace/i);
    expect(guidance, "asking for a concrete occasion").toMatch(/concrete/i);
  });

  it("carries the jury-room and verdict rules", () => {
    const jury = guidanceFor("tbct-s08-n14-p03-review-four-blocks");
    expect(jury, "the Juror 2 intervention").toMatch(/prosecutor's voice/i);
    expect(jury).toMatch(/jury room/i);
    expect(guidanceFor("tbct-s08-n14-p04-participant-verdict")).toMatch(/only ever be stated by the participant/i);
  });

  it("carries the appeal bridge and the anchors", () => {
    expect(guidanceFor("tbct-s08-n17-p02-prosecution-satisfaction")).toMatch(/appeal/i);
    expect(guidanceFor("tbct-s07-n05-p01-emotion-weight")).toMatch(/60\/70\/80\/90\/100/);
    expect(guidanceFor("tbct-s07-n08-p01-consensus-weights")).toMatch(/not editorialize/i);
  });

  it("gives every third-person-bound prompt its correction rule", () => {
    const thirdPersonPrompts = CANONICAL_PROMPT_ITEMS.filter(
      (promptItem) => (promptItem.validation as { requiresThirdPerson?: boolean } | null)?.requiresThirdPerson);
    expect(thirdPersonPrompts.length).toBeGreaterThan(0);
    for (const promptItem of thirdPersonPrompts) {
      expect(stepSpecificGuidanceFor(promptItem)?.join("\n"), promptItem.id).toMatch(/third person/i);
    }
  });
});

describe("S07/S08 speak the source's own wording", () => {
  it("offers the 60-100 anchors at every weighing", () => {
    for (const promptItemId of ["tbct-s07-n05-p01-emotion-weight", "tbct-s07-n05-p02-reason-weight", "tbct-s07-n08-p01-consensus-weights"]) {
      for (const locale of ["en-US", "ko-KR"]) {
        const text = resolvePromptLocaleText(promptItemId, resolveS07StaticText(promptById(promptItemId), {}, locale), locale);
        expect(text, `${promptItemId} (${locale})`).toMatch(/60/);
        expect(text, `${promptItemId} (${locale})`).toMatch(/100/);
      }
    }
  });

  it("asks the action plan's accountability question, not a support-in-general one", () => {
    // Source: "Ask who in the person's life could know about this plan, be
    // told afterwards, or be present." The old wording asked who could
    // support them "without pressuring you", a different construct.
    const en = resolveS07StaticText(promptById("tbct-s07-n10-p05-support-people"), {}, "en-US") ?? "";
    const ko = resolvePromptLocaleText("tbct-s07-n10-p05-support-people", en, "ko-KR");
    expect(en).toMatch(/know about this plan|tell about it|be there with you/i);
    expect(ko).toMatch(/알고 있어|말해|곁에/);
  });

  it("closes S08 by comparing the ratings warmly, without judging the person", () => {
    const summary = composeTrialClosingSummary({
      coreBeliefBaselinePercent: 85,
      baselineEmotionIntensityPercent: 80,
      originalChargeFinalBeliefPercent: 40,
      originalChargeFinalEmotionIntensityPercent: 35,
    }, "en-US");
    for (const value of ["85%", "80%", "40%", "35%"]) expect(summary).toContain(value);
    expect(summary).not.toMatch(/\b(?:great|well done|proud|amazing|you should)\b/i);
    expect(composeTrialClosingSummary({}, "ko-KR")).toMatch(/[가-힣]/);
  });
});

describe("the participant guide's promises about how each session opens", () => {
  /** The same order the runtime uses: composed/approved text first, then the
   * locale resolver (which prefers a reviewed Korean entry over it). */
  const deliveredText = (promptItemId: string, locale: string, fields: Record<string, unknown> = {}) => {
    const promptItem = promptById(promptItemId);
    const approved = resolveS07StaticText(promptItem, fields, locale) ?? resolveS08StaticText(promptItem, fields, locale);
    return resolvePromptLocaleText(promptItem.id, approved ?? promptItem.fallbackPatientText, locale) ?? "";
  };

  it("checks the participant has the worksheet before beginning", () => {
    // Both guides promise "The guide will check you have it before you
    // begin" -- neither session used to mention the worksheet at all.
    for (const [promptItemId, en, ko] of [
      ["tbct-s07-n01-p03-crp-worksheet-ready", /worksheet/i, /워크시트/],
      ["tbct-s08-n01-p01-trial-materials-ready", /worksheet/i, /워크시트/],
    ] as const) {
      expect(deliveredText(promptItemId, "en-US"), promptItemId).toMatch(en);
      expect(deliveredText(promptItemId, "ko-KR"), promptItemId).toMatch(ko);
      expect(promptRequiresPatientInput(promptById(promptItemId)), promptItemId).toBe(true);
    }
    // S08's is specifically both forms -- the trial worksheet AND the appeal record.
    expect(deliveredText("tbct-s08-n01-p01-trial-materials-ready", "en-US")).toMatch(/appeal/i);
  });

  it("opens S08 with the belief-as-charge orientation and invites a reaction to it", () => {
    // "A quick word first — the belief as a charge... you'll be asked what
    // you make of it before moving on." S08 used to open cold on "describe a
    // distressing situation", with the courtroom framing first appearing in
    // Step 3.
    const orientation = promptById("tbct-s08-n01-p02-belief-as-charge-orientation");
    const reaction = promptById("tbct-s08-n01-p03-orientation-reaction");
    expect(promptRequiresPatientInput(orientation), "the orientation states, it does not ask").toBe(false);
    expect(promptRequiresPatientInput(reaction), "the reaction is genuinely waited for").toBe(true);
    for (const locale of ["en-US", "ko-KR"]) {
      expect(deliveredText(orientation.id, locale), locale).toMatch(locale === "ko-KR" ? /고발|혐의/ : /accusation/i);
    }
    // It must come before the investigation itself.
    const nodeOne = CANONICAL_PROMPT_ITEMS.filter((promptItem) => promptItem.nodeId === "tbct-s08-n01-investigation-and-core-belief");
    const order = nodeOne.map((promptItem) => promptItem.id);
    expect(order.indexOf(orientation.id)).toBeLessThan(order.findIndex((id) => id.includes("distressing-situation")));
    expect(order.indexOf(reaction.id)).toBeLessThan(order.findIndex((id) => id.includes("distressing-situation")));
  });

  it("names the Reason/Emotion split plainly and leaves it standing", () => {
    // "The guide will name the split plainly as a conflict between 'your
    // Reason' and 'your Emotion,' and then let it stand." The two weights
    // used to be collected and never spoken about.
    const withSplit = { emotionDisadvantageWeight: 80, reasonAdvantageWeight: 70 };
    const en = deliveredText("tbct-s07-n05-p03-name-the-split", "en-US", withSplit);
    expect(en).toMatch(/80%/);
    expect(en).toMatch(/conflict between your Reason and your Emotion/i);
    expect(en, "naming is not evaluating").not.toMatch(/\b(?:significant|big|large|should|better|win)\b/i);
    expect(deliveredText("tbct-s07-n05-p03-name-the-split", "ko-KR", withSplit)).toMatch(/[가-힣]/);
    // When the two parts agree, claiming a conflict would be false.
    expect(deliveredText("tbct-s07-n05-p03-name-the-split", "en-US", { emotionDisadvantageWeight: 70, reasonAdvantageWeight: 35 }))
      .toMatch(/much the same direction/i);
  });

  it("asks the Consensus chair about the conversation, not only its conclusion", () => {
    expect(deliveredText("tbct-s07-n07-p04-consensus-emotion-intent", "en-US")).toMatch(/Emotion turn out to be trying to do/i);
    expect(deliveredText("tbct-s07-n07-p05-consensus-parts-needs", "en-US")).toMatch(/each part seem to need/i);
    for (const promptItemId of ["tbct-s07-n07-p04-consensus-emotion-intent", "tbct-s07-n07-p05-consensus-parts-needs"]) {
      expect(deliveredText(promptItemId, "ko-KR"), promptItemId).toMatch(/[가-힣]/);
      expect(stepSpecificGuidanceFor(promptById(promptItemId))?.join("\n"), promptItemId).toMatch(/never supply/i);
    }
  });

  it("keeps yellow and red actions with the therapist before planning one", () => {
    // Carried over from the exposure session: CRP decides and plans, but it
    // never licenses attempting a distressing item alone.
    const en = deliveredText("tbct-s07-n09-p03-green-only-scope", "en-US");
    expect(en).toMatch(/green/i);
    expect(en).toMatch(/therapist/i);
    expect(en).toMatch(/never on your own|not on your own/i);
    expect(deliveredText("tbct-s07-n09-p03-green-only-scope", "ko-KR")).toMatch(/치료사/);
  });

  it("tells the participant who sits in the jury room and who may not enter", () => {
    const en = deliveredText("tbct-s08-n14-p01-enter-jury-role", "en-US");
    expect(en, "the guide is the second juror").toMatch(/second juror/i);
    expect(en, "a space no one else may enter").toMatch(/not the prosecutor/i);
    expect(deliveredText("tbct-s08-n14-p01-enter-jury-role", "ko-KR")).toMatch(/두 번째 배심원/);
  });

  it("describes the defense attorney as the wise and kind figure the guide promises", () => {
    expect(deliveredText("tbct-s08-n07-p02-visualize-defense", "en-US")).toMatch(/wise and kind/i);
    expect(deliveredText("tbct-s08-n07-p02-visualize-defense", "ko-KR")).toMatch(/지혜롭고 따뜻한/);
  });

  it("carries the remaining live promises as step guidance", () => {
    const guidance = (promptItemId: string) => stepSpecificGuidanceFor(promptById(promptItemId))?.join("\n") ?? "";
    // "Let the prosecutor be unfair" -- harsh, sweeping accusations are the point.
    expect(guidance("tbct-s08-n06-p02-prosecution-evidence")).toMatch(/unfair/i);
    // Neither imagined figure may be someone real and close.
    for (const promptItemId of ["tbct-s08-n05-p01-visualize-prosecutor", "tbct-s08-n07-p02-visualize-defense"]) {
      expect(guidance(promptItemId), promptItemId).toMatch(/never a real person close to them/i);
    }
    // The guide plays the judge for this one moment only.
    expect(guidance("tbct-s08-n15-p01-announce-verdict")).toMatch(/judge/i);
    // The jury looks at one piece at a time.
    expect(guidance("tbct-s08-n14-p03-review-four-blocks")).toMatch(/ONE PIECE AT A TIME/);
    // Emotion may speak freely, and is never rescued or corrected.
    expect(guidance("tbct-s07-n06-p02-emotion-to-reason")).toMatch(/do not rescue it/i);
    // A participant who cannot separate Reason from Emotion is met differently.
    expect(guidance("tbct-s07-n05-p01-emotion-weight")).toMatch(/inner voice that says go/i);
    // Both sessions are for moderate material, not the heaviest thing carried.
    for (const promptItemId of ["tbct-s07-n04-p01-action-in-own-words", "tbct-s08-n01-p05-downward-arrow"]) {
      expect(guidance(promptItemId), promptItemId).toMatch(/not the very heaviest thing they carry/i);
    }
  });
});

describe("every S07/S08 turn says something a participant can actually answer", () => {
  // A sweep of the real delivery path for every prompt in both languages.
  // Written after a full audited walkthrough turned up four separate ways a
  // turn can be non-empty and still wrong: the content-free generic line, a
  // field name read back ("What would you say about desired or feared action
  // right now?"), an authoring instruction spoken aloud ("Positive belief
  // must come from the participant, how much you believe that?"), and a
  // doubled full stop in the composed charge.
  const SMELLS: Array<{ label: string; test: (text: string, locale: string) => boolean }> = [
    { label: "content-free generic line", test: (text, locale) => text === defaultFallbackPatientText(locale) },
    { label: "speaks about 'the participant'", test: (text) => /\bthe participant\b|\bparticipant'?s\b/i.test(text) },
    { label: "authoring-instruction opener", test: (text) => /^(?:collect|prompt|identify|elicit|capture|explore|help|support|confirm|introduce|run|present|close|start|rate|re-?rate|offer|invite|explain|keep|surface|anchor|set up|formulate|map|convert|prepare|begin|deepen|choose|score|establish|validate)\b/i.test(text) },
    { label: "worksheet-form scaffolding", test: (text) => /\bcolumn \d|^Note:|\bTable \d|_{3,}|\.{4,}/i.test(text) },
    { label: "internal 'must' instruction", test: (text) => /\bmust (?:come|be stated|be provided|not be)\b/i.test(text) },
    { label: "field-name echo", test: (text) => /What would you say about .* right now\?|how would you rate your [a-z ]+ right now\?/i.test(text) },
    { label: "unresolved bracket placeholder", test: (text) => /\[[^\]]{2,40}\]/.test(text) },
    { label: "doubled sentence punctuation", test: (text) => /[.!?]\s*["”']?\.[."”']*(?:\s|$)/.test(text) },
    { label: "Korean turn with no Hangul", test: (text, locale) => locale.startsWith("ko") && !/[가-힣]/.test(text) },
    { label: "raw source list bullet", test: (text) => /^\s*[•▪◦‣·]/.test(text) },
  ];
  // Mid-session state, so composed messages resolve instead of declining.
  const midSession: Record<string, unknown> = {
    coreBelief: "I am not good enough",
    emotionDisadvantageWeight: 80, reasonAdvantageWeight: 70,
    prosecutionEvidence: ["they missed the March deadline"],
    defenseEvidence: ["they delivered every other project"],
    prosecutionRebuttals: ["but March was the important one"],
    defenseSurrebuttals: ["but a supplier caused that delay"],
    thereforeConclusions: ["therefore one delay does not define them"],
    unrebuttedDefenseEvidence: "they finished the course",
    proposedActions: "send one message", possibleObstacles: "I will put it off",
    obstacleSolutions: "write it early", implementationPlan: "Saturday morning",
    supportPeople: "my partner", followUpPlan: "check next week",
    coreBeliefBaselinePercent: 90, baselineEmotionIntensityPercent: 85,
    originalChargeFinalBeliefPercent: 35, originalChargeFinalEmotionIntensityPercent: 30,
  };

  it.each(["en-US", "ko-KR"])("delivers a real, answerable line for every prompt in %s", (locale) => {
    const spokenPrompts = CANONICAL_PROMPT_ITEMS.filter((promptItem) => /^tbct-s0[78]-/.test(promptItem.id) && !promptItem.nodeId.endsWith("safety-pause"));
    expect(spokenPrompts.length).toBeGreaterThan(60);
    const findings: string[] = [];
    for (const promptItem of spokenPrompts) {
      // The real delivery order (runtime-orchestrator.ts's approvedPatientText):
      // composed/approved text if there is one, otherwise the NORMALIZER's
      // patient-facing fallback -- which is where instruction-shaped source
      // text gets rewritten into a real question. Reading the raw catalog
      // text instead would test a path no participant ever hears.
      const approved = resolveS07StaticText(promptItem, midSession, locale) ?? resolveS08StaticText(promptItem, midSession, locale);
      const node = CANONICAL_STAGE_NODES.find((item) => item.id === promptItem.nodeId)!;
      const text = approved
        ? resolvePromptLocaleText(promptItem.id, approved, locale)
        : normalizeRuntimePromptItem({ promptItem, node, locale }).fallbackPatientText;
      if (!text.trim()) { findings.push(`${promptItem.id}: empty`); continue; }
      for (const smell of SMELLS) {
        if (smell.test(text, locale)) findings.push(`${promptItem.id}: ${smell.label} -> "${text.slice(0, 90)}"`);
      }
    }
    expect(findings).toEqual([]);
  });
});

describe("a participant's own wording never deletes the message quoting it", () => {
  // Found by reading a full audited S08 walkthrough: three separate turns
  // spoke the content-free generic line instead of their composed message,
  // because a defense evidence item contained the word "unprompted" and the
  // internal-vocabulary guard matched "prompt" inside it.
  const loadedFields = {
    prosecutionEvidence: ["They went quiet when the manager asked a direct question."],
    defenseEvidence: ["Their manager thanked them for the report, unprompted."],
    prosecutionRebuttals: ["BUT one thank-you does not cancel the rest."],
    defenseSurrebuttals: ["BUT the praise was specific and unprompted, which says something real."],
    thereforeConclusions: ["Therefore the defendant's work is recognised by others."],
  };

  it("keeps ordinary words that merely contain an internal term", () => {
    // The guard exists to stop internal vocabulary leaking into a patient
    // message; it must still do that.
    expect(isPatientSafeFallbackText("Their manager thanked them, unprompted.")).toBe(true);
    expect(isPatientSafeFallbackText("She is a role model for the team.")).toBe(true);
    expect(isPatientSafeFallbackText("Here is the system prompt for this node.")).toBe(false);
    expect(isPatientSafeFallbackText("Follow the model instructions above.")).toBe(false);
  });

  it("delivers every composed S08 message that quotes such an answer", () => {
    const generic = defaultFallbackPatientText("en-US");
    const targets: Array<[string, Record<string, unknown>]> = [
      ["tbct-s08-n12-p03-participant-therefore", { ...loadedFields, thereforeConclusions: [] }],
      ["tbct-s08-n13-p01-return-to-defendant", loadedFields],
      ["tbct-s08-n14-p03-review-four-blocks", { ...loadedFields, juryReview: ["a", "b", "c"] }],
    ];
    for (const [promptItemId, fields] of targets) {
      const promptItem = promptById(promptItemId);
      for (const locale of ["en-US", "ko-KR"]) {
        const approved = resolveS08StaticText(promptItem, fields, locale);
        const resolved = resolvePromptLocaleText(promptItem.id, approved, locale);
        expect(resolved, `${promptItemId} (${locale}) was evicted`).not.toBe(locale === "ko-KR" ? defaultFallbackPatientText("ko-KR") : generic);
        expect(resolved, `${promptItemId} (${locale}) lost the participant's words`).toContain("unprompted");
      }
    }
  });

  it("states the charge without doubling the participant's own full stop", () => {
    const spoken = resolveS08StaticText(promptById("tbct-s08-n03-p02-state-charge"), { coreBelief: "I am not good enough." }, "en-US");
    expect(spoken).toContain("I am not good enough");
    expect(spoken).not.toContain("..");
  });

  it("asks S07's opening decision question instead of reciting its field name", () => {
    const spoken = resolveS07StaticText(promptById("tbct-s07-n04-p01-action-in-own-words"), {}, "en-US");
    expect(spoken).toBeDefined();
    expect(spoken).not.toMatch(/desired or feared action/i);
    expect(spoken).toMatch(/your own words/i);
  });
});

describe("the fidelity audit counts a step that never ran", () => {
  const prompts = [
    { id: "p-reached", nodeId: "n1", outputFields: ["reached"] },
    { id: "p-unreached", nodeId: "n2", outputFields: ["unreached"] },
    { id: "p-conditional", nodeId: "n1", outputFields: ["conditional"], activationCondition: { field: "x", operator: "equals", value: true } },
    { id: "p-branch", nodeId: "n3", outputFields: ["branchOnly"] },
  ];
  const defaultPathNodeIds = computeDefaultPathNodeIds({
    startNodeId: "n1",
    edges: [
      { source: "n1", target: "n2" },
      { source: "n1", target: "n3", condition: { field: "x", operator: "equals", value: true } },
    ],
  });

  it("treats an unreached unconditional prompt's field as missing", () => {
    // The old rule only counted fields whose prompt had EXECUTED, so a whole
    // skipped node (S07's Action Plan, S08's Appeal Preparation) vanished
    // from the check and the report said "Missing fields: none / PASS".
    const missing = computeMissingFields({
      expectedFields: ["reached", "unreached", "conditional", "branchOnly"],
      capturedFields: ["reached"],
      normalPrompts: prompts,
      skippedPromptItemIds: [],
      defaultPathNodeIds,
    });
    expect(missing).toEqual(["unreached"]);
  });

  it("does not count a branch that was simply not taken", () => {
    expect(defaultPathNodeIds.has("n3")).toBe(false);
    const missing = computeMissingFields({
      expectedFields: ["conditional", "branchOnly"],
      capturedFields: [],
      normalPrompts: prompts,
      skippedPromptItemIds: ["p-conditional"],
      defaultPathNodeIds,
    });
    expect(missing).toEqual([]);
  });
});
