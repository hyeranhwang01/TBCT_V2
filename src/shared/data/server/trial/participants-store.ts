// Study participants from registration to allocation and withdrawal, the
// session gate, visits and homework logs (sql/035-037). Server-only.
//
// The order the protocol requires is enforced here, not in the pages:
// screening -> eligibility -> main consent -> enrolment (baseline assessments)
// -> allocation (allocate_participant in SQL; then the 12-week visits and the
// rest of the assessments). A withdrawn participant's future visits and due
// assessments are cancelled, and the session gate refuses them.

import { TrialError, addDays, isoDate, makeId, select, selectOne, transaction, type Queryable } from "@/shared/data/server/trial/db";
import { getStudy, requireStudy } from "@/shared/data/server/trial/study-store";
import { generateTasks, participantForAuthUser } from "@/shared/data/server/trial/assessments-store";
import { recordEvents } from "@/shared/data/server/trial/events-store";
import { SCREENING_CRITERIA } from "@/shared/trial/default-study-config";
import type { TrialActor } from "@/shared/trial/trial-store-ops";
import type {
  AiRelease, Allocation, ArmCode, AssessmentTask, ConsentType, DiagnosisStratum, EligibilityDecision, HomeworkLog, ProtocolDeviation, Screening, SessionGate,
  StudyArm, StudyConsent, StudyParticipant, StudyVisit, Withdrawal,
} from "@/types/trial";

async function requireParticipant(id: string, db: Queryable, lock = false) {
  const participant = await selectOne<StudyParticipant>(`SELECT * FROM study_participants WHERE id = $1${lock ? " FOR UPDATE" : ""}`, [id], db);
  if (!participant) throw new TrialError("Study participant not found");
  return participant;
}

async function setStatus(db: Queryable, id: string, status: StudyParticipant["status"], extra = "") {
  await db.query(`UPDATE study_participants SET status = $2, updated_at = now()${extra} WHERE id = $1`, [id, status]);
}

/** The latest decision per consent type. */
export async function currentConsents(studyParticipantId: string, db?: Queryable) {
  const all = await select<StudyConsent>(
    `SELECT DISTINCT ON (consent_type) * FROM study_consents WHERE study_participant_id = $1 ORDER BY consent_type, decided_at DESC, id DESC`,
    [studyParticipantId],
    db,
  );
  return Object.fromEntries(all.map((consent) => [consent.consentType, consent])) as Partial<Record<ConsentType, StudyConsent>>;
}

export async function listTrialParticipants(blinded: boolean) {
  return select<Record<string, unknown>>(blinded ? "SELECT * FROM participant_overview_blinded ORDER BY study_code" : "SELECT * FROM participant_overview ORDER BY study_code");
}

export async function getTrialParticipant(studyParticipantId: string) {
  const participant = await selectOne<StudyParticipant>("SELECT * FROM study_participants WHERE id = $1", [studyParticipantId]);
  if (!participant) throw new TrialError("Study participant not found");
  const [screenings, eligibility, consents, withdrawals, allocation, visits, tasks, deviations] = await Promise.all([
    select<Screening>("SELECT * FROM screenings WHERE study_participant_id = $1 ORDER BY screened_at", [participant.id]),
    select<EligibilityDecision>("SELECT * FROM eligibility_decisions WHERE study_participant_id = $1 ORDER BY decided_at", [participant.id]),
    select<StudyConsent>("SELECT * FROM study_consents WHERE study_participant_id = $1 ORDER BY decided_at, id", [participant.id]),
    select<Withdrawal>("SELECT * FROM withdrawals WHERE study_participant_id = $1 ORDER BY withdrawn_at", [participant.id]),
    selectOne<Allocation>("SELECT * FROM allocations WHERE study_participant_id = $1", [participant.id]),
    select<StudyVisit>("SELECT * FROM study_visits WHERE study_participant_id = $1 ORDER BY window_start, visit_type, number", [participant.id]),
    select<AssessmentTask>("SELECT * FROM assessment_tasks WHERE study_participant_id = $1 ORDER BY window_start, instrument_code, occurrence", [participant.id]),
    select<ProtocolDeviation>("SELECT * FROM protocol_deviations WHERE study_participant_id = $1 ORDER BY detected_at", [participant.id]),
  ]);
  return { participant, screenings, eligibility, consents, withdrawals, allocation: allocation ?? null, visits, tasks, deviations };
}

