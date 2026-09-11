"use client";

import { useState } from "react";
import { Button, inputClass, textareaClass } from "@/shared/components/ui/primitives";
import { useT } from "@/shared/i18n/context";
import { S01_COGNITIVE_DISTORTIONS, S01_DISTORTION_IDS } from "@/patient/sessions/s01/cognitive-distortions";
import type { HomeworkEntryRecord } from "@/types/homework";

// The 15 cognitive distortions from the list used in the real first session
// (Cognitive Distortions List, Table A1), from the approved S01 registry:
// - DistortionTable: the read-only list beside the chat from the
//   distortions step on (s01/worksheet.tsx);
// - DistortionHomeworkTable: the same list as the homework table, with a
//   "내 예시" column the participant fills between sessions
//   (s01/homework.tsx).
// The participant always picks the row themselves -- nothing here suggests
// one.

export function DistortionTable({ locale }: { locale?: string }) {
  const korean = (locale ?? "").toLowerCase().startsWith("ko");
  return (
    <ol className="mt-2 space-y-2" data-testid="s01-distortion-list">
      {S01_COGNITIVE_DISTORTIONS.map((distortion, index) => (
        <li key={distortion.id} className="rounded-panel border border-border bg-surface p-2.5">
          <div className="text-sm font-semibold text-text-primary">{index + 1}. {korean ? distortion.nameKo : distortion.nameEn[0]}</div>
          <div className="mt-0.5 text-xs text-text-secondary">{korean ? distortion.descriptionKo : distortion.descriptionEn}</div>
          <div className="mt-0.5 text-xs italic text-text-muted">“{korean ? distortion.exampleKo[0] : distortion.exampleEn[0]}”</div>
        </li>
      ))}
    </ol>
  );
}

// Homework entries (.claude/TASK_SCOPE.json note2026_09_12_s01_redesign).
// The earlier free-form "example" entries are a different entry type and
// are not read.
export const DISTORTION_EXAMPLE_ENTRY_TYPE = "distortion_example";

export type DistortionExampleData = {
  schemaVersion: 2;
  distortionId: string;
  distortionNumber: number;
  distortionNameKo: string;
  date: string;
  text: string;
  createdAt: string;
};

export type DistortionExample = { id: string; distortionId: string; date: string; text: string };

export type DistortionExampleInput = { distortionId: string; date: string; text: string };

export function buildDistortionExampleData(input: DistortionExampleInput, now = new Date()): DistortionExampleData {
  const index = S01_COGNITIVE_DISTORTIONS.findIndex((item) => item.id === input.distortionId);
  if (index < 0) throw new Error(`Unknown S01 distortion: ${input.distortionId}`);
  return {
    schemaVersion: 2,
    distortionId: input.distortionId,
    distortionNumber: index + 1,
    distortionNameKo: S01_COGNITIVE_DISTORTIONS[index].nameKo,
    date: input.date,
    text: input.text,
    createdAt: now.toISOString(),
  };
}

export function toDistortionExamples(entries: HomeworkEntryRecord[]): DistortionExample[] {
  return entries.flatMap((entry) => {
    if (entry.entryType !== DISTORTION_EXAMPLE_ENTRY_TYPE) return [];
    const data = entry.data as Partial<DistortionExampleData>;
    if (data.schemaVersion !== 2 || typeof data.distortionId !== "string" || !S01_DISTORTION_IDS.has(data.distortionId) || typeof data.text !== "string" || !data.text.trim()) return [];
    return [{ id: entry.id, distortionId: data.distortionId, date: typeof data.date === "string" && data.date ? data.date : entry.createdAt.slice(0, 10), text: data.text }];
  });
}

