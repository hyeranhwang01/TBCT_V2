"use client";

import { SessionSignals, WorksheetCell, directionalValue, displayOrDash, listCount } from "@/components/runtime/worksheet-renderers/shared";
import { useReducedMotionPreference } from "@/lib/motion/use-reduced-motion-preference";
import type { WorksheetFieldView, WorksheetView } from "@/types/worksheet";

// Recreates the TBCT Session 5 Participation Grid: contributors listed
// against their share of responsibility (Round 1, %), plus the guilt/shame
// baseline -> now trajectories and the values that emerged from the
// exercise.

export function S05Worksheet({
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
  const reducedMotion = Boolean(useReducedMotionPreference());
  const byKey = new Map(view.fields.map((field) => [field.binding.worksheetFieldKey, field]));
  const get = (key: string) => byKey.get(key);
  const isActive = (field?: WorksheetFieldView) => Boolean(field && field.binding.canonicalFieldKey === activeCanonicalFieldKey);

  return (
    <div className="space-y-5 rounded-panel border border-border bg-[linear-gradient(180deg,var(--surface)_0%,var(--surface-subtle)_100%)] p-4 sm:p-6">
      <SessionSignals
        items={[
          { label: "Guilt belief", value: directionalValue(get("guiltBeliefBaseline"), get("guiltBeliefFinal")) },
          { label: "Shame intensity", value: directionalValue(get("shameIntensityBaseline"), get("shameIntensityFinal")) },
          { label: "My participation share (R1)", value: get("participantParticipationRound1")?.value?.displayValue ? `${displayOrDash(get("participantParticipationRound1"))}%` : "—" },
          { label: "Contributors listed", value: listCount(get("contributors")) },
        ]}
      />
      <ParticipationGrid
        contributorsField={get("contributors")}
        ratingsField={get("participationRatingsRound1")}
        selfField={get("participantParticipationRound1")}
        active={isActive(get("contributors")) || isActive(get("participationRatingsRound1"))}
        onConfirm={onConfirm}
        onEdit={onEdit}
        busy={busy}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <Trajectory title="Guilt belief" fromField={get("guiltBeliefBaseline")} toField={get("guiltBeliefFinal")} isActive={isActive} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
        <Trajectory title="Shame intensity" fromField={get("shameIntensityBaseline")} toField={get("shameIntensityFinal")} isActive={isActive} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
      </div>

      <WorksheetCell field={get("valuesArticulated")} q="8" label="What matters to me" list active={isActive(get("valuesArticulated"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
    </div>
  );
}

function ParticipationGrid({
  contributorsField,
  ratingsField,
  selfField,
  active,
  onConfirm,
  onEdit,
  busy,
}: {
  contributorsField?: WorksheetFieldView;
  ratingsField?: WorksheetFieldView;
  selfField?: WorksheetFieldView;
  active: boolean;
  onConfirm: (worksheetFieldKey: string) => void;
  onEdit: (worksheetFieldKey: string, value: unknown) => void;
  busy: boolean;
}) {
  if (!contributorsField || !ratingsField) return null;
  const contributors = Array.isArray(contributorsField.value?.value) ? (contributorsField.value?.value as unknown[]) : [];
  const ratings = Array.isArray(ratingsField.value?.value) ? (ratingsField.value?.value as unknown[]) : [];
  const filled = contributors.length > 0;
  const draftPending = contributorsField.value?.status === "draft_extracted" || ratingsField.value?.status === "draft_extracted";
  const selfFilled = selfField?.value?.value !== undefined && selfField?.value?.value !== "";

  return (
    <div className={`rounded-panel border p-3 sm:p-4 transition ${active ? "ring-2 ring-clinical-blue border-clinical-blue" : "border-border bg-surface"} ${!filled ? "border-dashed opacity-70" : ""}`}>
      <div className="mb-3 text-sm font-semibold text-text-primary">Participation Grid · Round 1</div>
      {filled ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[280px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] uppercase tracking-[0.05em] text-text-muted">
                <th className="py-1.5 pr-2">Contributor</th>
                <th className="py-1.5">Share</th>
              </tr>
            </thead>
            <tbody>
              {contributors.map((contributor, index) => {
                const percent = ratings[index] !== undefined ? Number(ratings[index]) : 0;
                return (
                  <tr key={index} className="border-b border-border/50 last:border-0">
                    <td className="py-1.5 pr-2 text-text-primary">{String(contributor)}</td>
                    <td className="py-1.5">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-subtle">
                          <div className="h-full rounded-full bg-clinical-blue" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
                        </div>
                        <span className="text-xs font-semibold text-text-primary">{percent}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {selfFilled && (
                <tr>
                  <td className="py-1.5 pr-2 font-semibold text-clinical-blue">Me</td>
                  <td className="py-1.5">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-subtle">
                        <div className="h-full rounded-full bg-clinical-blue" style={{ width: `${Math.max(0, Math.min(100, Number(selfField?.value?.value) || 0))}%` }} />
                      </div>
                      <span className="text-xs font-semibold text-text-primary">{selfField?.value?.displayValue}%</span>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-sm text-text-muted">&hellip;</div>
      )}
      {draftPending && (
        <button
          type="button"
          disabled={busy}
          className="mt-2 rounded-panel border border-clinical-blue px-3 py-1 text-xs font-semibold text-clinical-blue disabled:opacity-50"
          onClick={() => { onConfirm(contributorsField.definition.worksheetFieldKey); onConfirm(ratingsField.definition.worksheetFieldKey); }}
        >
          Confirm
        </button>
      )}
    </div>
  );
}

function Trajectory({
  title,
  fromField,
  toField,
  isActive,
  onConfirm,
  onEdit,
  busy,
  reducedMotion,
}: {
  title: string;
  fromField?: WorksheetFieldView;
  toField?: WorksheetFieldView;
  isActive: (field?: WorksheetFieldView) => boolean;
  onConfirm: (worksheetFieldKey: string) => void;
  onEdit: (worksheetFieldKey: string, value: unknown) => void;
  busy: boolean;
  reducedMotion: boolean;
}) {
  return (
    <div className="rounded-panel border border-border bg-surface p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-text-muted">{title}</div>
      <div className="grid grid-cols-2 gap-2">
        <WorksheetCell field={fromField} q="—" label="Start" borderless compact active={isActive(fromField)} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
        <WorksheetCell field={toField} q="—" label="Now" borderless compact active={isActive(toField)} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
      </div>
    </div>
  );
}
