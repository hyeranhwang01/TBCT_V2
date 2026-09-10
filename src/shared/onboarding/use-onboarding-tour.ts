"use client";

import { useCallback, useEffect, useState } from "react";

export type TourAudience = "patient" | "clinician";

function storageKey(audience: TourAudience) {
  return `tbct-onboarding-seen:${audience}`;
}

/**
 * Drives a single audience's onboarding tour: auto-starts once (per
 * browser, matching the theme-preference storage convention -- see
 * use-theme-preference.ts) the first time `ready` goes true, and exposes
 * `replay` for the header "?" button to show it again on demand.
 *
 * `ready` gates the auto-start on the caller's own data having loaded --
 * without it, the tour could fire while the page is still a skeleton (no
 * `data-tour-id` targets in the DOM yet), find nothing, and immediately
 * mark itself "seen" without the user ever having seen it. Defaults to
 * `true` for callers (like app-shell.tsx) whose targets are static chrome,
 * not data-dependent.
 */
export function useOnboardingTour(audience: TourAudience, ready = true) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!ready) return;
    if (window.localStorage.getItem(storageKey(audience))) return;
    // Brief delay past "ready" so the just-rendered page has settled (layout,
    // any final paint) before the tour measures its targets' positions.
    const timer = window.setTimeout(() => setActive(true), 300);
    return () => window.clearTimeout(timer);
  }, [audience, ready]);

  const finish = useCallback(() => {
    window.localStorage.setItem(storageKey(audience), "1");
    setActive(false);
  }, [audience]);

  const replay = useCallback(() => setActive(true), []);

  return { active, finish, replay };
}
