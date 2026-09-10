"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { PatientShell } from "@/components/runtime/patient-shell";
import { Badge, Button, Card, Field, textareaClass } from "@/components/ui/primitives";
import { updateHomeworkRecord } from "@/lib/api/homework-api";
import { useT } from "@/lib/i18n/context";
import type { HomeworkRecord } from "@/types/homework";
import type { RuntimeSession } from "@/types/runtime-session";

// S5 -- "Review Grid": like S3, the manual specifies keep/share the
// finished Participation Grid, not a fresh re-allocation as homework. This
// page never re-opens the percentage split for editing.
export function ReviewGridHomework({ session, homework }: { session: RuntimeSession; homework: HomeworkRecord; label: string }) {
  const { t } = useT();
  const fields = session.runtimeContext.fields;
  const contributors = Array.isArray(fields.contributors) ? (fields.contributors as string[]) : [];
  const firstRound = Array.isArray(fields.participationRatingsRound1) ? (fields.participationRatingsRound1 as number[]) : [];
  const participantFirstRound = typeof fields.participantParticipationRound1 === "number" ? fields.participantParticipationRound1 : undefined;
  const valuesArticulated = Array.isArray(fields.valuesArticulated) ? (fields.valuesArticulated as string[]) : [];

  const [note, setNote] = useState(String(homework.data.note ?? ""));
  const [discuss, setDiscuss] = useState(Boolean(homework.data.discussWithTherapist));

  const save = useMutation({
    mutationFn: () => updateHomeworkRecord(homework.id, { status: "review_available", data: { ...homework.data, note, discussWithTherapist: discuss } }),
  });

  return (
    <PatientShell title={t("homework.s05.title")} progressLabel={t("homework.s05.eyebrow")}>
      <div className="space-y-5">
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-text-primary">{t("homework.s05.myGrid")}</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-[0.06em] text-text-secondary">
                  <th className="py-2 pr-4">{t("homework.s05.contributor")}</th>
                  <th className="py-2">{t("homework.s05.round1")}</th>
                </tr>
              </thead>
              <tbody>
                {contributors.map((contributor, index) => (
                  <tr key={contributor} className="border-b border-border">
                    <td className="py-2 pr-4 text-text-primary">{contributor}</td>
                    <td className="py-2 text-text-secondary">{firstRound[index] ?? "—"}%</td>
                  </tr>
                ))}
                {participantFirstRound !== undefined && (
                  <tr>
                    <td className="py-2 pr-4 font-medium text-text-primary">{t("homework.s05.myself")}</td>
                    <td className="py-2 text-text-secondary">{participantFirstRound}%</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            {fields.guiltBeliefBaseline !== undefined && fields.guiltBeliefFinal !== undefined && (
              <Badge tone="primary">{t("homework.s05.guilt")}: {String(fields.guiltBeliefBaseline)}% → {String(fields.guiltBeliefFinal)}%</Badge>
            )}
            {fields.shameIntensityBaseline !== undefined && fields.shameIntensityFinal !== undefined && (
              <Badge tone="neutral">{t("homework.s05.shame")}: {String(fields.shameIntensityBaseline)}% → {String(fields.shameIntensityFinal)}%</Badge>
            )}
          </div>
          {valuesArticulated.length > 0 && (
            <div className="mt-4">
              <div className="text-xs font-semibold uppercase tracking-[0.06em] text-text-secondary">{t("homework.s05.values")}</div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">{valuesArticulated.map((value, index) => <Badge key={index} tone="neutral">{value}</Badge>)}</div>
            </div>
          )}
        </Card>

        <Card className="p-6">
          <label className="flex items-center gap-2 text-sm text-text-primary">
            <input type="checkbox" checked={discuss} onChange={(event) => setDiscuss(event.target.checked)} />
            {t("homework.s05.markForDiscussion")}
          </label>
          <div className="mt-3">
            <Field label={t("homework.s05.rememberLabel")}>
              <textarea className={textareaClass} value={note} onChange={(event) => setNote(event.target.value)} />
            </Field>
          </div>
          <div className="mt-4"><Button onClick={() => save.mutate()} loading={save.isPending}>{t("homework.s05.save")}</Button></div>
        </Card>
      </div>
    </PatientShell>
  );
}
