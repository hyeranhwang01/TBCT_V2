import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
const createSession = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => "/projects/demo/patient",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/shared/api/runtime-session-api", () => ({
  createCanonicalTestRuntimeSession: (input: { sessionDefinitionId: string }) => createSession(input),
  listRuntimeSessionsForParticipant: async () => [],
}));

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { LocaleProvider, UI_LOCALE_STORAGE_KEY } from "@/shared/i18n/context";
import { setDevModeEnabled } from "@/shared/dev-mode/dev-mode";
import { PatientJourney, buildPatientJourney } from "@/patient/pages/patient-list-page";

// The eight-step journey is the only thing that decides which session a patient
// can start: nothing in the API or the runtime enforces the order. Developer mode
// turns every step into its own entry point; with it off the steps must stay
// exactly what they were -- a picture, with one "continue" button below.

beforeEach(() => {
  globalThis.localStorage.setItem(UI_LOCALE_STORAGE_KEY, "ko");
  setDevModeEnabled(false);
  push.mockReset();
  createSession.mockReset().mockResolvedValue({ id: "new-session" });
});
afterEach(() => {
  cleanup();
  setDevModeEnabled(false);
  globalThis.localStorage.removeItem(UI_LOCALE_STORAGE_KEY);
});

/** One completed first session and nothing else -- so session 2 is next and 3-8
 * are still ahead. */
const SESSIONS = [
  { id: "s1", sessionDefinitionId: "tbct-s01", status: "completed", updatedAt: "2026-09-20T00:00:00.000Z" },
] as unknown as Parameters<typeof buildPatientJourney>[0];

function renderJourney() {
  render(
    <LocaleProvider>
      <PatientJourney journey={buildPatientJourney(SESSIONS, "ko")} participant={undefined} localPreview={false} />
    </LocaleProvider>,
  );
}

function stepButtons() {
  return screen.queryAllByRole("button", { name: /회기 .*시작하기$/ });
}

describe("the patient journey with developer mode off", () => {
  it("offers only the next session, and leaves the other steps as a picture", () => {
    renderJourney();
    expect(stepButtons()).toHaveLength(0);
    // The one way forward, as before: the continue button for session 2.
    expect(screen.getByText("2회기를 시작할 시간이에요")).toBeInTheDocument();
  });
});

describe("the patient journey with developer mode on", () => {
  it("turns every one of the eight steps into its own entry point", () => {
    renderJourney();
    act(() => setDevModeEnabled(true));
    expect(stepButtons()).toHaveLength(8);
    expect(screen.getByRole("button", { name: "5회기 (참여 격자) 시작하기" })).toBeInTheDocument();
  });

  it("starts the session the step stands for, skipping the ones before it", async () => {
    renderJourney();
    act(() => setDevModeEnabled(true));
    screen.getByRole("button", { name: "5회기 (참여 격자) 시작하기" }).click();
    await waitFor(() => expect(createSession).toHaveBeenCalledTimes(1));
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ sessionDefinitionId: "tbct-s05" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/projects/demo/patient/sessions/new-session"));
  });

  it("resumes an unfinished attempt instead of starting a second one", async () => {
    const withAttempt = [
      ...(SESSIONS as unknown[]),
      { id: "s3-attempt", sessionDefinitionId: "tbct-s03", status: "waiting_for_input", updatedAt: "2026-09-21T00:00:00.000Z" },
    ] as unknown as Parameters<typeof buildPatientJourney>[0];
    render(
      <LocaleProvider>
        <PatientJourney journey={buildPatientJourney(withAttempt, "ko")} participant={undefined} localPreview={false} />
      </LocaleProvider>,
    );
    act(() => setDevModeEnabled(true));
    screen.getByRole("button", { name: /^3회기 .*시작하기$/ }).click();
    await waitFor(() => expect(push).toHaveBeenCalledWith("/projects/demo/patient/sessions/s3-attempt"));
    expect(createSession).not.toHaveBeenCalled();
  });

  it("starts nothing in the local screen preview, where records are not saved", () => {
    render(
      <LocaleProvider>
        <PatientJourney journey={buildPatientJourney(SESSIONS, "ko")} participant={undefined} localPreview />
      </LocaleProvider>,
    );
    act(() => setDevModeEnabled(true));
    for (const button of stepButtons()) expect(button).toBeDisabled();
  });
});
