// Helpers for the trial store (src/shared/data/server/trial-store.ts).
// Server-only.

import { randomUUID } from "node:crypto";
import { getPgPool } from "@/shared/data/db/pg-pool";
import type { TrialActor } from "@/shared/trial/trial-store-ops";

export type Queryable = { query: <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<{ rows: T[]; rowCount?: number | null }> };

export class TrialError extends Error {}

export function makeId(prefix: string) {
  return `${prefix}-${randomUUID()}`;
}

export function actorLabel(actor: TrialActor | undefined) {
  return actor ? `${actor.role}:${actor.userId}` : "server:unknown";
}

const camel = (key: string) => key.replace(/_([a-z0-9])/g, (_, letter: string) => letter.toUpperCase());

function toJsonValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  return value;
}

/** A database row with camelCase keys and ISO date strings. */
export function row<T>(record: Record<string, unknown>): T {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [camel(key), toJsonValue(value)])) as T;
}

export function rows<T>(records: Array<Record<string, unknown>>): T[] {
  return records.map((record) => row<T>(record));
}

export async function select<T>(text: string, params: unknown[] = [], db: Queryable = getPgPool() as unknown as Queryable): Promise<T[]> {
  const result = await db.query<Record<string, unknown>>(text, params);
  return rows<T>(result.rows);
}

export async function selectOne<T>(text: string, params: unknown[] = [], db?: Queryable): Promise<T | undefined> {
  return (await select<T>(text, params, db))[0];
}

/** Runs `work` in a transaction with tbct.actor set, so every history row
 * (tbct_record_history) says who made the change. */
export async function transaction<T>(actor: TrialActor | undefined, work: (db: Queryable) => Promise<T>): Promise<T> {
  const client = await getPgPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('tbct.actor', $1, true)", [actorLabel(actor)]);
    const result = await work(client as unknown as Queryable);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function addDays(date: Date, days: number) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}
