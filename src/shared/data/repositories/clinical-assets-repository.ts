import { assets as seededAssets } from "@/shared/mocks/data";
import type { AuditEntry } from "@/types";
import { getLocalDb } from "@/shared/data/db/tbct-local-db";
import { makeId } from "@/shared/id";
import { listAuditEntries, saveAuditEntry } from "@/shared/data/repositories/audit-log-repository";
import type {
  AssetFilters,
  AssetRelationship,
  AssetVersion,
  ExtractedDocument,
  ExtractionJob,
  ExtractionReviewDraft,
  LocalClinicalAsset,
  ProtocolDraftCandidate,
  ReviewDecision,
  SourceEvidence,
  StoredFileRecord,
  StructuredTbctItem,
  SourceManifest,
} from "@/types/clinical-assets";

function createLocalId(prefix = "id"): string {
  return makeId(prefix);
}

function makeLocalId(prefix: string) {
  return createLocalId(prefix);
}

function inferAssetType(type: string): LocalClinicalAsset["assetType"] {
  if (type.includes("Transcript")) return "transcript";
  if (type.includes("Therapist")) return "therapist_manual";
  if (type.includes("Patient")) return "patient_manual";
  if (type.includes("Prompt")) return "claude_prompt";
  return "supporting_document";
}

function inferCountry(country: string): LocalClinicalAsset["country"] {
  if (country === "Korea") return "KR";
  if (country === "Brazil") return "BR";
  if (country === "France") return "FR";
  return "OTHER";
}

async function seedIfEmpty() {
  const db = getLocalDb();
  const count = await db.clinicalAssets.count();
  if (count > 0) return;
  const now = "2026-07-29T09:00:00.000Z";
  await db.transaction("rw", [db.clinicalAssets, db.assetVersions], async () => {
    for (const item of seededAssets) {
      const versionId = makeId("VER");
      const asset: LocalClinicalAsset = {
        id: item.id,
        projectId: "TBCT-BR-001",
        title: item.title,
        originalFileName: `${item.id}.${item.sourceKind === "pdf" ? "pdf" : item.sourceKind === "docx" ? "docx" : "txt"}`,
        mimeType:
          item.sourceKind === "pdf"
            ? "application/pdf"
            : item.sourceKind === "docx"
              ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              : "text/plain",
        extension: item.sourceKind === "pdf" ? "pdf" : item.sourceKind === "docx" ? "docx" : "txt",
        sizeBytes: 1024 * 1024 * Math.max(1, item.blocks),
        checksumSha256: `seed-${item.id.toLowerCase()}`,
        assetType: inferAssetType(item.type),
        country: inferCountry(item.country),
        sourceLocale: item.language === "Korean" ? "ko-KR" : "en-US",
        sessionIds: [item.session],
        version: item.version,
        currentVersionId: versionId,
        status: item.reviewStatus === "approved" ? "ready" : item.reviewStatus === "error" ? "failed" : "needs_review",
        extractionStatus:
          item.extractionStatus === "approved"
            ? "completed"
            : item.extractionStatus === "error"
              ? "failed"
              : item.extractionStatus === "review"
                ? "partial"
                : "not_started",
        createdAt: now,
        updatedAt: now,
        createdBy: item.author,
        authorName: item.author,
        notes: item.summary,
        tags: [item.session],
        permissionLevel: "project",
        characterCount: item.blocks * 180,
        pageCount: item.sourceKind === "pdf" ? Math.max(1, Math.ceil(item.blocks / 4)) : undefined,
        warningCount: item.extractionStatus === "error" ? 1 : 0,
      };
      const version: AssetVersion = {
        id: versionId,
        assetId: asset.id,
        version: asset.version,
        checksumSha256: asset.checksumSha256,
        fileName: asset.originalFileName,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        extractionStatus: asset.extractionStatus,
        changeSummary: "Seeded demo asset",
        createdAt: now,
        createdBy: asset.createdBy,
        isCurrent: true,
      };
      await db.clinicalAssets.put(asset);
      await db.assetVersions.put(version);
    }
  });
}

