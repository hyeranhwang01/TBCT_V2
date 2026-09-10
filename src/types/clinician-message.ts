// Async patient<->clinician messaging -- see sql/015_clinician_messages.sql.

export interface ClinicianMessage {
  id: string;
  participantId: string;
  senderRole: "patient" | "clinician";
  /** Auth user id of whoever sent it -- for a clinician sender, resolve to
   * a display email via src/shared/supabase/admin.ts's getUserEmail, same as
   * RuntimeParticipant.assignedClinician elsewhere in this app. */
  senderUserId: string;
  body: string;
  createdAt: string;
}