/** What a participant may see of their own trial: status, their visits and
 * the self-report assessments due. */
export async function getMyTrialStatus(actor: TrialActor | undefined) {
  if (!actor) return null;
  const participant = await participantForAuthUser(actor.userId);
  if (!participant) return null;
  const [visits, tasks] = await Promise.all([
    select<StudyVisit>("SELECT id, visit_type, number, ai_module_number, window_start, window_end, status FROM study_visits WHERE study_participant_id = $1 ORDER BY window_start, number", [participant.id]),
    select<AssessmentTask>("SELECT * FROM assessment_tasks WHERE study_participant_id = $1 AND mode = 'self' AND status = 'due' ORDER BY window_start", [participant.id]),
  ]);
  // Participants are not blind to their own arm (it decides what they do);
  // the arm code lets their page show the arm's own tasks (homework log).
  const allocation = await selectOne<Allocation>("SELECT arm_code FROM allocations WHERE study_participant_id = $1", [participant.id]);
  return { studyCode: participant.studyCode, status: participant.status, armCode: allocation?.armCode ?? null, visits, dueAssessments: tasks };
}

/** App accounts not yet registered in the study, for the coordinator to
 * register: pseudonymous id, alias and sign-up date only. */
export async function listUnregisteredAccounts() {
  return select<{ id: string; alias: string; createdAt: string }>(
    `SELECT rp.id, rp.alias, rp.created_at FROM runtime_participants rp
     WHERE rp.auth_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM study_participants sp WHERE sp.runtime_participant_id = rp.id)
     ORDER BY rp.created_at DESC LIMIT 500`,
  );
}

export async function registerParticipant(actor: TrialActor | undefined, input: { runtimeParticipantId: string; siteId: string; studyCode: string; diagnosisStratum?: DiagnosisStratum | null; data?: StudyParticipant["data"] }) {
  return transaction(actor, async (db) => {
    const study = await requireStudy(db);
    const runtimeParticipant = await selectOne<{ id: string }>("SELECT id FROM runtime_participants WHERE id = $1", [input.runtimeParticipantId], db);
    if (!runtimeParticipant) throw new TrialError("No app account with that participant id");
    const id = makeId("SP");
    await db.query(
      `INSERT INTO study_participants (id, study_id, site_id, runtime_participant_id, study_code, diagnosis_stratum, status, data)
       VALUES ($1,$2,$3,$4,$5,$6,'screening',$7)`,
      [id, study.id, input.siteId, input.runtimeParticipantId, input.studyCode, input.diagnosisStratum ?? null, JSON.stringify(input.data ?? {})],
    );
    return requireParticipant(id, db);
  });
}

