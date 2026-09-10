"use client";

import { Card } from "@/components/ui/primitives";
import { useT } from "@/lib/i18n/context";

interface HotlineEntry {
  key: string;
  number: string;
  href: string;
}

// Korean crisis hotlines -- verified real, current numbers (national,
// no area code needed, all free to call). This is a "public" audience
// route (see studio-app.tsx) on purpose: crisis resources must never sit
// behind a login wall, the same pattern every commercial mental-health
// app (Wysa, Woebot, BetterHelp) follows. Not gated to Korean locale
// either -- see the closing note for non-Korea callers.
const HOTLINES: HotlineEntry[] = [
  { key: "suicide", number: "1393", href: "tel:1393" },
  { key: "mentalHealth", number: "1577-0199", href: "tel:15770199" },
  { key: "lifeline", number: "1588-9191", href: "tel:15889191" },
  { key: "emergency", number: "119", href: "tel:119" },
];

export function CrisisResourcesPage() {
  const { t } = useT();
  return (
    <div className="min-h-screen bg-background p-4 lg:p-6">
      <div className="mx-auto max-w-lg space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">{t("crisis.title")}</h1>
          <p className="mt-2 text-sm text-text-secondary">{t("crisis.intro")}</p>
        </div>
        <div className="space-y-2">
          {HOTLINES.map((entry) => (
            <a
              key={entry.key}
              href={entry.href}
              className="flex items-center justify-between gap-3 rounded-panel border border-critical bg-critical-light px-4 py-3 hover:opacity-90"
            >
              <span className="text-sm font-medium text-text-primary">{t(`crisis.${entry.key}`)}</span>
              <span className="text-lg font-semibold text-critical">{entry.number}</span>
            </a>
          ))}
        </div>
        <Card className="p-4">
          <p className="text-xs text-text-secondary">{t("crisis.outsideKorea")}</p>
        </Card>
      </div>
    </div>
  );
}
