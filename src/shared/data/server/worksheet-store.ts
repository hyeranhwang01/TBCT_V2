import { getPgPool } from "@/shared/data/db/pg-pool";
import type { WorksheetStoreOp } from "@/shared/runtime/worksheet-store-ops";
import type {
  WorksheetCollectionItemRecord,
  WorksheetEventRecord,
  WorksheetFieldDefinitionRecord,
  WorksheetFieldRevisionRecord,
  WorksheetFieldValueRecord,
  WorksheetInstanceRecord,
  WorksheetTemplateVersionRecord,
} from "@/types/worksheet";

// Server-only: the real (Neon Postgres) implementation of the session
// worksheet store (sql/006_worksheets.sql) -- reached only through
// src/app/api/worksheets/store/route.ts, never imported by client
// components. Same "document row" writer/reader shape as
// runtime-session-store.ts, except the value-bearing tables here are
// genuinely normalized per-field rows (see the architectural note in
// sql/006_worksheets.sql).

function makeId(prefix: string) {
  const webCrypto = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (typeof webCrypto?.randomUUID === "function") return `${prefix}-${webCrypto.randomUUID().slice(0, 8)}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

async function ensureTemplateVersion(input: { templateId: string; sessionDefinitionId: string; title: string; version: number; sourceTextHash: string; fieldDefinitions: Array<Omit<WorksheetFieldDefinitionRecord, "id" | "templateVersionId">> }): Promise<WorksheetTemplateVersionRecord> {
  const pool = getPgPool();
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO worksheet_templates (id, session_definition_id, title, created_at) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`,
    [input.templateId, input.sessionDefinitionId, input.title, now],
  );
  const existing = await pool.query<{ id: string; data: { sourceTextHash: string; status: string; createdAt: string } }>(
    `SELECT id, data FROM worksheet_template_versions WHERE template_id = $1 AND version = $2`,
    [input.templateId, input.version],
  );
  let versionId: string;
  if (existing.rows[0]) {
    versionId = existing.rows[0].id;
  } else {
    versionId = makeId("WKTV");
    await pool.query(
      `INSERT INTO worksheet_template_versions (id, template_id, version, source_text_hash, status, created_at, data) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [versionId, input.templateId, input.version, input.sourceTextHash, "published", now, JSON.stringify({ sourceTextHash: input.sourceTextHash, status: "published", createdAt: now })],
    );
  }
  // Backfill any field this session's WorksheetBinding[] defines that this
  // template version doesn't have a row for yet -- covers both a brand-new
  // version (nothing exists) and, just as importantly, an EXISTING version
  // whose bindings array has grown since it was first created. TEMPLATE_VERSION
  // is a constant that's never bumped (see worksheet-projection.ts), so
  // without this, a field added to a session's bindings after its first real
  // run never gets a definition row for that session, forever -- it silently
  // disappears from getWorksheetView's output (this is what happened to
  // S07's emotionReasonSpeakers/consensusSurprise/consensusEmotionIntent/
  // consensusPartsNeeds, all added after S07's template version already
  // existed in production). ON CONFLICT DO NOTHING plus the existingKeys
  // check keeps this safe to run on every call: already-defined fields (and
  // their original display_order) are left untouched.
  const existingKeys = await pool.query<{ worksheet_field_key: string }>(
    `SELECT worksheet_field_key FROM worksheet_field_definitions WHERE template_version_id = $1`,
    [versionId],
  );
  const existingKeySet = new Set(existingKeys.rows.map((row) => row.worksheet_field_key));
  for (const [index, definition] of input.fieldDefinitions.entries()) {
    if (existingKeySet.has(definition.worksheetFieldKey)) continue;
    await pool.query(
      `INSERT INTO worksheet_field_definitions (id, template_version_id, canonical_field_key, worksheet_field_key, value_type, participant_owned, assistant_must_not_supply, confirmation_required, visual_element_id, display_order, source_section)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (template_version_id, worksheet_field_key) DO NOTHING`,
      [makeId("WKFD"), versionId, definition.canonicalFieldKey, definition.worksheetFieldKey, definition.valueType, definition.participantOwned, definition.assistantMustNotSupply, definition.confirmationRequired, definition.visualElementId, index, definition.sourceSection ?? null],
    );
  }
  return { id: versionId, templateId: input.templateId, version: input.version, sourceTextHash: input.sourceTextHash, status: "published", createdAt: now };
}

async function getTemplateVersion(sessionDefinitionId: string, version: number): Promise<WorksheetTemplateVersionRecord | undefined> {
  const pool = getPgPool();
  const { rows } = await pool.query<{ id: string; template_id: string; data: { sourceTextHash: string; status: string; createdAt: string } }>(
    `SELECT tv.id, tv.template_id, tv.data FROM worksheet_template_versions tv
     JOIN worksheet_templates t ON t.id = tv.template_id
     WHERE t.session_definition_id = $1 AND tv.version = $2`,
    [sessionDefinitionId, version],
  );
  const row = rows[0];
  if (!row) return undefined;
  return { id: row.id, templateId: row.template_id, version, sourceTextHash: row.data.sourceTextHash, status: row.data.status as WorksheetTemplateVersionRecord["status"], createdAt: row.data.createdAt };
}

async function listFieldDefinitions(templateVersionId: string): Promise<WorksheetFieldDefinitionRecord[]> {
  const pool = getPgPool();
  const { rows } = await pool.query(
    `SELECT id, template_version_id, canonical_field_key, worksheet_field_key, value_type, participant_owned, assistant_must_not_supply, confirmation_required, visual_element_id, display_order, source_section
     FROM worksheet_field_definitions WHERE template_version_id = $1 ORDER BY display_order ASC`,
    [templateVersionId],
  );
  return rows.map((row) => ({
    id: row.id, templateVersionId: row.template_version_id, canonicalFieldKey: row.canonical_field_key, worksheetFieldKey: row.worksheet_field_key,
    valueType: row.value_type, participantOwned: row.participant_owned, assistantMustNotSupply: row.assistant_must_not_supply,
    confirmationRequired: row.confirmation_required, visualElementId: row.visual_element_id, displayOrder: row.display_order, sourceSection: row.source_section ?? undefined,
  }));
}

async function ensureInstance(runtimeSessionId: string, templateVersionId: string): Promise<WorksheetInstanceRecord> {
  const pool = getPgPool();
  const existing = await pool.query<{ id: string; template_version_id: string; status: string; created_at: string; updated_at: string }>(
    `SELECT id, template_version_id, status, created_at, updated_at FROM worksheet_instances WHERE runtime_session_id = $1`,
    [runtimeSessionId],
  );
  if (existing.rows[0]) {
    const row = existing.rows[0];
    return { id: row.id, runtimeSessionId, templateVersionId: row.template_version_id, status: row.status as WorksheetInstanceRecord["status"], createdAt: row.created_at, updatedAt: row.updated_at };
  }
  const now = new Date().toISOString();
  const id = makeId("WKST");
  await pool.query(
    `INSERT INTO worksheet_instances (id, runtime_session_id, template_version_id, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, runtimeSessionId, templateVersionId, "in_progress", now, now],
  );
  return { id, runtimeSessionId, templateVersionId, status: "in_progress", createdAt: now, updatedAt: now };
}

