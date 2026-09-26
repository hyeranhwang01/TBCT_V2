import type { SessionSourceMetadata, SessionSpec } from "@/shared/protocol/source-fidelity-catalog";

// S02 is prompt-driven (.claude/TASK_SCOPE.json
// note2026_09_25_prompt_driven_s01_s02). The whole session -- the bridge, the
// fifteen-pattern walkthrough, the CD-Quest scoring and the closing -- is run
// by the session prompt in docs/prompts/TBCT_AI_Prompt_S02.md (generated into
// src/shared/protocol/session-prompts.generated.ts) through
// src/shared/api/prompt-session-api.ts. The node graph, turn rules, task
// intents and fixed messages that used to live in this folder are retired.
//
// What is left is the same three-node shell as S01: the release validator
// wants a session_start and a session_complete node, safety events record the
// node and prompt they happened on, and a clinician's resume after a safety
// hold goes to the orientation node. The former safety-pause node and its
// crisisSignal edges are gone: they were never reached (the global safety rule
// always pre-empts them), and safety stays in code for every session.
//
// MANUAL/CODE divergence, unchanged from the redesign: the RCT prompt manual's
// Session 02 is Problems and Goals (CCPH/CCGH); this session follows the book's
// chapter 2 (CD-Quest) and the recorded second session. The source ranges
// below are only provenance for the shell.

const metadata: SessionSourceMetadata = {
  number: 2,
  id: "tbct-s02",
  title: "Cognitive Distortions",
  titleKo: "인지왜곡 유형",
  techniqueName: "Cognitive Distortions Questionnaire (CD-Quest)",
  acronym: "CD-Quest",
  sourceLineStart: 223,
  sourceLineEnd: 429,
  sourceSessionHash: "9703a52d23c715b044b7d7ab198d6eca39d0d8968a4520e7286afcd00f8e3e0b",
  contextRange: [230, 251],
  roleRange: [230, 239],
  languageRange: [230, 239],
  openingRange: [250, 261],
  requiredActionsRange: [145, 155],
  restrictionsRange: [388, 429],
  safetyRange: [411, 429],
};

const PROMPT_DRIVEN = "Run by the session prompt (docs/prompts/TBCT_AI_Prompt_S02.md); this node only anchors the conversation for safety records and resume.";

export const spec: SessionSpec = {
  metadata,
  nodes: [
    {
      slug: "opening",
      title: "Session Start",
      titleKo: "세션 시작",
      type: "session_start",
      source: [250, 261],
      objective: PROMPT_DRIVEN,
      prompts: [{ slug: "opening", type: "opening", source: [250, 254], patientText: "Good to see you again." }],
    },
    {
      slug: "conversation",
      title: "Session Conversation",
      titleKo: "세션 대화",
      type: "orientation",
      source: [223, 429],
      objective: PROMPT_DRIVEN,
      prompts: [{ slug: "conversation", type: "question", source: [145, 155], patientText: "Please tell me in your own words." }],
    },
    {
      slug: "closing",
      title: "Session Complete",
      titleKo: "세션 마무리",
      type: "session_complete",
      source: [388, 429],
      terminal: true,
      objective: PROMPT_DRIVEN,
      prompts: [{ slug: "closing", type: "closing", source: [388, 390], patientText: "Thank you for sharing today. See you next time.", completionEffect: { type: "complete_session" } }],
    },
  ],
};
