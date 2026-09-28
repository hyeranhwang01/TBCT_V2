"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { motionDuration, motionEase } from "@/shared/motion/motion-tokens";
import { useReducedMotionPreference } from "@/shared/motion/use-reduced-motion-preference";
import { IconTile } from "@/patient/components/ui/kit";

/** A labeled settings row with a pill switch -- same semantics as a checkbox
 * (role="switch", aria-checked, Space/Enter), so it stays keyboard and
 * screen-reader operable. The caller owns the boolean state. Designed to sit
 * inside a ListGroup. */
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
  const toggle = () => onChange(!checked);
  return (
    <div className="flex items-center gap-3.5 px-4 py-3.5">
      {icon && <IconTile icon={icon} size="sm" />}
      <button type="button" onClick={toggle} className="min-w-0 flex-1 text-left" tabIndex={-1} aria-hidden="true">
        <span className="block text-[15px] font-semibold text-text-primary">{label}</span>
        {description && <span className="mt-0.5 block text-[13px] text-text-secondary">{description}</span>}
      </button>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={toggle}
        className={`transition-ui-base relative flex h-[30px] w-[52px] shrink-0 items-center rounded-full ${checked ? "bg-brand" : "bg-border-strong"}`}
      >
        <motion.span
          className="block h-6 w-6 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.25)]"
          animate={{ x: checked ? 25 : 3 }}
          transition={reducedMotion ? { duration: 0 } : { duration: motionDuration.base, ease: motionEase.ui }}
        />
      </button>
    </div>
  );
}
