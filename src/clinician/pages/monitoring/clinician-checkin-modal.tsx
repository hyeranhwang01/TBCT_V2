"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, Modal } from "@/components/ui/primitives";
import { submitStandardizedAssessment } from "@/lib/api/standardized-assessment-api";
import { INSTRUMENTS, responseOptionLabel } from "@/lib/standardized-assessments/instruments";
import { useT } from "@/lib/i18n/context";
import type { StandardizedInstrumentId } from "@/types/standardized-assessment";

interface ClinicianCheckinModalProps {
  open: boolean;
  onClose: () => void;
  participantId: string;
  participantAlias: string;
  assignedClinicianUserId?: string;
  participantLocale?: string;
}

/** Lets a clinician log a PHQ-9/GAD-7 check-in on a patient's behalf (e.g.
 * captured during a phone call or in-person visit, not through the app) --
 * the "체크인 추가" action on the profile tab's screening card. Mirrors
 * patient-checkin-page.tsx's item-by-item flow and safety-alert dispatch
 * exactly, just scoped to whichever participant this modal was opened for
 * instead of the signed-in patient. */
export function ClinicianCheckinModal({ open, onClose, participantId, participantAlias, assignedClinicianUserId, participantLocale }: ClinicianCheckinModalProps) {
  const { t, locale } = useT();
  const queryClient = useQueryClient();
  const [instrumentId, setInstrumentId] = useState<StandardizedInstrumentId | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);

  const startInstrument = (id: StandardizedInstrumentId) => {
    setInstrumentId(id);
    setAnswers(new Array(INSTRUMENTS[id].items.length).fill(-1));
  };

  const handleClose = () => {
    setInstrumentId(null);
    setAnswers([]);
    onClose();
  };

  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!instrumentId) throw new Error("No instrument selected");
      const result = await submitStandardizedAssessment(participantId, instrumentId, answers);
      if (result.selfHarmFlag) {
        void fetch("/api/notifications/safety-alert", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            participantId,
            participantAlias,
            severity: "high",
            triggerSummary: `PHQ-9 check-in flagged self-harm ideation (item score ${answers[INSTRUMENTS.phq9.selfHarmItemIndex!]})`,
            assignedClinicianUserId,
            locale: participantLocale,
          }),
        }).catch((error) => console.error("[clinician-checkin] failed to dispatch safety alert", error));
      }
      return result;
    },
    onSuccess: async () => {
      toast.success(t("patientCheckin.submitted"));
      handleClose();
      await queryClient.invalidateQueries({ queryKey: ["standardized-assessments", participantId] });
    },
    onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : t("patientCheckin.submitFailed"));
    },
  });

  if (instrumentId) {
    const definition = INSTRUMENTS[instrumentId];
    const allAnswered = answers.every((value) => value >= 0);
    return (
      <Modal open={open} onClose={handleClose} title={locale === "ko" ? definition.nameKo : definition.nameEn}>
        <div className="space-y-4 p-5">
          <div className="text-sm text-text-secondary">{locale === "ko" ? definition.instructionKo : definition.instructionEn}</div>
          <div className="space-y-4">
            {definition.items.map((item, index) => (
              <div key={index} className="border-b border-border pb-3 last:border-0">
                <div className="text-sm text-text-primary">{index + 1}. {locale === "ko" ? item.textKo : item.textEn}</div>
                <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[0, 1, 2, 3].map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setAnswers((prev) => prev.map((existing, i) => (i === index ? value : existing)))}
                      className={`rounded-panel border px-2 py-2 text-xs transition ${
                        answers[index] === value ? "border-clinical-blue bg-clinical-blue-light text-clinical-blue" : "border-border text-text-secondary hover:bg-surface-hover"
                      }`}
                    >
                      {responseOptionLabel(value, locale)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => { setInstrumentId(null); setAnswers([]); }}>{t("common.cancel")}</Button>
            <Button loading={submitMutation.isPending} disabled={!allAnswered} onClick={() => submitMutation.mutate()}>{t("patientCheckin.submit")}</Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open={open} onClose={handleClose} title={t("patientDetail.assessments.addCheckin")} description={t("patientDetail.assessments.selectInstrument")}>
      <div className="grid gap-3 p-5 sm:grid-cols-2">
        {Object.values(INSTRUMENTS).map((definition) => (
          <button
            key={definition.id}
            type="button"
            onClick={() => startInstrument(definition.id)}
            className="rounded-panel border border-border p-4 text-left transition hover:border-clinical-blue hover:bg-clinical-blue-light/40"
          >
            <div className="text-sm font-semibold text-text-primary">{locale === "ko" ? definition.nameKo : definition.nameEn}</div>
            <div className="mt-1 text-xs text-text-secondary">{locale === "ko" ? definition.instructionKo : definition.instructionEn}</div>
          </button>
        ))}
      </div>
    </Modal>
  );
}
