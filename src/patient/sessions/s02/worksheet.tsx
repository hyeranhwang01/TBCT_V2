"use client";

import { useState } from "react";
import { Button } from "@/components/ui/primitives";
import { ScoreChip, SessionSignals, displayOrDash, listCount } from "@/components/runtime/worksheet-renderers/shared";
import type { WorksheetFieldView, WorksheetView } from "@/types/worksheet";

// Recreates the TBCT Session 2 Color-Coded Problem Hierarchy (CCPH) and
// Color-Coded Goal Hierarchy (CCGH): each is a ranked list of items with a
// 0-5 severity/priority score rendered as a colored chip (0=light blue ..
// 5=red, per source), not a plain field-status row.

export function S02Worksheet({
  view,
  activeCanonicalFieldKey,
  onConfirm,
  onEdit,
  busy,
}: {
  view: WorksheetView;
  activeCanonicalFieldKey?: string;
  onConfirm: (worksheetFieldKey: string) => void;
  onEdit: (worksheetFieldKey: string, value: unknown) => void;
  busy: boolean;
}) {
  const byKey = new Map(view.fields.map((field) => [field.binding.worksheetFieldKey, field]));
  const get = (key: string) => byKey.get(key);
  const isActive = (field?: WorksheetFieldView) => Boolean(field && field.binding.canonicalFieldKey === activeCanonicalFieldKey);

  return (
    <div className="space-y-6 rounded-panel border border-border bg-[linear-gradient(180deg,var(--surface)_0%,var(--surface-subtle)_100%)] p-4 sm:p-6">
      <SessionSignals
        items={[
          { label: "Total problem score", value: displayOrDash(get("totalProblemScore")) },
          { label: "Total goals score", value: displayOrDash(get("totalGoalsScore")) },
          { label: "Problems tracked", value: listCount(get("problems")) },
          { label: "Goals tracked", value: listCount(get("goals")) },
        ]}
      />
      <HierarchyBoard
        title="Color-Coded Problem Hierarchy"
        itemsField={get("problems")}
        scoresField={get("problemRatings")}
        totalField={get("totalProblemScore")}
        totalLabel="Total problem score"
        itemLabel="Problems"
        active={isActive(get("problems")) || isActive(get("problemRatings"))}
        onConfirm={onConfirm}
        onEdit={onEdit}
        busy={busy}
      />
      <HierarchyBoard
        title="Color-Coded Goal Hierarchy"
        itemsField={get("goals")}
        scoresField={get("goalRatings")}
        totalField={get("totalGoalsScore")}
        totalLabel="Total goals score"
        itemLabel="Goals"
        active={isActive(get("goals")) || isActive(get("goalRatings"))}
        onConfirm={onConfirm}
        onEdit={onEdit}
        busy={busy}
      />
    </div>
  );
}

function HierarchyBoard({
  title,
  itemsField,
  scoresField,
  totalField,
  totalLabel,
  itemLabel,
  active,
  onConfirm,
  onEdit,
  busy,
}: {
  title: string;
  itemsField?: WorksheetFieldView;
  scoresField?: WorksheetFieldView;
  totalField?: WorksheetFieldView;
  totalLabel: string;
  itemLabel: string;
  active: boolean;
  onConfirm: (worksheetFieldKey: string) => void;
  onEdit: (worksheetFieldKey: string, value: unknown) => void;
  busy: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [itemsDraft, setItemsDraft] = useState((itemsField?.value?.value as unknown[] | undefined)?.join("\n") ?? "");
  const [scoresDraft, setScoresDraft] = useState((scoresField?.value?.value as unknown[] | undefined)?.join("\n") ?? "");
  if (!itemsField || !scoresField) return null;

  const items = Array.isArray(itemsField.value?.value) ? (itemsField.value?.value as unknown[]) : [];
  const scores = Array.isArray(scoresField.value?.value) ? (scoresField.value?.value as unknown[]) : [];
  const filled = items.length > 0;
  const draftPending = itemsField.value?.status === "draft_extracted" || scoresField.value?.status === "draft_extracted";
  const confirmed = itemsField.value?.status === "participant_confirmed" && scoresField.value?.status === "participant_confirmed";

  return (
    <div className={`rounded-panel border p-3 sm:p-4 transition ${active ? "ring-2 ring-clinical-blue border-clinical-blue" : "border-border bg-surface"} ${!filled ? "border-dashed opacity-70" : ""}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-text-primary">{title}</div>
        {confirmed && <span className="rounded-full bg-success-light px-2 py-0.5 text-[11px] font-semibold text-success">confirmed</span>}
      </div>

      {editing ? (
        <div className="space-y-2">
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-[0.05em] text-text-muted">{itemLabel} (one per line)</label>
            <textarea className="mt-1 w-full rounded-panel border border-border bg-surface px-2 py-1.5 text-sm" rows={4} value={itemsDraft} onChange={(event) => setItemsDraft(event.target.value)} />
          </div>
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-[0.05em] text-text-muted">Scores 0-5 (same order, one per line)</label>
            <textarea className="mt-1 w-full rounded-panel border border-border bg-surface px-2 py-1.5 text-sm" rows={4} value={scoresDraft} onChange={(event) => setScoresDraft(event.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                onEdit(itemsField.definition.worksheetFieldKey, itemsDraft.split("\n").map((line) => line.trim()).filter(Boolean));
                onEdit(scoresField.definition.worksheetFieldKey, scoresDraft.split("\n").map((line) => line.trim()).filter(Boolean));
                setEditing(false);
              }}
            >
              Save
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : filled ? (
        <>
          <ul className="space-y-1.5">
            {items.map((item, index) => (
              <li key={index} className="flex items-center gap-2 rounded-panel border border-border bg-surface-subtle px-2.5 py-1.5">
                <ScoreChip score={scores[index] !== undefined ? Number(scores[index]) : null} />
                <span className="text-sm text-text-primary">{String(item)}</span>
              </li>
            ))}
          </ul>
          {totalField?.value && (
            <div className="mt-2 flex items-center justify-end gap-2 text-sm">
              <span className="text-text-muted">{totalLabel}</span>
              <span className="rounded-full border border-border bg-surface-subtle px-2.5 py-0.5 font-semibold text-text-primary">{totalField.value.displayValue}</span>
            </div>
          )}
          <div className="mt-2 flex gap-2">
            {draftPending && (
              <Button size="sm" disabled={busy} onClick={() => { onConfirm(itemsField.definition.worksheetFieldKey); onConfirm(scoresField.definition.worksheetFieldKey); }}>Confirm</Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setItemsDraft(items.join("\n"));
                setScoresDraft(scores.join("\n"));
                setEditing(true);
              }}
            >
              Edit
            </Button>
          </div>
        </>
      ) : (
        <div className="text-sm text-text-muted">&hellip;</div>
      )}
    </div>
  );
}
