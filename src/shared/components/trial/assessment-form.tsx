"use client";

import { useState } from "react";
import { Button, Field, inputClass, textareaClass } from "@/shared/components/ui/primitives";
import { instrumentByCode } from "@/shared/trial/instruments";
import { useT } from "@/shared/i18n/context";

/**
 * Answers for one assessment task (sql/038): one control per item, in the
 * instrument's range. Item wording is shown where the app has it (PHQ-9,
 * GAD-7, PHQ-2 + item 9); otherwise items are numbered to match the validated
 * paper version the research team uses (instruments.ts licence notes).
 * SCID-5-CV records the diagnoses only. Scoring happens on the server.
 */
export function AssessmentForm({ instrumentCode, submitting, onSubmit }: { instrumentCode: string; submitting: boolean; onSubmit: (items: unknown[]) => void }) {
  const { t, locale } = useT();
  const instrument = instrumentByCode(instrumentCode);
  const [values, setValues] = useState<string[]>(() => Array.from({ length: instrument?.itemCount ?? 0 }, () => ""));
  const [diagnoses, setDiagnoses] = useState("");
  if (!instrument) return <p className="text-sm text-critical">{t("trial.assessment.unknown", { code: instrumentCode })}</p>;

  if (instrument.code === "SCID5CV") {
    return (
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); onSubmit([{ diagnoses: diagnoses.split(",").map((item) => item.trim()).filter(Boolean) }]); }}>
        <Field label={t("trial.assessment.diagnoses")} hint={t("trial.assessment.diagnosesHint")}>
          <textarea className={textareaClass} value={diagnoses} onChange={(event) => setDiagnoses(event.target.value)} />
        </Field>
        <Button type="submit" loading={submitting} disabled={!diagnoses.trim()}>{t("trial.assessment.submit")}</Button>
      </form>
    );
  }

  const wording = instrument.items ? (locale.startsWith("ko") ? instrument.items.ko : instrument.items.en) : undefined;
  const bounded = instrument.responseMin !== null && instrument.responseMax !== null;
  const options = bounded && instrument.responseMax! - instrument.responseMin! <= 10
    ? Array.from({ length: instrument.responseMax! - instrument.responseMin! + 1 }, (_, index) => instrument.responseMin! + index)
    : null;
  const complete = values.every((value) => value.trim() !== "");
  return (
    <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); onSubmit(values.map((value) => Number(value))); }}>
      {!wording && <p className="text-xs text-text-secondary">{t("trial.assessment.numberedItems")}</p>}
      <div className="max-h-[55vh] space-y-2 overflow-auto pr-1">
        {values.map((value, index) => (
          <div key={index} className="grid gap-1 rounded-panel border border-border p-2 text-sm sm:grid-cols-[1fr_auto] sm:items-center">
            <span className="text-text-primary">{index + 1}. {wording?.[index] ?? t("trial.assessment.item", { n: index + 1 })}</span>
            {options ? (
              <div className="flex flex-wrap gap-1">
                {options.map((option) => (
                  <label key={option} className={`cursor-pointer rounded-md border px-2 py-1 text-xs ${value === String(option) ? "border-clinical-blue bg-clinical-blue-light font-semibold" : "border-border"}`}>
                    <input type="radio" className="sr-only" name={`item-${index}`} value={option} checked={value === String(option)} onChange={() => setValues((current) => current.map((item, position) => (position === index ? String(option) : item)))} />
                    {option}
                  </label>
                ))}
              </div>
            ) : (
              <input className={`${inputClass} w-28`} inputMode="decimal" value={value} onChange={(event) => setValues((current) => current.map((item, position) => (position === index ? event.target.value : item)))} />
            )}
          </div>
        ))}
      </div>
      {options && <p className="text-[11px] text-text-secondary">{t("trial.assessment.range", { min: instrument.responseMin!, max: instrument.responseMax! })}</p>}
      <Button type="submit" loading={submitting} disabled={!complete}>{t("trial.assessment.submit")}</Button>
    </form>
  );
}