export async function recordScreening(actor: TrialActor | undefined, input: { studyParticipantId: string; criteria: Screening["criteria"]; phq9Total?: number | null; gad7Total?: number | null; cssrsRisk?: Screening["cssrsRisk"]; screenedAt?: string }) {
  return transaction(actor, async (db) => {
    const participant = await requireParticipant(input.studyParticipantId, db, true);
    if (participant.status !== "screening") throw new TrialError(`Participant is ${participant.status}; screening happens before eligibility`);
    const known = new Set(SCREENING_CRITERIA.map((criterion) => criterion.code));
    const unknown = input.criteria.find((criterion) => !known.has(criterion.code));
    if (unknown) throw new TrialError(`Unknown screening criterion ${unknown.code}`);
    const missing = SCREENING_CRITERIA.filter((criterion) => !input.criteria.some((given) => given.code === criterion.code));
    if (missing.length) throw new TrialError(`Screening is missing: ${missing.map((criterion) => criterion.code).join(", ")}`);
    const riskExcludes = input.cssrsRisk === "moderate" || input.cssrsRisk === "high";
    const result = input.criteria.every((criterion) => criterion.met === true) && !riskExcludes ? "pass" : "fail";
    const id = makeId("SCR");
    await db.query(
      `INSERT INTO screenings (id, study_participant_id, screened_by, screened_at, criteria, phq9_total, gad7_total, cssrs_risk, result)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, participant.id, actor?.userId ?? "server", input.screenedAt ?? new Date().toISOString(), JSON.stringify(input.criteria), input.phq9Total ?? null, input.gad7Total ?? null, input.cssrsRisk ?? null, result],
    );
    return (await selectOne<Screening>("SELECT * FROM screenings WHERE id = $1", [id], db))!;
  });
}

export async function decideEligibility(actor: TrialActor | undefined, input: { studyParticipantId: string; decision: "eligible" | "ineligible"; reasons: string[]; overrideReason?: string }) {
  return transaction(actor, async (db) => {
    const participant = await requireParticipant(input.studyParticipantId, db, true);
    if (!["screening", "eligible", "ineligible"].includes(participant.status)) throw new TrialError(`Participant is already ${participant.status}`);
    const screening = await selectOne<Screening>("SELECT * FROM screenings WHERE study_participant_id = $1 ORDER BY screened_at DESC, id DESC LIMIT 1", [participant.id], db);
    const contradicts = !screening || (input.decision === "eligible") !== (screening.result === "pass");
    if (contradicts && !input.overrideReason?.trim()) throw new TrialError(screening ? "This decision contradicts the screening result; give an override reason" : "No screening recorded; give an override reason");
    await db.query(
      `INSERT INTO eligibility_decisions (id, study_participant_id, screening_id, decision, reasons, is_override, override_reason, decided_by, decided_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,now())`,
      [makeId("ELG"), participant.id, screening?.id ?? null, input.decision, input.reasons, contradicts, contradicts ? input.overrideReason : null, actor?.userId ?? "server"],
    );
    if (contradicts) {
      await db.query(
        `INSERT INTO protocol_deviations (id, study_id, study_participant_id, category, severity, description, detected_at, detected_by, status)
         VALUES ($1,$2,$3,'eligibility','major',$4,now(),$5,'open')`,
        [makeId("DEV"), participant.studyId, participant.id, `Eligibility decided against the screening result: ${input.overrideReason}`, actor?.userId ?? "server"],
      );
    }
    await setStatus(db, participant.id, input.decision);
    return requireParticipant(participant.id, db);
  });
}

export async function recordConsent(actor: TrialActor | undefined, input: { studyParticipantId: string; consentType: ConsentType; version: string; status: "granted" | "withdrawn"; method: "written" | "electronic"; documentRef?: string; decidedAt?: string }) {
  return transaction(actor, async (db) => {
    const participant = await requireParticipant(input.studyParticipantId, db);
    const allocation = await selectOne<Allocation>("SELECT * FROM allocations WHERE study_participant_id = $1", [participant.id], db);
    const id = makeId("SCON");
    await db.query(
      `INSERT INTO study_consents (id, study_participant_id, consent_type, version, ai_release_id, status, method, document_ref, decided_at, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, participant.id, input.consentType, input.version, input.consentType === "ai_interaction_logging" ? allocation?.aiReleaseId ?? null : null, input.status, input.method, input.documentRef ?? null, input.decidedAt ?? new Date().toISOString(), actor?.userId ?? "server"],
    );
    return (await selectOne<StudyConsent>("SELECT * FROM study_consents WHERE id = $1", [id], db))!;
  });
}

export async function setDiagnosisStratum(actor: TrialActor | undefined, studyParticipantId: string, stratum: DiagnosisStratum) {
  return transaction(actor, async (db) => {
    const participant = await requireParticipant(studyParticipantId, db, true);
    if (["allocated", "completed", "withdrawn"].includes(participant.status)) throw new TrialError("The stratum cannot change after allocation");
    await db.query("UPDATE study_participants SET diagnosis_stratum = $2, updated_at = now() WHERE id = $1", [participant.id, stratum]);
    return requireParticipant(participant.id, db);
  });
}

export async function enrollParticipant(actor: TrialActor | undefined, studyParticipantId: string) {
  return transaction(actor, async (db) => {
    const participant = await requireParticipant(studyParticipantId, db, true);
    if (participant.status !== "eligible") throw new TrialError(`Only eligible participants are enrolled (this one is ${participant.status})`);
    if (!participant.diagnosisStratum) throw new TrialError("Set the diagnosis stratum (MDD or anxiety) before enrolment");
    const consents = await currentConsents(participant.id, db);
    if (consents.main?.status !== "granted") throw new TrialError("Main consent is not recorded");
    const now = new Date();
    await setStatus(db, participant.id, "enrolled", ", enrolled_at = now()");
    const enrolled = await requireParticipant(participant.id, db);
    await generateTasks(db, enrolled, "enrollment", now, null);
    return enrolled;
  });
}

