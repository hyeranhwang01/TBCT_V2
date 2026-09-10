"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { Button } from "@/shared/components/ui/primitives";
import { fadeIn, fadeScale } from "@/lib/motion/motion-variants";
import { useReducedMotionPreference } from "@/lib/motion/use-reduced-motion-preference";
import { useT } from "@/lib/i18n/context";
import type { TourStep } from "@/lib/onboarding/tour-steps";

const EDGE_MARGIN = 12;
const TOOLTIP_WIDTH = 320;

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function measure(el: Element): TargetRect {
  const rect = el.getBoundingClientRect();
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

// A `data-tour-id` can legitimately match more than one element at once --
// e.g. app-shell.tsx renders the same nav links twice (fixed desktop
// sidebar + a separate mobile bottom nav), only one of which is ever
// actually on-screen at a given viewport width. `querySelector` alone would
// always grab whichever copy comes first in the DOM regardless of which one
// the user can currently see, so this picks the first VISIBLE match
// instead -- "visible" meaning both not CSS-hidden (rect has real size) and
// not scrolled/translated off the viewport (the mobile sidebar drawer sits
// off-screen via `-translate-x-full` rather than `display:none`, so it
// still has a nonzero rect that just needs excluding by position too).
function isVisible(el: Element) {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  return rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;
}

function findTarget(id: string): Element | null {
  const matches = document.querySelectorAll(`[data-tour-id="${id}"]`);
  for (const el of Array.from(matches)) {
    if (isVisible(el)) return el;
  }
  return null;
}

/**
 * A spotlight walkthrough over elements already on the page, addressed by
 * `data-tour-id`. Deliberately DOM-measurement based (getBoundingClientRect
 * + a rAF loop) rather than a portal/positioning library -- the targets are
 * ordinary page chrome (buttons, cards, nav links), not floating elements,
 * so this stays a few dozen lines instead of a new dependency.
 *
 * Controlled entirely by the parent via `active`/`onDone` -- see
 * use-onboarding-tour.ts for the auto-start-once + replay logic shared by
 * both the patient and clinician tours.
 */
export function OnboardingTour({ steps, active, onDone }: { steps: TourStep[]; active: boolean; onDone: () => void }) {
  const { t } = useT();
  const reducedMotion = useReducedMotionPreference();
  const [index, setIndex] = useState(0);
  const [resolvedSteps, setResolvedSteps] = useState<TourStep[]>([]);
  const [rect, setRect] = useState<TargetRect | null>(null);
  const frameRef = useRef<number | null>(null);

  // Recompute which steps have a real target in today's DOM every time the
  // tour (re)starts -- a step whose element is hidden by responsive layout
  // is skipped instead of shown pointing at nothing. If literally none of
  // them resolve (e.g. an unexpectedly narrow viewport), finish immediately
  // rather than rendering forever with no target to measure.
  useEffect(() => {
    if (!active) return;
    const found = steps.filter((step) => findTarget(step.target));
    if (!found.length) {
      onDone();
      return;
    }
    setIndex(0);
    setResolvedSteps(found);
  }, [active, steps, onDone]);

  useEffect(() => {
    if (!active || !resolvedSteps.length) {
      setRect(null);
      return;
    }
    const step = resolvedSteps[index];
    const el = findTarget(step.target);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
    const tick = () => {
      setRect(measure(el));
      frameRef.current = requestAnimationFrame(tick);
    };
    // A running rAF loop (not a one-shot measurement) keeps the highlight
    // glued to the target through the scrollIntoView animation above and
    // any manual scrolling/resizing while this step is showing.
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [active, index, resolvedSteps, reducedMotion]);

  if (!active || !resolvedSteps.length || !rect) return null;

  const step = resolvedSteps[index];
  const isLast = index === resolvedSteps.length - 1;
  const placeBelow = rect.top + rect.height + 180 < window.innerHeight;
  const tooltipTop = placeBelow ? rect.top + rect.height + EDGE_MARGIN : rect.top - EDGE_MARGIN;
  const tooltipLeft = Math.min(Math.max(rect.left, EDGE_MARGIN), window.innerWidth - TOOLTIP_WIDTH - EDGE_MARGIN);

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[95]"
        variants={reducedMotion ? undefined : fadeIn}
        initial={reducedMotion ? false : "initial"}
        animate={reducedMotion ? undefined : "animate"}
        exit={reducedMotion ? undefined : "exit"}
      >
        {/* Click-anywhere-to-skip catcher. Sits under the spotlight ring
            (pointer-events-none, below) and the tooltip (auto, below) in
            paint order, so it only actually receives clicks outside both. */}
        <button type="button" aria-label={t("onboarding.controls.skip")} className="absolute inset-0 h-full w-full cursor-default bg-transparent" onClick={onDone} />
        <div
          className="pointer-events-none absolute rounded-panel ring-2 ring-clinical-blue transition-[top,left,width,height] duration-200"
          style={{
            top: rect.top - 6,
            left: rect.left - 6,
            width: rect.width + 12,
            height: rect.height + 12,
            boxShadow: "0 0 0 9999px rgba(15, 21, 33, 0.62)",
          }}
        />
        <motion.div
          className="absolute w-[320px] rounded-panel border border-border bg-surface p-4 shadow-lg"
          style={{ top: tooltipTop, left: tooltipLeft, transform: placeBelow ? undefined : "translateY(-100%)" }}
          variants={reducedMotion ? undefined : fadeScale}
          initial={reducedMotion ? false : "initial"}
          animate={reducedMotion ? undefined : "animate"}
          exit={reducedMotion ? undefined : "exit"}
        >
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-text-primary">{t(step.titleKey)}</h3>
            <button type="button" aria-label={t("onboarding.controls.skip")} onClick={onDone} className="shrink-0 text-text-muted hover:text-text-secondary">
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 text-sm text-text-secondary">{t(step.bodyKey)}</p>
          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="text-xs text-text-muted">{t("onboarding.controls.stepOf", { current: index + 1, total: resolvedSteps.length })}</span>
            <div className="flex gap-2">
              {index > 0 && (
                <Button size="sm" variant="ghost" onClick={() => setIndex((value) => value - 1)}>
                  {t("onboarding.controls.back")}
                </Button>
              )}
              <Button size="sm" onClick={() => (isLast ? onDone() : setIndex((value) => value + 1))}>
                {isLast ? t("onboarding.controls.finish") : t("onboarding.controls.next")}
              </Button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
