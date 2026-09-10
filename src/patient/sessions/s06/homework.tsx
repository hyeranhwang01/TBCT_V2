"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PatientShell } from "@/components/runtime/patient-shell";
import { Badge, Button, Card, Field, inputClass, textareaClass } from "@/components/ui/primitives";
import { appendHomeworkEntry, listHomeworkEntries } from "@/lib/api/homework-api";
import { useT } from "@/lib/i18n/context";
import type { HomeworkRecord } from "@/types/homework";
import type { RuntimeSession } from "@/types/runtime-session";

const SCALE_COLORS = ["light-blue", "blue", "green", "green", "yellow", "red"] as const;

interface TryEntryData {
  [key: string]: unknown;
  date: string;
  itemLabel: string;
  before?: number;
  after?: number;
  whatIDid: string;
  safetyBehaviorsNoticed: string[];
  whatLearned?: string;
}

// S6 -- "This Week's Practice": the single most explicit, and most
// safety-locked, homework in the manual. Green (2-3) items only; yellow/red
// (4-5) are NEVER selectable here, not just discouraged by a note -- the
// "Start practice" control itself is disabled for them, matching
// TBCT-S06-NO-YELLOW-RED-HOMEWORK, which the runtime already enforces
// during the session itself (see dialogue-agent-orchestrator.ts's
// isSafetyCriticalPrompt neighbors and block-independent-homework in the
// source catalog). This page only ever offers a "Try" log for items already
// in the participant-chosen greenHomeworkItems list.
export function PracticeHomework({ session, homework }: { session: RuntimeSession; homework: HomeworkRecord; label: string }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const fields = session.runtimeContext.fields;
  const symptomItems = Array.isArray(fields.symptomItems) ? (fields.symptomItems as string[]) : [];
  const symptomItemScores = Array.isArray(fields.symptomItemScores) ? (fields.symptomItemScores as number[]) : [];
  const greenHomeworkItems = new Set(Array.isArray(fields.greenHomeworkItems) ? (fields.greenHomeworkItems as string[]) : []);
  const safetyBehaviors = Array.isArray(fields.safetyBehaviors) ? (fields.safetyBehaviors as string[]) : [];
  const accountabilityPartner = fields.accountabilityPartner ? String(fields.accountabilityPartner) : undefined;
  const fallbackPlan = fields.fallbackPlan ? String(fields.fallbackPlan) : undefined;

  const [activeItem, setActiveItem] = useState<string | null>(null);
  const [before, setBefore] = useState("");
  const [after, setAfter] = useState("");
  const [whatIDid, setWhatIDid] = useState("");
  const [noticedBehaviors, setNoticedBehaviors] = useState<string[]>([]);
  const [whatLearned, setWhatLearned] = useState("");

  const triesQuery = useQuery({ queryKey: ["homework-entries", homework.id, "try"], queryFn: () => listHomeworkEntries(homework.id, "try"), refetchInterval: 4000 });
  const tries = (triesQuery.data ?? []).map((entry) => entry.data as unknown as TryEntryData);

  const addTry = useMutation({
    mutationFn: async () => {
      const data: TryEntryData = {
        date: new Date().toISOString(), itemLabel: activeItem!, before: before ? Number(before) : undefined, after: after ? Number(after) : undefined,
        whatIDid, safetyBehaviorsNoticed: noticedBehaviors, whatLearned: whatLearned || undefined,
      };
      return appendHomeworkEntry(homework.id, "try", data);
    },
    onSuccess: () => {
      setBefore(""); setAfter(""); setWhatIDid(""); setNoticedBehaviors([]); setWhatLearned("");
      queryClient.invalidateQueries({ queryKey: ["homework-entries", homework.id, "try"] });
    },
  });

  return (
    <PatientShell title={t("homework.s06.title")} progressLabel={t("homework.s06.eyebrow")}>
      <div className="space-y-5">
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-text-primary">{t("homework.s06.thisWeek")}</h2>
          <div className="mt-4 space-y-2.5">
            {symptomItems.map((item, index) => {
              const score = symptomItemScores[index];
              const isGreen = greenHomeworkItems.has(item);
              const color = score !== undefined ? SCALE_COLORS[score] : undefined;
              return (
                <div key={item} className="flex flex-col gap-2 rounded-panel border border-border bg-surface-subtle p-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${color === "green" ? "bg-success" : color === "yellow" ? "bg-warning" : color === "red" ? "bg-critical" : "bg-clinical-blue-light"}`} />
                    <span className="text-sm text-text-primary">{item}</span>
                    {score !== undefined && <Badge tone="neutral">{score}</Badge>}
                  </div>
                  <Button
                    size="sm"
                    variant={isGreen ? "primary" : "secondary"}
                    disabled={!isGreen}
                    onClick={() => setActiveItem(item)}
                  >
                    {isGreen ? t("homework.s06.startPractice") : t("homework.s06.bringToTherapist")}
                  </Button>
                </div>
              );
            })}
          </div>
          {(accountabilityPartner || fallbackPlan) && (
            <div className="mt-4 flex flex-wrap gap-3 text-xs text-text-secondary">
              {accountabilityPartner && <span>{t("homework.s06.accountabilityPartner")}: {accountabilityPartner}</span>}
              {fallbackPlan && <span>{t("homework.s06.fallbackPlan")}: {fallbackPlan}</span>}
            </div>
          )}
        </Card>

        {/* Always visible, never conditionally hidden. */}
        <div className="rounded-panel border border-warning-light bg-warning-light/40 p-4 text-sm text-warning">{t("homework.s06.safetyNote")}</div>

        {activeItem && (
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-text-primary">{t("homework.s06.tryTitle", { item: activeItem })}</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label={t("homework.s06.before")}><input className={inputClass} type="number" min={0} max={5} value={before} onChange={(event) => setBefore(event.target.value)} /></Field>
              <Field label={t("homework.s06.after")}><input className={inputClass} type="number" min={0} max={5} value={after} onChange={(event) => setAfter(event.target.value)} /></Field>
            </div>
            <div className="mt-3"><Field label={t("homework.s06.whatIDid")}><textarea className={textareaClass} value={whatIDid} onChange={(event) => setWhatIDid(event.target.value)} /></Field></div>
            {safetyBehaviors.length > 0 && (
              <div className="mt-3">
                <div className="mb-1.5 text-xs font-semibold text-text-primary">{t("homework.s06.didINotice")}</div>
                <div className="space-y-1.5">
                  {safetyBehaviors.map((behavior) => (
                    <label key={behavior} className="flex items-center gap-2 text-sm text-text-secondary">
                      <input
                        type="checkbox"
                        checked={noticedBehaviors.includes(behavior)}
                        onChange={(event) => setNoticedBehaviors((prev) => (event.target.checked ? [...prev, behavior] : prev.filter((item) => item !== behavior)))}
                      />
                      {behavior}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="mt-3"><Field label={t("homework.s06.whatLearned")}><textarea className={textareaClass} value={whatLearned} onChange={(event) => setWhatLearned(event.target.value)} /></Field></div>
            <div className="mt-4 flex gap-2">
              <Button disabled={!whatIDid} loading={addTry.isPending} onClick={() => addTry.mutate()}>{t("homework.s06.saveTry")}</Button>
              <Button variant="secondary" onClick={() => setActiveItem(null)}>{t("common.cancel")}</Button>
            </div>
          </Card>
        )}

        {tries.length > 0 && (
          <Card className="p-6">
            <h2 className="text-lg font-semibold text-text-primary">{t("homework.s06.history")}</h2>
            <ul className="mt-3 space-y-2">
              {tries.map((entry, index) => (
                <li key={index} className="rounded-panel border border-border bg-surface-subtle p-3 text-sm">
                  <div className="font-medium text-text-primary">{entry.itemLabel} · {new Date(entry.date).toLocaleDateString()}</div>
                  {entry.before !== undefined && entry.after !== undefined && <div className="text-text-secondary">{entry.before} → {entry.after}</div>}
                  <div className="mt-1 text-text-secondary">{entry.whatIDid}</div>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </PatientShell>
  );
}
