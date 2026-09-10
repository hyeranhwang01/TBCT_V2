"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle2 } from "lucide-react";
import { Badge, Button } from "@/shared/components/ui/primitives";
import { fadeScale, fadeUp, highlightPulse, questComplete } from "@/lib/motion/motion-variants";
import type { WorksheetFieldView } from "@/types/worksheet";
import type { RuntimeMessage, RuntimeMessageRole } from "@/types/runtime-session";

// How long the one-shot "just filled" flourish stays flagged -- matches
// questComplete's own animation duration (motion-variants.ts) so the badge
// has fully faded out before this flips back off.
const JUST_FILLED_MS = 1300;

/** Detects a field's one-shot false->true "just got filled" transition, not
 * "is filled" (which callers already compute themselves) -- so the "quest
 * complete" flourish plays exactly once per fill instead of replaying on
 * every unrelated re-render/poll while the field stays filled. A field that
 * is already filled on first mount (e.g. reopening a session mid-way
 * through) never triggers it -- only a live false->true flip does. */
export function useJustFilled(filled: boolean, reducedMotion: boolean) {
  const previousRef = useRef(filled);
  const [justFilled, setJustFilled] = useState(false);
  useEffect(() => {
    const wasFilled = previousRef.current;
    previousRef.current = filled;
    if (reducedMotion || !filled || wasFilled) return undefined;
    setJustFilled(true);
    const timeout = setTimeout(() => setJustFilled(false), JUST_FILLED_MS);
    return () => clearTimeout(timeout);
  }, [filled, reducedMotion]);
  return justFilled;
}

/** The "quest complete" badge itself -- a small overlay, not a layout
 * element, so callers just need `position: relative` on the cell shell. */
export function QuestCompleteBadge() {
  return (
    <motion.span
      className="pointer-events-none absolute -right-2 -top-2 z-10 inline-flex items-center gap-1 rounded-full border border-success bg-success-light px-2 py-0.5 text-[11px] font-semibold text-success shadow-sm"
      variants={questComplete}
      initial="initial"
      animate="animate"
    >
      <CheckCircle2 className="h-3 w-3" />
      Filled
    </motion.span>
  );
}

// ---------------------------------------------------------------------------
// Source traceability -- a WorksheetFieldValueRecord's optional
// `sourceTurnId` is literally the id of the RuntimeMessage that produced it
// (see runtime-execution-api.ts's submitPatientInput -> projectRuntimeFieldsToWorksheet
// call, `sourceTurnId: patientMessage.id`). WorksheetPane resolves the
// clinician's session messages once and provides them here via context, so
// every WorksheetCell in every session figure can offer a real "View
// source" link with zero prop-threading through 8 bespoke layouts. When a
// field has no sourceTurnId (e.g. system-calculated totals) or the message
// can't be found, nothing renders -- no fake/guessed mapping is ever shown.
const WorksheetSourceContext = createContext<Map<string, RuntimeMessage>>(new Map());

export function WorksheetSourceProvider({ messages, children }: { messages: RuntimeMessage[]; children: React.ReactNode }) {
  const byId = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages]);
  return <WorksheetSourceContext.Provider value={byId}>{children}</WorksheetSourceContext.Provider>;
}

function useSourceMessage(sourceTurnId?: string): RuntimeMessage | undefined {
  const byId = useContext(WorksheetSourceContext);
  return sourceTurnId ? byId.get(sourceTurnId) : undefined;
}

const SOURCE_SPEAKER_LABEL: Record<RuntimeMessageRole, string> = {
  patient: "Patient",
  clinician: "Clinician",
  assistant: "Program",
  system: "Program",
};

