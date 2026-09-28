"use client";

// DEV-ONLY, browser-only fixture data for locally viewing the patient UI
// (homework / session / profile screens) without live Supabase, Postgres,
// or Anthropic credentials.
//
// Safety: this never activates unless BOTH conditions hold --
//   (a) process.env.NODE_ENV !== "production"
//   (b) process.env.NEXT_PUBLIC_TBCT_PATIENT_MOCK === "1"
// -- fail-closed by default (the flag alone does nothing in a production
// build, so an accidentally-set env var in a deployed environment can never
// activate this). See isPatientMockModeEnabled().
//
// How it works: it intercepts fetch() to the same six Postgres-backed store
// endpoints the vitest suite already fakes offline, in-memory
// (src/test/fakes/install-fake-store-fetch.ts -- the exact machinery behind
// "npm test" and the offline audit scripts), then seeds them through the
// app's OWN real session/homework creation functions (createCanonicalTestRuntimeSession,
// ensureHomeworkRecord, etc.) rather than hand-building fixture objects --
// so the seeded data is always shaped exactly like what the live runtime
// produces. auth-context.tsx supplies the matching signed-in fake user (see
// PATIENT_MOCK_USER_ID) so patient pages that key off useAuth().user.id see
// this participant's data. Nothing here ever touches Supabase, DATABASE_URL,
// or ANTHROPIC_API_KEY, and no request leaves the browser while it's active.
//
// Usage: NEXT_PUBLIC_TBCT_PATIENT_MOCK=1 npm run dev

import { getOrCreateParticipantForUiLocale } from "@/shared/api/participant-api";
import { createCanonicalTestRuntimeSession } from "@/shared/api/runtime-session-api";
import { startRuntimeSession } from "@/shared/api/runtime-execution-api";
import { saveRuntimeMessage, updateRuntimeSessionRecord } from "@/shared/data/repositories/runtime-session-repository";
import { readBrowserStorageItem } from "@/shared/browser-storage";
import { UI_LOCALE_STORAGE_KEY } from "@/shared/i18n/context";
import { ensureHomeworkRecord } from "@/shared/data/repositories/homework-repository";
import { projectRuntimeFieldsToWorksheet } from "@/shared/worksheet/worksheet-projection";
import { HOMEWORK_LABEL_BY_SESSION, type HomeworkStatus } from "@/types/homework";
import type { RuntimeSessionStatus } from "@/types/runtime-session";

export const PATIENT_MOCK_USER_ID = "dev-mock-patient-user";
export const PATIENT_MOCK_EMAIL = "mock-patient@example.dev";

export function isPatientMockModeEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_TBCT_PATIENT_MOCK === "1";
}

type SeedSession = {
  sessionDefinitionId: string;
  status: RuntimeSessionStatus;
  homeworkStatus?: HomeworkStatus;
  daysAgo: number;
  /** A written-out example conversation, so a finished session opens on a
   * full transcript (S01/S02 run on the model and cannot be played through
   * offline). Invented demo text, not clinical content. */
  transcript?: [role: "assistant" | "patient", content: string][];
  /** Worksheet values to show beside that transcript. */
  worksheetFields?: Record<string, unknown>;
};

