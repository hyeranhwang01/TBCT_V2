"use client";

import { useState } from "react";
import { Button } from "@/shared/components/ui/primitives";
import { MemoryConsentDialog } from "@/patient/components/memory-consent-dialog";
import { memoryConsentStatus } from "@/shared/memory/memory-consent";
import { useT } from "@/shared/i18n/context";
import type { RuntimeParticipant } from "@/types/longitudinal-memory";

/** The profile's memory-consent row: the current answer, and the popup's own
 * text to change it. Replaces the three memory checkboxes that saved on
 * every profile save without a trial record. */
export function MemoryConsentSettings({ participant }: { participant: RuntimeParticipant }) {
  const { t, locale } = useT();
  const [open, setOpen] = useState(false);
  const status = memoryConsentStatus(participant);
  const date = participant.memoryConsent ? new Date(participant.memoryConsent.decidedAt).toLocaleDateString(locale === "ko" ? "ko-KR" : "en-US") : "";
  const label = status === "undecided" ? t("memoryConsent.settings.undecided") : t(`memoryConsent.settings.${status}`, { date });
  return (
    <div>
      <div className="mb-2 text-sm font-semibold text-text-primary">{t("memoryConsent.settings.title")}</div>
      <div className="flex items-center justify-between gap-3 rounded-panel border border-border bg-surface-subtle p-3 text-sm text-text-secondary">
        <span>{label}</span>
        <Button variant="secondary" onClick={() => setOpen(true)}>{t("memoryConsent.settings.change")}</Button>
      </div>
      <MemoryConsentDialog participant={participant} open={open} required={false} onClose={() => setOpen(false)} />
    </div>
  );
}
