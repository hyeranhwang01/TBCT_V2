import type { ProtocolGraphEdge, ProtocolGraphNode, ProtocolSession } from "@/types/protocol-runtime";

export const REAL_SESSION_03_PROTOCOL_ID = "tbct-br-001";
export const REAL_SESSION_03_ID = "tbct-br-001-session-03";
export const REAL_SESSION_03_TITLE = "Intrapersonal Thought Record";
export const REAL_SESSION_03_VERSION = "0.4.1";

export const REAL_SESSION_03_SESSION: ProtocolSession = {
  id: REAL_SESSION_03_ID,
  protocolId: REAL_SESSION_03_PROTOCOL_ID,
  title: REAL_SESSION_03_TITLE,
  order: 3,
  goals: ["Introduce Intra-TR", "Complete Intra-TR worksheet"],
  entryNodeId: "session_start",
  completionNodeIds: ["session_complete"],
  nodeIds: [],
  edgeIds: [],
  status: "draft",
  locale: "pt-BR",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

function makeNode(id: string, type: ProtocolGraphNode["type"], title: string, y: number, data: Partial<ProtocolGraphNode["data"]>): ProtocolGraphNode {
  const now = new Date().toISOString();
  return {
    id,
    protocolId: REAL_SESSION_03_PROTOCOL_ID,
    sessionId: REAL_SESSION_03_ID,
    type,
    position: { x: 180, y },
    data: {
      protocolNodeId: id,
      protocolId: REAL_SESSION_03_PROTOCOL_ID,
      sessionId: REAL_SESSION_03_ID,
      nodeType: type,
      title,
      required: true,
      status: "draft",
      sourceStructuredItemIds: [id],
      sourceEvidenceIds: ["SESSION-03-MANUAL"],
      safetyRuleIds: [],
      completionConditionIds: [],
      metadata: { createdBy: "Demo User", createdAt: now, updatedBy: "Demo User", updatedAt: now },
      ...data,
    },
  };
}

function makeEdge(id: string, source: string, target: string, edgeType: ProtocolGraphEdge["edgeType"] = "default", label?: string, condition?: ProtocolGraphEdge["condition"], isFallback = false): ProtocolGraphEdge {
  const now = new Date().toISOString();
  return { id, protocolId: REAL_SESSION_03_PROTOCOL_ID, sessionId: REAL_SESSION_03_ID, source, target, edgeType, label, condition, priority: 1, isFallback, sourceEvidenceIds: ["SESSION-03-MANUAL"], createdAt: now, updatedAt: now };
}

function condition(id: string, field: string, value: string | number | boolean): NonNullable<ProtocolGraphEdge["condition"]> {
  return { id, field, operator: "equals", value };
}

export const REAL_SESSION_03_NODES: ProtocolGraphNode[] = [
  makeNode("session_start", "session_start", "Session Start", 80, { clinicalIntent: "Initialize the session and participant context.", runtimeAction: { actionType: "send_message", payload: { text: "Session initialized." } } }),
  makeNode("mandatory_safety_check", "safety_check", "Mandatory Safety Check", 220, { clinicalIntent: "Check urgent distress before continuing.", content: "I want to make sure we can continue safely. Are you okay today, and is there anything urgent or distressing I should know before we begin?", runtimeAction: { actionType: "run_safety_check", payload: { field: "safetyCheck", text: "I want to make sure we can continue safely. Are you okay today, and is there anything urgent or distressing I should know before we begin?" } }, safetyRuleIds: ["GLOBAL-RISK-01"] }),
  makeNode("intra_tr_introduction", "orientation", "Intra-TR Introduction", 360, { clinicalIntent: "Introduce the thought record and expected flow.", content: "Today we will work through an Intrapersonal Thought Record, one question at a time.", runtimeAction: { actionType: "send_message", payload: { text: "Today we will work through an Intrapersonal Thought Record, one question at a time." } } }),
  makeNode("q1_situation", "question", "Q1 Situation", 500, { clinicalIntent: "Identify one recent distressing situation.", content: "Can you describe a recent situation that has been causing you distress?", runtimeAction: { actionType: "ask_question", payload: { field: "situation", text: "Can you describe a recent situation that has been causing you distress?" } } }),
  makeNode("q2a_automatic_thought", "question", "Q2a Automatic Thought", 640, { clinicalIntent: "Capture the first automatic thought.", content: "At that moment, what went through your mind?", runtimeAction: { actionType: "ask_question", payload: { field: "automaticThought", text: "At that moment, what went through your mind?" } } }),
  makeNode("factual_at_check", "condition", "Factual AT Check", 780, { clinicalIntent: "Check whether the automatic thought reflects a factual event.", content: "Is this thought describing a fact that needs clarification, or is it an interpretation?", runtimeAction: { actionType: "collect_field", payload: { field: "automaticThoughtType", kind: "single_choice" } } }),
  makeNode("underlying_belief_confirmation", "question", "Underlying Belief Confirmation", 920, { clinicalIntent: "Explore the distress meaning behind the factual thought.", content: "What about this situation causes you the most distress, and what does it mean to you?", runtimeAction: { actionType: "ask_question", payload: { field: "underlyingBelief", text: "What about this situation causes you the most distress, and what does it mean to you?" } } }),
  makeNode("q2b_initial_at_belief", "assessment", "Q2b Initial Belief", 1060, { clinicalIntent: "Rate belief in the current working automatic thought.", content: "How much do you believe that thought right now, from 0 to 100?", runtimeAction: { actionType: "collect_field", payload: { field: "initialATBeliefPercent", kind: "rating", min: 0, max: 100 } } }),
  makeNode("q3a_primary_emotion", "question", "Q3a Primary Emotion", 1200, { clinicalIntent: "Identify the strongest emotion.", content: "What emotion do you feel when you have that thought?", runtimeAction: { actionType: "ask_question", payload: { field: "primaryEmotion", text: "What emotion do you feel when you have that thought?" } } }),
  makeNode("q3b_initial_emotion_intensity", "assessment", "Q3b Initial Emotion Intensity", 1340, { clinicalIntent: "Rate emotion intensity.", content: "How strong is that emotion, from 0 to 100?", runtimeAction: { actionType: "collect_field", payload: { field: "initialEmotionIntensityPercent", kind: "rating", min: 0, max: 100 } } }),
  makeNode("q4a_behavior", "question", "Q4a Behavior", 1480, { clinicalIntent: "Capture observable behavior.", content: "What did you do when you had that thought and emotion?", runtimeAction: { actionType: "ask_question", payload: { field: "behavior", text: "What did you do when you had that thought and emotion?" } } }),
  makeNode("q4b_body_sensations", "question", "Q4b Body Sensations", 1620, { clinicalIntent: "Capture body sensations.", content: "What did you notice in your body?", runtimeAction: { actionType: "ask_question", payload: { field: "bodySensations", text: "What did you notice in your body?" } } }),
  makeNode("participant_summary_checkpoint", "assessment", "Participant Summary Checkpoint", 1760, { clinicalIntent: "Have the participant summarize the pattern.", content: "Please summarize the situation, thought, feeling, and behavior in your own words.", runtimeAction: { actionType: "collect_field", payload: { field: "participantSummary", kind: "text" } } }),
  makeNode("q5_behavior_pros", "question", "Q5 Behavior Pros", 1900, { clinicalIntent: "Explore short-term pros.", content: "What did this behavior protect you from or help you avoid?", runtimeAction: { actionType: "ask_question", payload: { field: "behaviorPros", text: "What did this behavior protect you from or help you avoid?" } } }),
  makeNode("q6_behavior_cons", "question", "Q6 Behavior Cons", 2040, { clinicalIntent: "Explore costs.", content: "What were the disadvantages or costs of behaving that way?", runtimeAction: { actionType: "ask_question", payload: { field: "behaviorCons", text: "What were the disadvantages or costs of behaving that way?" } } }),
  makeNode("q7_cognitive_distortion", "assessment", "Q7 Cognitive Distortion", 2180, { clinicalIntent: "Identify the distortion label when appropriate.", content: "Which distortion best matches this thought?", runtimeAction: { actionType: "collect_field", payload: { field: "cognitiveDistortion", kind: "single_choice" } } }),
  makeNode("q8_evidence_for", "question", "Q8 Evidence For", 2320, { clinicalIntent: "Collect first supporting evidence.", content: "What evidence supports this thought?", runtimeAction: { actionType: "ask_question", payload: { field: "evidenceFor", text: "What evidence supports this thought?" } } }),
  makeNode("q8_additional_evidence", "question", "Q8 Additional Evidence", 2460, { clinicalIntent: "Collect additional supporting evidence or explicit no-more-evidence confirmation.", content: "Is there anything else that supports it, or is that all?", runtimeAction: { actionType: "ask_question", payload: { field: "evidenceFor", text: "Is there anything else that supports it, or is that all?" } } }),
  makeNode("q9_evidence_against", "question", "Q9 Evidence Against", 2600, { clinicalIntent: "Collect first contrary evidence.", content: "What evidence does not support this thought?", runtimeAction: { actionType: "ask_question", payload: { field: "evidenceAgainst", text: "What evidence does not support this thought?" } } }),
  makeNode("q9_additional_evidence", "question", "Q9 Additional Evidence", 2740, { clinicalIntent: "Collect additional contrary evidence or explicit no-more-evidence confirmation.", content: "Is there anything else that does not support it, or is that all?", runtimeAction: { actionType: "ask_question", payload: { field: "evidenceAgainst", text: "Is there anything else that does not support it, or is that all?" } } }),
  makeNode("q10a_balanced_conclusion", "question", "Q10 Balanced Conclusion", 2880, { clinicalIntent: "Create a balanced conclusion.", content: "Taking the evidence together, what is a more balanced conclusion?", runtimeAction: { actionType: "ask_question", payload: { field: "balancedConclusion", text: "Taking the evidence together, what is a more balanced conclusion?" } } }),
  makeNode("q10_therefore_extension", "dialogue", "Therefore Extension", 3020, { clinicalIntent: "Extend the balanced conclusion into a therefore statement.", content: "Therefore, what does that mean for you going forward?", runtimeAction: { actionType: "send_message", payload: { text: "Therefore, what does that mean for you going forward?" } } }),
  makeNode("q10b_full_conclusion_belief", "assessment", "Q10b Full Conclusion Belief", 3160, { clinicalIntent: "Rate belief in the full conclusion.", content: "How much do you believe the full conclusion now, from 0 to 100?", runtimeAction: { actionType: "collect_field", payload: { field: "conclusionBeliefPercent", kind: "rating", min: 0, max: 100 } } }),
  makeNode("q11_positive_emotions", "question", "Q11 Positive Emotions", 3300, { clinicalIntent: "Identify positive emotions from the balanced view.", content: "What positive emotions do you feel now, if any?", runtimeAction: { actionType: "ask_question", payload: { field: "positiveEmotions", text: "What positive emotions do you feel now, if any?" } } }),
  makeNode("q11_original_negative_emotion", "question", "Q11 Original Negative Emotion", 3440, { clinicalIntent: "Re-check the original negative emotion.", content: "What happened to the original negative emotion?", runtimeAction: { actionType: "ask_question", payload: { field: "originalNegativeEmotionAfter", text: "What happened to the original negative emotion?" } } }),
  makeNode("q11_emotion_intensities", "assessment", "Q11 Emotion Intensities", 3580, { clinicalIntent: "Record the current emotion intensities.", content: "Please rate the current emotions from 0 to 100.", runtimeAction: { actionType: "collect_field", payload: { field: "newEmotionIntensities", kind: "rating" } } }),
  makeNode("q12a_intended_action", "question", "Q12a Intended Action", 3720, { clinicalIntent: "Capture intended coping action.", content: "What do you intend to do next?", runtimeAction: { actionType: "ask_question", payload: { field: "intendedActions", text: "What do you intend to do next?" } } }),
  makeNode("q12b_new_body_sensations", "question", "Q12b New Body Sensations", 3860, { clinicalIntent: "Capture new body sensations.", content: "What do you notice in your body now?", runtimeAction: { actionType: "ask_question", payload: { field: "newBodySensations", text: "What do you notice in your body now?" } } }),
  makeNode("q13_revised_at_belief", "assessment", "Q13 Revised AT Belief", 4000, { clinicalIntent: "Re-rate belief in the original thought or working automatic thought.", content: "How much do you now believe the original thought or working thought, from 0 to 100?", runtimeAction: { actionType: "collect_field", payload: { field: "revisedATBeliefPercent", kind: "rating", min: 0, max: 100 } } }),
  makeNode("q14_global_evaluation", "question", "Q14 Global Evaluation", 4140, { clinicalIntent: "Capture overall change.", content: "How are you now compared with the start of the exercise?", runtimeAction: { actionType: "ask_question", payload: { field: "globalEvaluation", text: "How are you now compared with the start of the exercise?" } } }),
  makeNode("closing", "dialogue", "Closing", 4280, { clinicalIntent: "Close the exercise with support.", content: "Thank you for working through this exercise.", runtimeAction: { actionType: "send_message", payload: { text: "Thank you for working through this exercise." } } }),
  makeNode("session_complete", "session_complete", "Session Complete", 4420, { clinicalIntent: "Mark completion and preserve the record.", content: "Session completed.", runtimeAction: { actionType: "complete_session", payload: { text: "Session completed." } } }),
];

export const REAL_SESSION_03_EDGES: ProtocolGraphEdge[] = [
  makeEdge("S03-E-001", "session_start", "mandatory_safety_check"),
  makeEdge("S03-E-002", "mandatory_safety_check", "intra_tr_introduction", "default", undefined, condition("S03-C-001", "safetyClear", true)),
  makeEdge("S03-E-003", "intra_tr_introduction", "q1_situation"),
  makeEdge("S03-E-004", "q1_situation", "q2a_automatic_thought"),
  makeEdge("S03-E-005", "q2a_automatic_thought", "factual_at_check", "conditional", "Factual thought", condition("S03-C-002", "automaticThoughtType", "factual")),
  makeEdge("S03-E-006", "q2a_automatic_thought", "q2b_initial_at_belief", "conditional", "Distorted thought", condition("S03-C-003", "automaticThoughtType", "distorted")),
  makeEdge("S03-E-007", "factual_at_check", "underlying_belief_confirmation"),
  makeEdge("S03-E-008", "underlying_belief_confirmation", "q2b_initial_at_belief"),
  makeEdge("S03-E-009", "q2b_initial_at_belief", "q3a_primary_emotion"),
  makeEdge("S03-E-010", "q3a_primary_emotion", "q3b_initial_emotion_intensity"),
  makeEdge("S03-E-011", "q3b_initial_emotion_intensity", "q4a_behavior"),
  makeEdge("S03-E-012", "q4a_behavior", "q4b_body_sensations"),
  makeEdge("S03-E-013", "q4b_body_sensations", "participant_summary_checkpoint"),
  makeEdge("S03-E-014", "participant_summary_checkpoint", "q5_behavior_pros"),
  makeEdge("S03-E-015", "q5_behavior_pros", "q6_behavior_cons"),
  makeEdge("S03-E-016", "q6_behavior_cons", "q7_cognitive_distortion"),
  makeEdge("S03-E-017", "q7_cognitive_distortion", "q8_evidence_for"),
  makeEdge("S03-E-018", "q8_evidence_for", "q8_additional_evidence", "conditional", "More evidence", condition("S03-C-004", "evidenceForNoMore", false), false),
  makeEdge("S03-E-019", "q8_evidence_for", "q9_evidence_against", "conditional", "No more evidence", condition("S03-C-005", "evidenceForNoMore", true)),
  makeEdge("S03-E-020", "q8_additional_evidence", "q9_evidence_against"),
  makeEdge("S03-E-021", "q9_evidence_against", "q9_additional_evidence", "conditional", "More evidence", condition("S03-C-006", "evidenceAgainstNoMore", false)),
  makeEdge("S03-E-022", "q9_evidence_against", "q10a_balanced_conclusion", "conditional", "No more evidence", condition("S03-C-007", "evidenceAgainstNoMore", true)),
  makeEdge("S03-E-023", "q9_additional_evidence", "q10a_balanced_conclusion"),
  makeEdge("S03-E-024", "q10a_balanced_conclusion", "q10_therefore_extension"),
  makeEdge("S03-E-025", "q10_therefore_extension", "q10b_full_conclusion_belief"),
  makeEdge("S03-E-026", "q10b_full_conclusion_belief", "q11_positive_emotions"),
  makeEdge("S03-E-027", "q11_positive_emotions", "q11_original_negative_emotion"),
  makeEdge("S03-E-028", "q11_original_negative_emotion", "q11_emotion_intensities"),
  makeEdge("S03-E-029", "q11_emotion_intensities", "q12a_intended_action"),
  makeEdge("S03-E-030", "q12a_intended_action", "q12b_new_body_sensations"),
  makeEdge("S03-E-031", "q12b_new_body_sensations", "q13_revised_at_belief"),
  makeEdge("S03-E-032", "q13_revised_at_belief", "q14_global_evaluation"),
  makeEdge("S03-E-033", "q14_global_evaluation", "closing"),
  makeEdge("S03-E-034", "closing", "session_complete"),
];