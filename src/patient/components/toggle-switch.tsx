"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { motionDuration, motionEase } from "@/shared/motion/motion-tokens";
import { useReducedMotionPreference } from "@/shared/motion/use-reduced-motion-preference";

/** Patient-only visual replacement for a bare `<input type="checkbox">` row
 * (patient-profile-page.tsx's memory/notification settings) -- a labeled
 * pill switch with an optional description line, same semantics as a
 * checkbox (role="switch", aria-checked) so it stays keyboard/screen-reader
 * operable. Purely presentational: the caller still owns the boolean state
 * and onChange contract a checkbox would have. */
export function ToggleSwitch({
  checked,
  onChange,
  label,
  description,
  icon,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  description?: string;
  icon?: ReactNode;
}) {
  const reducedMotion = useReducedMotionPreference();
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2.5">
      <span className="flex items-start gap-3">
        {icon && <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface text-clinical-blue">{icon}</span>}
        <span>
          <span className="block text-sm font-semibold text-text-primary">{label}</span>
          {description && <span className="mt-0.5 block text-xs text-text-secondary">{description}</span>}
        </span>
      </span>
      <span
        role="switch"
        aria-checked={checked}
        tabIndex={0}
        onClick={() => onChange(!checked)}
        onKeyDown={(event) => {
          if (event.key === " " || event.key === "Enter") {
            event.preventDefault();
            onChange(!checked);
          }
        }}
        className={`transition-ui-base relative mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full border outline-offset-2 ${checked ? "border-clinical-blue bg-clinical-blue" : "border-border bg-surface-subtle"}`}
      >
        <motion.span
          className="block h-4.5 w-4.5 rounded-full bg-white shadow"
          animate={{ x: checked ? 22 : 3 }}
          transition={reducedMotion ? { duration: 0 } : { duration: motionDuration.base, ease: motionEase.ui }}
          style={{ height: 18, width: 18 }}
        />
      </span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="sr-only" tabIndex={-1} aria-hidden="true" />
    </label>
  );
}
