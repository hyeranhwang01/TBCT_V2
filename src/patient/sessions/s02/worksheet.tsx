"use client";

import { useState } from "react";
import { Button, textareaClass } from "@/shared/components/ui/primitives";
import { ScoreChip, SessionSignals } from "@/patient/components/worksheet-renderers/shared";
import { COGNITIVE_DISTORTIONS } from "@/shared/protocol/cognitive-distortions";
import { NO_EXAMPLE_MARKER, cdQuestScore, type CdQuestGrade } from "@/patient/sessions/s02/turn-rules";
import { GradeButtons } from "@/patient/sessions/s02/cdquest-form";
import type { WorksheetFieldView, WorksheetView } from "@/types/worksheet";

// Session 2's worksheet: the Cognitive Distortions List (book appendix Table
// A1) with the participant's own example beside each pattern -- the table the
// real second session filled in together, one row per turn
// (.claude/TASK_SCOPE.json note2026_09_21_s02_cognitive_distortions).
//
// Why the participant sees this one (PATIENT_COMPOSED_WORKSHEET_SESSIONS):
// at 15:00 of the recording the participant asks to write in it herself --
// "the screen share, can I not write in it now?" -- and at 43:00 she reads the
// filled table back and notices which rows look worst. Without the table the
// walkthrough is 38 minutes of talk with nothing to look at.
//
// Rows come from the registry, so the fifteen definitions are data. The row
// being asked about is the one after the last stored example -- or, once the
// CD-Quest scoring is the active step, the one after the last stored score.

function numbersOf(field?: WorksheetFieldView): Array<number | null> {
  const value = field?.value?.value;
  return Array.isArray(value)
    ? value.map((item) => {
        const number = typeof item === "number" ? item : Number(item);
        return Number.isFinite(number) ? number : null;
      })
    : [];
}

/** Band labels for the score's two halves, shown under the chip as the basis of
 * the score. Index 0 is "unknown": a participant who states a score outright
 * leaves both halves null, and nothing is invented for them. */
const FREQUENCY_LABELS = ["—", "1–2일", "3–5일", "6–7일"] as const;
const FREQUENCY_LABELS_EN = ["—", "1-2 days", "3-5 days", "6-7 days"] as const;
const INTENSITY_LABELS = ["—", "약간", "꽤", "아주 강함"] as const;
const INTENSITY_LABELS_EN = ["—", "a little", "quite", "very much"] as const;
// Index-matched to the grade, so index 0 is the real answer "it did not come up"
// rather than the "unknown" dash the summary labels above use.
const FREQUENCY_LABELS_PICKER = ["없었음", "1~2일", "3~5일", "6~7일"] as const;
const FREQUENCY_LABELS_PICKER_EN = ["Not at all", "1-2 days", "3-5 days", "6-7 days"] as const;
const INTENSITY_LABELS_PICKER = ["없었음", "약간", "꽤", "아주 강하게"] as const;
const INTENSITY_LABELS_PICKER_EN = ["Not at all", "A little", "Quite", "Very much"] as const;

const FREQUENCY_COLUMNS = [
  { grade: 0 as CdQuestGrade, ko: "없었음", en: "Not at all" },
  { grade: 1 as CdQuestGrade, ko: "1~2일", en: "1-2 days" },
  { grade: 2 as CdQuestGrade, ko: "3~5일", en: "3-5 days" },
  { grade: 3 as CdQuestGrade, ko: "6~7일", en: "6-7 days" },
];
const INTENSITY_ROWS = [
  { grade: 1 as CdQuestGrade, ko: "약간 (30% 이하)", en: "A little (up to 30%)" },
  { grade: 2 as CdQuestGrade, ko: "꽤 (31~70%)", en: "Quite (31-70%)" },
  { grade: 3 as CdQuestGrade, ko: "아주 강하게 (70% 넘게)", en: "Very much (over 70%)" },
];

/**
 * The CD-Quest matrix, on screen while the scoring runs.
 *
 * In the recording the counselor put the form up and pointed at it -- "요
 * 매트릭스에 의해서" (985) -- and the participant then read her own score off it,
 * answering "2점인 것 같아요" as often as she gave the two halves. Reading a
 * number off a visible table is a different, easier task than holding six bands
 * in your head while someone recites them.
 *
 * On screen from the start, not only once the scoring begins. This was gated at
 * first, on the reasoning that the recording brings the grid out at 43:00 -- but
 * the participant's own copy of the instrument (CD Quest Client version 1) is
 * ONE sheet, carrying "1 2 3 / 2 3 4 / 3 4 5" beside the fifteen "enter a
 * personal example of..." fields. The form shows both the whole time, so the
 * worksheet does too.
 *
 * Cell values come from cdQuestScore, never from a literal table here, so the
 * grid a participant reads and the arithmetic the session records cannot drift
 * apart.
 */
