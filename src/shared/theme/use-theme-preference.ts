"use client";

import { useCallback, useEffect, useState } from "react";

export type ThemePreference = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "tbct-theme-preference";

/** Reflects `preference` onto <html data-theme="..."> -- "system" removes
 * the attribute entirely so globals.css's @media (prefers-color-scheme)
 * block decides; "light"/"dark" set it explicitly, which globals.css's
 * :root[data-theme="..."] blocks give priority over the OS preference
 * either way. Exported so layout.tsx's blocking inline script (avoids a
 * flash of the wrong theme before hydration) can stay in sync with this
 * same logic without importing React. */
export function applyThemeAttribute(preference: ThemePreference) {
  const root = document.documentElement;
  if (preference === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", preference);
}

/** Patient/clinician theme toggle -- persisted to localStorage, defaults
 * to "system" (follow the OS setting) the first time a browser visits.
 * See layout.tsx for the pre-hydration inline script that applies the
 * stored preference before first paint, so this hook's own effect below
 * is just for keeping React state in sync, not the first application. */
export function useThemePreference() {
  const [preference, setPreferenceState] = useState<ThemePreference>("system");

  useEffect(() => {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    setPreferenceState(stored === "light" || stored === "dark" ? stored : "system");
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    applyThemeAttribute(next);
    if (next === "system") window.localStorage.removeItem(THEME_STORAGE_KEY);
    else window.localStorage.setItem(THEME_STORAGE_KEY, next);
  }, []);

  return { preference, setPreference };
}
