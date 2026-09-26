import type { SessionSourceMetadata, SessionSpec } from "@/shared/protocol/source-fidelity-catalog";

// S01 is prompt-driven (.claude/TASK_SCOPE.json
// note2026_09_25_prompt_driven_s01_s02). The whole session is run by the
// session prompt in docs/prompts/TBCT_AI_Prompt_S01.md (generated into
// src/shared/protocol/session-prompts.generated.ts) through
// src/shared/api/prompt-session-api.ts; the step-by-step node graph, turn
// rules, task intents and fixed messages that used to live in this folder are
// retired.
//
// What is left is a three-node shell the rest of the system still needs:
//  - the release validator wants a session_start and a session_complete node;
//  - safety events record the node and prompt they happened on;
//  - a clinician's resume after a safety hold goes to the session's
//    orientation node.
// The conversation lives on the orientation node from the first message to the
// last. The opening and closing nodes are never delivered.

const metadata: SessionSourceMetadata = {
  number: 1,
  id: "tbct-s01",
  title: "Introduction to the TBCT Model",
  titleKo: "TBCT 모델 소개",
  techniqueName: "Cognitive Conceptualization Diagram (CCD), Level 1",
  acronym: "CCD Level 1",
  sourceLineStart: 18,
  sourceLineEnd: 222,
  sourceSessionHash: "44c5389a6ad419119c6b2fa0dc61273d5a8ef501bb53e17f13e09b711b3b7a39",
  contextRange: [23, 47],
  roleRange: [180, 193],
  languageRange: [22, 22],
  openingRange: [53, 65],
  requiredActionsRange: [66, 159],
  restrictionsRange: [160, 222],
  safetyRange: [160, 181],
};

const PROMPT_DRIVEN = "Run by the session prompt (docs/prompts/TBCT_AI_Prompt_S01.md); this node only anchors the conversation for safety records and resume.";

export const spec: SessionSpec = {
  metadata,
  nodes: [
    {
      slug: "opening",
      title: "Session Start",
      titleKo: "세션 시작",
      type: "session_start",
      source: [53, 65],
      objective: PROMPT_DRIVEN,
      prompts: [{ slug: "opening", type: "opening", source: [53, 65], patientText: "Hello, it's good to meet you." }],
    },
    {
      slug: "conversation",
      title: "Session Conversation",
      titleKo: "세션 대화",
      type: "orientation",
      source: [18, 222],
      objective: PROMPT_DRIVEN,
      prompts: [{ slug: "conversation", type: "question", source: [66, 159], patientText: "Please tell me in your own words." }],
    },
    {
      slug: "closing",
      title: "Session Complete",
      titleKo: "세션 마무리",
      type: "session_complete",
      source: [156, 159],
      terminal: true,
      objective: PROMPT_DRIVEN,
      prompts: [{ slug: "closing", type: "closing", source: [159, 159], patientText: "Thank you for sharing today. See you next time.", completionEffect: { type: "complete_session" } }],
    },
  ],
};
