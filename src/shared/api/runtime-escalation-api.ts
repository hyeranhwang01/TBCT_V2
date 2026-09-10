import { listRuntimeEscalations, updateRuntimeEscalation } from "@/shared/data/repositories/runtime-session-repository";

export async function getRuntimeEscalations() {
  return listRuntimeEscalations();
}

export async function acknowledgeEscalation(escalationId: string) {
  return updateRuntimeEscalation(escalationId, { status: "acknowledged", acknowledgedAt: new Date().toISOString() });
}

export async function resolveEscalation(escalationId: string, resolution: string) {
  return updateRuntimeEscalation(escalationId, {
    status: "resolved",
    resolvedAt: new Date().toISOString(),
    resolutionNote: resolution,
  });
}
