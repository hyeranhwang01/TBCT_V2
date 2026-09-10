"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PatientShell } from "@/components/runtime/patient-shell";
import { Badge, Button, Card, EmptyState, Field, inputClass, textareaClass } from "@/components/ui/primitives";
import { appendHomeworkEntry, listHomeworkEntries } from "@/lib/api/homework-api";
import { COGNITIVE_DISTORTIONS } from "@/lib/homework/cognitive-distortions-list";
import { useT } from "@/lib/i18n/context";
import type { HomeworkRecord } from "@/types/homework";
import type { RuntimeSession } from "@/types/runtime-session";

interface ExampleEntryData {
  [key: string]: unknown;
  date: string;
  situation: string;
  thought: string;
  distortionName: string;
  note?: string;
}

// S1 -- "Weekly Examples": an ongoing log the participant adds to between
// sessions. The proposal's key rule: the app must never pick the
// distortion for them -- each new example asks them to choose from the
// same Session 1 reference list themselves (see cognitive-distortions-list.ts).
export function WeeklyExamplesHomework({ homework }: { session: RuntimeSession; homework: HomeworkRecord; label: string }) {
  const { t } = useT();
  const queryClient = useQueryClient();
  const entriesQuery = useQuery({ queryKey: ["homework-entries", homework.id, "example"], queryFn: () => listHomeworkEntries(homework.id, "example"), refetchInterval: 4000 });
  const entries = entriesQuery.data ?? [];

  const [situation, setSituation] = useState("");
  const [thought, setThought] = useState("");
  const [distortionName, setDistortionName] = useState("");
  const [note, setNote] = useState("");

  const addExample = useMutation({
    mutationFn: async () => {
      const data: ExampleEntryData = { date: new Date().toISOString(), situation, thought, distortionName, note: note || undefined };
      return appendHomeworkEntry(homework.id, "example", data);
    },
    onSuccess: () => {
      setSituation("");
      setThought("");
      setDistortionName("");
      setNote("");
      queryClient.invalidateQueries({ queryKey: ["homework-entries", homework.id, "example"] });
    },
  });

  const entriesByDistortion = new Map<string, ExampleEntryData[]>();
  for (const entry of entries) {
    const data = entry.data as unknown as ExampleEntryData;
    const list = entriesByDistortion.get(data.distortionName) ?? [];
    list.push(data);
    entriesByDistortion.set(data.distortionName, list);
  }

  return (
    <PatientShell title={t("homework.s01.title")} progressLabel={t("homework.s01.eyebrow")}>
      <div className="space-y-5">
        <Card className="p-6">
          <h2 className="text-lg font-semibold text-text-primary">{t("homework.s01.addTitle")}</h2>
          <p className="mt-1 text-sm text-text-secondary">{t("homework.s01.addDescription")}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label={t("homework.s01.situationLabel")}>
              <input className={inputClass} value={situation} onChange={(event) => setSituation(event.target.value)} placeholder={t("homework.s01.situationPlaceholder")} />
            </Field>
            <Field label={t("homework.s01.thoughtLabel")}>
              <input className={inputClass} value={thought} onChange={(event) => setThought(event.target.value)} placeholder={t("homework.s01.thoughtPlaceholder")} />
            </Field>
          </div>
          <div className="mt-3">
            <Field label={t("homework.s01.distortionQuestion")} hint={t("homework.s01.distortionHint")}>
              <select className={inputClass} value={distortionName} onChange={(event) => setDistortionName(event.target.value)}>
                <option value="">{t("homework.s01.distortionPlaceholder")}</option>
                {COGNITIVE_DISTORTIONS.map((distortion) => <option key={distortion.id} value={distortion.name}>{distortion.name}</option>)}
              </select>
            </Field>
          </div>
          <div className="mt-3">
            <Field label={t("homework.s01.noteLabel")}>
              <textarea className={textareaClass} value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("homework.s01.notePlaceholder")} />
            </Field>
          </div>
          <div className="mt-4">
            <Button onClick={() => addExample.mutate()} disabled={!situation || !thought || !distortionName} loading={addExample.isPending}>{t("homework.s01.addExample")}</Button>
          </div>
        </Card>

        <div>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.08em] text-text-secondary">{t("homework.s01.thisWeek")}</h2>
          {COGNITIVE_DISTORTIONS.map((distortion) => {
            const examples = entriesByDistortion.get(distortion.name) ?? [];
            return (
              <Card key={distortion.id} className="mb-3 p-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-text-primary">{distortion.name}</div>
                  <Badge tone={examples.length ? "primary" : "neutral"}>{examples.length}</Badge>
                </div>
                {examples.length === 0 ? (
                  <p className="mt-2 text-sm text-text-muted">{t("homework.s01.noExamples")}</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {examples.map((example, index) => (
                      <li key={index} className="rounded-panel border border-border bg-surface-subtle p-3 text-sm">
                        <div className="text-text-primary">&ldquo;{example.thought}&rdquo;</div>
                        <div className="mt-1 text-xs text-text-secondary">{example.situation}</div>
                        {example.note && <div className="mt-1 text-xs text-text-muted">{example.note}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            );
          })}
          {entries.length === 0 && !entriesQuery.isLoading && <EmptyState title={t("homework.s01.emptyState")} description="" />}
        </div>
      </div>
    </PatientShell>
  );
}
