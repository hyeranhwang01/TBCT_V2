import {
  getTbctSourceExcerpt,
  TBCT_SOURCE_TEXT_HASH,
} from "@/lib/protocol/tbct-source-text.generated";
import type {
  ClinicalStageNode,
  PromptItem,
  PromptItemType,
  SessionCommonRules,
  SessionDefinition,
  SessionPlan,
  SourceFidelityEdge,
  SourceFidelitySessionSeed,
  SourceFidelityStatus,
  SourceTrace,
} from "@/lib/protocol/source-fidelity-types";
import * as s01 from "@/patient/sessions/s01/spec";
import * as s02 from "@/patient/sessions/s02/spec";
import * as s03 from "@/patient/sessions/s03/spec";
import * as s04 from "@/patient/sessions/s04/spec";
import * as s05 from "@/patient/sessions/s05/spec";
import * as s06 from "@/patient/sessions/s06/spec";
import * as s07 from "@/patient/sessions/s07/spec";
import * as s08 from "@/patient/sessions/s08/spec";

export const CANONICAL_PROTOCOL_ID = "tbct-br-001";
export const CANONICAL_SOURCE_VERSION = `tbct-source-${TBCT_SOURCE_TEXT_HASH.slice(0, 12)}`;

const CATALOG_TIMESTAMP = "2025-01-01T00:00:00.000Z";

export type SessionSourceMetadata = {
  number: number;
  id: string;
  title: string;
  /** See SessionDefinition.titleKo's own doc comment -- carried through
   * unchanged into the built definition below. */
  titleKo?: string;
  techniqueName: string;
  acronym?: string;
  sourceLineStart: number;
  sourceLineEnd: number;
  sourceSessionHash: string;
  contextRange: SourceRange;
  roleRange: SourceRange;
  languageRange: SourceRange;
  openingRange: SourceRange;
  requiredActionsRange: SourceRange;
  restrictionsRange: SourceRange;
  safetyRange: SourceRange;
  /** Source-text corruption/transcription-review markers scoped to specific
   * line ranges within this session (only s06 and s07 have any) --
   * co-located per-session (see src/lib/protocol/sessions/*.ts) rather than
   * a separate shared lookup, so a session owner never touches a shared
   * file to flag or clear one. See traceFor/fidelityFor below. */
  reviewRanges?: Array<{ range: SourceRange; warning: string }>;
};

export type SourceRange = readonly [number, number];

export type PromptSpec = {
  slug: string;
  type: PromptItemType;
  source: SourceRange;
  marker?: string;
  patientText?: string;
  outputFields?: string[];
  validation?: Record<string, unknown> | null;
  activationCondition?: Record<string, unknown> | null;
  completionEffect?: Record<string, unknown> | null;
  restrictions?: string[];
  safetyRuleIds?: string[];
  /** Re-asks the same PromptItem (accumulating into its list/rating field)
   * until `completionCondition` is met or `maxIterations` is reached, instead
   * of moving on after a single turn. Used for "rate every item in a list
   * one at a time" and "collect 2-4 pieces of evidence one at a time" steps. */
  executionMode?: PromptItem["executionMode"];
  maxIterations?: number;
  completionCondition?: PromptItem["completionCondition"];
};

export type NodeSpec = {
  slug: string;
  title: string;
  /** See SessionSourceMetadata.titleKo's own doc comment -- same "clinician-
   * facing display label only" contract, one level down at the step/node. */
  titleKo?: string;
  type: string;
  source: SourceRange;
  requiredFields?: string[];
  completionRule?: Record<string, unknown>;
  restrictions?: string[];
  safetyRuleIds?: string[];
  prompts: PromptSpec[];
  nextSlug?: string | null;
  terminal?: boolean;
  /** See ClinicalStageNode.participantRationale. Only set on nodes where a
   * brief "why this step" line materially helps comprehension. */
  participantRationale?: string;
  /** See ClinicalStageNode.objective's own doc comment. */
  objective?: string;
};

export type EdgeSpec = {
  sourceSlug: string;
  targetSlug: string;
  edgeType: SourceFidelityEdge["edgeType"];
  source: SourceRange;
  label?: string;
  condition?: SourceFidelityEdge["condition"];
  priority?: number;
  isFallback?: boolean;
};

