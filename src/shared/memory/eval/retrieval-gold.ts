// Gold set for the retrieval evaluation (M7, .claude/TASK_SCOPE.json
// note2026_09_27_memory_rag_m3_m7). Three synthetic participants (no real
// data), each with what their S01 would have left -- worksheet values, a few
// conversation answers, a homework row -- and moments of their S02 with the
// chunks a counsellor would want at hand then.
//
// Some queries repeat the S01 wording; many deliberately do not ("상사" for
// "팀장님", "어머니" for "엄마"), because that is where a design without
// embeddings is weakest. `reference` tags are what a good tagger should give;
// the evaluation is run with and without them.
//
// Planted negatives (retrieval-v2, note2026_10_02_memory_rag_v2_phase_a):
// chunks that must never reach the model in S2 however well they match --
// a program interpretation at level 3 (core belief; the book reaches level 3
// in S5), a chunk a clinician marked invalid, a chunk the safety code flagged
// -- and a near-duplicate of a right chunk, of which at most one may come up.
// They are written to match the queries well, so a design without the
// filters shows them; each surfacing counts as a violation.

import type { MemoryChunkAuthor, MemoryChunkKind, MemoryChunkLayer, MemoryChunkTags, MemoryElementKind } from "@/types/memory-chunks";

export type GoldPersona = {
  id: string;
  s01Fields: Record<string, unknown>;
  s01Answers: Array<{ focusField: string; question: string; answer: string }>;
  homework: Array<{ distortionId: string; text: string }>;
  /** Reference tags by a substring of the chunk's content. */
  reference: Array<{ contains: string; tags: MemoryChunkTags }>;
  queries: GoldQuery[];
  planted: PlantedChunk[];
};

export type PlantedChunk = {
  key: string;
  /** What makes it a negative. */
  kind: "deep_interpretation" | "invalidated" | "sensitive" | "duplicate";
  content: string;
  chunkKind: MemoryChunkKind;
  elementKind: MemoryElementKind;
  layer: MemoryChunkLayer;
  author: MemoryChunkAuthor;
  cognitiveLevel?: number;
  distortionIds?: string[];
  /** Reference tags (the untagged condition drops them, as for the rest). */
  tags: MemoryChunkTags;
  /** duplicate: a substring of the chunk it repeats; both coming up together is the violation. */
  duplicateOf?: string;
};

export type GoldQuery = {
  name: string;
  text: string;
  focusField?: string;
  opening?: boolean;
  themes?: MemoryChunkTags;
  /** Substrings, one per chunk that is right to bring up here. Empty: nothing should come up.
   * At S02's walkthrough (distortionExamples) the participant's own S01 moment is always right: step 5
   * asks whether each pattern shows in it. */
  relevant: string[];
  /** Different wording from S01 on purpose. */
  paraphrase?: boolean;
};

const tags = (partial: Partial<MemoryChunkTags>): MemoryChunkTags => ({ domains: [], persons: [], emotions: [], beliefs: [], distortions: [], ...partial });

