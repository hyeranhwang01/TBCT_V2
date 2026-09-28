import { describe, expect, it } from "vitest";
import { MEMORY_CONSENT_TEXT_VERSION, memoryConsentNeedsDecision, memoryConsentStatus, memoryUseAllowed } from "@/shared/memory/memory-consent";
import { getParticipantConsentHistory, getOrCreateParticipantForUser, recordParticipantMemoryConsent } from "@/shared/api/participant-api";
import { getParticipant, saveParticipant, updateParticipant } from "@/shared/data/repositories/participant-repository";
import type { MemoryConsentState } from "@/types/longitudinal-memory";

const decided = (decision: MemoryConsentState["decision"], textVersion = MEMORY_CONSENT_TEXT_VERSION): { memoryConsent: MemoryConsentState } => ({
  memoryConsent: { decision, textVersion, source: "first_visit_dialog", decidedAt: "2026-09-27T00:00:00.000Z" },
});

describe("the memory-consent gate", () => {
  it("allows memory only for a participant who agreed to the current wording", () => {
    expect(memoryUseAllowed(decided("granted"))).toBe(true);
    expect(memoryUseAllowed(decided("declined"))).toBe(false);
    expect(memoryUseAllowed({})).toBe(false);
    expect(memoryUseAllowed(undefined)).toBe(false);
  });

  it("treats an answer to older wording as not answered, so the participant is asked again", () => {
    const stale = decided("granted", "0.0.1");
    expect(memoryConsentStatus(stale)).toBe("undecided");
    expect(memoryConsentNeedsDecision(stale)).toBe(true);
    expect(memoryUseAllowed(stale)).toBe(false);
  });

  it("asks a participant who has not answered, and nobody who has", () => {
    expect(memoryConsentNeedsDecision({})).toBe(true);
    expect(memoryConsentNeedsDecision(decided("declined"))).toBe(false);
    expect(memoryConsentNeedsDecision(decided("granted"))).toBe(false);
  });
});

describe("recording an answer", () => {
  it("sets the participant's answer, keeps the old flag in step, and appends every change to the history", async () => {
    const participant = await getOrCreateParticipantForUser(`auth-consent-${Date.now()}`, { locale: "ko-KR" });
    expect(memoryConsentStatus(participant)).toBe("undecided");

    await recordParticipantMemoryConsent(participant.id, { decision: "declined", source: "first_visit_dialog", locale: "ko" });
    let stored = await getParticipant(participant.id);
    expect(stored?.memoryConsent).toMatchObject({ decision: "declined", textVersion: MEMORY_CONSENT_TEXT_VERSION, source: "first_visit_dialog" });
    expect(stored?.consent.crossSessionUseAllowed).toBe(false);
    expect(memoryUseAllowed(stored)).toBe(false);

    await recordParticipantMemoryConsent(participant.id, { decision: "granted", source: "profile", locale: "ko" });
    stored = await getParticipant(participant.id);
    expect(stored?.consent.crossSessionUseAllowed).toBe(true);
    expect(memoryUseAllowed(stored)).toBe(true);

    const history = await getParticipantConsentHistory(participant.id);
    expect(history.map((event) => [event.decision, event.source, event.previousDecision])).toEqual([
      ["declined", "first_visit_dialog", undefined],
      ["granted", "profile", "declined"],
    ]);
    expect(history.every((event) => event.textVersion === MEMORY_CONSENT_TEXT_VERSION && event.locale === "ko")).toBe(true);
  });

  it("cannot be undone by a profile save made from a stale copy, or by a patch", async () => {
    const participant = await getOrCreateParticipantForUser(`auth-consent-race-${Date.now()}`, { locale: "ko-KR" });
    const staleCopy = (await getParticipant(participant.id))!;
    await recordParticipantMemoryConsent(participant.id, { decision: "declined", source: "profile", locale: "ko" });
    await saveParticipant({ ...staleCopy, alias: "renamed", memoryConsent: { decision: "granted", textVersion: MEMORY_CONSENT_TEXT_VERSION, source: "profile", decidedAt: "x" } });
    await updateParticipant(participant.id, { memoryConsent: { decision: "granted", textVersion: MEMORY_CONSENT_TEXT_VERSION, source: "profile", decidedAt: "x" } });
    const stored = await getParticipant(participant.id);
    expect(stored?.alias).toBe("renamed");
    expect(stored?.memoryConsent?.decision).toBe("declined");
    expect(memoryUseAllowed(stored)).toBe(false);
  });
});
