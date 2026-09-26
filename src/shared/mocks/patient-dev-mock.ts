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

import { installFakeStoreFetch, resetAllFakeStores } from "@/test/fakes/install-fake-store-fetch";
import { getOrCreateParticipantForUiLocale } from "@/shared/api/participant-api";
import { createCanonicalTestRuntimeSession } from "@/shared/api/runtime-session-api";
import { updateRuntimeSessionRecord } from "@/shared/data/repositories/runtime-session-repository";
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
};

// s01을 2회 반복 실행시켜 둔다 -- 반복 홈워크(회차 라벨링/접기, 2026-09-22
// 구현) UI를 실제로 눈으로 확인할 수 있게 하기 위한 목적이 크다. 나머지는
// s02/s03을 완료 처리하고, s04 하나를 진행 중(waiting_for_input) 상태로
// 남겨 "현재 진행 중인 세션"이 있는 화면도 함께 확인할 수 있게 한다.
const SEED_SESSIONS: SeedSession[] = [
  { sessionDefinitionId: "tbct-s01", status: "completed", homeworkStatus: "completed", daysAgo: 20 },
  { sessionDefinitionId: "tbct-s01", status: "completed", homeworkStatus: "in_progress", daysAgo: 6 },
  { sessionDefinitionId: "tbct-s02", status: "completed", homeworkStatus: "completed", daysAgo: 13 },
  { sessionDefinitionId: "tbct-s03", status: "completed", homeworkStatus: "review_available", daysAgo: 9 },
  { sessionDefinitionId: "tbct-s04", status: "waiting_for_input", homeworkStatus: "not_started", daysAgo: 0 },
];

let installPromise: Promise<void> | null = null;

/** Idempotent and safe to call from multiple components on mount (e.g. every
 * page that renders AuthProvider) -- the underlying seed only ever runs
 * once per page load. */
export function installPatientDevMock(): Promise<void> {
  if (!isPatientMockModeEnabled()) return Promise.resolve();
  if (!installPromise) installPromise = seed();
  return installPromise;
}

async function seed() {
  installFakeStoreFetch({ interceptDialogueAgent: true });
  resetAllFakeStores();

  const participant = await getOrCreateParticipantForUiLocale(PATIENT_MOCK_USER_ID, "ko");

  for (const seedSession of SEED_SESSIONS) {
    const timestamp = new Date(Date.now() - seedSession.daysAgo * 24 * 60 * 60 * 1000).toISOString();
    const session = await createCanonicalTestRuntimeSession({
      sessionDefinitionId: seedSession.sessionDefinitionId,
      patientAlias: "개발용 테스트 환자",
      locale: "ko-KR",
      participantId: participant.id,
    });
    await updateRuntimeSessionRecord(session.id, {
      status: seedSession.status,
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(seedSession.status === "completed" ? { completedAt: timestamp } : {}),
    });
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
    }
  }
}
