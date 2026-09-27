// runtime_events and access_log (sql/032). Server-only.

import { getPgPool } from "@/shared/data/db/pg-pool";
import { makeId, select, type Queryable } from "@/shared/data/server/trial/db";
import type { TrialActor } from "@/shared/trial/trial-store-ops";
import type { RuntimeEvent } from "@/types/trial";

const EVENT_COLUMNS = ["id", "participant_id", "runtime_session_id", "session_number", "attempt_number", "message_id", "turn_id", "category", "severity", "code", "model", "prompt_version", "latency_ms", "input_tokens", "output_tokens", "detail", "created_at"];

export async function recordEvents(events: RuntimeEvent[], db: Queryable = getPgPool() as unknown as Queryable): Promise<number> {
  let inserted = 0;
  for (let start = 0; start < events.length; start += 100) {
    const batch = events.slice(start, start + 100);
    const values: unknown[] = [];
    const tuples = batch.map((event, index) => {
      values.push(event.id, event.participantId ?? null, event.runtimeSessionId ?? null, event.sessionNumber ?? null, event.attemptNumber ?? null, event.messageId ?? null, event.turnId ?? null, event.category, event.severity, event.code, event.model ?? null, event.promptVersion ?? null, event.latencyMs ?? null, event.inputTokens ?? null, event.outputTokens ?? null, JSON.stringify(event.detail ?? {}), event.createdAt);
      return `(${EVENT_COLUMNS.map((_, column) => `$${index * EVENT_COLUMNS.length + column + 1}`).join(",")})`;
    });
    const result = await db.query(`INSERT INTO runtime_events (${EVENT_COLUMNS.join(",")}) VALUES ${tuples.join(",")} ON CONFLICT (id) DO NOTHING`, values);
    inserted += result.rowCount ?? 0;
  }
  return inserted;
}

export async function listEvents(filter: { participantId?: string; runtimeSessionId?: string; code?: string; severity?: string; since?: string; limit?: number }): Promise<RuntimeEvent[]> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    conditions.push(sql.replace("?", `$${params.length}`));
  };
  if (filter.participantId) add("participant_id = ?", filter.participantId);
  if (filter.runtimeSessionId) add("runtime_session_id = ?", filter.runtimeSessionId);
  if (filter.code) add("code = ?", filter.code);
  if (filter.severity) add("severity = ?", filter.severity);
  if (filter.since) add("created_at >= ?", filter.since);
  params.push(Math.min(Math.max(filter.limit ?? 200, 1), 2000));
  return select<RuntimeEvent>(
    `SELECT * FROM runtime_events ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""} ORDER BY created_at DESC, id DESC LIMIT $${params.length}`,
    params,
  );
}

export async function logAccess(actor: TrialActor | undefined, entry: { action: string; resource: string; participantId?: string | null; detail?: Record<string, unknown> }) {
  if (!actor || actor.role === "server") return;
  await getPgPool().query(
    "INSERT INTO access_log (id, actor_user_id, actor_role, action, resource, participant_id, detail, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now())",
    [makeId("ACC"), actor.userId, actor.role, entry.action, entry.resource, entry.participantId ?? null, JSON.stringify(entry.detail ?? {})],
  );
}
