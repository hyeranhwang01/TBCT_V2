import { sourceText } from "@/lib/protocol/source-fidelity-catalog";
import type { SessionSourceMetadata, SessionSpec } from "@/lib/protocol/source-fidelity-catalog";

const metadata: SessionSourceMetadata = {
  number: 6,
  id: "tbct-s06",
  title: "Color-Coded Symptoms Hierarchy (CCSH)",
  titleKo: "색상별 증상 위계 (CCSH)",
  techniqueName: "Color-Coded Symptoms Hierarchy (CCSH)",
  acronym: "CCSH",
  sourceLineStart: 932,
  sourceLineEnd: 1275,
  sourceSessionHash: "20aa58141718d98412740adf7d13432203785df845b9c7f6d609a5f7a54e38ac",
  contextRange: [943, 960],
  roleRange: [943, 960],
  languageRange: [961, 989],
  openingRange: [990, 1017],
  requiredActionsRange: [1018, 1206],
  restrictionsRange: [1207, 1275],
  safetyRange: [990, 1017],
  reviewRanges: [
    {
      range: [1207, 1275],
      warning: "The supplied source contains visible encoding/transcription corruption in this excerpt. Preserve it verbatim and require clinical source review before correction.",
    },
  ],
};

export const spec: SessionSpec = {
  metadata,
  nodes: [
    {
      slug: "opening-language-lock",
      title: "Opening and Language Lock",
      titleKo: "도입 및 언어 고정",
      type: "session_start",
      source: [943, 1017],
      requiredFields: ["sessionLanguage", "languageLocked"],
      safetyRuleIds: ["TBCT-S06-CRISIS-PAUSE"],
      restrictions: [sourceText([961, 989])],
      prompts: [
        { slug: "warm-opening", type: "opening", source: [943, 1017], marker: "What do you find difficult", outputFields: ["sessionLanguage", "languageLocked"], validation: { kind: "language_lock_from_first_substantive_message" } },
        { slug: "symptom-list-opening", type: "question", source: [1062, 1104], marker: "Tell me about the situations", outputFields: ["symptomItems"] },
      ],
    },
    {
      slug: "human-presence",
      title: "Human Presence and Room Safety",
      titleKo: "동석자 확인 및 공간 안전",
      type: "dialogue",
      source: [990, 1017],
      requiredFields: ["inRoomSafetyBehaviorCheck"],
      safetyRuleIds: ["TBCT-S06-CRISIS-PAUSE"],
      restrictions: [sourceText([990, 1017])],
      prompts: [
        { slug: "notice-going-quiet", type: "clarification", source: [990, 1017], marker: "I notice you've gone quieter", activationCondition: { field: "inRoomSafetyBehaviorObserved", operator: "equals", value: true }, outputFields: ["inRoomSafetyBehaviorCheck"] },
        { slug: "check-going-quiet", type: "question", source: [990, 1017], marker: "Going quiet is on your list", activationCondition: { field: "inRoomSafetyBehaviorObserved", operator: "equals", value: true }, outputFields: ["inRoomSafetyBehaviorCheck"] },
      ],
    },
    {
      slug: "symptom-list",
      title: "Step 1 - Symptom List and Item Expansion",
      titleKo: "1단계 - 증상 목록 작성 및 확장",
      type: "question",
      source: [1062, 1104],
      requiredFields: ["symptomItems"],
      restrictions: [sourceText([1062, 1104])],
      prompts: [
        { slug: "concrete-actions", type: "question", source: [1062, 1104], marker: "Tell me about the situations", outputFields: ["symptomItems"], validation: { kind: "array", minItems: 4, maxItems: 21, exactParticipantWords: true } },
        { slug: "modifier-decomposition", type: "clarification", source: [1062, 1104], marker: "Is [core situation] harder", outputFields: ["symptomItems"], validation: { kind: "granular_modifier_decomposition", noCollapsedCategories: true } },
        { slug: "close-list", type: "confirmation", source: [1062, 1104], outputFields: ["symptomItems"], validation: { kind: "modifier_walk_complete", recommendedMinItems: 6 } },
      ],
    },
    {
      slug: "color-scale-and-calibration",
      title: "Step 2 - Color Scale and Calibration",
      titleKo: "2단계 - 색상 척도 및 보정",
      type: "assessment",
      source: [1105, 1123],
      requiredFields: ["colorScalePresented", "calibrationScore"],
      restrictions: [sourceText([1105, 1123])],
      prompts: [
        { slug: "six-anchor-symptom-scale", type: "instruction", source: [1105, 1123], marker: "Comfortable or indifferent exposure", outputFields: ["colorScalePresented"], validation: { kind: "exact_scale_anchors", min: 0, max: 5, colors: ["light blue", "blue", "green", "green", "yellow", "red"] } },
        // The manual's "establish 0-1" (tbct-source-text.generated.ts:1115) describes the
        // EXPECTED result of scoring a benign in-session anchor ("talking with me during
        // this session"), not a hard input bound -- the calibration anchor uses the same
        // 0-5 color scale as every other item (six-anchor-symptom-scale above, and
        // item-score below). Encoding {max:1} here rejected any real 2-5 answer and
        // deadlocked the session after 3 clarification attempts.
        { slug: "calibration-anchor", type: "rating", source: [1105, 1123], marker: "First, let's calibrate", outputFields: ["calibrationScore"], validation: { kind: "rating", min: 0, max: 5, collectedBeforeItemScores: true } },
        { slug: "color-zone-rules", type: "explanation", source: [1105, 1123], outputFields: ["colorZoneRulesAcknowledged"], validation: { kind: "green_yellow_red_rules_presented" } },
      ],
    },
    {
      slug: "rate-items",
      title: "Step 2 - Rate Each Symptom Item",
      titleKo: "2단계 - 각 증상 항목 평가하기",
      type: "assessment",
      source: [1105, 1123],
      requiredFields: ["symptomItemScores"],
      restrictions: [sourceText([1105, 1123])],
      prompts: [
        {
          slug: "item-score",
          type: "rating",
          source: [1105, 1123],
          patientText: "In your own words, [item] — using our 0 to 5 color scale, how would you rate it?",
          outputFields: ["symptomItemScores"],
          validation: { kind: "hierarchy_item_score", min: 0, max: 5, exactParticipantWords: true, noRescoreExistingItem: true },
          // Re-asks this same prompt once per listed symptom item instead of
          // stopping after a single score, so every item gets its own rating.
          executionMode: "repeat_until",
          maxIterations: 21,
          completionCondition: { kind: "field", field: "allSymptomItemsRated", operator: "equals", value: true },
        },
      ],
    },
    {
      slug: "discomfort-distress",
      title: "Step 3 - Discomfort and Distress",
      titleKo: "3단계 - 불편함과 고통",
      type: "dialogue",
      source: [1124, 1138],
      requiredFields: ["discomfortDistressSummary"],
      restrictions: [sourceText([1124, 1138])],
      prompts: [
        { slug: "value-linked-discomfort", type: "question", source: [1124, 1138], marker: "Why do you go to work", outputFields: ["discomfortDistressSummary"] },
        { slug: "professional-effort", type: "question", source: [1124, 1138], marker: "Why do people study for years", outputFields: ["discomfortDistressSummary"] },
        { slug: "participant-capsule-summary", type: "summary", source: [1124, 1138], marker: "How would you explain the difference", outputFields: ["discomfortDistressSummary"], validation: { kind: "participant_summary_required" } },
      ],
    },
    {
      slug: "green-commitments",
      title: "Step 4 - Green Commitments",
      titleKo: "4단계 - 초록 단계 실천 약속",
      type: "homework",
      source: [1139, 1151],
      requiredFields: ["greenHomeworkItems", "accountabilityPartner", "fallbackPlan"],
      safetyRuleIds: ["TBCT-S06-NO-YELLOW-RED-HOMEWORK"],
      restrictions: [sourceText([1139, 1151])],
      prompts: [
        { slug: "choose-green-items", type: "question", source: [1139, 1151], marker: "Let's pick 2", outputFields: ["greenHomeworkItems"], validation: { kind: "green_homework_selection", minItems: 2, maxItems: 3, allowedScores: [2, 3], participantChooses: true } },
        { slug: "accountability-partner", type: "question", source: [1139, 1151], marker: "Who in your life", outputFields: ["accountabilityPartner"] },
        { slug: "plan-b", type: "question", source: [1139, 1151], marker: "And if that doesn't happen", outputFields: ["fallbackPlan"] },
      ],
    },
    {
      slug: "exposure-principles",
      title: "Step 5 - Exposure Principles",
      titleKo: "5단계 - 노출 원칙",
      type: "orientation",
      source: [1152, 1171],
      requiredFields: ["exposurePrinciplesAcknowledged"],
      restrictions: [sourceText([1152, 1171])],
      prompts: [
        { slug: "intensity", type: "explanation", source: [1152, 1171], marker: "I will never ask you", outputFields: ["exposurePrinciplesAcknowledged"] },
        { slug: "duration", type: "explanation", source: [1152, 1171], marker: "If you stay in the situation", outputFields: ["exposurePrinciplesAcknowledged"] },
        { slug: "frequency", type: "explanation", source: [1152, 1171], marker: "One exposure is never enough", outputFields: ["exposurePrinciplesAcknowledged"] },
        { slug: "homework-confirmation", type: "confirmation", source: [1152, 1171], marker: "So the green items", outputFields: ["greenHomeworkItems"] },
      ],
    },
    {
      slug: "relief-versus-overcoming",
      title: "Step 6 - Relief Versus Overcoming",
      titleKo: "6단계 - 안도감과 극복의 차이",
      type: "visualization",
      source: [1172, 1183],
      requiredFields: ["reliefVersusOvercomingInsight"],
      prompts: [
        // The markers here are the source's *example* situation ("going quiet in
        // a meeting"), not a situation every participant has. Without a
        // patientText the marker text reached participants verbatim and asked
        // about meetings even when nothing in their hierarchy involved one --
        // so these ask about the safety behavior the participant actually named.
        { slug: "relief-curve", type: "question", source: [1172, 1183], marker: "When you go quiet in a meeting", patientText: "At the moment you use that safety behavior, does the anxiety go up or down?", outputFields: ["reliefVersusOvercomingInsight"] },
        { slug: "next-meeting", type: "question", source: [1172, 1183], marker: "And the next meeting", patientText: "And the next time you are in that same situation, what happens?", outputFields: ["reliefVersusOvercomingInsight"] },
        { slug: "overcoming-curve", type: "explanation", source: [1172, 1183], marker: "Anxiety rises", outputFields: ["reliefVersusOvercomingInsight"] },
      ],
    },
    {
      slug: "circuit-two",
      title: "Step 7 - Circuit 2 and Underlying Assumption",
      titleKo: "7단계 - 2회차 순환과 근본 가정",
      type: "activity",
      source: [1184, 1206],
      requiredFields: ["safetyBehaviors", "underlyingAssumption", "circuitTwo", "circuitTwoSummary"],
      restrictions: [sourceText([1184, 1206])],
      prompts: [
        // "question", not "explanation": the curated text for this prompt
        // ends by asking "What safety behavior do you notice?" -- an
        // "explanation" type prompt completes on delivery regardless of
        // patient input, so safetyBehaviors was structurally guaranteed to
        // stay empty.
        { slug: "introduce-safety-behaviors", type: "question", source: [1184, 1206], marker: "There are behaviors you repeat", outputFields: ["safetyBehaviors"] },
        { slug: "patient-formulates-ua", type: "question", source: [1184, 1206], marker: "Because if you", outputFields: ["underlyingAssumption"], validation: { kind: "participant_formulated_conditional", requiredPattern: "if_then", level: 2, noCoreBelief: true } },
        { slug: "render-circuit-two", type: "worksheet_instruction", source: [1184, 1206], marker: "Underlying Assumption", outputFields: ["circuitTwo"], validation: { kind: "exact_circuit_structure" } },
        { slug: "place-on-diagram", type: "question", source: [1184, 1206], marker: "Where would you put that sentence", outputFields: ["circuitTwo"] },
        { slug: "circuit-two-summary", type: "summary", source: [1184, 1206], outputFields: ["circuitTwoSummary"], validation: { kind: "participant_summary_required" } },
      ],
    },
    {
      slug: "review-required-closing",
      title: "Interaction Rules, Failure Modes, and Closing",
      titleKo: "진행 원칙, 유의 사항, 마무리",
      type: "session_complete",
      source: [1207, 1275],
      safetyRuleIds: ["TBCT-S06-CRISIS-PAUSE", "TBCT-S06-NO-YELLOW-RED-HOMEWORK"],
      restrictions: [sourceText([1207, 1275])],
      terminal: true,
      prompts: [
        { slug: "session-worksheet", type: "worksheet_instruction", source: [1207, 1275], outputFields: ["ccshWorksheet"], validation: { kind: "ccsh_summary", includeItems: true, includeHomework: true, includeCircuitTwo: true }, completionEffect: { type: "complete_session" } },
      ],
    },
    {
      slug: "yellow-red-homework-block",
      title: "Yellow and Red Homework Block",
      titleKo: "노랑·빨강 단계 과제 제한",
      type: "condition",
      source: [1139, 1151],
      nextSlug: "green-commitments",
      safetyRuleIds: ["TBCT-S06-NO-YELLOW-RED-HOMEWORK"],
      restrictions: [sourceText([1139, 1151])],
      prompts: [
        { slug: "block-independent-homework", type: "instruction", source: [1139, 1151], outputFields: ["homeworkSelectionCorrection"], validation: { kind: "reject_non_green_homework" }, safetyRuleIds: ["TBCT-S06-NO-YELLOW-RED-HOMEWORK"] },
      ],
    },
    {
      slug: "safety-pause",
      title: "Safety Pause and Clinician Review",
      titleKo: "안전을 위한 일시 중지 및 의료진 검토",
      type: "clinician_escalation",
      source: [990, 1017],
      safetyRuleIds: ["TBCT-S06-CRISIS-PAUSE"],
      terminal: true,
      prompts: [
        { slug: "pause-hierarchy", type: "instruction", source: [990, 1017], outputFields: ["safetyEscalation"], completionEffect: { type: "pause_session" }, safetyRuleIds: ["TBCT-S06-CRISIS-PAUSE"] },
      ],
    },
  ],
  extraEdges: [
    { sourceSlug: "opening-language-lock", targetSlug: "safety-pause", edgeType: "safety", source: [990, 1017], label: "Crisis signal", condition: { field: "crisisSignal", operator: "equals", value: true }, priority: 1 },
    { sourceSlug: "green-commitments", targetSlug: "yellow-red-homework-block", edgeType: "safety", source: [1139, 1151], label: "Yellow or red item proposed for independent homework", condition: { field: "currentHomeworkItemColor", operator: "in", value: ["yellow", "red"] }, priority: 1 },
  ],
};
