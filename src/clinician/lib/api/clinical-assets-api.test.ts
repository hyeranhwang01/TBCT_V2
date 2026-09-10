import { describe, expect, it } from "vitest";
import type { LocalClinicalAsset, StructuredTbctItem } from "@/types/clinical-assets";
import { validateSemanticVersion, validateStructuredItemApproval, validateTranscriptRelation, validateTranslationRelation } from "@/clinician/lib/api/clinical-assets-api";

const baseAsset: LocalClinicalAsset = {
  id: "AST-1",
  projectId: "TBCT-BR-001",
  title: "Asset",
  originalFileName: "asset.txt",
  mimeType: "text/plain",
  extension: "txt",
  sizeBytes: 12,
  checksumSha256: "abc",
  assetType: "therapist_manual",
  country: "BR",
  sourceLocale: "ko-KR",
  sessionIds: ["Session 03"],
  version: "1.0.0",
  currentVersionId: "VER-1",
  status: "ready",
  extractionStatus: "completed",
  createdAt: "2026-07-29T00:00:00.000Z",
  updatedAt: "2026-07-29T00:00:00.000Z",
  createdBy: "Demo User",
  tags: [],
  permissionLevel: "project",
};

const baseItem: StructuredTbctItem = {
  id: "ITEM-1",
  draftId: "DRF-1",
  sessionId: "Session 03",
  mappingType: "basic_question",
  title: "Question",
  content: "How did the homework go?",
  status: "in_progress",
  sourceEvidenceIds: ["EVD-1"],
  createdBy: "Demo User",
  createdAt: "2026-07-29T00:00:00.000Z",
  updatedAt: "2026-07-29T00:00:00.000Z",
};

describe("validateSemanticVersion", () => {
  it("accepts semantic versions", () => {
    expect(validateSemanticVersion("1.2.3").valid).toBe(true);
  });

  it("accepts legacy v-prefixed version with warning", () => {
    const result = validateSemanticVersion("v1.2");
    expect(result.valid).toBe(true);
    expect(result.warning).toBeTruthy();
  });
});

describe("relationship validators", () => {
  it("rejects translation relation with same locale", () => {
    expect(validateTranslationRelation(baseAsset, { ...baseAsset, id: "AST-2" })).toContain("different locales");
  });

  it("rejects transcript relation to non-media asset", () => {
    expect(validateTranscriptRelation({ ...baseAsset, assetType: "transcript" }, { ...baseAsset, id: "AST-2", assetType: "therapist_manual" })).toContain("audio or video");
  });
});

describe("validateStructuredItemApproval", () => {
  it("requires source evidence", () => {
    expect(validateStructuredItemApproval({ ...baseItem, sourceEvidenceIds: [] })).toContain("source evidence");
  });

  it("requires escalation rationale for clinician intervention condition", () => {
    expect(validateStructuredItemApproval({ ...baseItem, mappingType: "clinician_intervention_condition", clinicalRationale: "review later" })).toContain("escalation");
  });
});
