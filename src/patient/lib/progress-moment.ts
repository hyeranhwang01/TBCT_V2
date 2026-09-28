import { PROGRESS_SERIES_PLAN } from "@/shared/worksheet/worksheet-projection";

export type ProgressMoment = { seriesKey: string; from: number; to: number };

type Fields = Record<string, unknown> | undefined;

function numberAt(fields: Fields, key: string): number | undefined {
  const raw = fields?.[key];
  if (raw === undefined || raw === null || raw === "") return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** The re-rating that just landed, if any: a series (same field pairs as the
 * patient progress graph) whose starting rating exists and whose latest
 * checkpoint has a value now that it did not have before. Only the newest
 * checkpoint counts, so a multi-step series (S08) reports the most recent
 * step against the starting point. */
export function findNewProgressMoment(sessionDefinitionId: string, before: Fields, after: Fields): ProgressMoment | undefined {
  const plans = PROGRESS_SERIES_PLAN[sessionDefinitionId] ?? [];
  for (const plan of plans) {
    const start = numberAt(after, plan.checkpoints[0].fieldKey);
    if (start === undefined) continue;
    for (const checkpoint of [...plan.checkpoints.slice(1)].reverse()) {
      const now = numberAt(after, checkpoint.fieldKey);
      if (now === undefined) continue;
      if (numberAt(before, checkpoint.fieldKey) === now) break;
      return { seriesKey: plan.seriesKey, from: start, to: now };
    }
  }
  return undefined;
}
