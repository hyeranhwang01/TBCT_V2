"use client";

import { CycleArrow, FocusLine, SessionSignals, WorksheetCell, capturedStatus, directionalValue, listCount } from "@/components/runtime/worksheet-renderers/shared";
import { useReducedMotionPreference } from "@/lib/motion/use-reduced-motion-preference";
import type { WorksheetFieldView, WorksheetView } from "@/types/worksheet";

// Recreates the TBCT Session 8 "Trial One" courtroom: the 5-role circular
// courtroom diagram (Judge / Prosecutor / Defendant / Defense / Jury), a
// condensed belief trajectory across the defendant's repeated returns to
// the chair, the case record (evidence and arguments each role brought),
// the verdict, and the appeal. The full source form has 7+ sequential
// belief/emotion checkpoints per stage; this composes them into one
// trajectory strip rather than one box per checkpoint (see tbct-s08.ts's
// header for the condensation rationale).

export function S08Worksheet({
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
  const chargeField = get("charge");
  const chargeActive = isActive(chargeField);

  return (
    <div className="space-y-5 rounded-panel border border-border bg-[linear-gradient(180deg,var(--surface)_0%,var(--surface-subtle)_100%)] p-4 sm:p-6">
      <FocusLine text={chargeField?.value?.displayValue} />
      <SessionSignals
        items={[
          { label: "Charge belief", value: directionalValue(get("coreBeliefBaselinePercent"), get("defendantPostVerdictBeliefPercent")) },
          { label: "Verdict", value: get("verdict")?.value?.displayValue ? String(get("verdict")?.value?.displayValue) : "—" },
          { label: "New belief", value: capturedStatus(get("positiveBelief")) },
          { label: "Appeal evidence", value: listCount(get("appealEvidence")) },
        ]}
      />

      {/* The courtroom -- Judge above, Prosecutor/Defendant/Defense in the middle row, Jury below */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        <RoleBox className="col-span-3" title="Judge" caption="Sets the ground rules for the trial" />
        <RoleBox title="Prosecutor" caption="Argues the charge is true" />
        <div className={`rounded-panel border-2 p-2 text-center transition ${chargeActive ? "border-clinical-blue ring-2 ring-clinical-blue" : "border-clinical-blue/50"} bg-clinical-blue-light/20`}>
          <div className="text-[10px] font-semibold uppercase tracking-[0.05em] text-clinical-blue">Defendant</div>
          <div className="mt-1 min-h-[2.5rem] text-xs font-serif text-text-primary">{chargeField?.value?.displayValue || "…"}</div>
        </div>
        <RoleBox title="Defense" caption="Argues the charge is false" />
        <RoleBox className="col-span-3" title="Jury" caption="Weighs the evidence and delivers a verdict" />
      </div>

      {/* Belief trajectory -- the defendant's chair, revisited after every stage */}
      <div className="rounded-panel border border-border bg-surface p-3 sm:p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-text-muted">Belief in the charge, stage by stage</div>
        <div className="flex flex-wrap items-center gap-1 overflow-x-auto sm:flex-nowrap">
          <TrajectoryStep label="Start" field={get("coreBeliefBaselinePercent")} active={isActive(get("coreBeliefBaselinePercent"))} />
          <CycleArrow reducedMotion={reducedMotion} />
          <TrajectoryStep label="After prosecution" field={get("defendantPostProsecutionBeliefPercent")} active={isActive(get("defendantPostProsecutionBeliefPercent"))} />
          <CycleArrow reducedMotion={reducedMotion} />
          <TrajectoryStep label="After defense" field={get("defendantPostDefenseBeliefPercent")} active={isActive(get("defendantPostDefenseBeliefPercent"))} />
          <CycleArrow reducedMotion={reducedMotion} />
          <TrajectoryStep label="After rebuttal" field={get("defendantPostRebuttalBeliefPercent")} active={isActive(get("defendantPostRebuttalBeliefPercent"))} />
          <CycleArrow reducedMotion={reducedMotion} />
          <TrajectoryStep label="After verdict" field={get("defendantPostVerdictBeliefPercent")} active={isActive(get("defendantPostVerdictBeliefPercent"))} />
        </div>
      </div>

      {/* Case record -- what each role brought */}
      <div className="grid gap-3 sm:grid-cols-2">
        <WorksheetCell field={get("prosecutionEvidence")} q="6" label="Prosecutor's plea" list active={isActive(get("prosecutionEvidence"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
        <WorksheetCell field={get("defenseEvidence")} q="8" label="Defense attorney's plea" list active={isActive(get("defenseEvidence"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
        <WorksheetCell field={get("prosecutionRebuttals")} q="10" label={'Prosecutor’s rebuttal ("but...")'} list active={isActive(get("prosecutionRebuttals"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} emphasized />
        {/* The defense's Step 12 work is two distinct records in the source --
            an answer to each rebuttal, and the participant's own "Therefore..."
            conclusion drawn from it -- so the surrebuttals no longer share the
            conclusions' cell. */}
        <WorksheetCell field={get("defenseSurrebuttals")} q="12" label={'Defense’s answer ("but...")'} list active={isActive(get("defenseSurrebuttals"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
        <WorksheetCell field={get("thereforeConclusions")} q="12" label={'Defense’s conclusion ("...therefore")'} list active={isActive(get("thereforeConclusions"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
      </div>

      {/* Verdict */}
      <div className="rounded-panel border-2 border-text-secondary/30 bg-surface p-3 text-center">
        <div className="mb-1 text-xs font-semibold uppercase tracking-[0.06em] text-text-muted">The jury&apos;s verdict</div>
        <WorksheetCell field={get("verdict")} q="14" label="Verdict" chip borderless active={isActive(get("verdict"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
      </div>

      {/* Appeal */}
      <div className="rounded-panel border-2 border-clinical-blue/40 bg-clinical-blue-light/20 p-3 sm:p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-text-muted">The appeal</div>
        <WorksheetCell field={get("positiveBelief")} q="18" gauge={get("positiveBeliefPercent")} gaugeQ="20" label="My new positive belief" borderless active={isActive(get("positiveBelief")) || isActive(get("positiveBeliefPercent"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
        <div className="mt-2">
          <WorksheetCell field={get("appealEvidence")} q="19" label="Appeal evidence" list borderless active={isActive(get("appealEvidence"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
        </div>
        <div className="mt-2">
          <WorksheetCell field={get("originalChargeFinalBeliefPercent")} q="21" label="Belief in the original charge, now" borderless active={isActive(get("originalChargeFinalBeliefPercent"))} onConfirm={onConfirm} onEdit={onEdit} busy={busy} reducedMotion={reducedMotion} />
        </div>
      </div>
    </div>
  );
}

function RoleBox({ title, caption, className }: { title: string; caption: string; className?: string }) {
  return (
    <div className={`rounded-panel border border-dashed border-border bg-surface-subtle/60 p-2 text-center ${className ?? ""}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.05em] text-text-muted">{title}</div>
      <div className="mt-0.5 text-[11px] text-text-secondary">{caption}</div>
    </div>
  );
}

function TrajectoryStep({ label, field, active }: { label: string; field?: WorksheetFieldView; active: boolean }) {
  const filled = field?.value?.value !== undefined && field?.value?.value !== "";
  return (
    <div className={`flex shrink-0 flex-col items-center gap-1 rounded-panel border px-2.5 py-1.5 transition ${active ? "border-clinical-blue ring-2 ring-clinical-blue" : "border-border"} ${filled ? "bg-surface" : "border-dashed bg-surface-subtle/60 opacity-70"}`}>
      <span className="text-[9px] uppercase tracking-[0.04em] text-text-muted">{label}</span>
      <span className="text-sm font-semibold text-text-primary">{filled ? `${field?.value?.displayValue}%` : "…"}</span>
    </div>
  );
}