function localDate(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Five columns on a wide screen (No. / distortion / definition / example /
// my examples); on a phone each row stacks into a card.
const COLUMNS = "md:grid-cols-[2.25rem_9rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)]";

export function DistortionHomeworkTable({ entries, onAdd }: { entries: DistortionExample[]; onAdd: (input: DistortionExampleInput) => Promise<unknown> | void }) {
  const { t, locale } = useT();
  const korean = locale === "ko";
  const byDistortion = new Map<string, DistortionExample[]>();
  for (const entry of entries) byDistortion.set(entry.distortionId, [...(byDistortion.get(entry.distortionId) ?? []), entry]);
  return (
    <div role="table" aria-label={t("homework.s01.tableLabel")} className="space-y-2" data-testid="s01-homework-table">
      <div role="row" className={`hidden gap-3 px-3 text-[11px] font-semibold uppercase tracking-[0.05em] text-text-muted md:grid ${COLUMNS}`}>
        <span role="columnheader">{t("homework.s01.colNumber")}</span>
        <span role="columnheader">{t("homework.s01.colName")}</span>
        <span role="columnheader">{t("homework.s01.colDefinition")}</span>
        <span role="columnheader">{t("homework.s01.colExample")}</span>
        <span role="columnheader">{t("homework.s01.colMine")}</span>
      </div>
      {S01_COGNITIVE_DISTORTIONS.map((distortion, index) => (
        <HomeworkRow
          key={distortion.id}
          number={index + 1}
          name={korean ? distortion.nameKo : distortion.nameEn[0]}
          definition={korean ? distortion.descriptionKo : distortion.descriptionEn}
          example={korean ? distortion.exampleKo[0] : distortion.exampleEn[0]}
          examples={byDistortion.get(distortion.id) ?? []}
          onAdd={(input) => onAdd({ distortionId: distortion.id, ...input })}
        />
      ))}
    </div>
  );
}

function HomeworkRow({ number, name, definition, example, examples, onAdd }: {
  number: number;
  name: string;
  definition: string;
  example: string;
  examples: DistortionExample[];
  onAdd: (input: { date: string; text: string }) => Promise<unknown> | void;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [date, setDate] = useState(localDate);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSaving(true);
    setFailed(false);
    try {
      await onAdd({ date, text: trimmed });
      setText("");
      setOpen(false);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div role="row" className={`grid gap-2 rounded-panel border border-border bg-surface p-3 md:gap-3 ${COLUMNS}`}>
      <div role="cell" className="hidden text-sm font-semibold text-text-muted md:block">{number}</div>
      <div role="cell" className="text-sm font-semibold text-text-primary"><span className="md:hidden">{number}. </span>{name}</div>
      <div role="cell" className="text-xs text-text-secondary">{definition}</div>
      <div role="cell" className="text-xs italic text-text-muted">“{example}”</div>
      <div role="cell" className="space-y-1.5">
        <div className="text-[11px] font-semibold text-text-muted md:hidden">{t("homework.s01.colMine")}</div>
        {examples.length > 0 && (
          <ul className="space-y-1">
            {examples.map((entry) => (
              <li key={entry.id} className="rounded-panel border border-border bg-surface-subtle px-2 py-1 text-sm text-text-primary">
                <span className="mr-1.5 text-[11px] text-text-muted">{entry.date}</span>
                {entry.text}
              </li>
            ))}
          </ul>
        )}
        {examples.length === 0 && !open && <p className="text-xs text-text-muted">{t("homework.s01.noExamples")}</p>}
        {open ? (
          <div className="space-y-1.5">
            <textarea aria-label={t("homework.s01.textLabel")} className={textareaClass} rows={2} value={text} onChange={(event) => setText(event.target.value)} placeholder={t("homework.s01.textPlaceholder")} />
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" aria-label={t("homework.s01.dateLabel")} className={`${inputClass} w-auto`} value={date} onChange={(event) => setDate(event.target.value)} />
              <Button onClick={submit} disabled={!text.trim()} loading={saving}>{t("homework.s01.save")}</Button>
              <Button variant="secondary" onClick={() => { setOpen(false); setText(""); setFailed(false); }}>{t("homework.s01.cancel")}</Button>
            </div>
            {failed && <p role="alert" className="text-xs text-warning">{t("homework.s01.saveFailed")}</p>}
          </div>
        ) : (
          <Button variant="secondary" onClick={() => setOpen(true)}>{t("homework.s01.addMine")}</Button>
        )}
      </div>
    </div>
  );
}
