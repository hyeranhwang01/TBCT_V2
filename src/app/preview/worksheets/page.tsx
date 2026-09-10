"use client";

// Visual-QA preview for the TBCT Session 2 (CCPH/CCGH 0-5 color scale) and
// Session 3 (Intra-TR figure) worksheets. Renders the real, unmodified
// S02Worksheet/S03Worksheet components against local mock data instead of a
// live runtime session -- so this page needs no Postgres/Supabase-backed
// session to view, only `npm run dev`. It is purely additive: it imports
// existing components/bindings and never touches session runtime logic,
// worksheet-binding registries, or any other session's code.
//
// Not linked from the app's own navigation/router (src/components/studio-app.tsx) --
// visit directly at /preview/worksheets.

import { useState } from "react";
import { S02Worksheet } from "@/components/runtime/worksheet-renderers/s02-worksheet";
import { S03Worksheet } from "@/components/runtime/worksheet-renderers/s03-worksheet";
import { ScoreChip } from "@/components/runtime/worksheet-renderers/shared";
import { TBCT_S02_BINDINGS } from "@/lib/worksheet/worksheet-bindings/tbct-s02";
import { TBCT_S03_BINDINGS } from "@/lib/worksheet/worksheet-bindings/tbct-s03";
import type { WorksheetBinding, WorksheetFieldStatus, WorksheetFieldView, WorksheetView } from "@/types/worksheet";

function makeField(binding: WorksheetBinding, value: unknown, status: WorksheetFieldStatus = "participant_confirmed"): WorksheetFieldView {
  const displayValue = Array.isArray(value) ? value.map(String).join(", ") : value === undefined || value === null ? undefined : String(value);
  return {
    definition: {
      id: `preview-${binding.worksheetFieldKey}`,
      templateVersionId: "preview",
      canonicalFieldKey: binding.canonicalFieldKey,
      worksheetFieldKey: binding.worksheetFieldKey,
      valueType: binding.valueType,
      participantOwned: binding.participantOwned,
      assistantMustNotSupply: binding.assistantMustNotSupply,
      confirmationRequired: binding.confirmationRequired,
      visualElementId: binding.visualElementId,
      displayOrder: binding.displayOrder,
      sourceSection: binding.sourceSection,
    },
    binding,
    value: {
      id: `preview-value-${binding.worksheetFieldKey}`,
      instanceId: "preview-instance",
      fieldDefinitionId: `preview-${binding.worksheetFieldKey}`,
      status,
      provenance: "participant_verbatim",
      value,
      displayValue,
      updatedAt: new Date().toISOString(),
    },
  };
}

function bindingByKey(bindings: WorksheetBinding[], worksheetFieldKey: string): WorksheetBinding {
  const binding = bindings.find((entry) => entry.worksheetFieldKey === worksheetFieldKey);
  if (!binding) throw new Error(`No preview binding for ${worksheetFieldKey}`);
  return binding;
}