function formatSourceTimestamp(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Renders nothing unless the originating chat message can actually be
 * resolved -- see the module comment above. */
function SourceTrace({ sourceTurnId }: { sourceTurnId?: string }) {
  const message = useSourceMessage(sourceTurnId);
  const [open, setOpen] = useState(false);
  if (!message) return null;
  return (
    <div className="mt-2">
      <button type="button" onClick={() => setOpen((value) => !value)} className="text-[11px] font-semibold text-clinical-blue hover:underline">
        {open ? "Hide source" : "View source"}
      </button>
      {open && (
        <div className="mt-1.5 rounded-panel border border-border bg-surface-subtle/70 p-2.5">
          <div className="flex items-center justify-between gap-2 text-[11px] font-semibold text-text-muted">
            <span>{SOURCE_SPEAKER_LABEL[message.role]}</span>
            <span>{formatSourceTimestamp(message.createdAt)}</span>
          </div>
          <div className="mt-1 whitespace-pre-wrap break-words text-sm text-text-primary">{message.content}</div>
        </div>
      )}
    </div>
  );
}

/** S04's "the other person" cells estimate what someone else may have
 * thought/felt/done -- the participant's inference, not a fact about that
 * person. This flags that distinction inline wherever it applies, per the
 * data-layering rule (patient-reported vs. structured vs. patient-inferred). */
export function InferredBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-surface-subtle px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-text-secondary">
      Possible · Patient-inferred
    </span>
  );
}

/** A single line near the top of a session figure naming what the session
 * actually dealt with -- only rendered when the session has a real,
 * already-bound field to source it from (a genuine situation/event/charge
 * field). Sessions without one (S02, S05, S06, S07 -- see each renderer's
 * own comment) simply never call this rather than showing an always-empty
 * placeholder. */
export function FocusLine({ text }: { text?: string }) {
  if (!text) return null;
  return (
    <div className="rounded-panel border border-dashed border-border bg-surface-subtle/60 px-3 py-2">
      <span className="mr-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">Focus</span>
      <span className="text-sm text-text-primary">{text}</span>
    </div>
  );
}

/** Up to 4 structured, factual signals for this session -- no clinical
 * interpretation, ever (see each renderer's own signal list for exactly
 * which already-bound fields back each one). Values missing from the
 * underlying data show "—", never a fabricated placeholder. */