export type SessionSpec = {
  metadata: SessionSourceMetadata;
  nodes: NodeSpec[];
  extraEdges?: EdgeSpec[];
};

export function sourceText([sourceLineStart, sourceLineEnd]: SourceRange) {
  return getTbctSourceExcerpt(sourceLineStart, sourceLineEnd).trim();
}

function rangesOverlap(left: SourceRange, right: SourceRange) {
  return left[0] <= right[1] && right[0] <= left[1];
}

function traceFor(metadata: SessionSourceMetadata, sourceSection: string, range: SourceRange): SourceTrace {
  const reviewItems = (metadata.reviewRanges ?? []).filter((item) => rangesOverlap(range, item.range));

  return {
    sourceDocument: "TBCT pasted source text",
    sourceSession: `Session ${String(metadata.number).padStart(2, "0")}`,
    sourceSection,
    sourceLineStart: range[0],
    sourceLineEnd: range[1],
    sourceTextHash: TBCT_SOURCE_TEXT_HASH,
    sourceSessionHash: metadata.sourceSessionHash,
    importedVersion: CANONICAL_SOURCE_VERSION,
    ...(reviewItems.length > 0
      ? {
          rawSourceExcerpt: reviewItems.map((item) => sourceText(item.range)).join("\n\n"),
          reviewWarnings: reviewItems.map((item) => item.warning),
        }
      : {}),
  };
}

function fidelityFor(metadata: SessionSourceMetadata, range: SourceRange, isolatedPrompt = false): Exclude<SourceFidelityStatus, "source_missing"> {
  if ((metadata.reviewRanges ?? []).some((item) => rangesOverlap(range, item.range))) {
    return "review_required";
  }
  return isolatedPrompt ? "exact" : "structured_from_source";
}

/** The source document lists many of its scripted lines as bullets ("•\t What
 * defines a person -- ..."). `.trim()` doesn't remove the bullet or its tab,
 * so the marker line shipped to the patient still opened with the raw list
 * glyph -- visible verbatim in S08's Step 17 discussion questions. A leading
 * bullet is never part of what the therapist says out loud, in any session. */
function stripSourceListMarkers(line: string) {
  return line.replace(/^\s*[•▪◦‣·]\s*/, "").trim();
}

function quotedSourceText(range: SourceRange, marker?: string) {
  const text = sourceText(range);
  if (!marker) return { text, isolatedPrompt: false };

  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return { text, isolatedPrompt: false };

  const lineStart = text.lastIndexOf("\n", markerIndex) + 1;
  const nextLineBreak = text.indexOf("\n", markerIndex);
  const lineEnd = nextLineBreak < 0 ? text.length : nextLineBreak;
  const markerLine = text.slice(lineStart, lineEnd);
  const markerIndexInLine = markerIndex - lineStart;
  const quoteStart = markerLine.lastIndexOf('"', markerIndexInLine);
  const quoteEnd = markerLine.indexOf('"', markerIndexInLine + marker.length);
  if (quoteStart < 0 || quoteEnd < 0 || quoteEnd <= quoteStart + 1) {
    return markerLine.includes('"') ? { text, isolatedPrompt: false } : { text: stripSourceListMarkers(markerLine), isolatedPrompt: true };
  }

  return { text: stripSourceListMarkers(markerLine.slice(quoteStart + 1, quoteEnd)), isolatedPrompt: true };
}

function nodeId(sessionNumber: number, index: number, slug: string) {
  return `tbct-s${String(sessionNumber).padStart(2, "0")}-n${String(index).padStart(2, "0")}-${slug}`;
}

function promptId(sessionNumber: number, nodeIndex: number, promptIndex: number, slug: string) {
  return `tbct-s${String(sessionNumber).padStart(2, "0")}-n${String(nodeIndex).padStart(2, "0")}-p${String(promptIndex).padStart(2, "0")}-${slug}`;
}

function edgeId(sessionNumber: number, sourceSlug: string, targetSlug: string) {
  return `tbct-s${String(sessionNumber).padStart(2, "0")}-e-${sourceSlug}-to-${targetSlug}`;
}

