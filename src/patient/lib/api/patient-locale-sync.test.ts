import { describe, expect, it } from "vitest";
import { getOrCreateParticipantForUiLocale } from "@/shared/api/participant-api";
import { createCanonicalTestRuntimeSession, getRuntimeSession } from "@/shared/api/runtime-session-api";
import { updateRuntimeSessionRecord } from "@/shared/data/repositories/runtime-session-repository";
import { propagateLocaleToOpenSessions, sessionLocaleForStart } from "@/patient/lib/api/patient-locale-sync";
import { getParticipant } from "@/shared/data/repositories/participant-repository";

// Switching the language has to reach a session that is waiting for an
// answer -- the usual state of an open session. It used to be written as a
// same-status "transition", which the runtime state machine rejects; the
// error was swallowed and every open session silently kept its old language.
describe("propagateLocaleToOpenSessions", () => {
  it("switches an open session that is waiting for an answer, and leaves ended ones alone", async () => {
    const participant = await getOrCreateParticipantForUiLocale("locale-sync-test-user", "ko");
    const open = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s04", locale: "ko-KR", participantId: participant.id });
    await updateRuntimeSessionRecord(open.id, { status: "waiting_for_input" });
    const done = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s03", locale: "ko-KR", participantId: participant.id });
    await updateRuntimeSessionRecord(done.id, { status: "completed" });
    const stopped = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "ko-KR", participantId: participant.id });
    await updateRuntimeSessionRecord(stopped.id, { status: "terminated" });

    const updated = await propagateLocaleToOpenSessions(participant, "en-US");

    expect(updated).toBe(1);
    expect((await getRuntimeSession(open.id))?.session.locale).toBe("en-US");
    expect((await getRuntimeSession(open.id))?.session.status).toBe("waiting_for_input");
    expect((await getRuntimeSession(done.id))?.session.locale).toBe("ko-KR");
    expect((await getRuntimeSession(stopped.id))?.session.locale).toBe("ko-KR");
  });
});

// A participant whose record still said en-US used to get an English session
// under Korean screens: sessions copied the record, not what was on screen.
describe("sessionLocaleForStart", () => {
  it("starts in the language on screen and brings the record and open sessions in line", async () => {
    const participant = await getOrCreateParticipantForUiLocale("locale-start-test-user", "en");
    const open = await createCanonicalTestRuntimeSession({ sessionDefinitionId: "tbct-s02", locale: "en-US", participantId: participant.id });
    await updateRuntimeSessionRecord(open.id, { status: "waiting_for_input" });

    expect(await sessionLocaleForStart(participant, "ko")).toBe("ko-KR");
    expect((await getParticipant(participant.id))?.locale).toBe("ko-KR");
    expect((await getRuntimeSession(open.id))?.session.locale).toBe("ko-KR");
  });

  it("leaves a record that already matches alone, and still answers without a participant", async () => {
    const participant = await getOrCreateParticipantForUiLocale("locale-start-match-user", "en");
    expect(await sessionLocaleForStart(participant, "en")).toBe("en-US");
    expect((await getParticipant(participant.id))?.locale).toBe("en-US");
    expect(await sessionLocaleForStart(undefined, "ko")).toBe("ko-KR");
  });
});
