import type { AuditEntry } from "@/types";
import type {
  AssetFilters,
  AssetRelationship,
  AssetRelationshipType,
  AssetVersion,
  CreateAssetRelationshipInput,
  CreateAssetVersionInput,
  CreateClinicalAssetInput,
  CreateStructuredItemInput,
  DraftValidationIssue,
  ExtractedBlock,
  ExtractedDocument,
  ExtractionJob,
  ExtractionReviewDraft,
  FollowUpBranchData,
  DetectedSession,
  LocalClinicalAsset,
  ProtocolDraftCandidate,
  ReviewDecision,
  ReviewStatus,
  SourceEvidence,
  SourceBlock,
  StructuredTbctItem,
  TbctMappingType,
} from "@/types/clinical-assets";
import {
  addAssetVersion,
  archiveClinicalAsset as archiveRepoAsset,
  createClinicalAsset as createRepoAsset,
  deleteClinicalAsset as deleteRepoAsset,
  deleteRelationship,
  deleteSourceEvidence,
  deleteStructuredItem as deleteStructuredItemRepo,
  exportSourceManifest as exportRepoManifest,
  findDuplicateByChecksum,
  findDuplicateVersionChecksum,
  getAllRelationships,
  getAssetVersion,
  getAssetVersions,
  getClinicalAsset,
  getClinicalAssets,
  getExtractedDocument,
  getExtractionJob,
  getExtractionJobs,
  getProtocolDraftCandidate,
  getRelationships,
  getReviewDecisions,
  getReviewDraft,
  getSourceEvidenceByIds,
  getStoredFileByAsset,
  getStoredFileByVersion,
  getStructuredItems,
  linkAssets,
  saveExtractedDocument,
  saveExtractionJob,
  saveProtocolDraftCandidate,
  saveReviewDecision,
  saveReviewDraft,
  saveSourceEvidence,
  saveStructuredItem,
  saveStoredFile,
  setCurrentAssetVersion as setCurrentVersionRepo,
  updateClinicalAsset,
  updateRelationship as updateRelationshipRepo,
  updateReviewDraft,
  updateStructuredItem as updateStructuredItemRepo,
} from "@/shared/data/repositories/clinical-assets-repository";
import { getLocalDb } from "@/shared/data/db/tbct-local-db";

const DEMO_MAX_PAGES = 20;
const DEMO_MAX_CHARACTERS = 100_000;

