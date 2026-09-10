"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { PatientShell } from "@/components/runtime/patient-shell";
import { Badge, Button, Card, Field, textareaClass } from "@/components/ui/primitives";
import { updateHomeworkRecord } from "@/lib/api/homework-api";
import { useT } from "@/lib/i18n/context";
import type { HomeworkRecord } from "@/types/homework";
import type { RuntimeSession } from "@/types/runtime-session";

// S3 -- "Review Intra-TR": the manual specifies no new behavioral homework
// here, only storing and sharing the completed record with the therapist
// next time (the proposal is explicit that requiring a new Intra-TR daily
// would go beyond the source). So this page never asks for a new answer to
// any protocol field -- only a discuss-flag and a free-text note, both
// homework-specific, not canonical clinical fields.
export function ReviewIntraTrHomework({ session, homework }: { session: RuntimeSession; homework: HomeworkRecord; label: string }) {
  const { t } = useT();
  const fields = session.runtimeContext.fields;
  const [discuss, setDiscuss] = useState(Boolean(homework.data.discussWithTherapist));
  const [note, setNote] = useState(String(homework.data.note ?? ""));

  const save = useMutation({
    mutationFn: () => updateHomeworkRecord(homework.id, { status: "review_available", data: { ...homework.data, discussWithTherapist: discuss, note } }),
  });

  return (
    <PatientShell title={t("homework.s03.title")} progressLabel={t("homework.s03.eyebrow")}>
      <div className="space-y-5">
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-text-primary">{t("homework.s03.myIntraTr")}</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <ReadOnlyField label={t("homework.s03.situation")} value={String(fields.situation ?? "—")} />
            <ReadOnlyField label={t("homework.s03.automaticThought")} value={String(fields.automaticThought ?? "—")} />
            <ReadOnlyField label={t("homework.s03.emotion")} value={String(fields.primaryEmotion ?? "—")} />
            <ReadOnlyField label={t("homework.s03.behavior")} value={String(fields.behavior ?? "—")} />
          </div>
          <div className="mt-3">
            <ReadOnlyField label={t("homework.s03.balancedConclusion")} value={String(fields.balancedConclusion ?? "—")} />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {fields.conclusionBeliefPercent !== undefined && <Badge tone="primary">{t("homework.s03.beliefNow")}: {String(fields.conclusionBeliefPercent)}%</Badge>}
            {fields.globalEvaluation !== undefined && <Badge tone="neutral">{String(fields.globalEvaluation)}</Badge>}
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="text-lg font-semibold text-text-primary">{t("homework.s03.forNextTime")}</h2>
          <label className="mt-3 flex items-center gap-2 text-sm text-text-primary">
            <input type="checkbox" checked={discuss} onChange={(event) => setDiscuss(event.target.checked)} />
            {t("homework.s03.markForDiscussion")}
          </label>
          <div className="mt-3">
            <Field label={t("homework.s03.noteLabel")}>
              <textarea className={textareaClass} value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("homework.s03.notePlaceholder")} />
            </Field>
          </div>
          <div className="mt-4"><Button onClick={() => save.mutate()} loading={save.isPending}>{t("homework.s03.save")}</Button></div>
        </Card>
      </div>
    </PatientShell>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-[0.06em] text-text-secondary">{label}</div>
      <div className="mt-1 rounded-panel border border-border bg-surface-subtle p-3 text-sm text-text-primary">{value}</div>
    </div>
  );
}