// 로컬 확인용 예시 대화 (지어낸 데모 문장, 임상 내용 아님). 완료된 1·2회기를
// 열면 대화가 여러 개 쌓였을 때의 화면을 볼 수 있다.
const S01_DEMO_TRANSCRIPT: NonNullable<SeedSession["transcript"]> = [
  ["assistant", "안녕하세요. 오늘은 첫 회기예요. 요즘 도움받고 싶은 어려움과 목표를 함께 정하고, 최근 있었던 한 장면으로 생각과 감정이 어떻게 이어지는지 살펴볼 거예요. 이렇게 진행해도 괜찮을까요?"],
  ["patient", "네, 좋아요."],
  ["assistant", "좋아요. 요즘 가장 도움받고 싶은 어려움은 어떤 것들이 있을까요? 떠오르는 대로 몇 가지 말씀해 주셔도 돼요."],
  ["patient", "회사에서 발표할 때 너무 긴장돼요. 그리고 요즘 잠을 잘 못 자요."],
  ["assistant", "두 가지를 말씀해 주셨네요. 발표할 때의 긴장, 그리고 잠. 그중에서 다른 것들 밑에 깔려 있는 것 같은 어려움을 하나 고른다면 어떤 걸까요?"],
  ["patient", "발표할 때 긴장하는 거요. 그 생각 때문에 잠도 못 자는 것 같아요."],
  ["assistant", "상담이 끝날 즈음, 그 어려움이 어떻게 달라져 있으면 좋겠어요?"],
  ["patient", "떨리더라도 끝까지 발표를 해내면 좋겠어요."],
  ["assistant", "최근에 그 긴장이 특히 컸던 장면을 하나 떠올려 볼까요? 어디서 무슨 일이 있었는지 한 줄로 말씀해 주세요."],
  ["patient", "지난주 팀 회의에서 제가 준비한 내용을 발표해야 했어요."],
  ["assistant", "그때 머릿속에 스쳐 간 생각은 무엇이었나요?"],
  ["patient", "다들 내가 준비를 제대로 안 했다고 생각할 거야."],
  ["assistant", "그 생각이 들었을 때 어떤 감정이 들었고, 0에서 100 사이로 얼마나 강했나요?"],
  ["patient", "불안이요. 80 정도요."],
  ["assistant", "말씀해 주셔서 고마워요. 같은 회의 장면이라도 다른 사람이라면 다른 생각을 했을 수 있어요. 상황, 생각, 감정이 이어지는 모습을 오른쪽 워크시트에 정리해 두었어요. 이번 주에는 비슷한 순간이 오면 떠오른 생각을 한 줄씩 적어 보는 연습을 해 볼게요."],
  ["patient", "네, 해볼게요."],
  ["assistant", "오늘 첫 회기를 함께해 주셔서 고마워요. 다음 회기에서 이어서 이야기 나눠요."],
];
const S01_DEMO_FIELDS = {
  s01Problems: ["회사에서 발표할 때 너무 긴장된다", "잠을 잘 못 잔다"],
  s01RepresentativeProblem: "발표할 때 긴장하는 것",
  s01Goal: "떨리더라도 끝까지 발표를 해내는 것",
  situationLine: "지난주 팀 회의에서 준비한 내용을 발표해야 했다",
  openingInitialThought: "다들 내가 준비를 제대로 안 했다고 생각할 거야",
  personalEmotion: "불안",
  personalEmotionIntensity: 80,
};
const S02_DEMO_TRANSCRIPT: NonNullable<SeedSession["transcript"]> = [
  ["assistant", "다시 만나서 반가워요. 지난 한 주 동안 떠오른 생각을 적어 보는 연습은 어떠셨어요?"],
  ["patient", "두 번 정도 적었어요. 회의 전에 또 '망칠 거야'라는 생각이 들었어요."],
  ["assistant", "적어 두신 것 자체가 큰 걸음이에요. 오늘은 사람들이 자주 빠지는 15가지 생각의 함정을 하나씩 살펴보면서, 내 경험 속 예가 있는지 찾아볼 거예요. 첫 번째는 '파국화'예요. 앞으로 일어날 일을 최악으로만 예상하는 거예요. 비슷한 경험이 있으셨나요?"],
  ["patient", "네, 발표 전에 '완전히 망칠 거야'라고 생각했어요."],
  ["assistant", "좋은 예예요. 다음은 '독심술'이에요. 다른 사람이 나를 어떻게 생각하는지 확인하지 않고도 안다고 여기는 거예요."],
  ["patient", "그것도 있어요. 다들 제가 준비 안 했다고 생각할 거라고 했잖아요."],
  ["assistant", "맞아요. 지난 회기의 그 생각이 여기에 해당하네요. 이렇게 열다섯 가지를 모두 살펴본 뒤, 지난 한 주 동안 각각 얼마나 자주, 얼마나 강하게 나타났는지 점수를 매겨 볼게요."],
  ["patient", "네, 해볼게요."],
  ["assistant", "점수를 모두 매겼어요. 가장 높게 나온 건 파국화와 독심술이었어요. 이번 주에는 이 두 가지가 떠오를 때 알아차리고 이름을 붙여 보는 연습을 해 볼게요."],
  ["patient", "이름을 붙이니까 조금 덜 무섭게 느껴져요."],
  ["assistant", "그 느낌을 기억해 두세요. 오늘도 함께해 주셔서 고마워요."],
];

// s01을 2회 반복 실행시켜 둔다 -- 반복 홈워크(회차 라벨링/접기, 2026-09-22
// 구현) UI를 실제로 눈으로 확인할 수 있게 하기 위한 목적이 크다. 나머지는
// s02/s03을 완료 처리하고, s04 하나를 진행 중(waiting_for_input) 상태로
// 남겨 "현재 진행 중인 세션"이 있는 화면도 함께 확인할 수 있게 한다.
// s02 also has an earlier attempt that was ended partway, so both kinds of
// repeat -- a finished session run again (s01) and a restart after stopping
// (s02) -- show up folded under their session in history and homework.
const SEED_SESSIONS: SeedSession[] = [
  { sessionDefinitionId: "tbct-s01", status: "completed", homeworkStatus: "completed", daysAgo: 20 },
  { sessionDefinitionId: "tbct-s01", status: "completed", homeworkStatus: "in_progress", daysAgo: 6, transcript: S01_DEMO_TRANSCRIPT, worksheetFields: S01_DEMO_FIELDS },
  { sessionDefinitionId: "tbct-s02", status: "terminated", daysAgo: 15 },
  { sessionDefinitionId: "tbct-s02", status: "completed", homeworkStatus: "completed", daysAgo: 13, transcript: S02_DEMO_TRANSCRIPT },
  { sessionDefinitionId: "tbct-s03", status: "completed", homeworkStatus: "review_available", daysAgo: 9 },
  { sessionDefinitionId: "tbct-s04", status: "waiting_for_input", homeworkStatus: "not_started", daysAgo: 0 },
];