function buildSessionSeed(spec: SessionSpec): SourceFidelitySessionSeed {
  const { metadata } = spec;
  const resolvedNodes = spec.nodes.map((node, index) => ({ ...node, id: nodeId(metadata.number, index + 1, node.slug), index: index + 1 }));
  const nodeBySlug = new Map(resolvedNodes.map((node) => [node.slug, node]));
  const defaultEdges: EdgeSpec[] = resolvedNodes.flatMap((node, index) => {
    const nextNode = node.nextSlug === null ? undefined : node.nextSlug ? nodeBySlug.get(node.nextSlug) : resolvedNodes[index + 1];
    if (!nextNode || node.terminal) return [];
    return [{ sourceSlug: node.slug, targetSlug: nextNode.slug, edgeType: "default", source: node.source, priority: 100, isFallback: false }];
  });
  const edgeSpecs = [...defaultEdges, ...(spec.extraEdges ?? [])];

  const promptItems: PromptItem[] = resolvedNodes.flatMap((node) =>
    node.prompts.map((prompt, promptIndex) => {
      const promptText = quotedSourceText(prompt.source, prompt.marker);
      const aiMsg = promptText.text || sourceText(prompt.source);
      const shortAiMsg = aiMsg.split('\n')[0] || aiMsg.substring(0, 200);
      
      return {
        id: promptId(metadata.number, node.index, promptIndex + 1, prompt.slug),
        protocolId: CANONICAL_PROTOCOL_ID,
        sessionId: metadata.id,
        nodeId: node.id,
        order: promptIndex + 1,
        type: prompt.type,
        verbatimText: promptText.text,
        editableText: promptText.text || sourceText(prompt.source),
        aiInstruction: shortAiMsg,
        fallbackPatientText: prompt.patientText,
        markerHint: prompt.marker,
        activationCondition: prompt.activationCondition ?? null,
        outputFields: prompt.outputFields ?? [],
        validation: prompt.validation ?? null,
        executionMode: prompt.executionMode,
        maxIterations: prompt.maxIterations,
        completionCondition: prompt.completionCondition,
        completionEffect: prompt.completionEffect ?? { type: "advance_prompt" },
        restrictions: prompt.restrictions ?? node.restrictions ?? [],
        safetyRuleIds: prompt.safetyRuleIds ?? node.safetyRuleIds ?? [],
        sourceTrace: traceFor(metadata, `${node.title}: ${prompt.slug}`, prompt.source),
        sourceFidelityStatus: fidelityFor(metadata, prompt.source, promptText.isolatedPrompt),
        origin: "source_imported",
        sourceHash: TBCT_SOURCE_TEXT_HASH,
        status: "active",
        createdAt: CATALOG_TIMESTAMP,
        updatedAt: CATALOG_TIMESTAMP,
        updatedBy: "TBCT source import",
      };
    }),
  );

  const nodes: ClinicalStageNode[] = resolvedNodes.map((node, index) => {
    const nextNode = !node.terminal ? (node.nextSlug === null ? undefined : node.nextSlug ? nodeBySlug.get(node.nextSlug) : resolvedNodes[index + 1]) : undefined;
    const branchRules = edgeSpecs
      .filter((edge) => edge.sourceSlug === node.slug && edge.edgeType !== "default")
      .map((edge) => ({ edgeType: edge.edgeType, label: edge.label, condition: edge.condition, target: nodeBySlug.get(edge.targetSlug)?.id }));

    return {
      id: node.id,
      protocolId: CANONICAL_PROTOCOL_ID,
      sessionId: metadata.id,
      title: node.title,
      titleKo: node.titleKo,
      type: node.type,
      clinicalPurpose: sourceText(node.source),
      objective: node.objective,
      participantRationale: node.participantRationale,
      position: { x: 180 + (index % 2) * 340, y: 100 + index * 190 },
      promptItemIds: promptItems.filter((item) => item.nodeId === node.id).map((item) => item.id),
      requiredFields: node.requiredFields ?? [],
      completionRule: node.completionRule ?? { type: "all_required_prompt_items_completed" },
      branchRules,
      restrictions: node.restrictions ?? [],
      safetyRuleIds: node.safetyRuleIds ?? [],
      defaultNextNodeId: nextNode?.id,
      sourceTrace: traceFor(metadata, node.title, node.source),
      sourceFidelityStatus: fidelityFor(metadata, node.source),
      status: "active",
      createdAt: CATALOG_TIMESTAMP,
      updatedAt: CATALOG_TIMESTAMP,
    };
  });

  const edges: SourceFidelityEdge[] = edgeSpecs.map((edge) => {
    const sourceNode = nodeBySlug.get(edge.sourceSlug);
    const targetNode = nodeBySlug.get(edge.targetSlug);
    if (!sourceNode || !targetNode) {
      throw new Error(`Invalid canonical source edge: ${metadata.id}/${edge.sourceSlug}->${edge.targetSlug}`);
    }
    return {
      id: edgeId(metadata.number, edge.sourceSlug, edge.targetSlug),
      protocolId: CANONICAL_PROTOCOL_ID,
      sessionId: metadata.id,
      source: sourceNode.id,
      target: targetNode.id,
      edgeType: edge.edgeType,
      label: edge.label,
      condition: edge.condition,
      priority: edge.priority ?? (edge.edgeType === "default" ? 100 : 10),
      isFallback: edge.isFallback ?? edge.edgeType === "fallback",
      sourceTrace: traceFor(metadata, `${sourceNode.title} to ${targetNode.title}`, edge.source),
    };
  });

  const startNode = nodes.find((node) => node.type === "session_start") ?? nodes[0];
  const completionNode = nodes.find((node) => node.type === "session_complete") ?? nodes[nodes.length - 1];
  if (!startNode || !completionNode) {
    throw new Error(`Canonical source session ${metadata.id} is missing a start or completion node.`);
  }

  const sourceFidelityStatus = fidelityFor(metadata, [metadata.sourceLineStart, metadata.sourceLineEnd]);
  const commonRules: SessionCommonRules = {
    sessionTitle: metadata.title,
    techniqueName: metadata.techniqueName,
    roleAndStance: sourceText(metadata.roleRange),
    sessionObjective: sourceText(metadata.contextRange),
    languageRules: [sourceText(metadata.languageRange)],
    openingRules: [sourceText(metadata.openingRange)],
    sessionWideRequiredActions: [sourceText(metadata.requiredActionsRange)],
    sessionWideRestrictions: [sourceText(metadata.restrictionsRange)],
    sessionWideSafetyRules: [sourceText(metadata.safetyRange)],
    sourceTrace: traceFor(metadata, "Session common rules", [metadata.sourceLineStart, metadata.sourceLineEnd]),
    sourceFidelityStatus,
    version: CANONICAL_SOURCE_VERSION,
    status: sourceFidelityStatus === "review_required" ? "safety_review" : "clinical_review",
    clinicalContext: sourceText(metadata.contextRange),
    previousSessionContext: sourceText(metadata.contextRange),
    languageAndTerminologyRules: sourceText(metadata.languageRange),
    toneAndInteractionRules: sourceText(metadata.roleRange),
    safetyAndEscalationRules: sourceText(metadata.safetyRange),
    defaultModalityRules: ["text"],
  };

  const definition: SessionDefinition = {
    id: metadata.id,
    protocolId: CANONICAL_PROTOCOL_ID,
    number: metadata.number,
    title: metadata.title,
    titleKo: metadata.titleKo,
    techniqueName: metadata.techniqueName,
    acronym: metadata.acronym,
    contextAndPurpose: sourceText(metadata.contextRange),
    roleAndStance: sourceText(metadata.roleRange),
    sessionObjective: sourceText(metadata.requiredActionsRange),
    languageRules: [sourceText(metadata.languageRange)],
    openingRules: [sourceText(metadata.openingRange)],
    sessionWideRequiredActions: [sourceText(metadata.requiredActionsRange)],
    sessionWideRestrictions: [sourceText(metadata.restrictionsRange)],
    sessionWideSafetyRules: [sourceText(metadata.safetyRange)],
    startNodeId: startNode.id,
    completionNodeId: completionNode.id,
    sourceTrace: traceFor(metadata, "Complete session source", [metadata.sourceLineStart, metadata.sourceLineEnd]),
    sourceFidelityStatus,
    status: "reviewed",
    createdAt: CATALOG_TIMESTAMP,
    updatedAt: CATALOG_TIMESTAMP,
    technique: metadata.techniqueName,
    clinicalPurpose: sourceText(metadata.contextRange),
    roleInstruction: sourceText(metadata.roleRange),
    nodeCount: nodes.length,
    promptCount: promptItems.length,
    validationStatus: sourceFidelityStatus === "review_required" ? "review" : "ready",
  };

  return { definition, commonRules, nodes, promptItems, edges };
}