export function SessionSignals({ items }: { items: Array<{ label: string; value: string }> }) {
  const visible = items.slice(0, 4);
  if (!visible.length) return null;
  return (
    <div className="rounded-panel border border-border bg-surface p-3 sm:p-4">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">Session Signals</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {visible.map((item) => (
          <div key={item.label} className="rounded-panel border border-border/70 bg-surface-subtle/60 px-2.5 py-1.5">
            <div className="text-[10px] uppercase tracking-[0.05em] text-text-muted">{item.label}</div>
            <div className="mt-0.5 text-sm font-semibold text-text-primary">{item.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Neutral "before → after" text for a percentage pair -- no color-coding
 * for improvement/decline, just the two numbers in order. Falls back
 * gracefully when only one side (or neither) has a value yet. */
export function directionalValue(from?: WorksheetFieldView, to?: WorksheetFieldView): string {
  const fromValue = from?.value?.displayValue;
  const toValue = to?.value?.displayValue;
  if (fromValue && toValue) return `${fromValue}% → ${toValue}%`;
  if (fromValue) return `${fromValue}%`;
  if (toValue) return `${toValue}%`;
  return "—";
}

/** Item count for a text_list field, or "—" when empty/unfilled. */
export function listCount(field?: WorksheetFieldView): string {
  const value = field?.value?.value;
  if (!Array.isArray(value) || value.length === 0) return "—";
  return String(value.length);
}

/** "Captured" / "Not captured" for a field that's either filled or not --
 * a structured status, not a clinical judgment (see brief §14's own
 * "Balanced conclusion: Captured" example). */
export function capturedStatus(field?: WorksheetFieldView): string {
  const filled = Boolean(field) && field!.value !== null && field!.value!.value !== undefined && field!.value!.value !== "";
  return filled ? "Captured" : "Not captured";
}

/** Plain text/percentage display value, or "—" when unfilled. */
export function displayOrDash(field?: WorksheetFieldView): string {
  return field?.value?.displayValue ? String(field.value.displayValue) : "—";
}

// Small generic building blocks shared across the per-session composed
// worksheets (s01-worksheet.tsx .. s08-worksheet.tsx). These are UI atoms,
// not figure layouts -- each session file arranges them into its own
// bespoke structure matching that session's own manual figure; nothing
// about *which* fields appear, in *what* arrangement, is shared.

export function CycleArrow({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <div className="hidden items-center justify-center sm:flex" aria-hidden>
      <motion.svg width="28" height="16" viewBox="0 0 28 16" variants={reducedMotion ? undefined : fadeScale} initial={reducedMotion ? false : "initial"} animate={reducedMotion ? undefined : "animate"}>
        <line x1="1" y1="8" x2="22" y2="8" stroke="currentColor" strokeWidth="1.5" className="text-text-muted" />
        <path d="M22 8 L16 4 M22 8 L16 12" stroke="currentColor" strokeWidth="1.5" fill="none" className="text-text-muted" />
      </motion.svg>
    </div>
  );
}

export function ArrowDown({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <motion.svg width="16" height="24" viewBox="0 0 16 24" variants={reducedMotion ? undefined : fadeScale} initial={reducedMotion ? false : "initial"} animate={reducedMotion ? undefined : "animate"}>
      <line x1="8" y1="1" x2="8" y2="18" stroke="currentColor" strokeWidth="1.5" className="text-text-muted" />
      <path d="M8 18 L4 12 M8 18 L12 12" stroke="currentColor" strokeWidth="1.5" fill="none" className="text-text-muted" />
    </motion.svg>
  );
}

/** 0-5 color scale used by both S02's problem/goal hierarchies and S06's
 * symptom hierarchy -- the same clinical severity palette, per source. */
export const SCORE_SCALE_COLORS = ["#bfdbfe", "#1d4ed8", "#bbf7d0", "#15803d", "#facc15", "#dc2626"] as const;
export const SCORE_SCALE_TEXT = ["#1e3a8a", "#ffffff", "#14532d", "#ffffff", "#3f2d00", "#ffffff"] as const;

export function ScoreChip({ score }: { score: number | null }) {
  if (score === null || Number.isNaN(score) || score < 0 || score > 5) {
    return <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-border text-[11px] text-text-muted">?</span>;
  }
  return (
    <span
      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold"
      style={{ backgroundColor: SCORE_SCALE_COLORS[score], color: SCORE_SCALE_TEXT[score] }}
    >
      {score}
    </span>
  );
}

/** A fixed set of choice pills (e.g. "same / a little better / much
 * better") with the field's current value highlighted -- the figure
 * prints these as checkboxes; each session supplies its own option set. */
export function ChoicePills({ field, options, label, active }: { field?: WorksheetFieldView; options: Array<{ value: string; label: string }>; label: string; active: boolean }) {
  const current = field?.value?.value;
  return (
    <div className={`rounded-panel p-2 transition ${active ? "ring-2 ring-clinical-blue" : ""}`}>
      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.06em] text-text-muted">{label}</div>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <span key={option.value} className={`rounded-full border px-3 py-1 text-sm ${current === option.value ? "border-success bg-success-light text-text-primary" : "border-border bg-surface-subtle text-text-secondary"}`}>
            {option.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function WorksheetCell({
  field,
  q,
  gauge,
  gaugeQ,
  active,
  onConfirm,
  onEdit,
  busy,
  reducedMotion,
  compact,
  chip,
  list,
  emphasized,
  borderless,
  label,
  tone,
  inferred,
}: {
  field?: WorksheetFieldView;
  q: string;
  gauge?: WorksheetFieldView;
  gaugeQ?: string;
  active: boolean;
  onConfirm: (worksheetFieldKey: string) => void;
  onEdit: (worksheetFieldKey: string, value: unknown) => void;
  busy: boolean;
  reducedMotion: boolean;
  compact?: boolean;
  chip?: boolean;
  list?: boolean;
  emphasized?: boolean;
  borderless?: boolean;
  label?: string;
  tone?: "neutral";
  /** This value is the participant's own guess about someone else, not an
   * observed fact -- shows the POSSIBLE/PATIENT-INFERRED badge next to the
   * label (see InferredBadge above). Used by S04's "other person" cells. */
  inferred?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(field?.value?.displayValue ?? "");
  const filled = Boolean(field) && field!.value !== null && field!.value.value !== undefined && field!.value.value !== "";
  const justFilled = useJustFilled(filled, reducedMotion);
  if (!field) return null;
  const confirmed = field.value?.status === "participant_confirmed";
  const draftPending = field.value?.status === "draft_extracted";

  const shell = `relative rounded-panel p-3 transition ${borderless ? "" : `border ${emphasized ? "border-warning/50 bg-warning-light/15" : tone === "neutral" ? "border-border bg-surface" : "border-border bg-surface"}`} ${active ? "ring-2 ring-clinical-blue border-clinical-blue" : justFilled ? "ring-2 ring-success border-success" : ""} ${!filled ? "border-dashed opacity-70" : ""}`;

  const cellVariants = active ? highlightPulse : fadeUp;
  return (
    <motion.div className={shell} variants={reducedMotion ? undefined : cellVariants} initial={reducedMotion ? false : "initial"} animate={reducedMotion ? undefined : "animate"}>
      {justFilled && <QuestCompleteBadge />}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-text-muted">
          <span>{label ?? `Q${q}`}</span>
          {inferred && <InferredBadge />}
        </div>
        {confirmed && <Badge tone="success">confirmed</Badge>}
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <textarea className="w-full rounded-panel border border-border bg-surface px-2 py-1.5 text-sm" rows={list ? 3 : 2} value={draft} onChange={(event) => setDraft(event.target.value)} />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy}
              onClick={() => {
                const nextValue = list ? draft.split("\n").map((line) => line.trim()).filter(Boolean) : draft;
                onEdit(field.definition.worksheetFieldKey, nextValue);
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
          {list ? (
            <ul className="mt-1 space-y-1">
              {(Array.isArray(field.value?.value) ? (field.value?.value as unknown[]) : []).map((item, index) => (
                <li key={index} className="rounded-panel border border-border bg-surface-subtle px-2 py-1 text-sm text-text-primary">{String(item)}</li>
              ))}
            </ul>
          ) : chip ? (
            <div className="mt-1 inline-block rounded-full border border-border bg-surface-subtle px-3 py-1 font-serif text-sm text-text-primary">{field.value?.displayValue}</div>
          ) : (
            <div className={`mt-1 font-serif text-text-primary ${compact ? "text-sm" : "text-[15px]"}`}>{field.value?.displayValue}</div>
          )}
          {gauge?.value && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-[11px] text-text-muted">{gaugeQ ? `Q${gaugeQ}` : ""}</span>
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-subtle">
                <div className="h-full rounded-full bg-clinical-blue" style={{ width: `${Math.max(0, Math.min(100, Number(gauge.value.value) || 0))}%` }} />
              </div>
              <span className="text-sm font-semibold text-text-primary">{gauge.value.displayValue}%</span>
            </div>
          )}
          <SourceTrace sourceTurnId={field.value?.sourceTurnId} />
          <div className="mt-2 flex gap-2">
            {draftPending && <Button size="sm" onClick={() => onConfirm(field.definition.worksheetFieldKey)} disabled={busy}>Confirm</Button>}
            <Button size="sm" variant="ghost" onClick={() => { setDraft(field.value?.displayValue ?? ""); setEditing(true); }} disabled={busy}>Edit</Button>
          </div>
        </>
      ) : (
        <div className="mt-1 text-sm text-text-muted">&hellip;</div>
      )}
    </motion.div>
  );
}
