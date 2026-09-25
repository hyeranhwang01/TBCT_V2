"use client";

import { useMemo, useState } from "react";
import { Button, textareaClass } from "@/shared/components/ui/primitives";
import { ScoreChip } from "@/patient/components/worksheet-renderers/shared";
import { COGNITIVE_DISTORTIONS, DISTORTION_IDS } from "@/shared/protocol/cognitive-distortions";
import { cdQuestScore, type CdQuestGrade } from "@/patient/sessions/s02/cdquest-score";
import { useT } from "@/shared/i18n/context";
import type { HomeworkEntryRecord } from "@/types/homework";

// S02 homework, as the real second session assigned it (2026-09-18, 53:30):
// a blank CD-Quest form to fill in over the week -- a short example for each
// pattern that came up, and a score for how often it came up and how strongly
// it was believed (.claude/TASK_SCOPE.json
// note2026_09_21_s02_cognitive_distortions, stage 3).
//
// The grid is the same one the session uses (s02/cdquest-score.ts), so a score here
// and a score in the session mean the same thing and can be compared. Rows come
// from the shared registry, in the same order as the session worksheet.
//
// The book's rule for a re-rating: the participant must not see their earlier
// scores while scoring again, or the old number anchors the new one. So this
// round's rows show nothing from the session or from previous rounds until all
// fifteen have both halves; only then is the trend revealed.

export const CDQUEST_ROUND_ENTRY_TYPE = "cdquest_round";

export type CdQuestRowData = {
  distortionId: string;
  distortionNumber: number;
  distortionNameKo: string;
  example: string;
  frequency: CdQuestGrade;
  intensity: CdQuestGrade;
  score: number;
};

export type CdQuestRoundData = {
  [key: string]: unknown;
  schemaVersion: 1;
  date: string;
  createdAt: string;
  rows: CdQuestRowData[];
  total: number;
  highCount: number;
};

export type CdQuestRound = { id: string; date: string; rows: CdQuestRowData[]; total: number };

/** One row of the draft. A row the participant has not touched has null grades,
 * which is what "not scored yet" means -- distinct from a grade of 0, which is
 * the real answer "this one did not come up". */
export type CdQuestDraftRow = { example: string; frequency: CdQuestGrade | null; intensity: CdQuestGrade | null };

export function emptyDraft(): CdQuestDraftRow[] {
  return COGNITIVE_DISTORTIONS.map(() => ({ example: "", frequency: null, intensity: null }));
}

/** A row is scored once both halves are in. A pattern that did not come up is a
 * complete answer with both halves 0. */
export function isRowScored(row: CdQuestDraftRow): boolean {
  return row.frequency !== null && row.intensity !== null;
}

export function rowScore(row: CdQuestDraftRow): number | null {
  return isRowScored(row) ? cdQuestScore(row.frequency as CdQuestGrade, row.intensity as CdQuestGrade) : null;
}

export function draftTotal(rows: CdQuestDraftRow[]): number {
  return rows.reduce((sum, row) => sum + (rowScore(row) ?? 0), 0);
}

export function isDraftComplete(rows: CdQuestDraftRow[]): boolean {
  return rows.length === COGNITIVE_DISTORTIONS.length && rows.every((row) => isRowScored(row));
}

