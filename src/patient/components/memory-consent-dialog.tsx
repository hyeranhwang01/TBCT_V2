"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button, Modal } from "@/shared/components/ui/primitives";
import { recordParticipantMemoryConsent } from "@/shared/api/participant-api";
import { useT } from "@/shared/i18n/context";
import type { MemoryConsentDecision, MemoryConsentSource, RuntimeParticipant } from "@/types/longitudinal-memory";

/**
 * The memory-consent popup (src/shared/memory/memory-consent.ts). `required`:
 * shown by PatientShell until the participant answers -- no close button, no
 * backdrop close. Otherwise it is the same text opened from the profile to
 * change an earlier answer. The two answers are styled alike on purpose: the
 * layout should not lean toward either.
 */
export function MemoryConsentDialog({
  participant,
  open,
  required,
  onClose,
}: {
  participant: RuntimeParticipant;
  open: boolean;
  required: boolean;
  onClose?: () => void;
}) {
  const { t, locale } = useT();
  const queryClient = useQueryClient();
  const source: MemoryConsentSource = required ? "first_visit_dialog" : "profile";
  const mutation = useMutation({
    mutationFn: (decision: MemoryConsentDecision) => recordParticipantMemoryConsent(participant.id, { decision, source, locale }),
    onSuccess: async () => {
      toast.success(t("memoryConsent.saved"));
      await queryClient.invalidateQueries({ queryKey: ["runtime-participant"] });
      onClose?.();
    },
    onError: () => {
      toast.error(t("memoryConsent.saveFailed"));
    },
  });
  const choosing = mutation.isPending ? mutation.variables : undefined;

  return (
    <Modal open={open} onClose={() => onClose?.()} dismissible={!required} title={t("memoryConsent.title")} width="max-w-2xl">
      <div className="space-y-4 p-5 text-sm leading-6 text-text-secondary">
        <p>{t("memoryConsent.intro")}</p>
        <p className="font-semibold text-text-primary">{t("memoryConsent.question")}</p>
        <section className="rounded-panel border border-border bg-surface-subtle p-3">
          <h3 className="font-semibold text-text-primary">{t("memoryConsent.always.title")}</h3>
          <ul className="mt-1 list-disc pl-5">
            <li>{t("memoryConsent.always.problemsAndGoal")}</li>
            <li>{t("memoryConsent.always.homework")}</li>
          </ul>
          <p className="mt-1 text-xs">{t("memoryConsent.always.note")}</p>
        </section>
        <div className="grid gap-3 sm:grid-cols-2">
          <section className="rounded-panel border border-border p-3">
            <h3 className="font-semibold text-text-primary">{t("memoryConsent.grant.title")}</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>{t("memoryConsent.grant.use")}</li>
              <li>{t("memoryConsent.grant.transfer")}</li>
            </ul>
          </section>
          <section className="rounded-panel border border-border p-3">
            <h3 className="font-semibold text-text-primary">{t("memoryConsent.decline.title")}</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5">
              <li>{t("memoryConsent.decline.internal")}</li>
              <li>{t("memoryConsent.decline.quality")}</li>
              <li>{t("memoryConsent.decline.noPenalty")}</li>
            </ul>
          </section>
        </div>
        <p className="text-xs">{t("memoryConsent.changeLater")}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button variant="secondary" loading={choosing === "granted"} disabled={mutation.isPending} onClick={() => mutation.mutate("granted")}>
            {t("memoryConsent.grantButton")}
          </Button>
          <Button variant="secondary" loading={choosing === "declined"} disabled={mutation.isPending} onClick={() => mutation.mutate("declined")}>
            {t("memoryConsent.declineButton")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