const SESSION_SPECS: SessionSpec[] = [s01.spec, s02.spec, s03.spec, s04.spec, s05.spec, s06.spec, s07.spec, s08.spec];

export const CANONICAL_SOURCE_SEEDS = SESSION_SPECS.map(buildSessionSeed);
export const CANONICAL_SESSION_DEFINITIONS = CANONICAL_SOURCE_SEEDS.map((seed) => seed.definition);
export const CANONICAL_SESSION_COMMON_RULES = Object.fromEntries(CANONICAL_SOURCE_SEEDS.map((seed) => [seed.definition.id, seed.commonRules])) as Record<string, SessionCommonRules>;
export const CANONICAL_STAGE_NODES = CANONICAL_SOURCE_SEEDS.flatMap((seed) => seed.nodes);
export const CANONICAL_PROMPT_ITEMS = CANONICAL_SOURCE_SEEDS.flatMap((seed) => seed.promptItems);
export const CANONICAL_SOURCE_EDGES = CANONICAL_SOURCE_SEEDS.flatMap((seed) => seed.edges);

export const CANONICAL_SESSION_PLAN: SessionPlan = {
  id: "tbct-source-fidelity-plan",
  protocolId: CANONICAL_PROTOCOL_ID,
  orderedEntries: CANONICAL_SESSION_DEFINITIONS.map((definition) => ({
    entryId: `${definition.id}-entry`,
    sessionId: definition.id,
    order: definition.number,
    active: true,
    occurrence: 1,
    label: `Session ${String(definition.number).padStart(2, "0")}`,
  })),
  startingEntryId: "tbct-s01-entry",
  status: "validated",
  version: CANONICAL_SOURCE_VERSION,
  createdAt: CATALOG_TIMESTAMP,
  updatedAt: CATALOG_TIMESTAMP,
};

