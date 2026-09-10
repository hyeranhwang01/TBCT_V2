import { describe, expect, it } from "vitest";
import { extractRuntimeState, isExplicitPatientRefusal, isNonCurrentRiskMention, looksLikeMeaningClarificationRequest, looksLikeMetaQuestionAboutTheProcess, looksLikeS02ExplanationRequest, looksLikeS02NoMoreIdiom, normalizeText } from "@/lib/runtime/runtime-context";
import type { ClinicalStageNode, PromptItem } from "@/lib/protocol/source-fidelity-types";

function makeNode(field: string, kind: string = "text"): ClinicalStageNode {
  const now = new Date().toISOString();
  return {
    id: `node-${field}`,
    protocolId: "tbct-br-001",
    sessionId: "tbct-br-001-session-03",
    type: "question" as const,
    title: field,
    clinicalPurpose: kind,
    position: { x: 0, y: 0 },
    promptItemIds: [],
    requiredFields: [field],
    completionRule: {},
    branchRules: [],
    restrictions: [],
    safetyRuleIds: [],
    sourceTrace: { sourceDocument: "TBCT pasted source text", sourceSession: "Session 03", sourceSection: field, sourceLineStart: 1, sourceLineEnd: 1, sourceTextHash: "test", importedVersion: "test" },
    sourceFidelityStatus: "structured_from_source",
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
}

function makePrompt(field: string, validation?: Record<string, unknown>): PromptItem {
  return {
    id: `prompt-${field}`,
    protocolId: "tbct-br-001",
    sessionId: "tbct-s01",
    nodeId: `node-${field}`,
    order: 1,
    type: "question",
    verbatimText: "How would you describe what is happening right now, quite telegraphically?",
    editableText: "Ask for a simple, neutral description of what is happening. A situation is different from an interpretation or opinion.",
    aiInstruction: "Ask for a simple, neutral situation description.",
    activationCondition: null,
    outputFields: [field],
    validation: validation ?? null,
    completionEffect: null,
    restrictions: [],
    safetyRuleIds: [],
    sourceTrace: { sourceDocument: "TBCT pasted source text", sourceSession: "Session 01", sourceSection: field, sourceLineStart: 66, sourceLineEnd: 74, sourceTextHash: "test", importedVersion: "test" },
    sourceFidelityStatus: "structured_from_source",
    origin: "source_imported",
    sourceHash: "test",
    status: "active",
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    updatedBy: "test",
  };
}

describe("runtime context extraction", () => {
  it.each(["무슨 말인지 설명해줘", "이해가 안 돼요. 설명해 주세요", "What do you mean by that?"])("keeps an explanation request out of the clinical field: %s", async (value) => {
    const result = await extractRuntimeState({
      patientInput: { kind: "text", value },
      currentNode: makeNode("discomfortDistressSummary"),
      currentPromptItem: makePrompt("discomfortDistressSummary", { kind: "participant_summary_required" }),
      currentContext: { fields: {}, riskSignals: [], iterationCounts: {}, riskLevel: "low" },
      locale: "ko-KR",
    });
    expect(result.fields.discomfortDistressSummary).toBeUndefined();
    expect(result.missingFields).toEqual(["discomfortDistressSummary"]);
  });
  it.each(["네 알겠습니다.", "준비됐어요", "yes, I'm ready", "okay"])("does not record a readiness acknowledgement as a problems-list item: %s", async (value) => {
    const result = await extractRuntimeState({
      patientInput: { kind: "text", value },
      currentNode: makeNode("problems"),
      currentPromptItem: makePrompt("problems", { kind: "array", minItems: 1, maxItems: 5 }),
      currentContext: { fields: {}, riskSignals: [], iterationCounts: {}, riskLevel: "low" },
      locale: "ko-KR",
    });
    expect(result.fields.problems).toBeUndefined();
    expect(result.missingFields).toEqual(["problems"]);
  });

  it.each(["제 생각에는 저는 포기하는 용기가 없는 것 같아요", "사람들에게 싫은 말을 못 하는 게 문제예요", "일을 자꾸 미루는 습관이 있어요"])("records a colloquial Korean problem on the first attempt: %s", async (value) => {
    const result = await extractRuntimeState({
      patientInput: { kind: "text", value },
      currentNode: makeNode("problems"),
      currentPromptItem: makePrompt("problems", { kind: "array", minItems: 1, maxItems: 5 }),
      currentContext: { fields: {}, riskSignals: [], iterationCounts: {}, riskLevel: "low" },
      locale: "ko-KR",
    });
    expect(result.fields.problems).toEqual([value]);
    expect(result.missingFields).toEqual([]);
  });
  it("recognizes an explicit refusal without treating it as a safety disclosure", () => {
    expect(isExplicitPatientRefusal("I don’t want counsel")).toBe(true);
    expect(isExplicitPatientRefusal("I don't want to continue")).toBe(true);
  });
  it("recognizes an explicit refusal stated in Korean", () => {
    expect(isExplicitPatientRefusal("세션을 진행하고 싶지 않아요")).toBe(true);
    expect(isExplicitPatientRefusal("세션을 진행하고 싶지 않아요?")).toBe(true);
    // P0-1 (TBCT S01-S03 fidelity pass): this used to be `true` because the
    // refusal regex matched on a bare "진행" substring regardless of what was
    // being proceeded with -- "세시 시험을 진행하고 싶지 않아요" (not wanting to sit a
    // 3 o'clock EXAM) is not a refusal of the counseling session at all, the
    // same class of false positive as "프로젝트 진행을 하기 싫어요" (see the
    // dedicated false-positive corpus test below). A refusal must now name
    // the session/counseling/therapy itself as what's being stopped.
    expect(isExplicitPatientRefusal("세시 시험을 진행하고 싶지 않아요")).toBe(false);
    expect(isExplicitPatientRefusal("그만하고 싶어요")).toBe(true);
    expect(isExplicitPatientRefusal("치료받고 싶지 않아요")).toBe(true);
    expect(isExplicitPatientRefusal("나 좀 내버려 둬")).toBe(true);
    expect(isExplicitPatientRefusal("네, 그런 거 같습니다")).toBe(false);
  });
  it("preserves fields extracted from a partially complete multi-field answer", async () => {
    const promptItem = {
      ...makePrompt("distressingSituation"),
      id: "tbct-s08-n01-p01-distressing-situation",
      outputFields: ["distressingSituation", "automaticThought"],
      editableText: "Ask for a distressing situation and the automatic thought it triggered.",
    } satisfies PromptItem;
    const result = await extractRuntimeState({
      patientInput: { kind: "text", value: "During meetings I keep thinking that I'm not good enough and that I'm failing." },
      currentNode: { ...makeNode("distressingSituation"), requiredFields: ["distressingSituation", "automaticThought"] },
      currentPromptItem: promptItem,
      currentContext: { fields: {}, riskSignals: [], iterationCounts: {}, riskLevel: "low" },
      locale: "en-US",
    });

    expect(result.fields.distressingSituation).toBeDefined();
    expect(result.missingFields).not.toContain("distressingSituation");
  });
  it("derives the recorded flag from one rating_or_absent answer instead of requesting a second number", async () => {
    const result = await extractRuntimeState({
      patientInput: { kind: "rating", value: "32" },
      currentNode: { requiredFields: ["shameIntensityBaseline", "shameBaselineRecorded"] } as ClinicalStageNode,
      currentPromptItem: { outputFields: ["shameIntensityBaseline", "shameBaselineRecorded"], validation: { kind: "rating_or_absent", min: 0, max: 100 } } as unknown as PromptItem,
      currentContext: { fields: {}, riskSignals: [], iterationCounts: {}, riskLevel: "low" },
      locale: "en-US",
    });
    expect(result.fields.shameIntensityBaseline).toBe(32);
    expect(result.fields.shameBaselineRecorded).toBe(true);
    expect(result.missingFields).toEqual([]);
  });
  it("accepts numeric inputs in range and rejects invalid values", async () => {
    const valid = await extractRuntimeState({ patientInput: { kind: "rating", value: "80%" }, currentNode: makeNode("initialATBeliefPercent", "rating"), currentContext: { fields: {}, riskSignals: [], iterationCounts: {}, riskLevel: "low" } });
    expect(valid.missingFields).toHaveLength(0);
    expect(valid.fields.initialATBeliefPercent).toBe(80);

    const invalid = await extractRuntimeState({ patientInput: { kind: "rating", value: "200" }, currentNode: makeNode("initialATBeliefPercent", "rating"), currentContext: { fields: {}, riskSignals: [], iterationCounts: {}, riskLevel: "low" } });
    expect(invalid.missingFields).toContain("initialATBeliefPercent");
  });

  it("does not hide a safety disclosure behind numeric prompt validation", async () => {
    const result = await extractRuntimeState({ patientInput: { kind: "rating", value: "I have a suicide plan." }, currentNode: makeNode("initialATBeliefPercent", "rating"), currentContext: { fields: {}, riskSignals: [], iterationCounts: {}, riskLevel: "low" } });

    expect(result.riskLevel).toBe("high");
    expect(result.riskSignals).toContain("suicide");
    expect(result.missingFields).toHaveLength(0);
  });

  it.each(["I wanna die", "I want to die", "I don't want to live", "I will kill myself", "Suiside"])("detects direct or commonly misspelled suicide language: %s", async (value) => {
    const result = await extractRuntimeState({ patientInput: { kind: "text", value }, currentNode: makeNode("candidateOneReaction"), currentPromptItem: { ...makePrompt("candidateOneReaction", { kind: "enum", values: ["positive", "negative"] }) }, currentContext: { fields: {}, riskSignals: [], iterationCounts: {}, riskLevel: "low" } });
    expect(result.riskLevel).toBe("high");
    expect(result.riskSignals).toContain("suicide");
    expect(result.fields.crisisSignal).toBe(true);
  });

  it("routes indirect death-related language to neutral safety clarification", async () => {
    const result = await extractRuntimeState({ patientInput: { kind: "text", value: "Sometimes I wish I could disappear forever." }, currentNode: makeNode("candidateOneThought"), currentPromptItem: makePrompt("candidateOneThought"), currentContext: { fields: {}, riskSignals: [], iterationCounts: {}, riskLevel: "low" } });
    expect(result.riskLevel).toBe("low");
    expect(result.riskSignals).toContain("ambiguous_safety_language");
    expect(result.missingFields).toContain("candidateOneThought");
  });

  it("escalates an affirmative answer to a pending safety clarification", async () => {
    const result = await extractRuntimeState({ patientInput: { kind: "text", value: "Yes, that is what I mean." }, currentNode: makeNode("candidateOneThought"), currentPromptItem: makePrompt("candidateOneThought"), currentContext: { fields: {}, riskSignals: [], iterationCounts: {}, riskLevel: "low", lastClarificationReason: "safety_clarification" } });
    expect(result.riskLevel).toBe("high");
    expect(result.riskSignals).toContain("patient_confirmed_safety_concern");
  });

  it("rejects a copied Program question as patient input", async () => {
    const prompt = makePrompt("situationThoughtDistinction", { kind: "participant_articulated_distinction" });
    const result = await extractRuntimeState({ patientInput: { kind: "text", value: `${prompt.verbatimText} Read` }, currentNode: makeNode("situationThoughtDistinction"), currentPromptItem: prompt, currentContext: { fields: {}, riskSignals: [], iterationCounts: {}, riskLevel: "low" } });
    expect(result.missingFields).toContain("situationThoughtDistinction");
  });

  it("does not treat ordinary goal-setting uses of stop as a safety crisis", async () => {
    const result = await extractRuntimeState({
      patientInput: { kind: "text", value: "I want to stop feeling anxious and stop believing that I am a failure." },
      currentNode: makeNode("therapyGoals"),
      currentContext: { fields: {}, riskSignals: [], iterationCounts: {}, riskLevel: "low" },
    });

    expect(result.riskLevel).toBe("low");
    expect(result.riskSignals).toEqual([]);
  });

  it("does not treat an ordinary plan as a safety crisis", async () => {
    const result = await extractRuntimeState({
      patientInput: { kind: "text", value: "I have a plan to manage my workload this week." },
      currentNode: makeNode("therapyGoals"),
      currentContext: { fields: {}, riskSignals: [], iterationCounts: {}, riskLevel: "low" },
    });

    expect(result.riskLevel).toBe("low");
    expect(result.riskSignals).toEqual([]);
  });

  it("detects a direct Korean suicide disclosure before ordinary prompt validation", async () => {
    const result = await extractRuntimeState({ patientInput: { kind: "text", value: "죽고싶다" }, currentNode: makeNode("situationThoughtDistinction"), currentContext: { fields: {}, riskSignals: [], iterationCounts: {}, riskLevel: "low" } });

    expect(result.riskLevel).toBe("high");
    expect(result.riskSignals).toContain("suicidal_ideation_ko");
    expect(result.missingFields).toHaveLength(0);
  });

  it.each([
    ["pt", "Eu quero morrer e não quero mais viver."],
    ["fr", "Je veux mourir. Je ne veux plus vivre."],
    ["ja", "死にたい。もう生きたくない。"],
  ])("detects a direct %s suicide disclosure", async (_locale, value) => {
    const result = await extractRuntimeState({ patientInput: { kind: "text", value }, currentNode: makeNode("therapyGoals"), currentContext: { fields: {}, riskSignals: [], iterationCounts: {}, riskLevel: "low" } });
    expect(result.riskLevel).toBe("high");
    expect(result.fields.crisisSignal).toBe(true);
  });

  it("detects no-more-evidence phrases", async () => {
    const result = await extractRuntimeState({ patientInput: { kind: "text", value: "Não consigo pensar em mais nenhum" }, currentNode: makeNode("evidenceFor"), currentContext: { fields: {}, riskSignals: [], iterationCounts: {}, riskLevel: "low" } });
    expect(result.fields.evidenceForNoMore).toBe(true);
  });

  it("rejects a greeting or bare confirmation but accepts a substantive open-ended response", async () => {
    const greeting = await extractRuntimeState({ patientInput: { kind: "text", value: "hi" }, currentNode: makeNode("situationThoughtDistinction"), currentContext: { fields: {}, riskSignals: [], iterationCounts: {}, riskLevel: "low" } });
    const bareConfirmation = await extractRuntimeState({ patientInput: { kind: "text", value: "yes" }, currentNode: makeNode("situationThoughtDistinction"), currentContext: { fields: {}, riskSignals: [], iterationCounts: {}, riskLevel: "low" } });
    const substantive = await extractRuntimeState({ patientInput: { kind: "text", value: "I avoid speaking during meetings because I expect to make a mistake." }, currentNode: makeNode("situationThoughtDistinction"), currentContext: { fields: {}, riskSignals: [], iterationCounts: {}, riskLevel: "low" } });

    expect(greeting.missingFields).toContain("situationThoughtDistinction");
    expect(bareConfirmation.missingFields).toContain("situationThoughtDistinction");
    expect(substantive.missingFields).toHaveLength(0);
    expect(substantive.fields.situationThoughtDistinction).toContain("avoid speaking");
  });

  it("does not accept gibberish for the source-backed situation distinction", async () => {
    const promptItem = makePrompt("situationThoughtDistinction", { kind: "participant_articulated_distinction" });
    const result = await extractRuntimeState({ patientInput: { kind: "text", value: "fuiissiidojfosid" }, currentNode: makeNode("situationThoughtDistinction"), currentPromptItem: promptItem, currentContext: { fields: {}, riskSignals: [], iterationCounts: {}, riskLevel: "low" } });

    expect(result.missingFields).toContain("situationThoughtDistinction");
  });

  it("does not infer a factual automatic thought from its wording", async () => {
    const result = await extractRuntimeState({ patientInput: { kind: "text", value: "I am going to lose this job." }, currentNode: makeNode("automaticThought"), currentContext: { fields: {}, riskSignals: [], iterationCounts: {}, riskLevel: "low" } });
    expect(result.fields.automaticThought).toBe("I am going to lose this job.");
    expect(result.fields.automaticThoughtIsFactual).toBeUndefined();
  });

  // Regression coverage for the "same clarification repeats even after a
  // clearly sufficient elaboration" bug: DeterministicAssessmentModel's
  // multi-field situation/thought split only recognizes English connector
  // phrasing ("...and I thought that..."), so a Korean answer to a
  // distressingSituation + automaticThought prompt never gets split no
  // matter how clear it is, and every field stayed permanently unset,
  // reproducing the identical clarification turn after turn. The fix is
  // the lenient-retry fallback in runtime-context.ts: once the patient has
  // already been asked to clarify this exact prompt once
  // (clarificationAttemptCount >= 1), a further on-topic reply is accepted
  // and fills whatever fields are still unset instead of looping again.
  describe("lenient retry for a non-English multi-field prompt (repeated-clarification regression)", () => {
    function distressingSituationPromptAndNode() {
      const promptItem = {
        ...makePrompt("distressingSituation"),
        id: "tbct-s01-n01-p01-distressing-situation",
        outputFields: ["distressingSituation", "automaticThought"],
        editableText: "Ask for a distressing situation and the automatic thought it triggered.",
      } satisfies PromptItem;
      const node = { ...makeNode("distressingSituation"), requiredFields: ["distressingSituation", "automaticThought"] };
      return { promptItem, node };
    }

    it("accepts the elaboration on the second reply instead of asking the identical question a third time (사례 2: 발표 상황)", async () => {
      const { promptItem, node } = distressingSituationPromptAndNode();
      const firstTurn = await extractRuntimeState({
        patientInput: { kind: "text", value: "선생님과 발표를 했었던 상황이었어" },
        currentNode: node,
        currentPromptItem: promptItem,
        currentContext: { fields: {}, riskSignals: [], iterationCounts: {}, riskLevel: "low" },
        locale: "ko-KR",
      });
      // First attempt: the deterministic fallback can't split non-English
      // text, so this still asks for the missing concept once -- the
      // regression is specifically about what happens next, not this turn.
      expect(firstTurn.missingFields.length).toBeGreaterThan(0);

      const secondTurn = await extractRuntimeState({
        patientInput: { kind: "text", value: "발표에서 말을 절었지" },
        currentNode: node,
        currentPromptItem: promptItem,
        currentContext: { fields: firstTurn.fields, riskSignals: [], iterationCounts: {}, riskLevel: "low", clarificationAttemptCount: 1 },
        locale: "ko-KR",
      });

      expect(secondTurn.missingFields).toHaveLength(0);
      expect(secondTurn.fields.distressingSituation).toBeTruthy();
      expect(secondTurn.fields.automaticThought).toBeTruthy();
    });

    it("accepts the elaboration on the second reply for the study/concentration example (사례 1: 공부 집중)", async () => {
      const { promptItem, node } = distressingSituationPromptAndNode();
      const firstTurn = await extractRuntimeState({
        patientInput: { kind: "text", value: "요즘 너무 공부가 안돼" },
        currentNode: node,
        currentPromptItem: promptItem,
        currentContext: { fields: {}, riskSignals: [], iterationCounts: {}, riskLevel: "low" },
        locale: "ko-KR",
      });
      expect(firstTurn.missingFields.length).toBeGreaterThan(0);

      const secondTurn = await extractRuntimeState({
        patientInput: { kind: "text", value: "공부를 해야 하는데 집중이 잘 안돼" },
        currentNode: node,
        currentPromptItem: promptItem,
        currentContext: { fields: firstTurn.fields, riskSignals: [], iterationCounts: {}, riskLevel: "low", clarificationAttemptCount: 1 },
        locale: "ko-KR",
      });

      expect(secondTurn.missingFields).toHaveLength(0);
      expect(secondTurn.fields.distressingSituation).toBeTruthy();
      expect(secondTurn.fields.automaticThought).toBeTruthy();
    });

    it("still rejects a non-answer on a lenient retry -- leniency does not disable the meaningful-text gate", async () => {
      const promptItem = makePrompt("situationThoughtDistinction", { kind: "participant_articulated_distinction" });
      const result = await extractRuntimeState({
        patientInput: { kind: "text", value: "ok" },
        currentNode: makeNode("situationThoughtDistinction"),
        currentPromptItem: promptItem,
        currentContext: { fields: {}, riskSignals: [], iterationCounts: {}, riskLevel: "low", clarificationAttemptCount: 1 },
      });
      expect(result.missingFields).toContain("situationThoughtDistinction");
    });

    it("still escalates a safety signal on a lenient retry instead of silently accepting it as the answer", async () => {
      const result = await extractRuntimeState({
        patientInput: { kind: "text", value: "I wanna die" },
        currentNode: makeNode("candidateOneThought"),
        currentPromptItem: makePrompt("candidateOneThought"),
        currentContext: { fields: {}, riskSignals: [], iterationCounts: {}, riskLevel: "low", clarificationAttemptCount: 1 },
      });
      expect(result.riskLevel).toBe("high");
      expect(result.riskSignals).toContain("suicide");
    });

    it("still rejects an out-of-range rating on a lenient retry -- numeric validation stays strict", async () => {
      const result = await extractRuntimeState({
        patientInput: { kind: "rating", value: "200" },
        currentNode: makeNode("initialATBeliefPercent", "rating"),
        currentContext: { fields: {}, riskSignals: [], iterationCounts: {}, riskLevel: "low", clarificationAttemptCount: 1 },
      });
      expect(result.missingFields).toContain("initialATBeliefPercent");
    });
  });

  it("uses an explicit source-backed confirmation field for factual-thought routing", async () => {
    const promptItem = {
      id: "source-confirmation",
      protocolId: "tbct-br-001",
      sessionId: "tbct-s03",
      nodeId: "node-automaticThoughtIsFactual",
      order: 1,
      type: "confirmation",
      verbatimText: "Source confirmation",
      editableText: "Source confirmation",
      aiInstruction: "",
      activationCondition: null,
      outputFields: ["automaticThoughtIsFactual"],
      validation: { kind: "boolean" },
      completionEffect: null,
      restrictions: [],
      safetyRuleIds: [],
      sourceTrace: { sourceDocument: "TBCT pasted source text", sourceSession: "Session 03", sourceSection: "Factual thought", sourceLineStart: 511, sourceLineEnd: 528, sourceTextHash: "test", importedVersion: "test" },
      sourceFidelityStatus: "structured_from_source",
      origin: "source_imported",
      sourceHash: "test",
      status: "active",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-01T00:00:00.000Z",
      updatedBy: "test",
    } satisfies PromptItem;
    const result = await extractRuntimeState({ patientInput: { kind: "boolean", value: true }, currentNode: makeNode("automaticThought"), currentPromptItem: promptItem, currentContext: { fields: {}, riskSignals: [], iterationCounts: {}, riskLevel: "low" } });

    expect(result.fields.automaticThoughtIsFactual).toBe(true);
  });

  // TBCT S01-S03 정상 발화 오인 수정 (2026-08-17 fidelity pass): P0-1/P0-2/P0-5/P0-6/P1-1 corpora.
  describe("P0-1: refusal false-positive corpus", () => {
    it.each([
      ["이 행동을 그만하고 싶어요", false],
      ["머리카락 만지는 걸 그만하고 싶어요", false],
      ["회피하는 습관을 그만하고 싶어요", false],
      ["회사를 그만두고 싶어요", false],
      ["이 생각을 멈추고 싶어요", false],
      ["프로젝트 진행을 하기 싫어요", false],
      ["상담을 그만하고 싶어요", true],
      ["이 세션을 중단하고 싶어요", true],
      ["치료를 더 진행하고 싶지 않아요", true],
      ["오늘은 여기서 그만할래요", true],
    ])("%s -> refusal=%s", (text, expected) => {
      expect(isExplicitPatientRefusal(text)).toBe(expected);
    });
  });

  describe("P0-2: noMore false-positive corpus", () => {
    function evidenceForResult(rawText: string) {
      return extractRuntimeState({
        patientInput: { kind: "text", value: rawText },
        currentNode: makeNode("evidenceFor"),
        currentContext: { fields: { evidenceFor: ["기존 증거 하나"] }, riskSignals: [], iterationCounts: {}, riskLevel: "low" },
      });
    }

    it.each([
      ["의욕이 없어요", false],
      ["친구가 없어요", false],
      ["돈이 없어요", false],
      ["자신감이 없어요", false],
      ["에너지가 없어요", false],
      ["없어요", true],
      ["더 없어요", true],
      ["더는 없어요", true],
      ["추가로는 없어요", true],
      ["더 생각나는 건 없어요", true],
    ])("%s -> evidenceForNoMore=%s", async (text, expectedNoMore) => {
      const result = await evidenceForResult(text);
      expect(result.fields.evidenceForNoMore).toBe(expectedNoMore);
      if (!expectedNoMore) {
        // Real clinical content must still be recorded as a new list entry,
        // not silently dropped just because it wasn't treated as "no more".
        expect(result.fields.evidenceFor).toContain(text);
      }
    });
  });

  describe("P0-5: process-clarification request corpus", () => {
    it.each([
      ["뭘요?", true],
      ["뭐를 말하면 되나요?", true],
      ["뭘 말하면 되나요?", true],
      ["질문이 이해가 안 돼요", true],
      ["다시 설명해 주세요", true],
      ["쉽게 말해 주세요", true],
      ["네", false],
      ["네, 알겠습니다", false],
      ["회의에서 발표 순서가 왔어요", false],
    ])("%s -> looksLikeMeaningClarificationRequest=%s", (text, expected) => {
      expect(looksLikeMeaningClarificationRequest(normalizeText(text))).toBe(expected);
    });

    // English quality parity: this detector is shared across S01/S02/S03 via
    // detectProcessClarificationRequest, so an English-only gap here silently
    // degraded process-clarification handling in every one of those sessions.
    it.each([
      ["Huh?", true],
      ["What?", true],
      ["Sorry, what?", true],
      ["What should I say?", true],
      ["I don't understand the question.", true],
      ["Please explain that again.", true],
      ["Explain this again", true],
      ["Can you say that more simply?", true],
      ["Could you say this more simply?", true],
      ["Yes", false],
      ["Yes, I understand.", false],
      ["It was my turn to present at the meeting.", false],
    ])("%s -> looksLikeMeaningClarificationRequest=%s", (text, expected) => {
      expect(looksLikeMeaningClarificationRequest(normalizeText(text))).toBe(expected);
    });

    it.each([
      ["왜 이걸 물어봐요?", true],
      ["왜 물어보세요?", true],
      ["그게 무슨 말이에요?", true],
      ["회의에서 발표 순서가 왔어요", false],
    ])("%s -> looksLikeMetaQuestionAboutTheProcess=%s", (text, expected) => {
      expect(looksLikeMetaQuestionAboutTheProcess(normalizeText(text))).toBe(expected);
    });

    // S02's rating-card-check/goal-rating-card-check explanation-request
    // detector (exported for runtime-execution-api.ts's deliverClarificationTurn).
    it.each([
      ["설명해주세요", true],
      ["설명해 주시겠어요", true],
      ["잘 모르겠는데", true],
      ["이해가 안 돼요", true],
      ["앞에서 말했잖아요", true],
      ["please explain", true],
      ["Please explain", true],
      ["Can you explain?", true],
      ["I'm not sure", true],
      ["Not sure", true],
      ["I don't get it", true],
      ["I don't understand it", true],
      ["I already said that before", true],
      ["Yes I have the card", false],
      ["네, 카드 있어요", false],
    ])("%s -> looksLikeS02ExplanationRequest=%s", (text, expected) => {
      expect(looksLikeS02ExplanationRequest(text)).toBe(expected);
    });

    // EN/KO parity check: this idiom table used to be Korean-only ("이미
    // 이루어서 없어요" / "딱히 없어요") with no English mirror -- an
    // English-speaking participant using the equivalent idiom risked having
    // it stored as a literal problem/goal instead of ending the list.
    it.each([
      ["이미 이루어서 없어요", true],
      ["딱히 없어요", true],
      ["I already achieved that", true],
      ["I already accomplished my goal", true],
      ["Not really", true],
      ["Nothing in particular", true],
      ["일이 너무 많아요", false],
      ["I'm stressed about work", false],
    ])("%s -> looksLikeS02NoMoreIdiom=%s", (text, expected) => {
      expect(looksLikeS02NoMoreIdiom(text)).toBe(expected);
    });
  });

  describe("P0-6: safety false-positive corpus (negated/historical/third-party)", () => {
    it.each([
      ["지금 죽고 싶어요", false],
      ["지금 자해하고 싶어요", false],
      ["목숨을 끊고 싶어요", false],
      ["죽고 싶은 건 아니에요. 그냥 너무 지쳤어요.", true],
      ["예전에는 죽고 싶었지만 지금은 아니에요.", true],
      ["친구가 죽고 싶다고 해서 걱정돼요.", true],
    ])("%s -> isNonCurrentRiskMention=%s", (text, expected) => {
      expect(isNonCurrentRiskMention(text)).toBe(expected);
    });

    it("a negated mention routes to ambiguous_safety_language with low risk, not an immediate high-risk crisis route", async () => {
      const result = await extractRuntimeState({
        patientInput: { kind: "text", value: "죽고 싶은 건 아니에요. 그냥 너무 지쳤어요." },
        currentNode: makeNode("automaticThought"),
        currentContext: { fields: {}, riskSignals: [], iterationCounts: {}, riskLevel: "low" },
      });
      expect(result.riskLevel).toBe("low");
      expect(result.riskSignals).toContain("ambiguous_safety_language");
      expect(result.fields.crisisSignal).toBeUndefined();
    });

    it("an unqualified current disclosure is unaffected and still escalates immediately", async () => {
      const result = await extractRuntimeState({
        patientInput: { kind: "text", value: "지금 너무 힘들어서 죽고 싶어요" },
        currentNode: makeNode("automaticThought"),
        currentContext: { fields: {}, riskSignals: [], iterationCounts: {}, riskLevel: "low" },
      });
      expect(result.riskLevel).toBe("high");
      expect(result.fields.crisisSignal).toBe(true);
    });
  });

  describe("P1-1: S02 color-coded rating parsing and between-two-scores uncertainty", () => {
    function ratingPrompt() {
      return {
        ...makePrompt("problemRatings", { kind: "rating", min: 0, max: 5, includeColor: true }),
        id: "tbct-s02-n05-p01-reflect-problem-score",
        outputFields: ["problemRatings"],
      } satisfies PromptItem;
    }

    it.each([
      ["4", 4],
      ["4점", 4],
      ["노란색", 4],
      ["노란색이요", 4],
      ["빨간색 같아요", 5],
      ["진한 초록색 정도요", 3],
    ])("%s -> stored rating %s", async (text, expected) => {
      const result = await extractRuntimeState({
        patientInput: { kind: "text", value: text },
        currentNode: makeNode("problemRatings"),
        currentPromptItem: ratingPrompt(),
        currentContext: { fields: {}, riskSignals: [], iterationCounts: {}, riskLevel: "low" },
        locale: "ko-KR",
      });
      expect(result.fields.problemRatings).toEqual([expected]);
    });

    it.each(["2랑 3 사이 같아요", "2인지 3인지 모르겠어요"])("%s -> not immediately recorded, flags uncertainty instead", async (text) => {
      const result = await extractRuntimeState({
        patientInput: { kind: "text", value: text },
        currentNode: makeNode("problemRatings"),
        currentPromptItem: ratingPrompt(),
        currentContext: { fields: {}, riskSignals: [], iterationCounts: {}, riskLevel: "low" },
        locale: "ko-KR",
      });
      expect(result.fields.problemRatings).toBeUndefined();
      expect(result.fields.currentProblemScoreUncertain).toBe(true);
    });

    it("a resolved rating after uncertainty clears the uncertain flag", async () => {
      const uncertainTurn = await extractRuntimeState({
        patientInput: { kind: "text", value: "2와 3 사이 같아요" },
        currentNode: makeNode("problemRatings"),
        currentPromptItem: ratingPrompt(),
        currentContext: { fields: {}, riskSignals: [], iterationCounts: {}, riskLevel: "low" },
        locale: "ko-KR",
      });
      expect(uncertainTurn.fields.currentProblemScoreUncertain).toBe(true);

      const resolvedTurn = await extractRuntimeState({
        patientInput: { kind: "text", value: "3이요" },
        currentNode: makeNode("problemRatings"),
        currentPromptItem: ratingPrompt(),
        currentContext: { fields: uncertainTurn.fields, riskSignals: [], iterationCounts: {}, riskLevel: "low" },
        locale: "ko-KR",
      });
      expect(resolvedTurn.fields.problemRatings).toEqual([3]);
      expect(resolvedTurn.fields.currentProblemScoreUncertain).toBe(false);
    });
  });
});
