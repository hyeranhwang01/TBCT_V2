import { getParticipant } from "@/shared/data/repositories/participant-repository";
import { getRetentionPolicy, listLongitudinalMemories, saveMemoryRetrievalRun, saveMemoryUsageLog } from "@/shared/data/repositories/longitudinal-memory-repository";
import { makeId } from "@/shared/id";
import type { LongitudinalMemory, MemoryRetrievalRequest, MemoryRetrievalResult, MemoryType } from "@/types/longitudinal-memory";

function getTypeWeight(memoryType: MemoryType) {
  const map: Record<MemoryType, number> = {
    session_goal: 15,
    treatment_goal: 18,
    patient_preference: 20,
    communication_preference: 20,
    reported_context: 8,
    activity_history: 10,
    homework_assignment: 20,
    homework_outcome: 14,
    barrier: 12,
    coping_strategy: 14,
    progress_marker: 10,
    clinician_note: 0,
    safety_relevant: 0,
    temporary_session_fact: 4,
  };
  return map[memoryType];
}

function rankMemory(memory: LongitudinalMemory, request: MemoryRetrievalRequest) {
  let score = getTypeWeight(memory.memoryType);
  if (memory.isDirectlyReported) score += 20;
  if (memory.isSystemDerived) score -= 10;
  if (memory.sourceSessionId === request.runtimeSessionId) score -= 5;
  if (memory.memoryType === "homework_assignment") score += 20;
  if (memory.memoryType === "treatment_goal") score += 15;
  const intent = `${request.currentClinicalIntent ?? ""} ${request.currentNodeType}`.toLowerCase();
  if (intent && `${memory.title} ${memory.content}`.toLowerCase().includes(intent.split(" ")[0] ?? "")) score += 10;
  if (memory.validUntil) {
    const remaining = new Date(memory.validUntil).getTime() - Date.now();
    if (remaining < 1000 * 60 * 60 * 24 * 14) score -= 5;
  }
  return score;
}

export async function retrieveSelectiveMemory(request: MemoryRetrievalRequest) {
  const participant = await getParticipant(request.participantId);
  if (!participant) throw new Error("Participant not found");
  const allMemories = await listLongitudinalMemories(request.participantId);
  const now = Date.now();
  const excluded: MemoryRetrievalResult["excluded"] = [];
  const evaluated = [];
  for (const memory of allMemories) {
    const status = memory.status;
    if (status !== "approved") {
      excluded.push({ memoryId: memory.id, reason: "not approved" });
      continue;
    }
    if (memory.validUntil && new Date(memory.validUntil).getTime() < now) {
      excluded.push({ memoryId: memory.id, reason: "expired" });
      continue;
    }
    if (!participant.consent.crossSessionUseAllowed) {
      excluded.push({ memoryId: memory.id, reason: "cross-session consent disabled" });
      continue;
    }
    if (memory.sensitivity === "safety_restricted") {
      excluded.push({ memoryId: memory.id, reason: "safety restricted" });
      continue;
    }
    const policy = await getRetentionPolicy(memory.retentionPolicyId);
    if (!policy || !policy.allowRuntimeInjection) {
      excluded.push({ memoryId: memory.id, reason: "policy blocks runtime injection" });
      continue;
    }
    if (policy.allowedNodeTypes?.length && !policy.allowedNodeTypes.includes(request.currentNodeType)) {
      excluded.push({ memoryId: memory.id, reason: "node type not allowed by policy" });
      continue;
    }
    if (request.requestedMemoryTypes?.length && !request.requestedMemoryTypes.includes(memory.memoryType)) {
      excluded.push({ memoryId: memory.id, reason: "memory type not requested" });
      continue;
    }
    evaluated.push({ memory, score: rankMemory(memory, request) });
  }
  evaluated.sort((left, right) => right.score - left.score);
  const selected = evaluated.slice(0, request.maxItems);
  const run: MemoryRetrievalResult = {
    id: makeId("MRR"),
    participantId: request.participantId,
    runtimeSessionId: request.runtimeSessionId,
    currentNodeId: request.currentNodeId,
    candidatesEvaluated: allMemories.length,
    selectedMemoryIds: selected.map((item) => item.memory.id),
    excluded,
    createdAt: new Date().toISOString(),
  };
  await saveMemoryRetrievalRun(run);
  await Promise.all(
    selected.map((item) =>
      saveMemoryUsageLog({
        id: makeId("MUL"),
        memoryId: item.memory.id,
        participantId: request.participantId,
        runtimeSessionId: request.runtimeSessionId,
        nodeId: request.currentNodeId,
        usageType: "retrieved",
        reason: `retrieval score ${item.score}`,
        retrievalScore: item.score,
        createdAt: new Date().toISOString(),
      }),
    ),
  );
  return { run, selected: selected.map((item) => item.memory) };
}
