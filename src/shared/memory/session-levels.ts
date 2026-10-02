// The TBCT level a session works at, by the book's session order (de Oliveira
// 2015, Trial-Based Cognitive Therapy, PDF p.22-24): level 1 (automatic
// thoughts) in Sessions 1-3, level 2 (underlying assumptions) from Session 4,
// level 3 (core beliefs) from Session 5 on. Memory RAG v2
// (note2026_10_02_memory_rag_v2_phase_a) uses it to keep a derived
// interpretation of a deeper level than the session has reached out of the
// model's view -- in S2, a reading of the participant's core belief would get
// ahead of the treatment. The participant's own words are never gated: they
// are what they said, at whatever level.

export type CognitiveLevel = 1 | 2 | 3;

/** The deepest level a session may work at. Session 0 (a clinician note, no
 * session) and anything below 1 count as level 1. */
export function levelForSession(sessionIndex: number): CognitiveLevel {
  if (sessionIndex >= 5) return 3;
  if (sessionIndex === 4) return 2;
  return 1;
}