const SESSION_ID_ALIASES = Object.fromEntries(
  SESSION_SPECS.map((spec) => spec.metadata).flatMap((metadata) => {
    const number = String(metadata.number).padStart(2, "0");
    return [
      [metadata.id, metadata.id],
      [`tbct-session-${number}`, metadata.id],
      [`tbct-br-001-session-${number}`, metadata.id],
      [`SESSION-${number}`, metadata.id],
      [`session-${number}`, metadata.id],
    ];
  }),
) as Record<string, string>;

export function resolveCanonicalSessionId(sessionId?: string) {
  if (!sessionId) return undefined;
  return SESSION_ID_ALIASES[sessionId] ?? SESSION_ID_ALIASES[sessionId.toLowerCase()];
}

export function getCanonicalSessionSeed(sessionId: string) {
  const canonicalSessionId = resolveCanonicalSessionId(sessionId) ?? sessionId;
  return CANONICAL_SOURCE_SEEDS.find((seed) => seed.definition.id === canonicalSessionId) ?? null;
}

export function getCanonicalSourceFidelityIssues() {
  const issues: string[] = [];
  if (CANONICAL_SOURCE_SEEDS.length !== 8) issues.push(`Expected 8 source sessions, found ${CANONICAL_SOURCE_SEEDS.length}.`);
  for (const seed of CANONICAL_SOURCE_SEEDS) {
    if (seed.definition.protocolId !== CANONICAL_PROTOCOL_ID) issues.push(`${seed.definition.id} has a non-canonical protocol ID.`);
    if (seed.nodes.length === 0 || seed.promptItems.length === 0) issues.push(`${seed.definition.id} is missing source-backed nodes or prompt items.`);
    for (const node of seed.nodes) {
      if (!node.sourceTrace.sourceLineStart || !node.sourceTrace.sourceLineEnd) issues.push(`${node.id} is missing an exact source range.`);
      for (const promptItemId of node.promptItemIds) {
        if (!seed.promptItems.some((promptItem) => promptItem.id === promptItemId)) issues.push(`${node.id} refers to missing prompt ${promptItemId}.`);
      }
    }
    for (const promptItem of seed.promptItems) {
      if (promptItem.origin !== "source_imported") issues.push(`${promptItem.id} is not source imported.`);
      if (!promptItem.verbatimText.trim()) issues.push(`${promptItem.id} has no source text.`);
      if (promptItem.sourceHash !== TBCT_SOURCE_TEXT_HASH) issues.push(`${promptItem.id} has a stale source hash.`);
    }
  }
  return issues;
}
