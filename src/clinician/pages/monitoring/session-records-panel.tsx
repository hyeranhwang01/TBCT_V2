"use client";

import { useT } from "@/shared/i18n/context";

/** Downloads of the participant's sealed session records (sql/034) through
 * /api/session-records/export, which logs every download first.
 * note2026_09_28_rct_backend. */
export function SessionRecordsPanel({ participantId }: { participantId: string }) {
  const { t } = useT();
  const href = (format: "json" | "csv", attempts: "all" | "official") => `/api/session-records/export?participantId=${encodeURIComponent(participantId)}&format=${format}&attempts=${attempts}`;
  const link = "rounded-md border border-border px-2 py-1 text-xs text-text-primary hover:bg-surface-hover";
  return (
    <div className="space-y-2 rounded-panel border border-border p-3 text-sm">
      <div className="font-semibold text-text-primary">{t("trial.detail.records")}</div>
      <div className="text-xs text-text-secondary">{t("trial.detail.recordsHint")}</div>
      <div className="flex flex-wrap gap-2">
        <a className={link} href={href("json", "all")}>{t("trial.detail.exportJsonAll")}</a>
        <a className={link} href={href("csv", "all")}>{t("trial.detail.exportCsvAll")}</a>
        <a className={link} href={href("csv", "official")}>{t("trial.detail.exportCsvOfficial")}</a>
      </div>
    </div>
  );
}
