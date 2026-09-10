"use client";

import { Languages } from "lucide-react";
import { useT } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

/**
 * Compact ko <-> en toggle for this app's own UI chrome text (buttons,
 * labels, page structure). This used to be a UI-only preference, entirely
 * separate from the actual therapy session content's language
 * (participant.locale / session.locale) -- changing it never touched an
 * in-progress session's language at all, which is exactly the "language
 * setting" vs. "website language setting" confusion the optional onChange
 * below exists to fix: patient-shell.tsx passes one that also persists
 * participant.locale and propagates it to every open session (see
 * patient-locale-sync.ts). Callers that don't pass onChange (there are
 * none left in the patient shell, but the prop stays optional for any
 * future non-patient use) still just get the plain UI-only toggle. The
 * clinician sidebar (app-shell.tsx) already has its own full KO/EN pill
 * with room to spare; this smaller single-button version is for chrome
 * that doesn't have that room, e.g. the patient header.
 */
export function LocaleToggle({ className, onChange }: { className?: string; onChange?: (next: "ko" | "en") => void }) {
  const { locale, setLocale } = useT();
  const next = locale === "ko" ? "en" : "ko";

  return (
    <button
      type="button"
      onClick={() => {
        setLocale(next);
        onChange?.(next);
      }}
      aria-label={`Language: ${locale.toUpperCase()} (click for ${next.toUpperCase()})`}
      title={`Language: ${locale.toUpperCase()}`}
      className={cn(
        "flex h-9 items-center justify-center gap-1.5 rounded-panel border border-border bg-surface px-2.5 text-xs font-semibold text-text-secondary transition hover:bg-surface-hover",
        className,
      )}
    >
      <Languages className="h-4 w-4" />
      {locale.toUpperCase()}
    </button>
  );
}