async function getInstance(runtimeSessionId: string): Promise<WorksheetInstanceRecord | undefined> {
  const pool = getPgPool();
  const { rows } = await pool.query<{ id: string; template_version_id: string; status: string; created_at: string; updated_at: string }>(
    `SELECT id, template_version_id, status, created_at, updated_at FROM worksheet_instances WHERE runtime_session_id = $1`,
    [runtimeSessionId],
  );
  const row = rows[0];
  if (!row) return undefined;
  return { id: row.id, runtimeSessionId, templateVersionId: row.template_version_id, status: row.status as WorksheetInstanceRecord["status"], createdAt: row.created_at, updatedAt: row.updated_at };
}

async function upsertFieldValue(instanceId: string, fieldDefinitionId: string, patch: Partial<Omit<WorksheetFieldValueRecord, "id" | "instanceId" | "fieldDefinitionId">>): Promise<WorksheetFieldValueRecord> {
  const pool = getPgPool();
  const now = new Date().toISOString();
  const existing = await pool.query<{ id: string; data: Record<string, unknown> }>(
    `SELECT id, data FROM worksheet_field_values WHERE instance_id = $1 AND field_definition_id = $2`,
    [instanceId, fieldDefinitionId],
  );
  const current = existing.rows[0]?.data as Partial<WorksheetFieldValueRecord> | undefined;
  const next: WorksheetFieldValueRecord = {
    id: existing.rows[0]?.id ?? makeId("WKFV"),
    instanceId, fieldDefinitionId,
    status: patch.status ?? current?.status ?? "empty",
    provenance: patch.provenance ?? current?.provenance ?? "unconfirmed_extraction",
    confidence: patch.confidence ?? current?.confidence,
    sourceTurnId: patch.sourceTurnId ?? current?.sourceTurnId,
    confirmedAt: patch.confirmedAt ?? current?.confirmedAt,
    updatedAt: now,
    value: "value" in patch ? patch.value : current?.value,
    displayValue: patch.displayValue ?? current?.displayValue,
    participantVerbatim: patch.participantVerbatim ?? current?.participantVerbatim,
  };
  await pool.query(
    `INSERT INTO worksheet_field_values (id, instance_id, field_definition_id, status, provenance, confidence, source_turn_id, confirmed_at, updated_at, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (instance_id, field_definition_id) DO UPDATE SET
       status = EXCLUDED.status, provenance = EXCLUDED.provenance, confidence = EXCLUDED.confidence,
       source_turn_id = EXCLUDED.source_turn_id, confirmed_at = EXCLUDED.confirmed_at, updated_at = EXCLUDED.updated_at, data = EXCLUDED.data`,
    [next.id, instanceId, fieldDefinitionId, next.status, next.provenance, next.confidence ?? null, next.sourceTurnId ?? null, next.confirmedAt ?? null, next.updatedAt, JSON.stringify(next)],
  );
  return next;
}

