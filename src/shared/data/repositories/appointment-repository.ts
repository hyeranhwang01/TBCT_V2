import { APPOINTMENT_STORE_ENDPOINT } from "@/shared/runtime/appointment-store-ops";
import type { AppointmentRequest } from "@/shared/runtime/appointment-store-ops";
import { resolveStoreUrl } from "@/shared/runtime/resolve-store-url";
import type { Appointment } from "@/types/appointment";

async function callStore<T>(request: AppointmentRequest): Promise<T> {
  const response = await fetch(resolveStoreUrl(APPOINTMENT_STORE_ENDPOINT), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
  });
  const body = await response.json();
  if (!response.ok || !body.ok) throw new Error(body?.error ?? "Appointment store operation failed.");
  return body.result as T;
}

export async function createAppointment(participantId: string, scheduledAt: string, durationMinutes: number, notes?: string): Promise<Appointment> {
  return callStore<Appointment>({ op: "create", participantId, scheduledAt, durationMinutes, notes });
}

export async function listAppointmentsByParticipant(participantId: string): Promise<Appointment[]> {
  return callStore<Appointment[]>({ op: "listByParticipant", participantId });
}

export async function updateAppointmentStatus(id: string, status: "completed" | "cancelled" | "no_show"): Promise<Appointment> {
  return callStore<Appointment>({ op: "updateStatus", id, status });
}
