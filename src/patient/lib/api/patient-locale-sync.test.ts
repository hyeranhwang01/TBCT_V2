import { describe, expect, it } from "vitest";
import { getOrCreateParticipantForUiLocale } from "@/shared/api/participant-api";
import { createCanonicalTestRuntimeSession, getRuntimeSession } from "@/shared/api/runtime-session-api";
import { updateRuntimeSessionRecord } from "@/shared/data/repositories/runtime-session-repository";
import { propagateLocaleToOpenSessions } from "@/patient/lib/api/patient-locale-sync";

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