async function listFieldValues(instanceId: string): Promise<WorksheetFieldValueRecord[]> {
  const pool = getPgPool();
  const { rows } = await pool.query<{ data: WorksheetFieldValueRecord }>(`SELECT data FROM worksheet_field_values WHERE instance_id = $1`, [instanceId]);
  return rows.map((row) => row.data);
}

async function replaceCollectionItems(fieldValueId: string, items: Array<{ value: unknown; displayValue?: string; status: WorksheetFieldValueRecord["status"]; provenance: WorksheetFieldValueRecord["provenance"]; sourceTurnId?: string }>) {
  const pool = getPgPool();
  await pool.query(`DELETE FROM worksheet_collection_items WHERE field_value_id = $1`, [fieldValueId]);
  const now = new Date().toISOString();
  for (const [position, item] of items.entries()) {
    const id = makeId("WKCI");
    const record: WorksheetCollectionItemRecord = { id, fieldValueId, position, status: item.status, provenance: item.provenance, sourceTurnId: item.sourceTurnId, createdAt: now, value: item.value, displayValue: item.displayValue };
    await pool.query(
      `INSERT INTO worksheet_collection_items (id, field_value_id, position, status, provenance, source_turn_id, created_at, data) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, fieldValueId, position, item.status, item.provenance, item.sourceTurnId ?? null, now, JSON.stringify(record)],
    );
  }
}

async function listCollectionItems(fieldValueId: string): Promise<WorksheetCollectionItemRecord[]> {
  const pool = getPgPool();
  const { rows } = await pool.query<{ data: WorksheetCollectionItemRecord }>(`SELECT data FROM worksheet_collection_items WHERE field_value_id = $1 ORDER BY position ASC`, [fieldValueId]);
  return rows.map((row) => row.data);
}

async function appendFieldRevision(input: { fieldValueId: string; status: WorksheetFieldValueRecord["status"]; provenance: WorksheetFieldValueRecord["provenance"]; sourceTurnId?: string; snapshot: unknown }) {
  const pool = getPgPool();
  const id = makeId("WKFR");
  const now = new Date().toISOString();
  const record: WorksheetFieldRevisionRecord = { id, fieldValueId: input.fieldValueId, status: input.status, provenance: input.provenance, sourceTurnId: input.sourceTurnId, createdAt: now, snapshot: input.snapshot };
  await pool.query(
    `INSERT INTO worksheet_field_revisions (id, field_value_id, status, provenance, source_turn_id, created_at, data) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, input.fieldValueId, input.status, input.provenance, input.sourceTurnId ?? null, now, JSON.stringify(record)],
  );
  return record;
}