function makeView(bindings: WorksheetBinding[], values: Record<string, unknown>, statuses: Record<string, WorksheetFieldStatus> = {}): WorksheetView {
  return {
    instance: { id: "preview-instance", runtimeSessionId: "preview-session", templateVersionId: "preview", status: "in_progress", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    templateVersion: { id: "preview", templateId: "preview", version: 1, sourceTextHash: "preview", status: "published", createdAt: new Date().toISOString() },
    fields: Object.entries(values).map(([worksheetFieldKey, value]) => makeField(bindingByKey(bindings, worksheetFieldKey), value, statuses[worksheetFieldKey])),
  };
}

const initialS02View = makeView(TBCT_S02_BINDINGS, {
  problems: ["집중이 안 돼요", "잠을 잘 못 자요", "사람들과 있으면 불안해요", "매사에 의욕이 없어요", "작은 일에도 화가 나요", "혼자 있으면 우울해요"],
  problemRatings: [0, 1, 2, 3, 4, 5],
  totalProblemScore: 15,
  goals: ["숙면 취하기", "사람들과 편하게 지내기", "집중력 회복하기", "화내지 않고 대화하기", "외출을 편하게 하기", "활력 되찾기"],
  goalRatings: [0, 1, 2, 3, 4, 5],
  totalGoalsScore: 15,
});

const initialS03View = makeView(TBCT_S03_BINDINGS, {
  situation: "친구가 문자에 답장을 하지 않았다",
  automaticThought: "내가 뭔가 잘못한 게 틀림없어",
  automaticThoughtBeliefPercent: 80,
  primaryEmotion: "불안",
  primaryEmotionIntensityPercent: 70,
  behavior: "문자를 여러 번 다시 확인했다",
  bodySensations: "가슴이 답답했다",
  participantSummary: "친구 문자에 답이 없어서 불안했고, 내가 뭔가 잘못했다고 생각했다.",
  behaviorPros: "빨리 확인해서 안심하고 싶었다",
  behaviorCons: "계속 확인하느라 다른 일에 집중하지 못했다",
  cognitiveDistortion: "성급한 결론 (마음 읽기)",
  evidenceFor: ["예전에도 답장이 늦은 적 있었다"],
  evidenceAgainst: ["친구가 바쁘다고 미리 말했었다", "평소에는 늘 답장을 잘 해줬다"],
  balancedConclusion: "친구가 바빠서 답장이 늦어지는 것일 수도 있다. 내 잘못이라고 단정할 근거는 부족하다.",
  conclusionBeliefPercent: 75,
  intendedActions: ["조금 더 기다려보기", "필요하면 먼저 안부 문자 보내기"],
  newBodySensations: "가슴 답답함이 줄어들었다",
  revisedAutomaticThoughtBeliefPercent: 30,
  globalEvaluation: "a little better",
});

function updateField(view: WorksheetView, worksheetFieldKey: string, patch: Partial<NonNullable<WorksheetFieldView["value"]>>): WorksheetView {
  return {
    ...view,
    fields: view.fields.map((field) =>
      field.binding.worksheetFieldKey === worksheetFieldKey && field.value
        ? { ...field, value: { ...field.value, ...patch } }
        : field,
    ),
  };
}

function ScaleLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-panel border border-border bg-surface p-3 text-sm">
      <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-text-muted">0-5 Color Scale</span>
      {[0, 1, 2, 3, 4, 5].map((score) => (
        <span key={score} className="inline-flex items-center gap-1.5">
          <ScoreChip score={score} />
        </span>
      ))}
    </div>
  );
}

export default function WorksheetPreviewPage() {
  const [s02View, setS02View] = useState(initialS02View);
  const [s03View, setS03View] = useState(initialS03View);
  const busy = false;

  const editS02 = (worksheetFieldKey: string, value: unknown) =>
    setS02View((view) => updateField(view, worksheetFieldKey, { value, displayValue: Array.isArray(value) ? value.map(String).join(", ") : String(value), status: "participant_edited" }));
  const confirmS02 = (worksheetFieldKey: string) => setS02View((view) => updateField(view, worksheetFieldKey, { status: "participant_confirmed", confirmedAt: new Date().toISOString() }));
  const editS03 = (worksheetFieldKey: string, value: unknown) =>
    setS03View((view) => updateField(view, worksheetFieldKey, { value, displayValue: Array.isArray(value) ? value.map(String).join(", ") : String(value), status: "participant_edited" }));
  const confirmS03 = (worksheetFieldKey: string) => setS03View((view) => updateField(view, worksheetFieldKey, { status: "participant_confirmed", confirmedAt: new Date().toISOString() }));

  return (
    <div className="mx-auto max-w-5xl space-y-8 p-4 sm:p-8">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold text-text-primary">Session 2 &amp; 3 Worksheet Visual Preview</h1>
        <p className="text-sm text-text-muted">
          Mock-data preview of the real S02Worksheet / S03Worksheet components (no runtime session, database, or login required).
          Edit/Confirm buttons work against local state so you can exercise the same interactions a live session drives.
        </p>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-text-secondary">Session 2 · Color-Coded Problem/Goal Hierarchy (CCPH/CCGH)</h2>
        <ScaleLegend />
        <S02Worksheet view={s02View} onConfirm={confirmS02} onEdit={editS02} busy={busy} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-text-secondary">Session 3 · Intra-TR</h2>
        <S03Worksheet view={s03View} onConfirm={confirmS03} onEdit={editS03} busy={busy} />
      </section>
    </div>
  );
}
