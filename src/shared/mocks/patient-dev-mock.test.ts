import { afterEach, describe, expect, it, vi } from "vitest";
import { isPatientMockModeEnabled } from "@/shared/mocks/patient-dev-mock";

// Safety-critical invariant: this must be fail-closed. A bug here would let
// dev-only fixture data (or, worse, the fake-store fetch interception it
// installs) activate somewhere it shouldn't.
describe("isPatientMockModeEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is off by default", () => {
    vi.stubEnv("NEXT_PUBLIC_TBCT_PATIENT_MOCK", "");
    expect(isPatientMockModeEnabled()).toBe(false);
  });

  it("is off in a production build even if the flag is set", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_TBCT_PATIENT_MOCK", "1");
    expect(isPatientMockModeEnabled()).toBe(false);
  });

  it("is on only with the flag set to the exact string \"1\" outside production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_TBCT_PATIENT_MOCK", "1");
    expect(isPatientMockModeEnabled()).toBe(true);
  });

  it("is off for any value other than the exact string \"1\"", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_TBCT_PATIENT_MOCK", "true");
    expect(isPatientMockModeEnabled()).toBe(false);
  });
});

describe("installPatientDevMock", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("seeds a participant with 5 sessions (2 of them the same sessionDefinitionId) and homework for each", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_TBCT_PATIENT_MOCK", "1");

    const { installPatientDevMock, PATIENT_MOCK_USER_ID } = await import("@/shared/mocks/patient-dev-mock");
    await installPatientDevMock();

    const { getOrCreateParticipantForUiLocale } = await import("@/shared/api/participant-api");
    const participant = await getOrCreateParticipantForUiLocale(PATIENT_MOCK_USER_ID, "ko");

    const { listRuntimeSessionsForParticipant } = await import("@/shared/api/runtime-session-api");
    const sessions = await listRuntimeSessionsForParticipant(participant.id);
    expect(sessions).toHaveLength(5);

    const s01Sessions = sessions.filter((session) => session.sessionDefinitionId === "tbct-s01");
    expect(s01Sessions).toHaveLength(2);
    expect(new Set(s01Sessions.map((session) => session.id)).size).toBe(2);

    const { listHomeworkRecordsByParticipant } = await import("@/shared/data/repositories/homework-repository");
    const homework = await listHomeworkRecordsByParticipant(participant.id);
    expect(homework.length).toBe(5);
    expect(homework.filter((record) => record.sessionDefinitionId === "tbct-s01")).toHaveLength(2);
  });
});
