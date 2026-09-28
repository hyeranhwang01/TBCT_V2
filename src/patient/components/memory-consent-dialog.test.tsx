import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const record = vi.hoisted(() => vi.fn());
vi.mock("@/shared/api/participant-api", () => ({ recordParticipantMemoryConsent: record }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LocaleProvider, UI_LOCALE_STORAGE_KEY } from "@/shared/i18n/context";
import { MemoryConsentDialog } from "@/patient/components/memory-consent-dialog";
import type { RuntimeParticipant } from "@/types/longitudinal-memory";

const participant: RuntimeParticipant = {
  id: "PT-1", projectId: "P", alias: "A", locale: "ko-KR", status: "active", runtimeSessionIds: [], longitudinalRecordId: "L",
  consent: { memoryStorageAllowed: true, crossSessionUseAllowed: false, sensitiveMemoryAllowed: false, updatedAt: "x" }, createdAt: "x", updatedAt: "x",
};

function renderDialog(props: { required: boolean; onClose?: () => void }) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <LocaleProvider>
        <MemoryConsentDialog participant={participant} open {...props} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  globalThis.localStorage.setItem(UI_LOCALE_STORAGE_KEY, "ko");
  record.mockReset().mockResolvedValue(participant);
});
afterEach(() => {
  cleanup();
  globalThis.localStorage.removeItem(UI_LOCALE_STORAGE_KEY);
});

describe("the memory-consent popup", () => {
  it("tells the participant what is used either way and what changes, and cannot be closed without answering", () => {
    renderDialog({ required: true });
    expect(screen.getByText("지난 상담 내용을 기억해도 될까요?")).toBeTruthy();
    expect(screen.getByText("첫 회기에 정한 고민과 목표")).toBeTruthy();
    expect(screen.getByText("지난번 과제를 했는지 여부")).toBeTruthy();
    expect(screen.getByText(/상담이 덜 맞춤형으로 느껴질 수 있습니다/)).toBeTruthy();
    expect(screen.queryByLabelText("Close")).toBeNull();
  });

  it("records the answer as given from the first-visit popup", async () => {
    renderDialog({ required: true });
    fireEvent.click(screen.getByText("동의하지 않습니다"));
    await waitFor(() => expect(record).toHaveBeenCalledWith("PT-1", { decision: "declined", source: "first_visit_dialog", locale: "ko" }));
  });

  it("opened from the profile, can be closed and records a change as a profile change", async () => {
    const onClose = vi.fn();
    renderDialog({ required: false, onClose });
    expect(screen.getByLabelText("Close")).toBeTruthy();
    fireEvent.click(screen.getByText("동의합니다"));
    await waitFor(() => expect(record).toHaveBeenCalledWith("PT-1", { decision: "granted", source: "profile", locale: "ko" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
