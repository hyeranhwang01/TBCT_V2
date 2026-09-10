import {
  assets,
  auditEntries,
  protocolEdges,
  protocolSteps,
  safetyRules,
  transcript,
  validationIssues,
  versions,
} from "@/shared/mocks/data";
import { getLocalAuditEntries } from "@/shared/data/repositories/clinical-assets-repository";
import type {
  AuditEntry,
  ClinicalAsset,
  ProtocolEdge,
  ProtocolStep,
  ProtocolVersion,
  SafetyRule,
  TranscriptSegment,
  ValidationIssue,
} from "@/types";

const delay = (ms = 220) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function getAssets(): Promise<ClinicalAsset[]> {
  await delay();
  return structuredClone(assets);
}

export async function uploadAsset(
  input: Pick<ClinicalAsset, "title" | "type" | "language" | "country" | "version" | "session">,
): Promise<ClinicalAsset> {
  await delay(680);
  return {
    id: `AST-${String(assets.length + 1).padStart(3, "0")}`,
    ...input,
    extractionStatus: "draft",
    reviewStatus: "draft",
    author: "Kim Jieun",
    updatedAt: "2026.07.29 09:18",
    blocks: 0,
    linkedSteps: [],
    sourceKind: "pdf",
    summary: "This is a newly registered clinical asset. After metadata linking, it will be included for structured draft generation.",
  };
}

export async function getExtraction(): Promise<{ transcript: TranscriptSegment[]; step: ProtocolStep }> {
  await delay();
  return { transcript: structuredClone(transcript), step: structuredClone(protocolSteps[2]) };
}

export async function approveExtraction(stepId: string): Promise<{ stepId: string; status: "approved" }> {
  await delay(300);
  return { stepId, status: "approved" };
}

export async function rejectExtraction(stepId: string): Promise<{ stepId: string; status: "review" }> {
  await delay(280);
  return { stepId, status: "review" };
}

export async function getProtocol(): Promise<{ steps: ProtocolStep[]; edges: ProtocolEdge[] }> {
  await delay();
  return { steps: structuredClone(protocolSteps), edges: structuredClone(protocolEdges) };
}

export async function updateProtocolStep(step: ProtocolStep): Promise<ProtocolStep> {
  await delay(260);
  return structuredClone(step);
}

export async function getSafetyRules(): Promise<SafetyRule[]> {
  await delay();
  return structuredClone(safetyRules);
}

export async function validateProtocol(): Promise<{ score: number; issues: ValidationIssue[] }> {
  await delay(420);
  return { score: 86, issues: structuredClone(validationIssues) };
}

export async function getVersions(): Promise<ProtocolVersion[]> {
  await delay();
  return structuredClone(versions);
}

export async function publishProtocol(version: string, target: "staging" | "production") {
  await delay(540);
  return {
    releaseId: "REL-2026-0729-001",
    checksum: "tbct-8c0f9f27b9f6e9a3",
    version,
    target,
    publishedAt: "2026.07.29 09:52",
  };
}

export async function getAuditEntries(): Promise<AuditEntry[]> {
  await delay();
  const localEntries = await getLocalAuditEntries().catch(() => []);
  return [...structuredClone(auditEntries), ...localEntries].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