/** Allocation (SQL allocate_participant), then the visit schedule and the
 * post-allocation assessments. */
export async function allocateParticipant(actor: TrialActor | undefined, studyParticipantId: string) {
  return transaction(actor, async (db) => {
    const { rows } = await db.query<Record<string, unknown>>("SELECT * FROM allocate_participant($1, $2, $3)", [studyParticipantId, makeId("ALLOC"), actor ? `${actor.role}:${actor.userId}` : "server"]);
    if (!rows[0]) throw new TrialError("Allocation failed");
    const allocation = (await selectOne<Allocation>("SELECT * FROM allocations WHERE study_participant_id = $1", [studyParticipantId], db))!;
    const participant = await requireParticipant(studyParticipantId, db);
    const arm = (await selectOne<StudyArm>("SELECT * FROM study_arms WHERE id = $1", [allocation.armId], db))!;
    const start = new Date(allocation.allocatedAt);
    for (const entry of arm.scheduleTemplate) {
      const windowStart = addDays(start, Math.max(0, entry.week - 1) * 7);
      await db.query(
        `INSERT INTO study_visits (id, study_participant_id, visit_type, number, ai_module_number, window_start, window_end, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'scheduled') ON CONFLICT (study_participant_id, visit_type, number) DO NOTHING`,
        [makeId("VIS"), participant.id, entry.visitType, entry.number, entry.aiModuleNumber, isoDate(windowStart), isoDate(addDays(windowStart, 6))],
      );
    }
    await generateTasks(db, participant, "allocation", start, allocation.armCode as ArmCode);
    return allocation;
  });
}

export async function assignTherapist(actor: TrialActor | undefined, studyParticipantId: string, therapistId: string) {
  return transaction(actor, async (db) => {
    await requireParticipant(studyParticipantId, db, true);
    await db.query("UPDATE study_participants SET therapist_id = $2, updated_at = now() WHERE id = $1", [studyParticipantId, therapistId]);
    return requireParticipant(studyParticipantId, db);
  });
}

