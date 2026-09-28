import { NextResponse } from "next/server";
import "@/shared/data/server/runtime-request-context";
import { dispatchTrialStoreOp } from "@/shared/data/server/trial-store";
import { logAccess } from "@/shared/data/server/trial/events-store";
import { TrialError } from "@/shared/data/server/trial/db";
import { getParticipantByAuthUserId } from "@/shared/data/server/participant-store";
import { getRuntimeSessionRecord } from "@/shared/data/server/runtime-session-store";
import { getStaffCaller } from "@/shared/supabase/server";
import type { AppRole } from "@/shared/auth/roles";
import type { TrialStoreOp, TrialStoreOpName } from "@/shared/trial/trial-store-ops";

export const runtime = "nodejs";

// The trial store endpoint (.claude/TASK_SCOPE.json note2026_09_28_rct_backend).
// Every op names the roles that may run it; ops with no role are server-only
// (the runtime calls them in process). A patient's ops are also checked for
// ownership. The blinded assessor never reaches allocations, arms, releases,
// conversations or self-report responses (which instrument a participant
// answered can reveal the arm). Reads of identifiable clinical data are
// written to access_log.

const CLIN: AppRole[] = ["clinician", "admin"];
const COORD: AppRole[] = ["coordinator", "admin"];
const TEAM: AppRole[] = ["clinician", "coordinator", "admin"];

const ROLES: Record<TrialStoreOpName, AppRole[]> = {
  recordEvents: [],
  listEvents: CLIN,
  logAccess: [],
  finalizeSessionRecord: ["patient", ...TEAM],
  listSessionRecords: CLIN,
  recordRecordDownload: [],
  configureStudy: ["admin"],
  getStudyContext: TEAM,
  upsertTherapist: COORD,
  createAiRelease: ["admin"],
  freezeAiRelease: ["admin"],
  retireAiRelease: ["admin"],
  uploadRandomizationList: ["admin"],
  randomizationStatus: ["admin"],
  listTrialParticipants: TEAM,
  listBlindedParticipants: ["assessor", ...TEAM],
  getTrialParticipant: TEAM,
  getMyTrialStatus: ["patient"],
  listUnregisteredAccounts: COORD,
  registerParticipant: COORD,
  recordScreening: COORD,
  decideEligibility: COORD,
  recordConsent: COORD,
  setDiagnosisStratum: COORD,
  enrollParticipant: COORD,
  allocateParticipant: COORD,
  assignTherapist: COORD,
  withdrawParticipant: TEAM,
  completeParticipant: COORD,
  getSessionGate: ["patient", ...TEAM],
  recordVisit: TEAM,
  logHomework: ["patient", ...COORD],
  listAssessmentTasks: ["patient", "assessor", ...TEAM],
  submitAssessmentResponse: ["patient", "assessor", ...COORD],
  listAssessmentResponses: TEAM,
  setInstrumentItems: ["admin"],
  listReviewTasks: CLIN,
  resolveReviewTask: CLIN,
  createAdverseEvent: CLIN,
  updateAdverseEvent: CLIN,
  listAdverseEvents: CLIN,
  createDeviation: TEAM,
  resolveDeviation: TEAM,
  listDeviations: TEAM,
  getMonitoringSummary: TEAM,
  checkDeterioration: CLIN,
  lockStudy: ["admin"],
};

const LOGGED_READS: Partial<Record<TrialStoreOpName, (op: TrialStoreOp) => { resource: string; participantId?: string | null }>> = {
  getTrialParticipant: (op) => ({ resource: "trial_participant", participantId: (op as { studyParticipantId: string }).studyParticipantId }),
  listSessionRecords: (op) => ({ resource: "session_records", participantId: (op as { participantId: string }).participantId }),
  listAssessmentResponses: (op) => ({ resource: "assessment_responses", participantId: (op as { studyParticipantId: string }).studyParticipantId }),
  listAdverseEvents: (op) => ({ resource: "adverse_events", participantId: (op as { studyParticipantId?: string }).studyParticipantId ?? null }),
  listEvents: () => ({ resource: "runtime_events" }),
};

async function patientOwns(op: TrialStoreOp, authUserId: string) {
  const own = await getParticipantByAuthUserId(authUserId);
  if (!own) return false;
  if (op.op === "getSessionGate") return op.runtimeParticipantId === own.id;
  if (op.op === "finalizeSessionRecord") return (await getRuntimeSessionRecord(op.runtimeSessionId))?.participantId === own.id;
  if (op.op === "listAssessmentTasks") return !op.studyParticipantId;
  if (op.op === "logHomework") return !op.log.studyParticipantId;
  // getMyTrialStatus and submitAssessmentResponse resolve the participant
  // from the caller inside the store.
  return op.op === "getMyTrialStatus" || op.op === "submitAssessmentResponse";
}

export async function POST(request: Request) {
  try {
    const op = (await request.json()) as TrialStoreOp;
    const caller = await getStaffCaller();
    if (!caller) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
    const allowed = ROLES[op.op];
    if (!allowed || !allowed.includes(caller.role)) return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });
    if (caller.role === "patient" && !(await patientOwns(op, caller.userId))) return NextResponse.json({ ok: false, error: "Not authorized." }, { status: 403 });
    const actor = { userId: caller.userId, role: caller.role };
    const result = await dispatchTrialStoreOp({ ...op, actor });
    const logged = LOGGED_READS[op.op];
    if (logged && caller.role !== "patient") await logAccess(actor, { action: op.op, ...logged(op) });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    const status = error instanceof TrialError ? 400 : 500;
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Trial store operation failed." }, { status });
  }
}