let installPromise: Promise<void> | null = null;

/** Idempotent and safe to call from multiple components on mount (e.g. every
 * page that renders AuthProvider) -- the underlying seed only ever runs
 * once per page load. */
export function installPatientDevMock(): Promise<void> {
  if (!isPatientMockModeEnabled()) return Promise.resolve();
  // A failed seed must be visible: it would otherwise leave a half-built
  // mock (e.g. one session stuck at "not started") with no clue why.
  if (!installPromise) installPromise = seed().catch((error) => console.error("[patient-dev-mock] seed failed", error));
  return installPromise;
}

async function seed() {
  // Loaded here, not at the top: the fake stores are test code, so a normal
  // visitor's browser never downloads them -- only a mock-mode page load does.
  const { installFakeStoreFetch, resetAllFakeStores } = await import("@/test/fakes/install-fake-store-fetch");
  installFakeStoreFetch({ interceptDialogueAgent: true });
  resetAllFakeStores();

  // The mock is rebuilt on every page load; start it in the language this
  // browser last chose, the way a real participant's saved language carries
  // over, instead of always in Korean (which left an English screen talking
  // to a Korean session and worksheet after every reload).
  const uiLocale = readBrowserStorageItem(UI_LOCALE_STORAGE_KEY) === "en" ? "en" : "ko";
  const sessionLocale = uiLocale === "en" ? "en-US" : "ko-KR";
  const participant = await getOrCreateParticipantForUiLocale(PATIENT_MOCK_USER_ID, uiLocale);

  for (const seedSession of SEED_SESSIONS) {
    const timestamp = new Date(Date.now() - seedSession.daysAgo * 24 * 60 * 60 * 1000).toISOString();
    const session = await createCanonicalTestRuntimeSession({
      sessionDefinitionId: seedSession.sessionDefinitionId,
      patientAlias: "개발용 테스트 환자",
      locale: sessionLocale,
      participantId: participant.id,
    });
    if (seedSession.status === "waiting_for_input") {
      // The in-progress session runs its real entry node (offline -- the
      // dialogue agent is intercepted above) so it opens on a genuine first
      // message and a genuine question to answer, instead of an empty
      // transcript with a status forced onto the row.
      await startRuntimeSession(session.id).catch((error) => console.warn("[patient-dev-mock] could not start the in-progress session", error));
      await updateRuntimeSessionRecord(session.id, { createdAt: timestamp });
    } else {
      await updateRuntimeSessionRecord(session.id, {
        status: seedSession.status,
        createdAt: timestamp,
        updatedAt: timestamp,
        ...(seedSession.status === "completed" ? { completedAt: timestamp } : {}),
      });
    }
    if (seedSession.transcript) {
      const start = new Date(timestamp).getTime() - seedSession.transcript.length * 60_000;
      for (const [index, [role, content]] of seedSession.transcript.entries()) {
        const at = new Date(start + index * 60_000).toISOString();
        await saveRuntimeMessage({ id: `demo-${session.id}-${index}`, runtimeSessionId: session.id, role, content, status: "delivered", createdAt: at, deliveredAt: at });
      }
    }
    if (seedSession.worksheetFields) {
      await projectRuntimeFieldsToWorksheet({ runtimeSessionId: session.id, sessionDefinitionId: seedSession.sessionDefinitionId, fields: seedSession.worksheetFields });
    }
    if (seedSession.homeworkStatus && seedSession.sessionDefinitionId in HOMEWORK_LABEL_BY_SESSION) {
      await ensureHomeworkRecord({
        runtimeSessionId: session.id,
        sessionDefinitionId: seedSession.sessionDefinitionId,
        participantId: participant.id,
        initialStatus: seedSession.homeworkStatus,
      });
    }
    // s03's completed run gets real worksheet field values so the
    // patient-session-complete-page.tsx "before -> after" hero has something
    // to chart locally: `status: "completed"` above only forces the session
    // ROW, it never runs the real node graph, so without this the belief
    // fields getPatientProgressSeries looks for are simply absent and the
    // hero silently falls back to its generic (no-chart) copy -- exactly
    // like every real session that hasn't reached this pair of fields yet.
    if (seedSession.sessionDefinitionId === "tbct-s03" && seedSession.status === "completed") {
      await projectRuntimeFieldsToWorksheet({
        runtimeSessionId: session.id,
        sessionDefinitionId: "tbct-s03",
        fields: { automaticThoughtBeliefPercent: 80, revisedAutomaticThoughtBeliefPercent: 35 },
      });
      // The same fields on the session row itself, plus the participant's own
      // conclusion, which the completion page shows as "today's insight".
      await updateRuntimeSessionRecord(session.id, {
        runtimeContext: {
          ...session.runtimeContext,
          fields: {
            ...session.runtimeContext.fields,
            automaticThoughtBeliefPercent: 80,
            revisedAutomaticThoughtBeliefPercent: 35,
            balancedConclusion: "발표를 망친 게 아니라 떨렸던 것뿐이다. 떨려도 끝까지 해냈다.",
          },
        },
      });
    }
  }
}