export async function withdrawParticipant(actor: TrialActor | undefined, input: Omit<Withdrawal, "id" | "recordedBy" | "withdrawnAt"> & { withdrawnAt?: string }) {
  return transaction(actor, async (db) => {
    const participant = await requireParticipant(input.studyParticipantId, db, true);
    if (participant.status === "withdrawn") throw new TrialError("Participant is already withdrawn");
    const withdrawnAt = input.withdrawnAt ?? new Date().toISOString();
    await db.query(
      `INSERT INTO withdrawals (id, study_participant_id, withdrawn_at, reason_category, reason_text, initiated_by, data_disposition, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [makeId("WDR"), participant.id, withdrawnAt, input.reasonCategory, input.reasonText ?? null, input.initiatedBy, input.dataDisposition, actor?.userId ?? "server"],
    );
    await db.query("UPDATE study_participants SET status = 'withdrawn', withdrawn_at = $2, updated_at = now() WHERE id = $1", [participant.id, withdrawnAt]);
    await db.query("UPDATE study_visits SET status = 'cancelled' WHERE study_participant_id = $1 AND status = 'scheduled'", [participant.id]);
    await db.query("UPDATE assessment_tasks SET status = 'cancelled' WHERE study_participant_id = $1 AND status = 'due'", [participant.id]);
    return requireParticipant(participant.id, db);
  });
}

export async function completeParticipant(actor: TrialActor | undefined, studyParticipantId: string) {
  return transaction(actor, async (db) => {
    const participant = await requireParticipant(studyParticipantId, db, true);
    if (participant.status !== "allocated") throw new TrialError(`Participant is ${participant.status}`);
    await setStatus(db, participant.id, "completed", ", completed_at = now()");
    return requireParticipant(participant.id, db);
  });
}

function moduleOf(sessionDefinitionId: string) {
  const match = /^tbct-s0*(\d+)$/.exec(sessionDefinitionId);
  return match ? Number(match[1]) : null;
}

/**
 * Whether this participant may run this AI session now, and on which frozen
 * release. With no active study in this database (development, demos) the
 * gate is open and not enforced. Otherwise: an allocated participant in an AI
 * arm, not withdrawn, with current main and AI-logging consent, whose frozen
 * release covers this session's prompt as deployed.
 */
export async function getSessionGate(runtimeParticipantId: string, sessionDefinitionId: string, currentPromptVersions?: Record<string, { version: string; sha256: string }>): Promise<SessionGate> {
  const study = await getStudy();
  if (!study || study.status !== "active") return { allowed: true, enforced: false };
  const deny = (reason: string): SessionGate => ({ allowed: false, enforced: true, reason });
  const participant = await selectOne<StudyParticipant>("SELECT * FROM study_participants WHERE study_id = $1 AND runtime_participant_id = $2", [study.id, runtimeParticipantId]);
  if (!participant) return deny("not_enrolled");
  if (participant.status === "withdrawn") return deny("withdrawn");
  if (participant.status !== "allocated") return deny(`status_${participant.status}`);
  const allocation = await selectOne<Allocation>("SELECT * FROM allocations WHERE study_participant_id = $1", [participant.id]);
  const arm = allocation ? await selectOne<StudyArm>("SELECT * FROM study_arms WHERE id = $1", [allocation.armId]) : undefined;
  if (!allocation || !arm?.aiEnabled || !allocation.aiReleaseId) return deny("arm_without_ai");
  const consents = await currentConsents(participant.id);
  if (consents.main?.status !== "granted") return deny("main_consent_missing");
  if (consents.ai_interaction_logging?.status !== "granted") return deny("ai_consent_missing");
  const release = await selectOne<AiRelease>("SELECT * FROM ai_releases WHERE id = $1", [allocation.aiReleaseId]);
  if (!release || release.status === "draft") return deny("release_not_frozen");
  const frozenPrompt = release.promptVersions[sessionDefinitionId];
  const deployed = currentPromptVersions?.[sessionDefinitionId];
  if (frozenPrompt && deployed && frozenPrompt.sha256 !== deployed.sha256) return deny("prompt_differs_from_frozen_release");
  const warnings: string[] = [];
  if (consents.ai_interaction_logging.aiReleaseId && consents.ai_interaction_logging.aiReleaseId !== release.id) warnings.push("ai_consent_for_other_release");
  const moduleNumber = moduleOf(sessionDefinitionId);
  const visit = moduleNumber === null ? undefined : await selectOne<StudyVisit>(
    `SELECT * FROM study_visits WHERE study_participant_id = $1 AND ai_module_number = $2 AND status = 'scheduled' ORDER BY window_start LIMIT 1`,
    [participant.id, moduleNumber],
  );
  if (!visit) warnings.push("module_not_scheduled");
  else {
    const today = isoDate(new Date());
    if (today < visit.windowStart || today > visit.windowEnd) warnings.push("visit_out_of_window");
  }
  return { allowed: true, enforced: true, studyParticipantId: participant.id, armCode: allocation.armCode, aiReleaseId: release.id, modelId: release.modelId, visitId: visit?.id ?? null, warnings };
}

/** At the end of a session: the visit it fulfils is completed and linked, and
 * the runtime session gets its protocol session number. */
export async function linkEndedSessionToVisit(db: Queryable, runtimeSession: { id: string; participantId: string; sessionDefinitionId: string; status: string }) {
  if (runtimeSession.status !== "completed") return null;
  const moduleNumber = moduleOf(runtimeSession.sessionDefinitionId);
  if (moduleNumber === null) return null;
  const visit = await selectOne<StudyVisit>(
    `SELECT v.* FROM study_visits v JOIN study_participants sp ON sp.id = v.study_participant_id
     WHERE sp.runtime_participant_id = $1 AND v.ai_module_number = $2 AND v.status = 'scheduled'
     ORDER BY v.window_start LIMIT 1 FOR UPDATE OF v`,
    [runtimeSession.participantId, moduleNumber],
    db,
  );
  if (!visit) return null;
  await db.query("UPDATE study_visits SET status = 'completed', completed_at = now(), runtime_session_id = $2, modality = 'in_app' WHERE id = $1", [visit.id, runtimeSession.id]);
  await db.query("UPDATE runtime_sessions SET session_number = $2, study_visit_id = $3 WHERE id = $1", [runtimeSession.id, visit.number || null, visit.id]);
  return visit;
}

export async function recordVisit(actor: TrialActor | undefined, visitId: string, patch: Pick<StudyVisit, "status"> & Partial<Pick<StudyVisit, "attended" | "durationMinutes" | "modality" | "therapistId">>) {
  return transaction(actor, async (db) => {
    const visit = await selectOne<StudyVisit>("SELECT * FROM study_visits WHERE id = $1 FOR UPDATE", [visitId], db);
    if (!visit) throw new TrialError("Visit not found");
    if (visit.status !== "scheduled") throw new TrialError(`Visit is already ${visit.status}`);
    if (!["completed", "missed", "cancelled"].includes(patch.status)) throw new TrialError("A visit is recorded as completed, missed or cancelled");
    await db.query(
      `UPDATE study_visits SET status = $2, completed_at = CASE WHEN $2 = 'completed' THEN now() ELSE NULL END, attended = $3,
         duration_minutes = $4, modality = $5, therapist_id = coalesce($6, therapist_id), recorded_by = $7 WHERE id = $1`,
      [visitId, patch.status, patch.attended ?? (patch.status === "completed" ? true : patch.status === "missed" ? false : null), patch.durationMinutes ?? null, patch.modality ?? null, patch.therapistId ?? null, actor?.userId ?? "server"],
    );
    const today = isoDate(new Date());
    if (patch.status === "completed" && (today < visit.windowStart || today > visit.windowEnd)) {
      const participant = await requireParticipant(visit.studyParticipantId, db);
      await db.query(
        `INSERT INTO protocol_deviations (id, study_id, study_participant_id, category, severity, description, detected_at, detected_by, status)
         VALUES ($1,$2,$3,'visit_window','minor',$4,now(),$5,'open')`,
        [makeId("DEV"), participant.studyId, participant.id, `${visit.visitType} ${visit.number} recorded outside its window (${visit.windowStart}..${visit.windowEnd})`, actor?.userId ?? "server"],
      );
    }
    return (await selectOne<StudyVisit>("SELECT * FROM study_visits WHERE id = $1", [visitId], db))!;
  });
}

export async function logHomework(actor: TrialActor | undefined, input: { studyParticipantId?: string; week: number; minutes: number; completed: boolean; note?: string }) {
  return transaction(actor, async (db) => {
    let studyParticipantId = input.studyParticipantId;
    if (actor?.role === "patient") {
      const own = await participantForAuthUser(actor.userId, db);
      if (!own) throw new TrialError("You are not enrolled in the study");
      studyParticipantId = own.id;
    }
    if (!studyParticipantId) throw new TrialError("Which participant?");
    const participant = await requireParticipant(studyParticipantId, db);
    if (participant.status !== "allocated") throw new TrialError(`Participant is ${participant.status}`);
    const id = makeId("HWL");
    await db.query(
      "INSERT INTO homework_logs (id, study_participant_id, week, minutes, completed, note, logged_by, logged_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now())",
      [id, participant.id, input.week, input.minutes, input.completed, input.note ?? null, actor?.userId ?? "server"],
    );
    return (await selectOne<HomeworkLog>("SELECT * FROM homework_logs WHERE id = $1", [id], db))!;
  });
}

export async function recordGateEvent(gate: SessionGate, context: { participantId: string; runtimeSessionId?: string }) {
  if (!gate.enforced) return;
  const now = new Date().toISOString();
  if (!gate.allowed) {
    await recordEvents([{ id: makeId("EVT"), participantId: context.participantId, runtimeSessionId: context.runtimeSessionId ?? null, category: "trial", severity: "warn", code: "SESSION_GATE_DENIED", detail: { reason: gate.reason }, createdAt: now }]);
  } else if (gate.warnings.length) {
    await recordEvents([{ id: makeId("EVT"), participantId: context.participantId, runtimeSessionId: context.runtimeSessionId ?? null, category: "trial", severity: "info", code: "SESSION_GATE_WARNING", detail: { warnings: gate.warnings }, createdAt: now }]);
  }
}
