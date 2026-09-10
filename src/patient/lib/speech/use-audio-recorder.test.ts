import { describe, expect, it, vi } from "vitest";
import { preferredRecordingMimeType } from "@/patient/lib/speech/use-audio-recorder";

describe("audio recorder format selection", () => {
  it("prefers Opus WebM and falls back safely", () => {
    const original = globalThis.MediaRecorder;
    globalThis.MediaRecorder = { isTypeSupported: vi.fn((type: string) => type === "audio/webm") } as unknown as typeof MediaRecorder;
    expect(preferredRecordingMimeType()).toBe("audio/webm");
    globalThis.MediaRecorder = original;
  });
});