function CdQuestGrid({ korean }: { korean: boolean }) {
  return (
    <div className="rounded-panel border border-border bg-surface p-3 sm:p-4" data-testid="s02-cdquest-grid">
      <div className="text-sm font-semibold text-text-primary">{korean ? "점수판" : "How the score works"}</div>
      <p className="mt-0.5 text-xs text-text-secondary">
        {korean ? "지난 한 주 기준으로, 얼마나 자주 있었는지와 그때 얼마나 믿었는지가 만나는 칸이 그 유형의 점수예요." : "Where how often it came up this past week meets how strongly you believed it, that cell is the score."}
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[320px] border-collapse text-center text-xs">
          <caption className="sr-only">{korean ? "빈도와 강도로 점수를 정하는 표" : "Score by frequency and intensity"}</caption>
          <thead>
            <tr>
              <th scope="col" className="p-1.5 text-left font-semibold text-text-muted">
                {korean ? "강도 ＼ 빈도" : "Strength ＼ How often"}
              </th>
              {FREQUENCY_COLUMNS.map((column) => (
                <th key={column.grade} scope="col" className="p-1.5 font-semibold text-text-secondary">
                  {korean ? column.ko : column.en}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {INTENSITY_ROWS.map((row) => (
              <tr key={row.grade} className="border-t border-border">
                <th scope="row" className="p-1.5 text-left font-medium text-text-secondary">
                  {korean ? row.ko : row.en}
                </th>
                {FREQUENCY_COLUMNS.map((column) => (
                  <td key={column.grade} className="p-1.5">
                    <ScoreChip score={cdQuestScore(column.grade, row.grade)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function rowsOf(field?: WorksheetFieldView): string[] {
  const value = field?.value?.value;
  return Array.isArray(value) ? value.map((item) => (typeof item === "string" ? item : String(item ?? ""))) : [];
}

function isFilled(row: string | undefined): boolean {
  return Boolean(row && row.trim() && row.trim() !== NO_EXAMPLE_MARKER);
}

export function S02Worksheet({
  view,
  activeCanonicalFieldKey,
  onEdit,
  busy,
  locale,
  readOnly,
  allowEdit,
}: {
  view: WorksheetView;
  activeCanonicalFieldKey?: string;
  onConfirm: (worksheetFieldKey: string) => void;
  onEdit: (worksheetFieldKey: string, value: unknown) => void;
  busy: boolean;
  locale?: string;
  readOnly?: boolean;
  allowEdit?: boolean;
}) {
  const korean = (locale ?? "").toLowerCase().startsWith("ko");
  const field = view.fields.find((item) => item.binding.canonicalFieldKey === "distortionExamples");
  const scoreField = view.fields.find((item) => item.binding.canonicalFieldKey === "cdQuestScores");
  const totalField = view.fields.find((item) => item.binding.canonicalFieldKey === "cdQuestTotal");
  const rows = rowsOf(field);
  const scores = numbersOf(scoreField);
  // The two halves the score was built from.
  const frequencies = numbersOf(view.fields.find((item) => item.binding.canonicalFieldKey === "cdQuestFrequency"));
  const intensities = numbersOf(view.fields.find((item) => item.binding.canonicalFieldKey === "cdQuestIntensity"));
  // The active key is the PROMPT's output field (patient-session-page.tsx), and
  // both loops answer into a scratch scalar rather than into the list they build
  // -- so the list's own name never appears here and both pointers have to match
  // the scratch name too.
  const active = activeCanonicalFieldKey === "distortionExamples" || activeCanonicalFieldKey === "distortionTurnAnswer";
  const scoringActive = activeCanonicalFieldKey === "cdQuestScores" || activeCanonicalFieldKey === "cdQuestItemScore";

  // The pattern currently being asked about: the row after the last stored one.
  // During scoring the pointer follows the scores instead of the examples.
  const currentIndex = Math.min(scoringActive ? scores.length : rows.length, COGNITIVE_DISTORTIONS.length - 1);
  const editable = Boolean(field) && (!readOnly || Boolean(allowEdit));
  const filledCount = rows.filter((row) => isFilled(row)).length;

  // A score the participant can correct, for the same reason the example cell is
  // editable: the guide reads the score out of what they SAY, and a misread one
  // is a measured value that would otherwise stay wrong. Writing the two halves
  // and the score together keeps the row self-consistent -- the score is never
  // stored apart from what it was made of.
  const saveScore = (index: number, frequency: CdQuestGrade, intensity: CdQuestGrade) => {
    const scoreField = view.fields.find((item) => item.binding.canonicalFieldKey === "cdQuestScores");
    const frequencyField = view.fields.find((item) => item.binding.canonicalFieldKey === "cdQuestFrequency");
    const intensityField = view.fields.find((item) => item.binding.canonicalFieldKey === "cdQuestIntensity");
    if (!scoreField || !frequencyField || !intensityField) return;
    const pad = <T,>(list: T[], fill: T) => {
      const next = [...list];
      while (next.length <= index) next.push(fill);
      return next;
    };
    const nextScores = pad(scores, 0);
    const nextFrequency = pad(frequencies, null);
    const nextIntensity = pad(intensities, null);
    nextScores[index] = cdQuestScore(frequency, intensity);
    nextFrequency[index] = frequency;
    nextIntensity[index] = intensity;
    onEdit(frequencyField.definition.worksheetFieldKey, nextFrequency);
    onEdit(intensityField.definition.worksheetFieldKey, nextIntensity);
    onEdit(scoreField.definition.worksheetFieldKey, nextScores);
  };

  const save = (index: number, text: string) => {
    if (!field) return;
    const next = [...rows];
    while (next.length <= index) next.push(NO_EXAMPLE_MARKER);
    next[index] = text.trim() || NO_EXAMPLE_MARKER;
    onEdit(field.definition.worksheetFieldKey, next);
  };

  return (
    <div className="space-y-4 rounded-panel border border-border bg-[linear-gradient(180deg,var(--surface)_0%,var(--surface-subtle)_100%)] p-4 sm:p-6">
      <SessionSignals
        items={[
          { label: korean ? "살펴본 유형" : "Patterns looked at", value: `${rows.length} / ${COGNITIVE_DISTORTIONS.length}` },
          { label: korean ? "내 예시" : "My examples", value: String(filledCount) },
          { label: korean ? "채점한 유형" : "Patterns scored", value: `${scores.length} / ${COGNITIVE_DISTORTIONS.length}` },
          // Summed from the rows rather than read from cdQuestTotal, so a score
          // corrected here shows up immediately. The two agree unless a row was
          // edited after the program worked the total out.
          { label: korean ? "총점" : "Total", value: scores.length ? String(scores.reduce<number>((sum, score) => sum + (score ?? 0), 0)) : (totalField?.value?.displayValue ?? "—") },
        ]}
      />
      <CdQuestGrid korean={korean} />
      <div className={`rounded-panel border p-3 sm:p-4 transition ${active ? "ring-2 ring-clinical-blue border-clinical-blue" : "border-border bg-surface"}`}>
        <div className="mb-3 text-sm font-semibold text-text-primary">{korean ? "인지왜곡 목록과 내 예시" : "Cognitive distortions and my examples"}</div>
        <ol className="space-y-2" data-testid="s02-distortion-rows">
          {COGNITIVE_DISTORTIONS.map((distortion, index) => (
            <DistortionRow
              key={distortion.id}
              index={index}
              name={korean ? distortion.nameKo : distortion.nameEn[0]}
              description={korean ? distortion.descriptionKo : distortion.descriptionEn}
              example={rows[index]}
              score={scores[index] ?? undefined}
              frequency={frequencies[index] ?? null}
              intensity={intensities[index] ?? null}
              current={(active || scoringActive) && index === currentIndex}
              editable={editable}
              busy={busy}
              korean={korean}
              onSave={(text) => save(index, text)}
              onScore={(frequency, intensity) => saveScore(index, frequency, intensity)}
            />
          ))}
        </ol>
      </div>
    </div>
  );
}

function DistortionRow({
  index,
  name,
  description,
  example,
  score,
  frequency,
  intensity,
  current,
  editable,
  busy,
  korean,
  onSave,
  onScore,
}: {
  index: number;
  name: string;
  description: string;
  example?: string;
  score?: number;
  frequency: number | null;
  intensity: number | null;
  current: boolean;
  editable: boolean;
  busy: boolean;
  korean: boolean;
  onSave: (text: string) => void;
  onScore: (frequency: CdQuestGrade, intensity: CdQuestGrade) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [scoring, setScoring] = useState(false);
  const [draftFrequency, setDraftFrequency] = useState<CdQuestGrade | null>(null);
  const [draftIntensity, setDraftIntensity] = useState<CdQuestGrade | null>(null);
  const [draft, setDraft] = useState(isFilled(example) ? (example as string) : "");
  const filled = isFilled(example);
  const lookedAt = example !== undefined;

  return (
    <li
      data-testid={`s02-distortion-row-${index + 1}`}
      aria-current={current ? "step" : undefined}
      className={`rounded-panel border p-2.5 transition ${current ? "border-clinical-blue ring-1 ring-clinical-blue" : "border-border"} ${lookedAt ? "bg-surface" : "border-dashed bg-surface-subtle opacity-80"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-text-primary">
            {index + 1}. {name}
          </div>
          <div className="mt-0.5 text-xs text-text-secondary">{description}</div>
        </div>
        {typeof score === "number" && Number.isFinite(score) && (
          <button
            type="button"
            disabled={!editable || busy}
            onClick={() => {
              setDraftFrequency(frequency === null ? null : (frequency as CdQuestGrade));
              setDraftIntensity(intensity === null ? null : (intensity as CdQuestGrade));
              setScoring(true);
            }}
            aria-label={korean ? `${index + 1}번 유형 점수 고치기` : `Change the score for pattern ${index + 1}`}
            className={`flex shrink-0 flex-col items-end gap-0.5 rounded-panel px-1 py-0.5 ${editable ? "hover:bg-surface-hover" : "cursor-default"}`}
            data-testid={`s02-distortion-score-${index + 1}`}
          >
            <ScoreChip score={score} />
            {(frequency !== null || intensity !== null) && (
              <span className="text-[10px] text-text-muted">
                {(korean ? FREQUENCY_LABELS : FREQUENCY_LABELS_EN)[frequency ?? 0]} · {(korean ? INTENSITY_LABELS : INTENSITY_LABELS_EN)[intensity ?? 0]}
              </span>
            )}
          </button>
        )}
      </div>

      {scoring && (
        <div className="mt-2 space-y-2 rounded-panel border border-border bg-surface-subtle p-2.5" data-testid={`s02-score-picker-${index + 1}`}>
          <div className="flex flex-wrap gap-4">
            <GradeButtons
              legend={korean ? "얼마나 자주" : "How often"}
              labels={korean ? [...FREQUENCY_LABELS_PICKER] : [...FREQUENCY_LABELS_PICKER_EN]}
              value={draftFrequency}
              onChange={setDraftFrequency}
              disabled={busy}
            />
            <GradeButtons
              legend={korean ? "얼마나 강하게" : "How strongly"}
              labels={korean ? [...INTENSITY_LABELS_PICKER] : [...INTENSITY_LABELS_PICKER_EN]}
              value={draftIntensity}
              onChange={setDraftIntensity}
              disabled={busy}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={busy || draftFrequency === null || draftIntensity === null}
              onClick={() => {
                if (draftFrequency === null || draftIntensity === null) return;
                onScore(draftFrequency, draftIntensity);
                setScoring(false);
              }}
            >
              {korean ? "저장" : "Save"}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setScoring(false)}>
              {korean ? "취소" : "Cancel"}
            </Button>
            {draftFrequency !== null && draftIntensity !== null && (
              <span className="text-xs text-text-secondary">
                {korean ? "점수" : "Score"} <ScoreChip score={cdQuestScore(draftFrequency, draftIntensity)} />
              </span>
            )}
          </div>
        </div>
      )}

      <div className="mt-1.5">
        <div className="text-[11px] font-semibold uppercase tracking-[0.05em] text-text-muted">{korean ? "내 예시" : "My example"}</div>
        {editing ? (
          <div className="mt-1 space-y-2">
            <textarea className={textareaClass} rows={2} value={draft} onChange={(event) => setDraft(event.target.value)} />
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={busy}
                onClick={() => {
                  onSave(draft);
                  setEditing(false);
                }}
              >
                {korean ? "저장" : "Save"}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
                {korean ? "취소" : "Cancel"}
              </Button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            disabled={!editable || busy}
            onClick={() => {
              setDraft(filled ? (example as string) : "");
              setEditing(true);
            }}
            className={`mt-0.5 w-full rounded-panel px-2 py-1 text-left text-sm ${filled ? "text-text-primary" : "text-text-muted"} ${editable ? "hover:bg-surface-hover" : "cursor-default"}`}
          >
            {filled ? example : lookedAt ? (korean ? "이 유형에는 예시 없음" : "no example for this one") : "…"}
          </button>
        )}
      </div>
    </li>
  );
}
