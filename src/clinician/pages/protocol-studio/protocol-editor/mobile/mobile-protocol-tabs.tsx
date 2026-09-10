"use client";

import { useT } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

export type MobileProtocolTab = "steps" | "flow" | "prompt";

const TABS: MobileProtocolTab[] = ["steps", "flow", "prompt"];

// Brief §4's secondary navigation ([Steps] [Flow] [Prompt]) -- lets a
// clinician see all three exist without scrolling, and jump straight to
// any one of them. Sticky so it stays reachable while scrolling a long
// Steps list or Prompt Editor.
export function MobileProtocolTabs({ active, onChange }: { active: MobileProtocolTab; onChange: (tab: MobileProtocolTab) => void }) {
  const { t } = useT();
  const label = (tab: MobileProtocolTab) =>
    tab === "steps" ? t("protocolEditor.mobile.stepsTab") : tab === "flow" ? t("protocolEditor.mobile.flowTab") : t("protocolEditor.mobile.promptTab");

  return (
    <div className="sticky top-[56px] z-20 mx-3 mt-3 flex overflow-hidden rounded-full border border-white/70 bg-surface/95 p-1 shadow-lg backdrop-blur-xl">
      {TABS.map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => onChange(tab)}
          className={cn(
            "flex min-h-[44px] flex-1 items-center justify-center rounded-full text-sm font-semibold transition",
            active === tab ? "rainbow-fill text-white shadow-sm" : "text-text-secondary",
          )}
        >
          {label(tab)}
        </button>
      ))}
    </div>
  );
}
