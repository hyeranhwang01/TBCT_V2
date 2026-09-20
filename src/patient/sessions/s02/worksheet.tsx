"use client";

import { useState } from "react";
import { Button, textareaClass } from "@/shared/components/ui/primitives";
import { SessionSignals } from "@/patient/components/worksheet-renderers/shared";
import { COGNITIVE_DISTORTIONS } from "@/shared/protocol/cognitive-distortions";
import { NO_EXAMPLE_MARKER } from "@/patient/sessions/s02/turn-rules";
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
// being asked about is the one after the last stored example.

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
  const rows = rowsOf(field);
  const active = activeCanonicalFieldKey === "distortionExamples";
  // The pattern currently being asked about: the row after the last stored one.
  const currentIndex = Math.min(rows.length, COGNITIVE_DISTORTIONS.length - 1);
  const editable = Boolean(field) && (!readOnly || Boolean(allowEdit));
  const filledCount = rows.filter((row) => isFilled(row)).length;

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
        ]}
      />
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
              current={active && index === currentIndex}
              editable={editable}
              busy={busy}
              korean={korean}
              onSave={(text) => save(index, text)}
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
  current,
  editable,
  busy,
  korean,
  onSave,
}: {
  index: number;
  name: string;
  description: string;
  example?: string;
  current: boolean;
  editable: boolean;
  busy: boolean;
  korean: boolean;
  onSave: (text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(isFilled(example) ? (example as string) : "");
  const filled = isFilled(example);
  const lookedAt = example !== undefined;

  return (
    <li
      data-testid={`s02-distortion-row-${index + 1}`}
      aria-current={current ? "step" : undefined}
      className={`rounded-panel border p-2.5 transition ${current ? "border-clinical-blue ring-1 ring-clinical-blue" : "border-border"} ${lookedAt ? "bg-surface" : "border-dashed bg-surface-subtle opacity-80"}`}
    >
      <div className="text-sm font-semibold text-text-primary">
        {index + 1}. {name}
      </div>
      <div className="mt-0.5 text-xs text-text-secondary">{description}</div>

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
