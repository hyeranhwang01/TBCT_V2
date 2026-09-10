// Domain types for the session worksheet layer (sql/006_worksheets.sql).
// RuntimeContext.fields (src/types/runtime-session.ts) remains the
// canonical clinical field state; everything here is a typed projection of
// it, never an independent write target. See
// src/shared/worksheet/worksheet-projection.ts for the write-path contract.

export type WorksheetFieldStatus =
  | "empty"
  | "active"
  | "draft_extracted"
  | "shown_to_participant"
  | "participant_confirmed"
  | "participant_edited"
  | "not_applicable"
  | "clinician_review_required"
  | "locked";

export type WorksheetFieldProvenance =
  | "participant_verbatim"
  | "participant_confirmed_summary"
  | "system_calculated"
  | "clinician_entered"
  | "unconfirmed_extraction";

export type WorksheetValueType =
  | "text"
  | "long_text"
  | "integer"
  | "percentage"
  | "rating_0_5"
  | "boolean"
  | "choice"
  | "text_list"
  | "structured_list"
  | "role_turns"
  | "evaluation_matrix"
  | "action_plan";

export interface WorksheetFieldValue {
  fieldId: string;
  value: unknown;
  displayValue?: string;
  participantVerbatim?: string;
  sourceTurnId?: string;
  status: WorksheetFieldStatus;
  provenance: WorksheetFieldProvenance;
  confidence?: number;
  participantOwned: boolean;
  assistantMustNotSupply: boolean;
  confirmedAt?: string;
  updatedAt: string;
}

export type WorksheetDisplayMode = "verbatim" | "confirmed_summary" | "number" | "list" | "derived";

/** Statically authored -- one entry per canonical runtime field this
 * session's worksheet renders. canonicalFieldKey must be a real
 * PromptItem.outputFields[0] value from source-fidelity-catalog.ts; the
 * registry never invents a field name. */
export interface WorksheetBinding {
  sessionDefinitionId: string;
  canonicalFieldKey: string;
  worksheetFieldKey: string;
  visualElementId: string;
  valueType: WorksheetValueType;
  participantOwned: boolean;
  assistantMustNotSupply: boolean;
  confirmationRequired: boolean;
  displayMode: WorksheetDisplayMode;
  label: string;
  /** Korean translation of `label`, used for the patient-facing progress
   * checklist (see PatientProgressFeed in worksheet-pane.tsx) when the
   * session locale is Korean. The clinician-facing composed worksheets
   * keep using `label` (English) unconditionally, unchanged. */
  labelKo?: string;
  sourceSection?: string;
  displayOrder: number;
}

export interface WorksheetFieldDefinitionRecord {
  id: string;
  templateVersionId: string;
  canonicalFieldKey: string;
  worksheetFieldKey: string;
  valueType: WorksheetValueType;
  participantOwned: boolean;
  assistantMustNotSupply: boolean;
  confirmationRequired: boolean;
  visualElementId: string;
  displayOrder: number;
  sourceSection?: string;
}

export interface WorksheetTemplateVersionRecord {
  id: string;
  templateId: string;
  version: number;
  sourceTextHash: string;
  status: "draft" | "published" | "deprecated";
  createdAt: string;
}

export interface WorksheetInstanceRecord {
  id: string;
  runtimeSessionId: string;
  templateVersionId: string;
  status: "in_progress" | "completed" | "abandoned";
  createdAt: string;
  updatedAt: string;
}

export interface WorksheetFieldValueRecord {
  id: string;
  instanceId: string;
  fieldDefinitionId: string;
  status: WorksheetFieldStatus;
  provenance: WorksheetFieldProvenance;
  confidence?: number;
  sourceTurnId?: string;
  confirmedAt?: string;
  updatedAt: string;
  value: unknown;
  displayValue?: string;
  participantVerbatim?: string;
}

export interface WorksheetCollectionItemRecord {
  id: string;
  fieldValueId: string;
  position: number;
  status: WorksheetFieldStatus;
  provenance: WorksheetFieldProvenance;
  sourceTurnId?: string;
  createdAt: string;
  value: unknown;
  displayValue?: string;
}

export interface WorksheetFieldRevisionRecord {
  id: string;
  fieldValueId: string;
  status: WorksheetFieldStatus;
  provenance: WorksheetFieldProvenance;
  sourceTurnId?: string;
  createdAt: string;
  snapshot: unknown;
}

export interface WorksheetEventRecord {
  id: string;
  instanceId: string;
  eventType: "field_shown" | "field_confirmed" | "field_edited" | "instance_completed" | "instance_created";
  createdAt: string;
  data: Record<string, unknown>;
}

/** The read model the UI actually consumes: one row per bound field, its
 * current projected value (if any), and the definition metadata needed to
 * render it -- assembled server-side by worksheet-projection.ts so the
 * client never has to join definitions to values itself. */
export interface WorksheetFieldView {
  definition: WorksheetFieldDefinitionRecord;
  binding: WorksheetBinding;
  value: WorksheetFieldValueRecord | null;
  collectionItems?: WorksheetCollectionItemRecord[];
}

export interface WorksheetView {
  instance: WorksheetInstanceRecord;
  templateVersion: WorksheetTemplateVersionRecord;
  fields: WorksheetFieldView[];
}

/** Cross-run "progress over time" read model for a repeatable list+scores
 * field pair (e.g. S06's Symptom Hierarchy, re-scored across separate runs
 * of the same session -- see that session's own manual). One row per
 * distinct item text seen in ANY run, one column per run, chronological. */
export interface WorksheetHistoryRun {
  runtimeSessionId: string;
  runLabel: string;
  startedAt?: string;
}

export interface WorksheetHistoryRow {
  item: string;
  scoresByRunId: Record<string, number | null>;
}

export interface WorksheetHistoryView {
  runs: WorksheetHistoryRun[];
  rows: WorksheetHistoryRow[];
  totalsByRunId: Record<string, number | null>;
}

/** Patient-facing progress-over-time view (see
 * getPatientProgressSeries in worksheet-projection.ts). Deliberately raw --
 * seriesKey/checkpoint are stable keys the UI resolves through i18n, not
 * pre-localized strings, matching how every other clinical-facing type in
 * this file stays locale-agnostic. */
export interface ProgressPoint {
  checkpoint: string;
  value: number;
}

export interface ProgressSeries {
  seriesKey: string;
  points: ProgressPoint[];
}

export interface SessionProgressCard {
  sessionDefinitionId: string;
  series: ProgressSeries[];
}

/** Cohort-wide rollup of SessionProgressCard, for the clinician-facing
 * roster (see getCohortProgressSummary in worksheet-projection.ts) -- one
 * row per (session, series) pair that at least one participant has a real
 * two-point-or-longer series for. averageDelta is last-checkpoint minus
 * first-checkpoint, averaged across sampleSize participants (never
 * fabricated for a session/series nobody has reached yet -- that pair is
 * simply absent from the array). */
export interface CohortProgressSummaryRow {
  sessionDefinitionId: string;
  seriesKey: string;
  averageDelta: number;
  sampleSize: number;
}
