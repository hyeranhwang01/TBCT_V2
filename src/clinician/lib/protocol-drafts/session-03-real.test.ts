import { describe, expect, it } from "vitest";
import { REAL_SESSION_03_EDGES, REAL_SESSION_03_NODES } from "@/clinician/lib/protocol-drafts/session-03-real";

describe("Session 03 real graph", () => {
  it("matches the expected node order", () => {
    expect(REAL_SESSION_03_NODES.map((node) => node.id)).toEqual([
      "session_start",
      "mandatory_safety_check",
      "intra_tr_introduction",
      "q1_situation",
      "q2a_automatic_thought",
      "factual_at_check",
      "underlying_belief_confirmation",
      "q2b_initial_at_belief",
      "q3a_primary_emotion",
      "q3b_initial_emotion_intensity",
      "q4a_behavior",
      "q4b_body_sensations",
      "participant_summary_checkpoint",
      "q5_behavior_pros",
      "q6_behavior_cons",
      "q7_cognitive_distortion",
      "q8_evidence_for",
      "q8_additional_evidence",
      "q9_evidence_against",
      "q9_additional_evidence",
      "q10a_balanced_conclusion",
      "q10_therefore_extension",
      "q10b_full_conclusion_belief",
      "q11_positive_emotions",
      "q11_original_negative_emotion",
      "q11_emotion_intensities",
      "q12a_intended_action",
      "q12b_new_body_sensations",
      "q13_revised_at_belief",
      "q14_global_evaluation",
      "closing",
      "session_complete",
    ]);
  });

  it("has the required branch edges", () => {
    expect(REAL_SESSION_03_EDGES.some((edge) => edge.source === "q2a_automatic_thought" && edge.target === "factual_at_check")).toBe(true);
    expect(REAL_SESSION_03_EDGES.some((edge) => edge.source === "q2a_automatic_thought" && edge.target === "q2b_initial_at_belief")).toBe(true);
    expect(REAL_SESSION_03_EDGES.some((edge) => edge.source === "q8_evidence_for" && edge.target === "q8_additional_evidence")).toBe(true);
    expect(REAL_SESSION_03_EDGES.some((edge) => edge.source === "q9_evidence_against" && edge.target === "q9_additional_evidence")).toBe(true);
  });
});