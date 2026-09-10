"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useThemePreference, type ThemePreference } from "@/lib/theme/use-theme-preference";
import { cn } from "@/lib/utils";

const ORDER: ThemePreference[] = ["system", "light", "dark"];
const ICONS: Record<ThemePreference, typeof Sun> = { system: Monitor, light: Sun, dark: Moon };

/** Cycles system -> light -> dark -> system. A single icon button rather
 * than a 3-way segmented control to keep this small enough to drop into
 * either header (app-shell.tsx for clinicians, patient-shell.tsx for
 * patients) without competing for space with the rest of the toolbar. */
export function ThemeToggle({ className }: { className?: string }) {
  const { preference, setPreference } = useThemePreference();
  const Icon = ICONS[preference];
  const next = ORDER[(ORDER.indexOf(preference) + 1) % ORDER.length];

  return (
    <button
      type="button"
      onClick={() => setPreference(next)}
      aria-label={`Theme: ${preference} (click for ${next})`}
      title={`Theme: ${preference}`}
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center rounded-panel border border-border bg-surface text-text-secondary transition hover:bg-surface-hover",
        className,
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