function createLocalId(prefix = "id"): string {
  const webCrypto =
    typeof globalThis !== "undefined"
      ? globalThis.crypto
      : undefined;

  if (typeof webCrypto?.randomUUID === "function") {
    return `${prefix}-${webCrypto.randomUUID()}`;
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function makeId(prefix: string) {
  return createLocalId(prefix);
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function resolveImportedModule<TModule extends object>(moduleValue: TModule) {
  const imported = moduleValue as TModule & { default?: TModule };
  if (typeof imported.default === "object" && imported.default !== null) return imported.default;
  return moduleValue;
}

function normalizeSessionIds(sessionIds: string[]) {
  const cleaned = sessionIds.map((value) => value.trim()).filter(Boolean);
  return cleaned.length ? cleaned : ["All Sessions"];
}

function ensureFileData(fileRecord?: { blob?: Blob | null }) {
  if (!fileRecord?.blob) throw new Error("Original file data is missing from local storage.");
  if (fileRecord.blob.size <= 0) throw new Error("Original file data is missing from local storage.");
  return fileRecord.blob;
}

function splitIntoBlocks(pageText: string, pageNumber: number, assetId: string, assetVersionId?: string) {
  const chunks = pageText
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
  const blocks: ExtractedBlock[] = [];

  let currentText = "";
  let blockIndex = 0;
  const flush = () => {
    const text = currentText.trim();
    if (!text) return;
    blocks.push({
      id: makeId("BLK"),
      assetId,
      assetVersionId,
      blockIndex: blockIndex++,
      type: classifyBlockType(text),
      text,
      pageNumber,
      sourceLocator: `page:${pageNumber}`,
    });
    currentText = "";
  };

  for (const chunk of chunks) {
    if (!currentText) {
      currentText = chunk;
      continue;
    }
    if ((currentText.length + chunk.length) < 500) {
      currentText = `${currentText}\n\n${chunk}`;
      continue;
    }
    flush();
    currentText = chunk;
  }
  flush();
  return blocks;
}

function createAuditEntry(input: Partial<AuditEntry> & Pick<AuditEntry, "action" | "resource" | "version">): AuditEntry {
  return {
    id: makeId("AUD"),
    timestamp: new Date().toISOString(),
    user: "Demo User",
    initials: "DM",
    role: "Clinical Research Operator",
    previousValue: "",
    newValue: "",
    reason: "",
    result: "Success",
    ...input,
  };
}

function extensionFromName(name: string) {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

function isTextAsset(extension: string, mimeType: string) {
  return ["txt", "md", "json", "docx", "pdf"].includes(extension) || mimeType.startsWith("text/");
}

function normalizeDetectionText(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function truncateLabel(text: string, maxLength = 72) {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

function sessionLabelFromIndex(index: number) {
  return `SESSION-${String(index).padStart(2, "0")}`;
}

function classifyBlockType(text: string, fallback: ExtractedBlock["type"] = "paragraph") {
  const normalized = normalizeDetectionText(text);
  if (/^(?:#+\s*|(?:session|세션|chapter|module)\s*\d+|제\s*\d+\s*회기)/i.test(normalized)) return "heading";
  if (/^\d+[.)]\s+/.test(normalized) || normalized === normalized.toUpperCase()) return "heading";
  return fallback;
}

function detectSessionHeading(text: string) {
  const normalized = normalizeDetectionText(text);
  const patterns = [
    { regex: /^(?:#+\s*)?(?:session|세션)\s*(\d+|[ivxlcdm]+)\b[:\-\.]?\s*(.*)$/i, prefix: "Session" },
    { regex: /^(?:#+\s*)?chapter\s*(\d+|[ivxlcdm]+)\b[:\-\.]?\s*(.*)$/i, prefix: "Chapter" },
    { regex: /^(?:#+\s*)?module\s*(\d+|[ivxlcdm]+)\b[:\-\.]?\s*(.*)$/i, prefix: "Module" },
    { regex: /^(?:#+\s*)?제\s*(\d+)\s*회기\b[:\-\.]?\s*(.*)$/i, prefix: "세션" },
  ] as const;
  for (const pattern of patterns) {
    const match = normalized.match(pattern.regex);
    if (!match) continue;
    const number = match[1]?.trim() ?? "";
    const rest = match[2]?.trim() ?? "";
    const title = truncateLabel(rest || normalized);
    return {
      label: `${pattern.prefix} ${number}`.trim(),
      title,
    };
  }
  return null;
}

function enrichSourceBlocks(blocks: ExtractedBlock[], asset: LocalClinicalAsset) {
  const sourceBlocks: SourceBlock[] = [];
  const detectedSessions: DetectedSession[] = [];
  const preferredSessionId = asset.sessionIds[0];
  let activeSession: DetectedSession | null = null;

  for (const block of blocks) {
    const heading = detectSessionHeading(block.text);
    const isSessionStart = Boolean(heading);

    if (heading) {
      activeSession = {
        id: sessionLabelFromIndex(detectedSessions.length + 1),
        label: heading.label,
        title: heading.title,
        sourceLocator: block.sourceLocator,
        startBlockIndex: block.blockIndex,
        endBlockIndex: block.blockIndex,
        blockCount: 0,
      };
      detectedSessions.push(activeSession);
    } else if (!activeSession && preferredSessionId && !detectedSessions.length) {
      activeSession = {
        id: preferredSessionId,
        label: preferredSessionId,
        title: asset.title,
        sourceLocator: block.sourceLocator,
        startBlockIndex: block.blockIndex,
        endBlockIndex: block.blockIndex,
        blockCount: 0,
      };
      detectedSessions.push(activeSession);
    }

    if (activeSession) {
      activeSession.endBlockIndex = block.blockIndex;
      activeSession.blockCount += 1;
    }

    sourceBlocks.push({
      ...block,
      type: classifyBlockType(block.text, block.type),
      sessionId: activeSession?.id,
      sessionLabel: activeSession?.label,
      sessionHeading: heading?.title,
      sectionLabel: block.type === "heading" ? truncateLabel(block.text) : undefined,
      isSessionStart,
    });
  }

  if (!detectedSessions.length && blocks.length && preferredSessionId) {
    detectedSessions.push({
      id: preferredSessionId,
      label: preferredSessionId,
      title: asset.title,
      sourceLocator: blocks[0]?.sourceLocator ?? "document:start",
      startBlockIndex: 0,
      endBlockIndex: Math.max(0, blocks.length - 1),
      blockCount: blocks.length,
    });
    for (const block of sourceBlocks) {
      block.sessionId = preferredSessionId;
      block.sessionLabel = preferredSessionId;
    }
  }

  return { sourceBlocks, detectedSessions };
}

export function validateSemanticVersion(version: string) {
  const strict = /^\d+\.\d+\.\d+$/;
  const legacy = /^v\d+(\.\d+){1,2}$/i;
  return {
    valid: strict.test(version) || legacy.test(version),
    warning: strict.test(version) ? undefined : legacy.test(version) ? "Legacy version label detected. Semantic version is preferred." : "Invalid version format.",
  };
}

function groupToNodeType(mappingType: TbctMappingType): ProtocolDraftCandidate["items"][number]["proposedNodeType"] {
  switch (mappingType) {
    case "session_goal":
      return "session_start";
    case "clinical_intent":
      return "dialogue";
    case "basic_question":
      return "question";
    case "expected_response":
    case "follow_up_branch":
      return "condition";
    case "therapeutic_activity":
      return "activity";
    case "homework":
      return "homework";
    case "visualization":
      return "visualization";
    case "completion_condition":
      return "session_complete";
    case "safety_rule":
      return "safety_check";
    case "clinician_intervention_condition":
      return "clinician_escalation";
  }
}

export async function calculateFileChecksum(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();

  const webCrypto =
    typeof globalThis !== "undefined"
      ? globalThis.crypto
      : undefined;

  if (webCrypto?.subtle) {
    const hashBuffer = await webCrypto.subtle.digest("SHA-256", buffer);

    return Array.from(new Uint8Array(hashBuffer))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  // Deterministic fallback for demo environments where Web Crypto is unavailable.
  const bytes = new Uint8Array(buffer);
  let hash = 0x811c9dc5;

  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }

  return `fallback-fnv1a-${(hash >>> 0)
    .toString(16)
    .padStart(8, "0")}`;
}

async function loadPdfJs() {
  if (typeof window === "undefined") {
    throw new Error("PDF extraction can only run in the browser.");
  }

  const pdfjsUrl = "/vendor/pdfjs/pdf.mjs" as const;
  const pdfjsModule = await import(/* webpackIgnore: true */ pdfjsUrl);
  const pdfjs = "default" in pdfjsModule && pdfjsModule.default ? pdfjsModule.default : pdfjsModule;
  if (!pdfjs || typeof pdfjs !== "object" || typeof (pdfjs as { getDocument?: unknown }).getDocument !== "function") {
    throw new Error("PDF.js browser module loaded, but getDocument is unavailable.");
  }
  const workerSrc = "/vendor/pdfjs/pdf.worker.mjs";
  const resolvedPdfjs = pdfjs as { GlobalWorkerOptions?: { workerSrc?: string } };
  const moduleOptions = (pdfjsModule as { GlobalWorkerOptions?: { workerSrc?: string } }).GlobalWorkerOptions;
  if (resolvedPdfjs.GlobalWorkerOptions) {
    resolvedPdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
  }
  if (moduleOptions) {
    moduleOptions.workerSrc = workerSrc;
  }
  return pdfjs as { getDocument: (options: { data: Uint8Array; disableWorker: boolean; useSystemFonts: boolean }) => { promise: Promise<{ numPages: number; getPage(page: number): Promise<{ getTextContent(): Promise<{ items: Array<{ str?: string } | { str: string }> }> }> }> } };
}

async function extractPdf(file: Blob, assetId: string, assetVersionId?: string): Promise<ExtractedDocument> {
  const pdfjs = await loadPdfJs();
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(arrayBuffer),
    disableWorker: true,
    useSystemFonts: true,
  } as any);
  const doc = await loadingTask.promise;
  const blocks: ExtractedBlock[] = [];
  let processedPages = 0;
  let emptyPages = 0;
  let collectedCharacters = 0;
  let lastProgress = 25;

  for (let page = 1; page <= doc.numPages && processedPages < DEMO_MAX_PAGES && collectedCharacters < DEMO_MAX_CHARACTERS; page += 1) {
    const pageData = await doc.getPage(page);
    const text = await pageData.getTextContent();
    const pageText = text.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    processedPages += 1;

    if (!pageText) {
      emptyPages += 1;
      if (processedPages % 3 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      continue;
    }

    const pageBlocks = splitIntoBlocks(pageText, page, assetId, assetVersionId);
    for (const block of pageBlocks) {
      if (collectedCharacters >= DEMO_MAX_CHARACTERS) break;
      collectedCharacters += block.text.length;
      blocks.push({ ...block, blockIndex: blocks.length });
    }

    lastProgress = Math.min(70, 35 + Math.round((processedPages / Math.max(1, Math.min(doc.numPages, DEMO_MAX_PAGES))) * 35));
    if (processedPages % 2 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const demoLimited = doc.numPages > DEMO_MAX_PAGES || collectedCharacters >= DEMO_MAX_CHARACTERS;
  return {
    id: makeId("EXT"),
    assetId,
    assetVersionId,
    extractionVersion: demoLimited ? "local-pdf-demo-1" : "local-pdf-1",
    pageCount: doc.numPages,
    characterCount: blocks.reduce((sum, item) => sum + item.text.length, 0),
    extractedAt: new Date().toISOString(),
    blocks,
    warnings: blocks.length ? (demoLimited ? ["Demo partial extraction"] : []) : ["No embedded text was detected. OCR is required."],
  };
}

async function extractDocx(file: Blob, assetId: string, assetVersionId?: string): Promise<ExtractedDocument> {
  const mammothModule = await import("mammoth");
  const mammoth = resolveImportedModule(mammothModule);
  if (!isObjectLike(mammoth) || typeof mammoth.extractRawText !== "function") {
    throw new Error("Mammoth failed to load correctly.");
  }
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  const blocks = result.value
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((text, index) => ({
      id: makeId("BLK"),
      assetId,
      assetVersionId,
      blockIndex: index,
      type: classifyBlockType(text),
      text,
      paragraphNumber: index + 1,
      sourceLocator: `paragraph:${index + 1}`,
    }));
  return {
    id: makeId("EXT"),
    assetId,
    assetVersionId,
    extractionVersion: "local-docx-1",
    characterCount: blocks.reduce((sum, item) => sum + item.text.length, 0),
    extractedAt: new Date().toISOString(),
    blocks,
    warnings: [],
  };
}

async function extractPlainText(file: Blob, assetId: string, assetVersionId?: string): Promise<ExtractedDocument> {
  const text = await file.text();
  const blocks = text
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item, index) => ({
      id: makeId("BLK"),
      assetId,
      assetVersionId,
      blockIndex: index,
      type: classifyBlockType(item, item.startsWith("#") ? "heading" : "paragraph"),
      text: item,
      paragraphNumber: index + 1,
      sourceLocator: `paragraph:${index + 1}`,
    }));
  return {
    id: makeId("EXT"),
    assetId,
    assetVersionId,
    extractionVersion: "local-text-1",
    characterCount: text.length,
    extractedAt: new Date().toISOString(),
    blocks,
    warnings: [],
  };
}

async function extractJson(file: Blob, assetId: string, assetVersionId?: string): Promise<ExtractedDocument> {
  const raw = await file.text();
  const parsed = JSON.parse(raw) as object;
  const text = JSON.stringify(parsed, null, 2);
  return {
    id: makeId("EXT"),
    assetId,
    assetVersionId,
    extractionVersion: "local-json-1",
    characterCount: text.length,
    extractedAt: new Date().toISOString(),
    blocks: [
      {
        id: makeId("BLK"),
        assetId,
        assetVersionId,
        blockIndex: 0,
        type: "prompt",
        text,
        sourceLocator: "json:root",
      },
    ],
    warnings: [],
  };
}

async function getMediaMetadata(file: File) {
  const objectUrl = URL.createObjectURL(file);
  try {
    const metadata = await new Promise<{ durationSeconds?: number }>((resolve, reject) => {
      const element = document.createElement(file.type.startsWith("video") ? "video" : "audio");
      element.preload = "metadata";
      element.onloadedmetadata = () => resolve({ durationSeconds: Math.round(element.duration || 0) });
      element.onerror = () => reject(new Error("Media metadata read failed"));
      element.src = objectUrl;
    });
    return metadata;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function extractDocumentFromFile(asset: LocalClinicalAsset, file: Blob, assetVersionId?: string) {
  if (!file || file.size === 0) {
    throw new Error("Original file data is missing from local storage.");
  }

  const mimeType = file.type || asset.mimeType || "application/octet-stream";
  const extension = asset.extension || extensionFromName(asset.originalFileName);
  const isText = mimeType.startsWith("text/") || ["txt", "md"].includes(extension);

  const baseDocument =
    mimeType === "application/pdf" || extension === "pdf"
      ? await extractPdf(file, asset.id, assetVersionId)
      : mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || extension === "docx"
        ? await extractDocx(file, asset.id, assetVersionId)
        : mimeType === "application/json" || extension === "json"
          ? await extractJson(file, asset.id, assetVersionId)
          : isText
            ? await extractPlainText(file, asset.id, assetVersionId)
            : {
                id: makeId("EXT"),
                assetId: asset.id,
                assetVersionId,
                extractionVersion: "local-media-1",
                durationSeconds: asset.durationSeconds,
                characterCount: 0,
                extractedAt: new Date().toISOString(),
                blocks: [],
                warnings: ["Media asset metadata only. Transcript link is recommended."],
              } satisfies ExtractedDocument;

  const { sourceBlocks, detectedSessions } = enrichSourceBlocks(baseDocument.blocks, asset);
  return {
    ...baseDocument,
    blocks: sourceBlocks,
    sourceBlocks,
    sessions: detectedSessions,
  };
}

export async function createClinicalAssetFromFile(input: CreateClinicalAssetInput) {
  const checksumSha256 = await calculateFileChecksum(input.file);
  const duplicate = await findDuplicateByChecksum(checksumSha256);
  const now = new Date().toISOString();
  const assetId = makeId("AST");
  const versionId = makeId("VER");
  const extension = extensionFromName(input.file.name);
  const mimeType = input.file.type || "application/octet-stream";
  if (duplicate && !input.allowForceDuplicate) return { duplicate };

  const asset: LocalClinicalAsset = {
    id: assetId,
    projectId: "TBCT-BR-001",
    title: input.title,
    originalFileName: input.file.name,
    mimeType,
    extension,
    sizeBytes: input.file.size,
    checksumSha256,
    assetType: input.assetType,
    country: input.country,
    sourceLocale: input.sourceLocale,
    translationLocale: input.translationLocale,
    sessionIds: normalizeSessionIds(input.sessionIds),
    protocolId: input.protocolId,
    authorName: input.authorName,
    organization: input.organization,
    version: input.version,
    currentVersionId: versionId,
    status: "processing",
    extractionStatus: "queued",
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy,
    notes: input.notes,
    tags: input.tags,
    permissionLevel: input.permissionLevel,
  };

  if (mimeType.startsWith("audio/") || mimeType.startsWith("video/")) {
    const media = await getMediaMetadata(input.file);
    asset.durationSeconds = media.durationSeconds;
  }

  const version: AssetVersion = {
    id: versionId,
    assetId,
    version: input.version,
    fileName: input.file.name,
    mimeType,
    sizeBytes: input.file.size,
    checksumSha256,
    extractionStatus: "not_started",
    changeSummary: input.duplicateReason || "Initial local import",
    createdAt: now,
    createdBy: input.createdBy,
    isCurrent: true,
  };

  await createRepoAsset(
    asset,
    { id: makeId("FIL"), assetId, versionId, blob: input.file },
    version,
    createAuditEntry({
      action: "Asset registered",
      resource: assetId,
      version: input.version,
      newValue: JSON.stringify({ title: input.title, assetType: input.assetType }),
      reason: input.duplicateReason || "Local file registration",
    }),
  );
  return { asset };
}

export async function queueExtraction(assetId: string, assetVersionId?: string) {
  const asset = await getClinicalAsset(assetId);
  if (!asset) throw new Error("Asset not found");
  const targetVersionId = assetVersionId ?? asset.currentVersionId;
  const jobs = (await getExtractionJobs()).filter((job) => job.assetId === assetId && job.assetVersionId === targetVersionId);
  const activeJob = jobs.find((job) => job.status === "queued" || job.status === "extracting");
  if (activeJob) return activeJob;

  const latestFailedJob = jobs.find((job) => job.status === "failed");
  if (latestFailedJob) {
    for (const job of jobs) {
      if (job.status === "failed" && job.id !== latestFailedJob.id) {
        await getLocalDb().extractionJobs.delete(job.id);
      }
    }
    const restartedJob: ExtractionJob = {
      ...latestFailedJob,
      status: "queued",
      progress: 0,
      stage: "queued",
      error: undefined,
      errorName: undefined,
      errorMessage: undefined,
      errorStage: undefined,
      failedAt: undefined,
      startedAt: undefined,
      completedAt: undefined,
      createdAt: latestFailedJob.createdAt,
      assetVersionId: targetVersionId,
    };
    await saveExtractionJob(restartedJob);
    await updateClinicalAsset(assetId, { extractionStatus: "queued", status: "processing" });
    return restartedJob;
  }

  const job: ExtractionJob = {
    id: makeId("JOB"),
    assetId,
    assetVersionId: targetVersionId,
    status: "queued",
    progress: 0,
    stage: "queued",
    createdAt: new Date().toISOString(),
  };
  await saveExtractionJob(job);
  await updateClinicalAsset(assetId, { extractionStatus: "queued", status: "processing" });
  return job;
}

export async function runLocalExtraction(jobId: string) {
  const job = await getExtractionJob(jobId);
  if (!job) throw new Error("Job not found");
  const asset = await getClinicalAsset(job.assetId);
  if (!asset) throw new Error("Asset not found");
  const startedAt = new Date().toISOString();
  await saveExtractionJob({ ...job, status: "extracting", progress: 10, stage: "reading_file", startedAt });

  const fileRecord = job.assetVersionId ? await getStoredFileByVersion(job.assetVersionId) : await getStoredFileByAsset(job.assetId);
  const file = ensureFileData(fileRecord);
  let document: ExtractedDocument;
  let parserStage: ExtractionJob["stage"] = "reading_file";
  try {
    if (!file || file.size === 0) {
      throw new Error("Original file data is missing from local storage.");
    }

    parserStage =
      file.type === "application/pdf" || asset.extension === "pdf"
        ? "loading_pdf_parser"
        : file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || asset.extension === "docx"
          ? "extracting_pages"
          : file.type === "application/json" || asset.extension === "json"
            ? "creating_blocks"
            : "creating_blocks";

    await saveExtractionJob({ ...job, status: "extracting", progress: 20, stage: parserStage as ExtractionJob["stage"], startedAt });
    document = await extractDocumentFromFile(asset, file, job.assetVersionId);
    const textPages = document.blocks.filter((block) => block.text.trim().length > 0);
    if ((file.type === "application/pdf" || asset.extension === "pdf") && textPages.length === 0) {
      const ocrJob: ExtractionJob = {
        ...job,
        status: "ocr_required",
        progress: 100,
        stage: "completed",
        completedAt: new Date().toISOString(),
        errorName: "OCRRequiredError",
        errorMessage: "No embedded text was detected. OCR is required.",
        errorStage: "extracting_pages",
        failedAt: new Date().toISOString(),
        error: "No embedded text was detected. OCR is required.",
      };
      const emptyDocument = { ...document, warnings: ["No embedded text was detected. OCR is required."] };
      await saveExtractedDocument(emptyDocument, ocrJob, createAuditEntry({
        action: "Extraction completed",
        resource: asset.id,
        version: asset.version,
        newValue: JSON.stringify({ versionId: job.assetVersionId, blocks: 0, warnings: emptyDocument.warnings }),
        reason: "OCR required: no embedded text detected",
      }));
      await updateClinicalAsset(asset.id, { extractionStatus: "ocr_required", status: "needs_review", warningCount: 1 });
      return { job: ocrJob, document: emptyDocument };
    }
    const morePagesThanDemo = (document.pageCount ?? 0) > DEMO_MAX_PAGES;
    await saveExtractionJob({ ...job, status: document.warnings.length || morePagesThanDemo ? "partial" : "completed", progress: 80, stage: "creating_blocks", startedAt });
  } catch (error) {
    const actualError = error instanceof Error ? error : new Error("Extraction failed");
    const failedJob: ExtractionJob = {
      ...job,
      status: "failed",
      progress: job.progress || 25,
      stage: "failed",
      completedAt: new Date().toISOString(),
      error: actualError.message,
      errorName: actualError.name,
      errorMessage: actualError.message,
      errorStack: actualError.stack,
      errorStage: parserStage,
      failedAt: new Date().toISOString(),
    };
    if (process.env.NODE_ENV !== "production") console.error("TBCT extraction failed", actualError);
    await saveExtractionJob(failedJob);
    await updateClinicalAsset(asset.id, { extractionStatus: "failed", status: "failed", warningCount: 1 });
    throw actualError;
  }

  await saveExtractionJob({ ...job, status: document.warnings.length ? "partial" : "completed", progress: 90, stage: "saving_results", startedAt });

  const completedJob: ExtractionJob = {
    ...job,
    status: document.warnings.length ? "partial" : "completed",
    progress: 100,
    stage: "completed",
    startedAt,
    completedAt: new Date().toISOString(),
    error: undefined,
    errorName: undefined,
    errorMessage: undefined,
    errorStack: undefined,
    errorStage: undefined,
    failedAt: undefined,
  };

  await saveExtractedDocument(
    document,
    completedJob,
    createAuditEntry({
      action: "Extraction completed",
      resource: asset.id,
      version: asset.version,
      newValue: JSON.stringify({ versionId: job.assetVersionId, blocks: document.blocks.length, warnings: document.warnings }),
      reason: "Local document extraction",
    }),
  );

  if (!job.assetVersionId || job.assetVersionId === asset.currentVersionId) {
    await updateClinicalAsset(asset.id, {
      extractionStatus: completedJob.status,
      status: document.warnings.length ? "needs_review" : "ready",
      pageCount: document.pageCount,
      durationSeconds: document.durationSeconds ?? asset.durationSeconds,
      characterCount: document.characterCount,
      warningCount: document.warnings.length,
    });
  }

  return { job: completedJob, document };
}

export async function queueAndRunLocalExtraction(assetId: string, assetVersionId?: string) {
  const job = await queueExtraction(assetId, assetVersionId);
  return runLocalExtraction(job.id);
}

export async function extractAssetNow(assetId: string, options?: { forceRestart?: boolean; assetVersionId?: string }) {
  const job = await queueExtraction(assetId, options?.assetVersionId);
  return runLocalExtraction(job.id);
}

export async function createAssetVersion(assetId: string, input: CreateAssetVersionInput) {
  const asset = await getClinicalAsset(assetId);
  if (!asset) throw new Error("Asset not found");
  const versionCheck = validateSemanticVersion(input.version);
  if (!versionCheck.valid) throw new Error("Version format is invalid");
  if (input.version === asset.version) throw new Error("Current version label cannot be reused");

  const checksum = await calculateFileChecksum(input.file);
  const duplicateVersion = await findDuplicateVersionChecksum(assetId, checksum);
  if (duplicateVersion) throw new Error("A version with the same checksum already exists");

  const version: AssetVersion = {
    id: makeId("VER"),
    assetId,
    version: input.version,
    fileName: input.file.name,
    mimeType: input.file.type || "application/octet-stream",
    sizeBytes: input.file.size,
    checksumSha256: checksum,
    extractionStatus: input.rerunExtraction ? "queued" : "not_started",
    changeSummary: input.changeSummary,
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy,
    isCurrent: false,
  };

  await addAssetVersion(
    version,
    { id: makeId("FIL"), assetId, versionId: version.id, blob: input.file },
    createAuditEntry({
      action: "Asset version created",
      resource: assetId,
      version: input.version,
      previousValue: asset.version,
      newValue: JSON.stringify({ version: input.version, checksum, changeSummary: input.changeSummary }),
      reason: input.changeSummary,
    }),
  );

  if (input.rerunExtraction) {
    const job = await queueExtraction(assetId, version.id);
    await runLocalExtraction(job.id);
  }

  return { version, warning: versionCheck.warning };
}

export async function setCurrentAssetVersion(assetId: string, versionId: string) {
  const asset = await getClinicalAsset(assetId);
  const version = await getAssetVersion(versionId);
  if (!asset || !version) throw new Error("Version not found");
  await setCurrentVersionRepo(
    assetId,
    versionId,
    createAuditEntry({
      action: "Current asset version changed",
      resource: assetId,
      version: version.version,
      previousValue: asset.version,
      newValue: version.version,
      reason: "User selected a different active version",
    }),
  );
}

export async function compareAssetVersions(leftVersionId: string, rightVersionId: string) {
  const left = await getAssetVersion(leftVersionId);
  const right = await getAssetVersion(rightVersionId);
  if (!left || !right) throw new Error("Version not found");
  const [leftDoc, rightDoc] = await Promise.all([
    left.extractedDocumentId ? getExtractedDocument(left.assetId, left.id) : null,
    right.extractedDocumentId ? getExtractedDocument(right.assetId, right.id) : null,
  ]);
  const leftBlocks = new Set((leftDoc?.blocks ?? []).map((block) => block.text));
  const rightBlocks = new Set((rightDoc?.blocks ?? []).map((block) => block.text));

  return {
    left,
    right,
    addedBlocks: [...rightBlocks].filter((item) => !leftBlocks.has(item)),
    removedBlocks: [...leftBlocks].filter((item) => !rightBlocks.has(item)),
    changed: left.checksumSha256 !== right.checksumSha256,
    stats: {
      leftCharacterCount: leftDoc?.characterCount ?? 0,
      rightCharacterCount: rightDoc?.characterCount ?? 0,
      leftBlockCount: leftDoc?.blocks.length ?? 0,
      rightBlockCount: rightDoc?.blocks.length ?? 0,
      leftPageCount: leftDoc?.pageCount ?? 0,
      rightPageCount: rightDoc?.pageCount ?? 0,
    },
  };
}

export function validateTranslationRelation(source: LocalClinicalAsset, target: LocalClinicalAsset) {
  if (source.id === target.id) return "An asset cannot translate itself.";
  if (source.sourceLocale === target.sourceLocale) return "translation_of requires different locales.";
  if (source.assetType !== target.assetType) return "translation_of expects compatible asset types.";
  return null;
}

export function validateTranscriptRelation(source: LocalClinicalAsset, target: LocalClinicalAsset) {
  if (source.assetType !== "transcript") return "transcript_of must start from a transcript asset.";
  if (!["session_audio", "session_video"].includes(target.assetType)) return "transcript_of target must be audio or video.";
  return null;
}

export async function findRelationshipCycle(input: Pick<AssetRelationship, "sourceAssetId" | "targetAssetId" | "relationType">) {
  const all = await getAllRelationships();
  if (input.relationType !== "revision_of") return false;
  const visit = (currentId: string, seen = new Set<string>()): boolean => {
    if (currentId === input.sourceAssetId) return true;
    if (seen.has(currentId)) return false;
    seen.add(currentId);
    return all
      .filter((item) => item.relationType === "revision_of" && item.sourceAssetId === currentId)
      .some((item) => visit(item.targetAssetId, seen));
  };
  return visit(input.targetAssetId);
}

export async function validateAssetRelationship(input: CreateAssetRelationshipInput) {
  const [source, target, all] = await Promise.all([
    getClinicalAsset(input.sourceAssetId),
    getClinicalAsset(input.targetAssetId),
    getAllRelationships(),
  ]);
  if (!source || !target) return { valid: false, error: "Asset not found" };
  if (all.some((item) => item.sourceAssetId === input.sourceAssetId && item.targetAssetId === input.targetAssetId && item.relationType === input.relationType)) {
    return { valid: false, error: "Duplicate relationship already exists" };
  }
  if (input.relationType === "translation_of") {
    const error = validateTranslationRelation(source, target);
    return error ? { valid: false, error } : { valid: true };
  }
  if (input.relationType === "transcript_of") {
    const error = validateTranscriptRelation(source, target);
    return error ? { valid: false, error } : { valid: true };
  }
  if (input.relationType === "revision_of") {
    if (source.assetType !== target.assetType) return { valid: false, error: "revision_of expects compatible asset types." };
    if (await findRelationshipCycle({ sourceAssetId: input.sourceAssetId, targetAssetId: input.targetAssetId, relationType: input.relationType })) {
      return { valid: false, error: "revision_of cycle detected" };
    }
  }
  return { valid: true };
}

export async function createAssetRelationship(input: CreateAssetRelationshipInput) {
  const validation = await validateAssetRelationship(input);
  if (!validation.valid) throw new Error(validation.error);
  const relationship: AssetRelationship = {
    id: makeId("REL"),
    projectId: input.projectId,
    sourceAssetId: input.sourceAssetId,
    targetAssetId: input.targetAssetId,
    relationType: input.relationType,
    sourceVersionId: input.sourceVersionId,
    targetVersionId: input.targetVersionId,
    notes: input.notes,
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy,
  };
  await linkAssets(
    relationship,
    createAuditEntry({
      action: "Asset relationship created",
      resource: input.sourceAssetId,
      version: "",
      newValue: JSON.stringify(relationship),
      reason: input.relationType,
    }),
  );
  return relationship;
}

export async function updateAssetRelationship(id: string, patch: Partial<AssetRelationship>) {
  return updateRelationshipRepo(
    id,
    patch,
    createAuditEntry({
      action: "Asset relationship updated",
      resource: id,
      version: "",
      newValue: JSON.stringify(patch),
      reason: "Relationship patch",
    }),
  );
}

export async function deleteAssetRelationship(id: string) {
  await deleteRelationship(
    id,
    createAuditEntry({
      action: "Asset relationship deleted",
      resource: id,
      version: "",
      reason: "Relationship removed",
    }),
  );
}

export async function getClinicalAssetsApi(filters: AssetFilters = {}) {
  return getClinicalAssets(filters);
}

export async function getClinicalAssetApi(assetId: string) {
  const [asset, versions, relationships] = await Promise.all([getClinicalAsset(assetId), getAssetVersions(assetId), getRelationships(assetId)]);
  const document = await getExtractedDocument(assetId, asset?.currentVersionId);
  return { asset, document, versions, relationships };
}

export async function getExtractionJobsApi() {
  return getExtractionJobs();
}

export async function getAssetRelationshipsApi(assetId: string) {
  const [asset, relationships, assets] = await Promise.all([getClinicalAsset(assetId), getRelationships(assetId), getClinicalAssets()]);
  return { asset, relationships, assets };
}

export async function getExtractionReviewDraftApi(draftId: string) {
  const draft = await getReviewDraft(draftId);
  if (!draft) return null;
  const primaryAssetId = draft.assetIds[0];
  const asset = primaryAssetId ? await getClinicalAsset(primaryAssetId) : null;
  const document = primaryAssetId ? await getExtractedDocument(primaryAssetId, asset?.currentVersionId) : null;
  const structuredItems = await getStructuredItems(draft.id);
  const evidenceIds = structuredItems.flatMap((item) => item.sourceEvidenceIds);
  const evidence = (await getSourceEvidenceByIds([...new Set([...evidenceIds, ...draft.sourceEvidence.map((item) => item.id)])])).filter(Boolean) as SourceEvidence[];
  const decisions = await getReviewDecisions(draft.id);
  const relatedAssets = draft.assetIds.length ? await Promise.all(draft.assetIds.map((assetId) => getClinicalAsset(assetId))) : [];
  return {
    draft,
    asset,
    document,
    assets: relatedAssets.filter(Boolean) as LocalClinicalAsset[],
    sourceBlocks: (draft.sourceBlocks ?? []).length ? draft.sourceBlocks ?? [] : document?.sourceBlocks ?? document?.blocks ?? [],
    detectedSessions: draft.detectedSessions ?? document?.sessions ?? [],
    structuredItems,
    evidence,
    decisions,
    relationships: asset ? await getRelationships(asset.id) : [],
  };
}

export async function getLatestExtractionReviewDraftApi() {
  const assets = await getClinicalAssets();
  const draftIds = assets.map((asset) => asset.extractionDraftId).filter(Boolean) as string[];
  const drafts = draftIds.length ? await Promise.all(draftIds.map((id) => getReviewDraft(id))) : [];
  const draft = drafts.find((item) => item) ?? (await getLocalDb().reviewDrafts.orderBy("createdAt").last());
  if (!draft) return null;
  return getExtractionReviewDraftApi(draft.id);
}

export async function createExtractionReviewDraft(assetId: string) {
  const document = await getExtractedDocument(assetId);
  const asset = await getClinicalAsset(assetId);
  if (!asset || !document) throw new Error("Extracted document not ready");
  const sourceBlocks = document.sourceBlocks ?? document.blocks;
  const draft: ExtractionReviewDraft = {
    id: makeId("DRF"),
    projectId: asset.projectId,
    assetIds: [assetId],
    sessionId: asset.sessionIds[0] ?? document.sessions?.[0]?.id,
    title: `${asset.title} review draft`,
    status: "unstructured",
    sourceBlocks,
    sourceEvidence: [],
    detectedSessions: document.sessions ?? [],
    structuredItems: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    createdBy: "Demo User",
  };
  await saveReviewDraft(
    draft,
    createAuditEntry({
      action: "Extraction review draft created",
      resource: assetId,
      version: asset.version,
      newValue: JSON.stringify({ draftId: draft.id }),
      reason: "Create source-backed review draft",
    }),
  );
  await updateClinicalAsset(assetId, { extractionDraftId: draft.id });
  return draft;
}

export async function createStructuredItem(input: CreateStructuredItemInput) {
  const item: StructuredTbctItem = {
    id: makeId("ITEM"),
    draftId: input.draftId,
    sessionId: input.sessionId,
    mappingType: input.mappingType,
    title: input.title,
    content: input.content,
    clinicalRationale: input.clinicalRationale,
    status: "in_progress",
    sourceEvidenceIds: input.sourceEvidenceIds,
    createdBy: input.createdBy,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    branchData: input.branchData,
  };
  await saveStructuredItem(
    item,
    createAuditEntry({
      action: "Structured item created",
      resource: input.draftId,
      version: "",
      newValue: JSON.stringify({ mappingType: input.mappingType, title: input.title }),
      reason: "Manual TBCT mapping",
    }),
  );
  return item;
}

export async function createSourceEvidenceFromBlocks(
  draftId: string,
  assetId: string,
  extractedDocumentId: string,
  blocks: SourceBlock[],
  assetVersionId?: string,
) {
  const evidence: SourceEvidence = {
    id: makeId("EVD"),
    assetId,
    assetVersionId,
    extractedDocumentId,
    blockId: blocks.map((block) => block.id).join(","),
    sessionId: blocks[0]?.sessionId,
    sessionLabel: blocks[0]?.sessionLabel,
    pageNumber: blocks[0]?.pageNumber,
    paragraphNumber: blocks[0]?.paragraphNumber,
    startSeconds: blocks[0]?.startSeconds,
    endSeconds: blocks.at(-1)?.endSeconds,
    sourceLocator: blocks.map((block) => block.sourceLocator).join(" + "),
    quotedText: blocks.map((block) => block.text).join("\n\n"),
  };
  await saveSourceEvidence(
    evidence,
    createAuditEntry({
      action: "Source evidence created",
      resource: draftId,
      version: "",
      newValue: JSON.stringify({ evidenceId: evidence.id, blockCount: blocks.length }),
      reason: "Blocks mapped into review evidence",
    }),
  );
  const draft = await getReviewDraft(draftId);
  if (draft) {
    await updateReviewDraft(draftId, { sourceEvidence: [...draft.sourceEvidence, evidence] });
  }
  return evidence;
}

export async function updateStructuredItem(itemId: string, patch: Partial<StructuredTbctItem>) {
  return updateStructuredItemRepo(
    itemId,
    patch,
    createAuditEntry({
      action: "Structured item updated",
      resource: itemId,
      version: "",
      newValue: JSON.stringify(patch),
      reason: patch.changeReason || "Structured item patch",
    }),
  );
}

export async function deleteStructuredItem(itemId: string) {
  await deleteStructuredItemRepo(
    itemId,
    createAuditEntry({
      action: "Structured item deleted",
      resource: itemId,
      version: "",
      reason: "Structured item removed",
    }),
  );
}

export function validateStructuredItemApproval(item: StructuredTbctItem) {
  if (!item.mappingType) return "Mapping type is required.";
  if (!item.content.trim()) return "Structured content cannot be empty.";
  if (!item.sourceEvidenceIds.length) return "At least one source evidence link is required.";
  if (["session_goal", "basic_question", "expected_response", "follow_up_branch", "therapeutic_activity", "homework", "completion_condition"].includes(item.mappingType) && !item.sessionId) {
    return "Session-linked mapping requires a session ID.";
  }
  if (item.mappingType === "safety_rule" && !item.clinicalRationale?.trim()) return "Safety rule approval requires risk rationale or response details.";
  if (item.mappingType === "clinician_intervention_condition" && !item.clinicalRationale?.toLowerCase().includes("escal")) return "Clinician intervention condition requires escalation criteria.";
  if (item.mappingType === "follow_up_branch" && !item.branchData?.targetItemId) return "Follow-up branch requires a target item.";
  return null;
}

export async function createReviewDecision(input: Omit<ReviewDecision, "id" | "createdAt">) {
  const decision: ReviewDecision = {
    ...input,
    id: makeId("DEC"),
    createdAt: new Date().toISOString(),
  };
  await saveReviewDecision(
    decision,
    createAuditEntry({
      action: `Review ${decision.decision}`,
      resource: input.structuredItemId ?? input.draftId,
      version: "",
      newValue: JSON.stringify(decision),
      reason: input.comment || decision.decision,
    }),
  );
  return decision;
}

export async function approveStructuredItem(itemId: string, reviewer = "Demo Reviewer") {
  const allDrafts = await Promise.all((await getClinicalAssets()).map((asset) => asset.extractionDraftId).filter(Boolean).map((id) => getReviewDraft(id!)));
  const draftId = allDrafts.find((draft) => draft)?.id;
  const items = draftId ? await getStructuredItems(draftId) : [];
  const item = items.find((entry) => entry.id === itemId);
  if (!item) throw new Error("Structured item not found");
  const error = validateStructuredItemApproval(item);
  if (error) throw new Error(error);
  await updateStructuredItem(itemId, {
    status: "approved",
    reviewedBy: reviewer,
    reviewedAt: new Date().toISOString(),
  });
  await createReviewDecision({ draftId: item.draftId, structuredItemId: itemId, decision: "approve", createdBy: reviewer });
}

export async function validateExtractionDraft(draftId: string) {
  const [draft, items] = await Promise.all([getReviewDraft(draftId), getStructuredItems(draftId)]);
  if (!draft) throw new Error("Draft not found");
  const issues: DraftValidationIssue[] = [];
  for (const item of items) {
    if (!item.mappingType) issues.push({ id: makeId("ISS"), severity: "critical", itemId: item.id, message: "Mapping type is missing." });
    if (!item.content.trim()) issues.push({ id: makeId("ISS"), severity: "critical", itemId: item.id, message: "Structured content is empty." });
    if (!item.sourceEvidenceIds.length) issues.push({ id: makeId("ISS"), severity: "critical", itemId: item.id, message: "No source evidence linked." });
    if (item.mappingType === "basic_question" && !item.sessionId) issues.push({ id: makeId("ISS"), severity: "warning", itemId: item.id, message: "Basic question is missing session linkage." });
    if (draft.sessionId && item.sessionId && item.sessionId !== draft.sessionId) issues.push({ id: makeId("ISS"), severity: "warning", itemId: item.id, message: "Structured item session does not match the draft session." });
    if (item.mappingType === "expected_response" && item.status !== "approved") issues.push({ id: makeId("ISS"), severity: "information", itemId: item.id, message: "Expected response is not approved yet." });
    if (item.mappingType === "follow_up_branch" && !item.branchData?.fallback) issues.push({ id: makeId("ISS"), severity: "warning", itemId: item.id, message: "Fallback branch is not defined." });
  }
  if (!(draft.sourceBlocks ?? []).length) issues.push({ id: makeId("ISS"), severity: "critical", message: "Draft has no source blocks." });
  if (!draft.detectedSessions?.length && !draft.sessionId) issues.push({ id: makeId("ISS"), severity: "warning", message: "No detected session metadata found." });
  await createReviewDecision({ draftId, decision: "request_review", createdBy: "Demo User", comment: "Validation run completed" });
  return {
    issues,
    summary: {
      totalItems: items.length,
      approvedItems: items.filter((item) => item.status === "approved").length,
      evidenceCoverage: items.length ? Math.round((items.filter((item) => item.sourceEvidenceIds.length > 0).length / items.length) * 100) : 0,
      detectedSessions: draft.detectedSessions?.length ?? 0,
      readiness: issues.some((issue) => issue.severity === "critical") ? "blocked" : "candidate",
    },
  };
}

export async function createProtocolDraftCandidate(draftId: string) {
  const [draft, items, validation] = await Promise.all([getReviewDraft(draftId), getStructuredItems(draftId), validateExtractionDraft(draftId)]);
  if (!draft) throw new Error("Draft not found");
  const approved = items.filter((item) => item.status === "approved");
  if (!approved.length) throw new Error("At least one approved item is required.");
  if (validation.issues.some((issue) => issue.severity === "critical")) throw new Error("Critical validation issues must be resolved before candidate generation.");
  const candidateSessionId = draft.sessionId ?? approved[0]?.sessionId ?? draft.detectedSessions?.[0]?.id;
  if (!candidateSessionId) throw new Error("Draft session ID is required.");
  const candidate: ProtocolDraftCandidate = {
    id: makeId("CAND"),
    projectId: draft.projectId,
    protocolId: "tbct-br-001",
    sessionId: candidateSessionId,
    sourceDraftId: draft.id,
    items: approved.map((item) => ({
      id: makeId("PDI"),
      structuredItemId: item.id,
      proposedNodeType: groupToNodeType(item.mappingType),
      title: item.title,
      content: item.content,
      sourceEvidenceIds: item.sourceEvidenceIds,
      linkedItemIds: item.branchData?.targetItemId ? [item.branchData.targetItemId] : [],
    })),
    validationSummary: {
      critical: validation.issues.filter((issue) => issue.severity === "critical").length,
      warning: validation.issues.filter((issue) => issue.severity === "warning").length,
      information: validation.issues.filter((issue) => issue.severity === "information").length,
    },
    createdAt: new Date().toISOString(),
    createdBy: "Demo User",
  };
  await saveProtocolDraftCandidate(
    candidate,
    createAuditEntry({
      action: "Protocol draft candidate created",
      resource: draft.id,
      version: "",
      newValue: JSON.stringify({ candidateId: candidate.id, itemCount: candidate.items.length }),
      reason: "Approved structured items converted to protocol draft candidate",
    }),
  );
  return candidate;
}

export async function getProtocolDraftCandidateApi(candidateId: string) {
  return getProtocolDraftCandidate(candidateId);
}

export async function getProtocolDraftCandidateBySourceDraftIdApi(sourceDraftId: string) {
  const candidate = await getLocalDb().protocolDraftCandidates.where("sourceDraftId").equals(sourceDraftId).last();
  return candidate ?? null;
}

export async function exportSourceManifestApi() {
  return exportRepoManifest("TBCT-BR-001");
}

export async function archiveClinicalAssetApi(assetId: string) {
  const asset = await getClinicalAsset(assetId);
  if (!asset) throw new Error("Asset not found");
  await archiveRepoAsset(
    assetId,
    createAuditEntry({
      action: "Asset archived",
      resource: assetId,
      version: asset.version,
      previousValue: asset.status,
      newValue: "archived",
      reason: "Bulk or single archive",
    }),
  );
}

export async function deleteClinicalAssetApi(assetId: string) {
  const asset = await getClinicalAsset(assetId);
  if (!asset) throw new Error("Asset not found");
  await deleteRepoAsset(
    assetId,
    createAuditEntry({
      action: "Asset deleted",
      resource: assetId,
      version: asset.version,
      previousValue: asset.title,
      newValue: "",
      reason: "User confirmed delete",
    }),
  );
}
