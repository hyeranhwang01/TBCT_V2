import { sendClinicianMessage, listClinicianMessages } from "@/shared/data/repositories/clinician-message-repository";
import type { ClinicianMessage } from "@/types/clinician-message";

export async function sendMessage(participantId: string, body: string): Promise<ClinicianMessage> {
  return sendClinicianMessage(participantId, body);
}

export async function listMessages(participantId: string): Promise<ClinicianMessage[]> {
  return listClinicianMessages(participantId);
}