function localDate(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function buildCdQuestRoundData(rows: CdQuestDraftRow[], now = new Date()): CdQuestRoundData {
  if (!isDraftComplete(rows)) throw new Error("A CD-Quest round needs all fifteen patterns scored.");
  const built: CdQuestRowData[] = rows.map((row, index) => {
    const distortion = COGNITIVE_DISTORTIONS[index];
    return {
      distortionId: distortion.id,
      distortionNumber: index + 1,
      distortionNameKo: distortion.nameKo,
      example: row.example.trim(),
      frequency: row.frequency as CdQuestGrade,
      intensity: row.intensity as CdQuestGrade,
      score: cdQuestScore(row.frequency as CdQuestGrade, row.intensity as CdQuestGrade),
    };
  });
  return {
    schemaVersion: 1,
    date: localDate(now),
    createdAt: now.toISOString(),
    rows: built,
    total: built.reduce((sum, row) => sum + row.score, 0),
    highCount: built.filter((row) => row.score >= 4).length,
  };
}

/** Stored rounds, oldest first. A round that is not a complete, well-formed
 * fifteen-row CD-Quest is skipped rather than shown half-drawn. */
export function toCdQuestRounds(entries: HomeworkEntryRecord[]): CdQuestRound[] {
  return entries
    .flatMap((entry) => {
      if (entry.entryType !== CDQUEST_ROUND_ENTRY_TYPE) return [];
      const data = entry.data as Partial<CdQuestRoundData>;
      if (data.schemaVersion !== 1 || !Array.isArray(data.rows) || data.rows.length !== COGNITIVE_DISTORTIONS.length) return [];
      const rows = data.rows.filter(
        (row): row is CdQuestRowData =>
          Boolean(row) && typeof row.distortionId === "string" && DISTORTION_IDS.has(row.distortionId) && typeof row.score === "number" && Number.isFinite(row.score),
      );
      if (rows.length !== COGNITIVE_DISTORTIONS.length) return [];
      return [
        {
          id: entry.id,
          date: typeof data.date === "string" && data.date ? data.date : entry.createdAt.slice(0, 10),
          rows,
          total: typeof data.total === "number" ? data.total : rows.reduce((sum, row) => sum + row.score, 0),
        },
      ];
    })
    .sort((left, right) => left.date.localeCompare(right.date));
}

export const GRADES: CdQuestGrade[] = [0, 1, 2, 3];

export function GradeButtons({
  legend,
  labels,
  value,
  onChange,
  disabled,
}: {
  legend: string;
  labels: string[];
  value: CdQuestGrade | null;
  onChange: (grade: CdQuestGrade) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-[11px] font-semibold uppercase tracking-[0.05em] text-text-muted">{legend}</legend>
      <div className="mt-1 flex flex-wrap gap-1">
        {GRADES.map((grade) => (
          <button
            key={grade}
            type="button"
            disabled={disabled}
            aria-pressed={value === grade}
            onClick={() => onChange(grade)}
            className={`rounded-panel border px-2 py-1 text-xs transition ${value === grade ? "border-clinical-blue bg-clinical-blue text-white" : "border-border bg-surface text-text-secondary hover:bg-surface-hover"}`}
          >
            {labels[grade]}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function CdQuestForm({
  rounds,
  baselineScores,
  onSave,
}: {
  rounds: CdQuestRound[];
  /** The scores from the session itself, index-matched to the registry. Hidden
   * until this round is complete. */
  baselineScores: Array<number | null>;
  onSave: (rows: CdQuestDraftRow[]) => Promise<unknown>;
}) {
  const { t } = useT();
  const [draft, setDraft] = useState<CdQuestDraftRow[]>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const frequencyLabels = useMemo(() => [t("homework.s02.freq0"), t("homework.s02.freq1"), t("homework.s02.freq2"), t("homework.s02.freq3")], [t]);
  const intensityLabels = useMemo(() => [t("homework.s02.int0"), t("homework.s02.int1"), t("homework.s02.int2"), t("homework.s02.int3")], [t]);

  const complete = isDraftComplete(draft);
  const scoredCount = draft.filter((row) => isRowScored(row)).length;
  const total = draftTotal(draft);

  const update = (index: number, patch: Partial<CdQuestDraftRow>) =>
    setDraft((previous) => previous.map((row, position) => (position === index ? { ...row, ...patch } : row)));

  const save = async () => {
    setSaving(true);
    setFailed(false);
    try {
      await onSave(draft);
      setRevealed(true);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  if (revealed) {
    return (
      <div className="space-y-4" data-testid="s02-cdquest-trend">
        <div className="rounded-panel border border-border bg-surface p-4">
          <h3 className="text-sm font-semibold text-text-primary">{t("homework.s02.trendTitle")}</h3>
          <p className="mt-1 text-xs text-text-secondary">{t("homework.s02.trendHint")}</p>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-xs text-text-muted">{t("homework.s02.baseline")}</span>
            <span className="font-semibold text-text-primary">{baselineScores.filter((score) => score !== null).length ? baselineScores.reduce((sum, score) => (sum ?? 0) + (score ?? 0), 0) : "—"}</span>
            {[...rounds.map((round) => round.total), total].map((value, index) => (
              <span key={index} className="flex items-center gap-2">
                <span className="text-text-muted">→</span>
                <span className="font-semibold text-text-primary">{value}</span>
              </span>
            ))}
          </div>
        </div>
        <ol className="space-y-2">
          {COGNITIVE_DISTORTIONS.map((distortion, index) => (
            <li key={distortion.id} data-testid={`s02-trend-row-${index + 1}`} className="flex items-center justify-between gap-3 rounded-panel border border-border bg-surface p-2.5">
              <span className="text-sm text-text-primary">
                {index + 1}. {distortion.nameKo}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <ScoreChip score={baselineScores[index] ?? null} />
                <span className="text-text-muted">→</span>
                <ScoreChip score={rowScore(draft[index])} />
              </span>
            </li>
          ))}
        </ol>
        <Button
          variant="secondary"
          onClick={() => {
            setDraft(emptyDraft());
            setRevealed(false);
          }}
        >
          {t("homework.s02.again")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-panel border border-border bg-surface-subtle p-3">
        <span className="text-xs text-text-secondary">{t("homework.s02.scored", { count: scoredCount, of: COGNITIVE_DISTORTIONS.length })}</span>
        <span className="text-sm font-semibold text-text-primary">
          {t("homework.s02.total")} {complete ? total : "—"}
        </span>
      </div>

      <ol className="space-y-2" data-testid="s02-cdquest-rows">
        {COGNITIVE_DISTORTIONS.map((distortion, index) => {
          const row = draft[index];
          return (
            <li key={distortion.id} data-testid={`s02-cdquest-row-${index + 1}`} className="rounded-panel border border-border bg-surface p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-text-primary">
                    {index + 1}. {distortion.nameKo}
                  </div>
                  <div className="mt-0.5 text-xs text-text-secondary">{distortion.descriptionKo}</div>
                </div>
                <span className="shrink-0" data-testid={`s02-cdquest-score-${index + 1}`}>
                  <ScoreChip score={rowScore(row)} />
                </span>
              </div>

              <label className="mt-2 block">
                <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-text-muted">{t("homework.s02.colMine")}</span>
                <textarea
                  className={`${textareaClass} mt-1`}
                  rows={2}
                  value={row.example}
                  placeholder={t("homework.s02.examplePlaceholder")}
                  onChange={(event) => update(index, { example: event.target.value })}
                />
              </label>

              <div className="mt-2 flex flex-wrap gap-4">
                <GradeButtons legend={t("homework.s02.colFrequency")} labels={frequencyLabels} value={row.frequency} onChange={(grade) => update(index, { frequency: grade })} />
                <GradeButtons legend={t("homework.s02.colIntensity")} labels={intensityLabels} value={row.intensity} onChange={(grade) => update(index, { intensity: grade })} />
              </div>
            </li>
          );
        })}
      </ol>

      {failed && (
        <p role="alert" className="text-sm text-warning">
          {t("homework.s02.saveFailed")}
        </p>
      )}
      <Button disabled={!complete} loading={saving} onClick={save}>
        {t("homework.s02.finish")}
      </Button>
      {!complete && <p className="text-xs text-text-muted">{t("homework.s02.hiddenUntilDone")}</p>}
    </div>
  );
}
