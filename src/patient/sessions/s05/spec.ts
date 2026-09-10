import { sourceText } from "@/lib/protocol/source-fidelity-catalog";
import type { SessionSourceMetadata, SessionSpec } from "@/lib/protocol/source-fidelity-catalog";

const metadata: SessionSourceMetadata = {
  number: 5,
  id: "tbct-s05",
  title: "Participation Grid (PG)",
  titleKo: "참여 격자표 (PG)",
  techniqueName: "Participation Grid (PG)",
  acronym: "PG",
  sourceLineStart: 804,
  sourceLineEnd: 931,
  sourceSessionHash: "313fe5df2c2e15f42053cd95e6194cd834eeaf4273e4849c16de89afda96d236",
  contextRange: [807, 827],
  roleRange: [804, 818],
  languageRange: [819, 826],
  openingRange: [828, 831],
  requiredActionsRange: [832, 879],
  restrictionsRange: [886, 914],
  safetyRange: [915, 931],
};

export const spec: SessionSpec = {
  metadata,
  nodes: [
    {
      slug: "baseline-guilt-shame",
      title: "Step 1 - Baseline Guilt and Shame",
      titleKo: "1단계 - 기저 죄책감과 수치심",
      type: "session_start",
      source: [828, 831],
      requiredFields: ["guiltBeliefBaseline", "shameIntensityBaseline", "shameBaselineRecorded"],
      safetyRuleIds: ["TBCT-S05-CRISIS-PAUSE"],
      restrictions: [sourceText([819, 826])],
      prompts: [
        { slug: "guilt-belief-baseline", type: "rating", source: [828, 831], marker: "On a scale of 0 to 100%", outputFields: ["guiltBeliefBaseline"], validation: { kind: "rating", min: 0, max: 100, register: "cognitive_belief" } },
        { slug: "shame-intensity-baseline", type: "rating", source: [828, 831], marker: "What's the size of this emotion", outputFields: ["shameIntensityBaseline", "shameBaselineRecorded"], validation: { kind: "rating_or_absent", min: 0, max: 100, register: "emotional_intensity" } },
      ],
    },
    {
      slug: "language-substitution",
      title: "Step 2 - Language Substitution",
      titleKo: "2단계 - 표현 바꾸기",
      type: "orientation",
      source: [832, 834],
      requiredFields: ["participationLanguageAccepted"],
      restrictions: [sourceText([819, 826])],
      prompts: [
        { slug: "participation-language", type: "explanation", source: [832, 834], marker: "I'm not asking about guilt or blame", outputFields: ["participationLanguageAccepted"], validation: { kind: "boolean" } },
      ],
    },
    {
      slug: "populate-grid",
      title: "Step 3 - Populate the Grid",
      titleKo: "3단계 - 격자 채우기",
      type: "question",
      source: [835, 838],
      requiredFields: ["contributors"],
      restrictions: [sourceText([835, 838])],
      prompts: [
        { slug: "list-contributors", type: "question", source: [835, 838], marker: "Name all people", outputFields: ["contributors"], validation: { kind: "array", minItems: 1, patientListedLast: true, noDeepExploration: true } },
        { slug: "participant-last", type: "instruction", source: [835, 838], marker: "We will come to yourself last", outputFields: ["contributors"], validation: { kind: "participant_last" } },
      ],
    },
    {
      slug: "first-participation-ratings",
      title: "Step 4 - First Round of Participation Ratings",
      titleKo: "4단계 - 참여도 평가 1차",
      type: "assessment",
      source: [839, 843],
      requiredFields: ["participationRatingsRound1", "participantParticipationRound1"],
      restrictions: [sourceText([839, 843])],
      prompts: [
        { slug: "rate-other-contributors", type: "rating", source: [839, 843], outputFields: ["participationRatingsRound1"], validation: { kind: "participation_percentages", min: 0, max: 100, sumTo: 100, participantLast: true } },
        { slug: "participant-remainder", type: "rating", source: [839, 843], marker: "Whatever remains after summing all others", outputFields: ["participantParticipationRound1"], validation: { kind: "computed_remainder", sumTo: 100, participantLast: true } },
        { slug: "guilt-distortion-check", type: "clarification", source: [839, 850], marker: "As you think about your own participation", activationCondition: { field: "participantRejectsRemainder", operator: "equals", value: true }, outputFields: ["participationRatingsRound1"] },
      ],
    },
    {
      slug: "socratic-deepening",
      title: "Step 5 - Socratic Deepening",
      titleKo: "5단계 - 소크라테스식 질문으로 깊이 살펴보기",
      type: "dialogue",
      source: [844, 850],
      requiredFields: ["contributorExploration"],
      restrictions: [sourceText([844, 850])],
      prompts: [
        { slug: "deepen-each-contributor", type: "question", source: [844, 847], marker: "Before we move to the next evaluation", outputFields: ["contributorExploration"], validation: { kind: "no_new_numbers_during_exploration" } },
        { slug: "new-contributor-next-round", type: "instruction", source: [839, 850], outputFields: ["deferredContributors"], validation: { kind: "defer_new_contributor_to_next_round" } },
      ],
    },
    {
      slug: "rerating-rounds",
      title: "Step 6 - Second Through Fifth Evaluations",
      titleKo: "6단계 - 2~5차 평가",
      type: "assessment",
      source: [851, 851],
      requiredFields: ["participationRatingRounds", "participationRatingStable"],
      restrictions: [sourceText([851, 851])],
      prompts: [
        // "Continue until the patient's own percentage stabilizes...
        // most frequently three rounds total (including the first)"
        // (tbct-source-text.generated.ts:854). Implemented as a bounded
        // repeat_until covering rounds 2-3 (the manual's own most-common
        // case) entirely within this one node/turn cycle -- deliberately
        // NOT a dynamic stability-driven loop re-entering this node
        // multiple times, which would need a node-graph self-loop; that
        // mechanism is untested elsewhere in this catalog and re-entering
        // a node doesn't reset its own per-node prompt-completion
        // tracking, so a self-loop here can cascade through several
        // "already complete" re-entries within a single turn with no
        // patient input in between. A future pass that also fixes that
        // re-entry behavior could extend this to the full 4/5-round case.
        {
          slug: "updated-percentage",
          type: "rating",
          source: [851, 851],
          marker: "Updated percentage",
          outputFields: ["participationRatingRounds"],
          validation: { kind: "participation_percentages", min: 0, max: 100, sumTo: 100, showPreviousOnly: true, maximumRounds: 5 },
          executionMode: "repeat_until",
          maxIterations: 42,
          completionCondition: { kind: "field", field: "participationReratingComplete", operator: "equals", value: true },
        },
        { slug: "reflect-without-interpretation", type: "reflection", source: [851, 851], marker: "How does that feel", patientText: "How does that feel to you now?", outputFields: ["participationRatingStable"] },
      ],
    },
    {
      slug: "guilt-shame-rerating",
      title: "Step 7 - Guilt and Shame Re-rating",
      titleKo: "7단계 - 죄책감과 수치심 재평가",
      type: "assessment",
      source: [852, 859],
      requiredFields: ["guiltBeliefFinal", "shameIntensityFinal"],
      restrictions: [sourceText([819, 826])],
      prompts: [
        { slug: "guilt-belief-final", type: "rating", source: [852, 859], marker: "How much do you now believe", outputFields: ["guiltBeliefFinal"], validation: { kind: "rating", min: 0, max: 100, register: "cognitive_belief" } },
        { slug: "shame-intensity-final", type: "rating", source: [852, 859], marker: "What's the size of this emotion", activationCondition: { field: "shameBaselineRecorded", operator: "equals", value: true }, outputFields: ["shameIntensityFinal"], validation: { kind: "rating", min: 0, max: 100, register: "emotional_intensity" } },
      ],
    },
    {
      slug: "values",
      title: "Step 8 - Values",
      titleKo: "8단계 - 가치관",
      type: "reflection",
      source: [860, 862],
      requiredFields: ["valuesArticulated"],
      nextSlug: "summary-table",
      restrictions: [sourceText([860, 862])],
      prompts: [
        { slug: "values", type: "question", source: [860, 862], marker: "As you think about what matters most", outputFields: ["valuesArticulated"], validation: { kind: "array", minItems: 1, forbiddenTerms: ["responsibility", "responsible"] } },
      ],
    },
    {
      slug: "residual-shame",
      title: "Step 9 - Downward Arrow on Residual Shame",
      titleKo: "9단계 - 남은 수치심 파고들기",
      type: "question",
      source: [863, 868],
      requiredFields: ["residualShameBelief"],
      nextSlug: "summary-table",
      restrictions: [sourceText([863, 868])],
      prompts: [
        { slug: "residual-shame-meaning", type: "question", source: [863, 868], marker: "When you think about [event]", outputFields: ["residualShameBelief"] },
        { slug: "residual-shame-probe", type: "follow_up", source: [863, 868], marker: "What does that mean about you", outputFields: ["residualShameBelief"] },
      ],
    },
    {
      slug: "summary-table",
      title: "Step 10 - Summary Table",
      titleKo: "10단계 - 요약표",
      type: "session_complete",
      source: [869, 879],
      restrictions: [sourceText([869, 879])],
      terminal: true,
      prompts: [
        { slug: "participant-summary-table", type: "worksheet_instruction", source: [869, 879], outputFields: ["summaryTable"], validation: { kind: "participation_grid_summary", contributorRows: true, guiltRegister: "cognitive_belief", shameRegister: "emotional_intensity", values: true }, completionEffect: { type: "complete_session" } },
      ],
    },
    {
      slug: "safety-pause",
      title: "Safety Pause and Clinician Review",
      titleKo: "안전을 위한 일시 중지 및 의료진 검토",
      type: "clinician_escalation",
      source: [915, 931],
      safetyRuleIds: ["TBCT-S05-CRISIS-PAUSE"],
      terminal: true,
      prompts: [
        { slug: "pause-grid", type: "instruction", source: [915, 931], outputFields: ["safetyEscalation"], completionEffect: { type: "pause_session" }, safetyRuleIds: ["TBCT-S05-CRISIS-PAUSE"] },
      ],
    },
  ],
  extraEdges: [
    { sourceSlug: "baseline-guilt-shame", targetSlug: "safety-pause", edgeType: "safety", source: [915, 931], label: "Crisis or destabilization", condition: { field: "crisisSignal", operator: "equals", value: true }, priority: 1 },
    { sourceSlug: "values", targetSlug: "residual-shame", edgeType: "conditional", source: [863, 868], label: "Residual shame requires follow-up", condition: { field: "residualShameRequiresDownwardArrow", operator: "equals", value: true }, priority: 1 },
  ],
};