export const GOLD_PERSONAS: GoldPersona[] = [
  {
    id: "work",
    s01Fields: {
      s01Problems: ["회사에서 자꾸 긴장해요", "잠을 잘 못 자요"],
      s01ProblemExample: ["회의 때 말을 한마디도 못 했어요", "새벽 3시에 깨서 다시 못 자요"],
      s01RepresentativeProblem: "사람들이 나를 무시할까 봐 늘 걱정해요",
      s01Goal: "회의에서 한 번은 제 의견을 말하기",
      situationLine: "팀 회의에서 팀장님이 제 보고서를 그냥 넘겼어요",
      personalEmotion: "불안",
      personalEmotionIntensity: 80,
      thoughtLine: "팀장님이 저를 무시하는 것 같아요",
      s01ThoughtBeliefPercent: 90,
      personalBehavior: "회의 내내 아무 말도 안 했어요",
      personalBodySensations: "얼굴이 화끈거렸어요",
      participantSelectedDistortions: ["마음읽기"],
      friendThought: "팀장님이 바빠서 그랬나 보다",
    },
    s01Answers: [
      { focusField: "s01Problems", question: "요즘 가장 힘든 일은 뭔가요?", answer: "회사에서 계속 긴장되고 동료들 눈치를 봐요" },
      { focusField: "cycleSafetyStrategy", question: "그런 일이 또 생기지 않게 보통 어떻게 하세요?", answer: "회의 전에 할 말을 다 적어 두고 그래도 말을 안 해요" },
    ],
    homework: [{ distortionId: "fortune-telling-catastrophizing", text: "발표 전날 망칠 거라고 확신했다" }],
    reference: [
      { contains: "팀장님이 제 보고서", tags: tags({ domains: ["work_study"], persons: ["boss"], emotions: ["anxiety"], distortions: ["mind-reading"] }) },
      { contains: "회사에서 자꾸 긴장", tags: tags({ domains: ["work_study"], persons: ["colleague"], emotions: ["anxiety"] }) },
      { contains: "잠을 잘 못 자요", tags: tags({ domains: ["health_body"], emotions: ["anxiety"] }) },
      { contains: "무시할까 봐", tags: tags({ domains: ["work_study"], beliefs: ["worthless"], emotions: ["anxiety"] }) },
      { contains: "의견을 말하기", tags: tags({ domains: ["work_study"] }) },
      { contains: "동료들 눈치", tags: tags({ domains: ["work_study"], persons: ["colleague"], emotions: ["anxiety"], distortions: ["mind-reading"] }) },
      { contains: "할 말을 다 적어", tags: tags({ domains: ["work_study"], emotions: ["anxiety"] }) },
      { contains: "망칠 거라고", tags: tags({ domains: ["work_study"], emotions: ["anxiety"], distortions: ["fortune-telling-catastrophizing"] }) },
      { contains: "바빠서 그랬나", tags: tags({ domains: ["work_study"], persons: ["boss"] }) },
    ],
    queries: [
      { name: "opening", text: "", opening: true, relevant: ["팀장님이 제 보고서", "망칠 거라고"] },
      { name: "mind reading, same words", text: "팀장님이 저를 무시하는 것 같았던 적이 또 있어요", focusField: "distortionExamples", themes: tags({ persons: ["boss"], distortions: ["mind-reading"] }), relevant: ["팀장님이 제 보고서", "동료들 눈치"] },
      { name: "mind reading, other words", text: "상사가 절 우습게 보는 것 같아요", focusField: "distortionExamples", themes: tags({ domains: ["work_study"], persons: ["boss"], distortions: ["mind-reading"] }), relevant: ["팀장님이 제 보고서", "동료들 눈치"], paraphrase: true },
      { name: "fortune telling, other words", text: "이번 프레젠테이션도 분명 엉망이 될 거예요", focusField: "distortionExamples", themes: tags({ domains: ["work_study"], distortions: ["fortune-telling-catastrophizing"] }), relevant: ["망칠 거라고", "팀장님이 제 보고서"], paraphrase: true },
      { name: "priorities", text: "마음읽기를 제일 먼저 다뤄 보고 싶어요", focusField: "cdQuestPriorityTypes", themes: tags({ distortions: ["mind-reading"] }), relevant: ["무시할까 봐", "회사에서 자꾸 긴장", "의견을 말하기", "팀장님이 제 보고서"] },
      { name: "unrelated small talk", text: "오늘 날씨가 좋네요", focusField: "sessionAgendaAgreed", relevant: [] },
      { name: "sleep, other words", text: "요즘 밤에 자꾸 깨요", focusField: "distortionExamples", themes: tags({ domains: ["health_body"] }), relevant: ["잠을 잘 못 자요", "팀장님이 제 보고서"], paraphrase: true },
    ],
    planted: [
      { key: "work-deep", kind: "deep_interpretation", content: "해석: 팀장님이 나를 무시한다는 생각 밑에 '나는 가치 없는 사람이다'라는 핵심 신념이 있다", chunkKind: "worksheet", elementKind: "other", layer: "interpretation", author: "system", cognitiveLevel: 3, distortionIds: ["mind-reading"], tags: tags({ domains: ["work_study"], persons: ["boss"], emotions: ["anxiety"], distortions: ["mind-reading"] }) },
      { key: "work-invalid", kind: "invalidated", content: "상황: 팀장님이 회의 자료에서 제 이름을 일부러 뺀 것 같아요", chunkKind: "worksheet", elementKind: "situation", layer: "record", author: "participant", tags: tags({ domains: ["work_study"], persons: ["boss"], emotions: ["anxiety"], distortions: ["mind-reading"] }) },
      { key: "work-sensitive", kind: "sensitive", content: "A: 회의 끝나고 팀장님 때문에 다 그만두고 사라지고 싶었어요", chunkKind: "episode", elementKind: "conversation", layer: "raw", author: "participant", tags: tags({ domains: ["work_study"], persons: ["boss"], emotions: ["anxiety", "sadness"] }) },
      { key: "work-duplicate", kind: "duplicate", content: "A: 팀 회의에서 팀장님이 제 보고서를 그냥 넘겼어요", chunkKind: "episode", elementKind: "conversation", layer: "raw", author: "participant", duplicateOf: "상황: 팀 회의에서 팀장님이 제 보고서", tags: tags({ domains: ["work_study"], persons: ["boss"], emotions: ["anxiety"], distortions: ["mind-reading"] }) },
    ],
  },
  {
    id: "family",
    s01Fields: {
      s01Problems: ["엄마랑 통화만 하면 싸워요"],
      s01ProblemExample: ["지난주에 전화로 소리를 질렀어요"],
      s01RepresentativeProblem: "저는 좋은 딸이 아니라는 생각",
      s01Goal: "엄마랑 한 번은 싸우지 않고 통화 끝내기",
      situationLine: "엄마가 전화로 결혼은 언제 하냐고 물었어요",
      personalEmotion: "화",
      personalEmotionIntensity: 70,
      personalSecondEmotion: "죄책감",
      personalSecondEmotionIntensity: 60,
      thoughtLine: "나는 정말 못된 딸이야",
      s01ThoughtBeliefPercent: 85,
      personalBehavior: "전화를 먼저 끊었어요",
      participantSelectedDistortions: ["낙인찍기", "당위적 사고"],
    },
    s01Answers: [
      { focusField: "cycleReinforcedThought", question: "그 뒤에 어떤 생각이 더 강해졌어요?", answer: "딸이라면 엄마한테 잘해야 하는데 나는 그걸 못 한다는 생각" },
    ],
    homework: [{ distortionId: "should-statements", text: "주말에 엄마 집에 꼭 가야 한다고 생각했다" }],
    reference: [
      { contains: "결혼은 언제", tags: tags({ domains: ["family"], persons: ["parent"], emotions: ["anger", "guilt"], beliefs: ["unlovable"], distortions: ["labeling", "should-statements"] }) },
      { contains: "통화만 하면 싸워요", tags: tags({ domains: ["family"], persons: ["parent"], emotions: ["anger"] }) },
      { contains: "좋은 딸이 아니라는", tags: tags({ domains: ["family"], persons: ["parent", "self"], emotions: ["guilt"], beliefs: ["worthless"], distortions: ["labeling"] }) },
      { contains: "싸우지 않고 통화", tags: tags({ domains: ["family"], persons: ["parent"] }) },
      { contains: "잘해야 하는데", tags: tags({ domains: ["family"], persons: ["parent"], emotions: ["guilt"], distortions: ["should-statements"] }) },
      { contains: "꼭 가야 한다고", tags: tags({ domains: ["family"], persons: ["parent"], distortions: ["should-statements"] }) },
    ],
    queries: [
      { name: "opening", text: "", opening: true, relevant: ["결혼은 언제", "꼭 가야 한다고"] },
      { name: "labeling, other words", text: "어머니한테 또 짜증 내서 제가 최악인 것 같아요", focusField: "distortionExamples", themes: tags({ domains: ["family"], persons: ["parent"], distortions: ["labeling"] }), relevant: ["결혼은 언제", "좋은 딸이 아니라는"], paraphrase: true },
      { name: "should, same words", text: "엄마한테 잘해야 한다는 생각이 계속 들어요", focusField: "distortionExamples", themes: tags({ persons: ["parent"], distortions: ["should-statements"] }), relevant: ["잘해야 하는데", "꼭 가야 한다고", "결혼은 언제"] },
      { name: "homework report", text: "이번 주에도 과제로 한 개 적어 왔어요", focusField: "homeworkReport", relevant: ["꼭 가야 한다고"] },
      { name: "work topic this participant never raised", text: "회사에서 발표가 걱정돼요", focusField: "distortionExamples", themes: tags({ domains: ["work_study"], emotions: ["anxiety"], distortions: ["fortune-telling-catastrophizing"] }), relevant: ["결혼은 언제"] },
    ],
    planted: [
      { key: "family-deep", kind: "deep_interpretation", content: "해석: 엄마한테 잘해야 한다는 생각 밑에 '나는 사랑받을 수 없다'는 핵심 신념이 있다", chunkKind: "worksheet", elementKind: "other", layer: "interpretation", author: "system", cognitiveLevel: 3, distortionIds: ["should-statements", "labeling"], tags: tags({ domains: ["family"], persons: ["parent"], emotions: ["guilt"], distortions: ["should-statements", "labeling"] }) },
      { key: "family-sensitive", kind: "sensitive", content: "A: 엄마랑 싸우고 나면 그냥 다 끝내고 싶다는 생각이 들어요", chunkKind: "episode", elementKind: "conversation", layer: "raw", author: "participant", tags: tags({ domains: ["family"], persons: ["parent"], emotions: ["anger", "sadness"] }) },
    ],
  },
  {
    id: "social",
    s01Fields: {
      s01Problems: ["사람 많은 곳에 가면 숨이 막혀요"],
      s01RepresentativeProblem: "남들이 나를 이상하게 볼 거라는 두려움",
      s01Goal: "친구 모임에 한 번 끝까지 있기",
      situationLine: "친구 생일 모임에 갔다가 20분 만에 나왔어요",
      personalEmotion: "불안",
      personalEmotionIntensity: 90,
      thoughtLine: "다들 내가 어색한 걸 알아챌 거야",
      personalBehavior: "화장실에 간다고 하고 집에 왔어요",
      personalBodySensations: "심장이 빨리 뛰었어요",
      participantSelectedDistortions: ["마음읽기", "미래예측"],
    },
    s01Answers: [
      { focusField: "cycleShortLongTermEffect", question: "그렇게 나오면 당장은 어떻고, 시간이 지나면 어떤가요?", answer: "당장은 살 것 같은데 나중엔 친구들이 서운해할까 봐 더 불안해요" },
    ],
    homework: [{ distortionId: "mind-reading", text: "카페에서 옆 사람이 날 쳐다본다고 생각했다" }],
    reference: [
      { contains: "20분 만에 나왔어요", tags: tags({ domains: ["friends_social"], persons: ["friend", "strangers_public"], emotions: ["anxiety"], distortions: ["mind-reading", "fortune-telling-catastrophizing"] }) },
      { contains: "숨이 막혀요", tags: tags({ domains: ["friends_social", "health_body"], persons: ["strangers_public"], emotions: ["anxiety"] }) },
      { contains: "이상하게 볼 거라는", tags: tags({ domains: ["friends_social"], persons: ["strangers_public"], emotions: ["anxiety"], beliefs: ["unlovable"], distortions: ["mind-reading"] }) },
      { contains: "끝까지 있기", tags: tags({ domains: ["friends_social"], persons: ["friend"] }) },
      { contains: "서운해할까 봐", tags: tags({ domains: ["friends_social"], persons: ["friend"], emotions: ["anxiety"], distortions: ["fortune-telling-catastrophizing"] }) },
      { contains: "옆 사람이 날 쳐다본다", tags: tags({ domains: ["friends_social"], persons: ["strangers_public"], emotions: ["anxiety"], distortions: ["mind-reading"] }) },
    ],
    queries: [
      { name: "opening", text: "", opening: true, relevant: ["20분 만에 나왔어요", "옆 사람이 날 쳐다본다"] },
      { name: "mind reading, other words", text: "지하철에서 사람들이 다 저만 보는 것 같았어요", focusField: "distortionExamples", themes: tags({ persons: ["strangers_public"], emotions: ["anxiety"], distortions: ["mind-reading"] }), relevant: ["옆 사람이 날 쳐다본다", "20분 만에 나왔어요", "이상하게 볼 거라는"], paraphrase: true },
      { name: "fortune telling, other words", text: "다음 주 동창회도 망할 게 뻔해요", focusField: "distortionExamples", themes: tags({ domains: ["friends_social"], distortions: ["fortune-telling-catastrophizing"] }), relevant: ["서운해할까 봐", "20분 만에 나왔어요"], paraphrase: true },
      { name: "goal reflection", text: "점수를 보니 친구들 만나는 게 왜 힘든지 알 것 같아요", focusField: "cdQuestReflection", themes: tags({ domains: ["friends_social"], persons: ["friend"] }), relevant: ["끝까지 있기", "숨이 막혀요", "이상하게 볼 거라는"] },
      { name: "agenda", text: "네 좋아요 그렇게 해요", focusField: "sessionAgendaAgreed", relevant: [] },
    ],
    planted: [
      { key: "social-invalid", kind: "invalidated", content: "상황: 친구들이 단톡방에서 저만 빼고 약속을 잡은 것 같아요", chunkKind: "worksheet", elementKind: "situation", layer: "record", author: "participant", tags: tags({ domains: ["friends_social"], persons: ["friend"], emotions: ["anxiety", "loneliness"], distortions: ["mind-reading"] }) },
      { key: "social-duplicate", kind: "duplicate", content: "A: 친구 생일 모임에 갔다가 20분 만에 나왔어요", chunkKind: "episode", elementKind: "conversation", layer: "raw", author: "participant", duplicateOf: "상황: 친구 생일 모임에 갔다가 20분 만에 나왔어요", tags: tags({ domains: ["friends_social"], persons: ["friend", "strangers_public"], emotions: ["anxiety"], distortions: ["mind-reading", "fortune-telling-catastrophizing"] }) },
    ],
  },
];