async function listFieldRevisions(fieldValueId: string): Promise<WorksheetFieldRevisionRecord[]> {
  const pool = getPgPool();
  const { rows } = await pool.query<{ data: WorksheetFieldRevisionRecord }>(`SELECT data FROM worksheet_field_revisions WHERE field_value_id = $1 ORDER BY created_at ASC`, [fieldValueId]);
  return rows.map((row) => row.data);
}

async function appendEvent(input: { instanceId: string; eventType: WorksheetEventRecord["eventType"]; data: Record<string, unknown> }) {
  const pool = getPgPool();
  const id = makeId("WKEV");
  const now = new Date().toISOString();
  const record: WorksheetEventRecord = { id, instanceId: input.instanceId, eventType: input.eventType, createdAt: now, data: input.data };
  await pool.query(
    `INSERT INTO worksheet_events (id, instance_id, event_type, created_at, data) VALUES ($1, $2, $3, $4, $5)`,
    [id, input.instanceId, input.eventType, now, JSON.stringify(record)],
  );
  return record;
}

async function listEvents(instanceId: string): Promise<WorksheetEventRecord[]> {
  const pool = getPgPool();
  const { rows } = await pool.query<{ data: WorksheetEventRecord }>(`SELECT data FROM worksheet_events WHERE instance_id = $1 ORDER BY created_at ASC`, [instanceId]);
  return rows.map((row) => row.data);
}

export async function dispatchWorksheetStoreOp(op: WorksheetStoreOp): Promise<unknown> {
  switch (op.op) {
    case "ensureTemplateVersion": return ensureTemplateVersion(op);
    case "getTemplateVersion": return getTemplateVersion(op.sessionDefinitionId, op.version);
    case "listFieldDefinitions": return listFieldDefinitions(op.templateVersionId);
    case "ensureInstance": return ensureInstance(op.runtimeSessionId, op.templateVersionId);
    case "getInstance": return getInstance(op.runtimeSessionId);
    case "upsertFieldValue": return upsertFieldValue(op.instanceId, op.fieldDefinitionId, op.patch);
    case "listFieldValues": return listFieldValues(op.instanceId);
    case "replaceCollectionItems": return replaceCollectionItems(op.fieldValueId, op.items);
    case "listCollectionItems": return listCollectionItems(op.fieldValueId);
    case "appendFieldRevision": return appendFieldRevision(op);
    case "listFieldRevisions": return listFieldRevisions(op.fieldValueId);
    case "appendEvent": return appendEvent(op);
    case "listEvents": return listEvents(op.instanceId);
    default: {
      const exhaustive: never = op;
      throw new Error(`Unknown worksheet store op: ${JSON.stringify(exhaustive)}`);
    }
  }
}
