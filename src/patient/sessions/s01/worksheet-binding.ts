import type { WorksheetBinding } from "@/types/worksheet";

// Session 1 worksheet bindings (.claude/TASK_SCOPE.json
// note2026_09_12_s01_redesign). They back the two paper worksheets used in
// the real first session, shown to the participant beside the chat and
// filled as they answer: the TBCT Conceptualization Diagram Phase 1 Level 1
// (problems/goals card, situation -> automatic thought -> feelings ->
// behavior/body, with the returning-arrows notes) and Level 1 Repeated 3
// times (the three-person example). Keys of fields that already existed are
// unchanged -- a stored definition's type is never updated in place, so a
// changed type would need a new key.
//
// Participant-owned fields hold the participant's own words. The scene and
// the feelings given to persons 2 and 3 are written by the system
// (s01/turn-rules.ts), so they are not participant-owned.

function binding(canonicalFieldKey: string, valueType: WorksheetBinding["valueType"], label: string, labelKo: string, sourceSection: string, displayOrder: number, options: { system?: boolean; confirmationRequired?: boolean; displayMode?: WorksheetBinding["displayMode"] } = {}): WorksheetBinding {
  const participantOwned = !options.system;
  return {
    sessionDefinitionId: "tbct-s01",
    canonicalFieldKey,
    worksheetFieldKey: canonicalFieldKey,
    visualElementId: `s01-${canonicalFieldKey}`,
    valueType,
    participantOwned,
    assistantMustNotSupply: participantOwned,
    confirmationRequired: options.confirmationRequired ?? false,
    displayMode: options.displayMode ?? (valueType === "text_list" ? "list" : valueType === "percentage" ? "number" : "verbatim"),
    label,
    labelKo,
    sourceSection,
    displayOrder,
  };
}

const PROBLEMS = "Problems and Goals";
const CCD = "Level 1";
const CYCLE = "Returning Arrows";
const THREE = "Level 1 Repeated";

export const TBCT_S01_BINDINGS: WorksheetBinding[] = [
  binding("s01Problems", "text_list", "My difficulties", "나의 어려움", PROBLEMS, 0),
  binding("s01RepresentativeProblem", "text", "The difficulty underneath the others", "대표 어려움", PROBLEMS, 1),
  binding("s01Goal", "text", "When counseling ends", "상담이 끝났을 때 바라는 모습", PROBLEMS, 2),
  binding("s01GoalBenefit", "long_text", "What would change", "이루면 달라질 것", PROBLEMS, 3),

  binding("situationThoughtDistinction", "text", "My situation (in my words)", "내 상황 (처음 하신 말)", CCD, 4),
  binding("situationLine", "text", "My situation in one line", "내 상황 한 줄", CCD, 5),
  binding("openingInitialThought", "text", "My thought", "그때 스친 생각", CCD, 6),
  binding("thoughtLine", "text", "My thought in one line", "생각 한 줄", CCD, 7),
  binding("s01ThoughtBeliefPercent", "percentage", "How much I believed it", "믿는 정도", CCD, 8),
  binding("personalEmotion", "text", "My feeling", "내 감정", CCD, 9),
  binding("personalEmotionIntensity", "percentage", "Feeling intensity", "감정 강도", CCD, 10),
  binding("personalSecondEmotion", "text", "Another feeling", "다른 감정", CCD, 11),
  binding("personalSecondEmotionIntensity", "percentage", "Its intensity", "그 감정의 강도", CCD, 12),
  binding("personalThirdEmotion", "text", "A third feeling", "세 번째 감정", CCD, 13),
  binding("personalThirdEmotionIntensity", "percentage", "Its intensity", "그 감정의 강도", CCD, 14),
  binding("personalBehavior", "text", "What I did", "내 행동", CCD, 15),
  binding("personalSecondBehavior", "text", "What else I did", "다른 행동", CCD, 16),
  binding("personalBodySensations", "text", "My body", "몸의 반응", CCD, 17),
  binding("friendThought", "text", "What a friend might think", "친구라면 했을 생각", CCD, 18),
  binding("cycleAfterBehaviorEmotion", "text", "Feeling after what I did", "행동 뒤의 감정", CYCLE, 19),
  binding("cycleReinforcedThought", "text", "The thought that got stronger", "더 강해진 생각", CYCLE, 20),
  binding("cycleSafetyStrategy", "text", "What I do to prevent it", "막으려고 하는 행동", CYCLE, 21),
  binding("cycleProblemLink", "text", "Link to my difficulty", "처음 어려움과의 연결", CYCLE, 22),
  binding("cycleShortLongTermEffect", "text", "Right away / over time", "당장 / 길게 보면", CYCLE, 23),
  binding("ownCaseActualOutcome", "text", "What actually happened", "그 뒤 실제로 일어난 일", CYCLE, 24),

  binding("threePersonScene", "text", "The scene (same for all three)", "상황 (세 사람 모두 같음)", THREE, 25, { system: true }),
  binding("candidateOneEmotion", "text", "Person 1 · Feeling", "첫 번째 사람 · 감정", THREE, 26),
  binding("candidateOneThought", "text", "Person 1 · Thought", "첫 번째 사람 · 생각", THREE, 27),
  binding("candidateOneBehavior", "text", "Person 1 · Behavior", "첫 번째 사람 · 행동", THREE, 28),
  binding("candidateOneBodySensations", "text", "Person 1 · Body", "첫 번째 사람 · 몸", THREE, 29),
  binding("candidateTwoThought", "text", "Person 2 · Thought", "두 번째 사람 · 생각", THREE, 30),
  binding("candidateTwoEmotion", "text", "Person 2 · Feeling", "두 번째 사람 · 감정", THREE, 31, { system: true }),
  binding("candidateTwoBehavior", "text", "Person 2 · Behavior", "두 번째 사람 · 행동", THREE, 32),
  binding("candidateTwoBodySensations", "text", "Person 2 · Body", "두 번째 사람 · 몸", THREE, 33),
  binding("candidateThreeThought", "text", "Person 3 · Thought", "세 번째 사람 · 생각", THREE, 34),
  binding("candidateThreeEmotion", "text", "Person 3 · Feeling", "세 번째 사람 · 감정", THREE, 35, { system: true }),
  binding("candidateThreeBehavior", "text", "Person 3 · Behavior", "세 번째 사람 · 행동", THREE, 36),
  binding("candidateThreeBodySensations", "text", "Person 3 · Body", "세 번째 사람 · 몸", THREE, 37),
  binding("threePersonModelInsight", "long_text", "What made the difference", "무엇이 차이를 만들었나", THREE, 38),

  binding("participantSummary", "long_text", "My summary", "내 요약", "Summary", 39, { confirmationRequired: true, displayMode: "confirmed_summary" }),
  binding("participantSelectedDistortions", "text_list", "Distortions I recognized", "내가 알아차린 인지 왜곡", "Cognitive Distortions", 40),
];