export async function getClinicalAssets(filters: AssetFilters = {}) {
  await seedIfEmpty();
  const db = getLocalDb();
  let items = await db.clinicalAssets.toArray();
  items = items.filter((item) => item.status !== "archived");
  if (filters.query) {
    const q = filters.query.toLowerCase();
    items = items.filter((item) =>
      [item.title, item.originalFileName, item.authorName ?? "", item.checksumSha256, item.version, item.sessionIds.join(" "), item.tags.join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }
  if (filters.country && filters.country !== "all") items = items.filter((item) => item.country === filters.country);
  if (filters.locale && filters.locale !== "all") items = items.filter((item) => item.sourceLocale === filters.locale);
  if (filters.assetType && filters.assetType !== "all") items = items.filter((item) => item.assetType === filters.assetType);
  if (filters.sessionId && filters.sessionId !== "all") {
    const sessionId = filters.sessionId;
    items = items.filter((item) => item.sessionIds.includes(sessionId));
  }
  if (filters.status && filters.status !== "all") items = items.filter((item) => item.status === filters.status);
  if (filters.extractionStatus && filters.extractionStatus !== "all") items = items.filter((item) => item.extractionStatus === filters.extractionStatus);
  const sortBy = filters.sortBy ?? "updatedAt";
  items = [...items].sort((a, b) => String(b[sortBy] ?? "").localeCompare(String(a[sortBy] ?? "")));
  return items;
}

export async function getClinicalAsset(assetId: string) {
  await seedIfEmpty();
  return getLocalDb().clinicalAssets.get(assetId);
}

export async function saveStoredFile(record: StoredFileRecord) {
  await getLocalDb().storedFiles.put(record);
}

export async function getStoredFileByAsset(assetId: string) {
  return getLocalDb().storedFiles.where("assetId").equals(assetId).first();
}

export async function getStoredFileByVersion(versionId: string) {
  return getLocalDb().storedFiles.where("versionId").equals(versionId).first();
}

export async function findDuplicateByChecksum(checksum: string) {
  await seedIfEmpty();
  const assets = await getLocalDb().clinicalAssets.toArray();
  return assets.find((asset) => asset.checksumSha256 === checksum);
}

export async function findDuplicateVersionChecksum(assetId: string, checksum: string) {
  await seedIfEmpty();
  const versions = await getLocalDb().assetVersions.where("assetId").equals(assetId).toArray();
  return versions.find((version) => version.checksumSha256 === checksum);
}

export async function createClinicalAsset(asset: LocalClinicalAsset, fileRecord: StoredFileRecord, version: AssetVersion, audit: AuditEntry) {
  const db = getLocalDb();
  await db.transaction("rw", [db.clinicalAssets, db.storedFiles, db.assetVersions, db.auditEntries], async () => {
    await db.clinicalAssets.put(asset);
    await db.storedFiles.put(fileRecord);
    await db.assetVersions.put(version);
    await saveAuditEntry(audit);
  });
  return asset;
}

export async function updateClinicalAsset(assetId: string, patch: Partial<LocalClinicalAsset>, audit?: AuditEntry) {
  const db = getLocalDb();
  const current = await db.clinicalAssets.get(assetId);
  if (!current) throw new Error("Asset not found");
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await db.clinicalAssets.put(next);
  if (audit) await saveAuditEntry(audit);
  return next;
}

export async function archiveClinicalAsset(assetId: string, audit: AuditEntry) {
  return updateClinicalAsset(assetId, { status: "archived" }, audit);
}

export async function deleteClinicalAsset(assetId: string, audit: AuditEntry) {
  const db = getLocalDb();
  await db.transaction(
    "rw",
    [db.clinicalAssets, db.storedFiles, db.extractedDocuments, db.extractionJobs, db.assetVersions, db.relationships, db.auditEntries],
    async () => {
      await db.clinicalAssets.delete(assetId);
      const fileIds = await db.storedFiles.where("assetId").equals(assetId).primaryKeys();
      await db.storedFiles.bulkDelete(fileIds);
      await saveAuditEntry(audit);
      const docs = await db.extractedDocuments.where("assetId").equals(assetId).primaryKeys();
      await db.extractedDocuments.bulkDelete(docs);
      const jobs = await db.extractionJobs.where("assetId").equals(assetId).primaryKeys();
      await db.extractionJobs.bulkDelete(jobs);
      const versions = await db.assetVersions.where("assetId").equals(assetId).primaryKeys();
      await db.assetVersions.bulkDelete(versions);
    },
  );
}

export async function getAssetVersions(assetId: string) {
  return getLocalDb().assetVersions.where("assetId").equals(assetId).reverse().sortBy("createdAt");
}

export async function getAssetVersion(versionId: string) {
  return getLocalDb().assetVersions.get(versionId);
}

export async function addAssetVersion(version: AssetVersion, fileRecord: StoredFileRecord, audit: AuditEntry) {
  const db = getLocalDb();
  await db.transaction("rw", [db.assetVersions, db.storedFiles, db.auditEntries], async () => {
    await db.assetVersions.put(version);
    await db.storedFiles.put(fileRecord);
    await saveAuditEntry(audit);
  });
}

export async function setCurrentAssetVersion(assetId: string, versionId: string, audit: AuditEntry) {
  const db = getLocalDb();
  const versions = await db.assetVersions.where("assetId").equals(assetId).toArray();
  const current = versions.find((item) => item.id === versionId);
  if (!current) throw new Error("Version not found");
  await db.transaction("rw", [db.assetVersions, db.clinicalAssets, db.auditEntries], async () => {
    for (const version of versions) {
      await db.assetVersions.put({ ...version, isCurrent: version.id === versionId });
    }
    await updateClinicalAsset(assetId, {
      version: current.version,
      currentVersionId: current.id,
      originalFileName: current.fileName,
      mimeType: current.mimeType,
      sizeBytes: current.sizeBytes,
      checksumSha256: current.checksumSha256,
      extractionStatus: current.extractionStatus,
    });
    await saveAuditEntry(audit);
  });
  return current;
}

export async function saveExtractedDocument(document: ExtractedDocument, job: ExtractionJob, audit: AuditEntry) {
  const db = getLocalDb();
  await db.transaction("rw", [db.extractedDocuments, db.extractionJobs, db.assetVersions, db.auditEntries], async () => {
    await db.extractedDocuments.put(document);
    await db.extractionJobs.put(job);
    if (document.assetVersionId) {
      const version = await db.assetVersions.get(document.assetVersionId);
      if (version) {
        await db.assetVersions.put({ ...version, extractionStatus: job.status, extractedDocumentId: document.id });
      }
    }
    await saveAuditEntry(audit);
  });
}

export async function getExtractedDocument(assetId: string, assetVersionId?: string) {
  if (assetVersionId) {
    return getLocalDb().extractedDocuments.where("assetVersionId").equals(assetVersionId).last();
  }
  return getLocalDb().extractedDocuments.where("assetId").equals(assetId).last();
}

export async function saveExtractionJob(job: ExtractionJob) {
  await getLocalDb().extractionJobs.put(job);
}

export async function getExtractionJobs() {
  return getLocalDb().extractionJobs.orderBy("createdAt").reverse().toArray();
}

export async function getExtractionJob(jobId: string) {
  return getLocalDb().extractionJobs.get(jobId);
}

export async function getReviewDraft(draftId: string) {
  return getLocalDb().reviewDrafts.get(draftId);
}

export async function saveReviewDraft(draft: ExtractionReviewDraft, audit: AuditEntry) {
  const db = getLocalDb();
  await db.transaction("rw", [db.reviewDrafts, db.auditEntries], async () => {
    await db.reviewDrafts.put(draft);
    await saveAuditEntry(audit);
  });
}

export async function updateReviewDraft(draftId: string, patch: Partial<ExtractionReviewDraft>, audit?: AuditEntry) {
  const db = getLocalDb();
  const current = await db.reviewDrafts.get(draftId);
  if (!current) throw new Error("Draft not found");
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await db.reviewDrafts.put(next);
  if (audit) await saveAuditEntry(audit);
  return next;
}

export async function getStructuredItems(draftId: string) {
  return getLocalDb().structuredTbctItems.where("draftId").equals(draftId).sortBy("createdAt");
}

export async function saveStructuredItem(item: StructuredTbctItem, audit: AuditEntry) {
  const db = getLocalDb();
  await db.transaction("rw", [db.structuredTbctItems, db.auditEntries], async () => {
    await db.structuredTbctItems.put(item);
    await saveAuditEntry(audit);
  });
}

export async function updateStructuredItem(itemId: string, patch: Partial<StructuredTbctItem>, audit: AuditEntry) {
  const db = getLocalDb();
  const current = await db.structuredTbctItems.get(itemId);
  if (!current) throw new Error("Structured item not found");
  const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
  await db.structuredTbctItems.put(next);
  await saveAuditEntry(audit);
  return next;
}

export async function deleteStructuredItem(itemId: string, audit: AuditEntry) {
  const db = getLocalDb();
  await db.structuredTbctItems.delete(itemId);
  await saveAuditEntry(audit);
}

export async function saveSourceEvidence(evidence: SourceEvidence, audit?: AuditEntry) {
  const db = getLocalDb();
  await db.sourceEvidence.put(evidence);
  if (audit) await saveAuditEntry(audit);
}

export async function getSourceEvidenceByIds(ids: string[]) {
  const db = getLocalDb();
  return ids.length ? db.sourceEvidence.bulkGet(ids) : [];
}

export async function deleteSourceEvidence(evidenceId: string, audit: AuditEntry) {
  const db = getLocalDb();
  await db.sourceEvidence.delete(evidenceId);
  await saveAuditEntry(audit);
}

export async function saveReviewDecision(decision: ReviewDecision, audit: AuditEntry) {
  const db = getLocalDb();
  await db.reviewDecisions.put(decision);
  await saveAuditEntry(audit);
}

export async function getReviewDecisions(draftId: string) {
  return getLocalDb().reviewDecisions.where("draftId").equals(draftId).reverse().sortBy("createdAt");
}

export async function linkAssets(relationship: AssetRelationship, audit: AuditEntry) {
  const db = getLocalDb();
  await db.relationships.put(relationship);
  await saveAuditEntry(audit);
}

export async function updateRelationship(id: string, patch: Partial<AssetRelationship>, audit: AuditEntry) {
  const db = getLocalDb();
  const current = await db.relationships.get(id);
  if (!current) throw new Error("Relationship not found");
  const next = { ...current, ...patch };
  await db.relationships.put(next);
  await saveAuditEntry(audit);
  return next;
}

export async function deleteRelationship(id: string, audit: AuditEntry) {
  const db = getLocalDb();
  await db.relationships.delete(id);
  await saveAuditEntry(audit);
}

export async function getRelationships(assetId: string) {
  const db = getLocalDb();
  const all = await db.relationships.toArray();
  return all.filter((item) => item.sourceAssetId === assetId || item.targetAssetId === assetId);
}

export async function getAllRelationships() {
  return getLocalDb().relationships.toArray();
}

export async function saveProtocolDraftCandidate(candidate: ProtocolDraftCandidate, audit: AuditEntry) {
  const db = getLocalDb();
  await db.protocolDraftCandidates.put(candidate);
  await saveAuditEntry(audit);
}

export async function getProtocolDraftCandidate(candidateId: string) {
  return getLocalDb().protocolDraftCandidates.get(candidateId);
}

export async function exportSourceManifest(projectId: string): Promise<SourceManifest> {
  await seedIfEmpty();
  const db = getLocalDb();
  return {
    schemaVersion: "1.0",
    exportedAt: new Date().toISOString(),
    projectId,
    assets: await db.clinicalAssets.where("projectId").equals(projectId).toArray(),
    relationships: await db.relationships.toArray(),
  };
}

export async function getLocalAuditEntries() {
  await seedIfEmpty();
  return listAuditEntries();
}
