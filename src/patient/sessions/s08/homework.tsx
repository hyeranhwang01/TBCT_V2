"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PatientShell } from "@/components/runtime/patient-shell";
import { Badge, Button, Card, Field, inputClass, textareaClass } from "@/components/ui/primitives";
import { appendHomeworkEntry, listHomeworkEntries } from "@/lib/api/homework-api";
import { useT } from "@/lib/i18n/context";
import type { HomeworkRecord } from "@/types/homework";
import type { RuntimeSession } from "@/types/runtime-session";

interface AppealEntryData {
  [key: string]: unknown;
  date: string;
  chargeShowedUp: boolean;
  beliefBefore: number;
  evidence: string;
  whatEvidenceSays: string;
  beliefAfter: number;
}

// S8 -- "Appeal Record": the one session where the manual is explicit that
// continuing the record daily IS the homework ("the daily habit is what
// makes the change last", appealHomeworkAcknowledged). Evidence and its
// meaning must stay entirely participant-authored -- there is no AI call
// anywhere in this page, so nothing here can supply either for them.
export function AppealRecordHomework({ session, homework }: { session: RuntimeSession; homework: HomeworkRecord; label: string }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const fields = session.runtimeContext.fields;
  const charge = fields.charge ? String(fields.charge) : undefined;
  const baselineBelief = typeof fields.originalChargeFinalBeliefPercent === "number" ? fields.originalChargeFinalBeliefPercent : undefined;

  const appealsQuery = useQuery({ queryKey: ["homework-entries", homework.id, "appeal"], queryFn: () => listHomeworkEntries(homework.id, "appeal"), refetchInterval: 4000 });
  const appeals = (appealsQuery.data ?? []).map((entry) => entry.data as unknown as AppealEntryData);
  const latestBelief = appeals.length ? appeals[appeals.length - 1].beliefAfter : baselineBelief;

  const [chargeShowedUp, setChargeShowedUp] = useState<boolean | null>(null);
  const [beliefBefore, setBeliefBefore] = useState("");
  const [evidence, setEvidence] = useState("");
  const [whatEvidenceSays, setWhatEvidenceSays] = useState("");
  const [beliefAfter, setBeliefAfter] = useState("");

  const saveAppeal = useMutation({
    mutationFn: async () => {
      const data: AppealEntryData = { date: new Date().toISOString(), chargeShowedUp: Boolean(chargeShowedUp), beliefBefore: Number(beliefBefore), evidence, whatEvidenceSays, beliefAfter: Number(beliefAfter) };
      return appendHomeworkEntry(homework.id, "appeal", data);
    },
    onSuccess: () => {
      setChargeShowedUp(null); setBeliefBefore(""); setEvidence(""); setWhatEvidenceSays(""); setBeliefAfter("");
      queryClient.invalidateQueries({ queryKey: ["homework-entries", homework.id, "appeal"] });
    },
  });

  return (
    <PatientShell title={t("homework.s08.title")} progressLabel={t("homework.s08.eyebrow")}>
      <div className="space-y-5">
        <Card className="p-6">
          {charge && <div className="text-sm text-text-secondary">{t("homework.s08.theCharge")}</div>}
          {charge && <div className="mt-1 text-lg font-semibold text-text-primary">&ldquo;{charge}&rdquo;</div>}
          {latestBelief !== undefined && <div className="mt-2"><Badge tone="primary">{t("homework.s08.currentBelief")}: {latestBelief}%</Badge></div>}
        </Card>

        <Card className="p-6">
          <h2 className="text-lg font-semibold text-text-primary">{t("homework.s08.todaysAppeal")}</h2>
          <div className="mt-3">
            <div className="mb-1.5 text-xs font-semibold text-text-primary">{t("homework.s08.didItShowUp")}</div>
            <div className="flex gap-2">
              <Button size="sm" variant={chargeShowedUp === true ? "primary" : "secondary"} onClick={() => setChargeShowedUp(true)}>{t("common.yes")}</Button>
              <Button size="sm" variant={chargeShowedUp === false ? "primary" : "secondary"} onClick={() => setChargeShowedUp(false)}>{t("common.no")}</Button>
            </div>
          </div>
          <div className="mt-3">
            <Field label={t("homework.s08.beliefBefore")}><input className={inputClass} type="number" min={0} max={100} value={beliefBefore} onChange={(event) => setBeliefBefore(event.target.value)} /></Field>
          </div>
          <div className="mt-3"><Field label={t("homework.s08.evidenceNoticed")}><textarea className={textareaClass} value={evidence} onChange={(event) => setEvidence(event.target.value)} /></Field></div>
          <div className="mt-3"><Field label={t("homework.s08.whatEvidenceSays")}><textarea className={textareaClass} value={whatEvidenceSays} onChange={(event) => setWhatEvidenceSays(event.target.value)} /></Field></div>
          <div className="mt-3"><Field label={t("homework.s08.beliefAfter")}><input className={inputClass} type="number" min={0} max={100} value={beliefAfter} onChange={(event) => setBeliefAfter(event.target.value)} /></Field></div>
          <div className="mt-4">
            <Button disabled={chargeShowedUp === null || !beliefBefore || !beliefAfter} loading={saveAppeal.isPending} onClick={() => saveAppeal.mutate()}>{t("homework.s08.saveAppeal")}</Button>
          </div>
        </Card>

        {appeals.length > 0 && (
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-text-primary">{t("homework.s08.record")}</h2>
            <ul className="mt-3 space-y-2">
              {appeals.map((entry, index) => (
                <li key={index} className="flex items-center justify-between rounded-panel border border-border bg-surface-subtle p-3 text-sm">
                  <span className="text-text-secondary">{new Date(entry.date).toLocaleDateString()}</span>
                  <span className="font-medium text-text-primary">{entry.beliefBefore}% → {entry.beliefAfter}%</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </PatientShell>
  );
}
