"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import en from "@/shared/i18n/dictionaries/en";
import ko from "@/shared/i18n/dictionaries/ko";
import { DEFAULT_LOCALE, isUiLocale, type UiLocale } from "@/shared/i18n/locales";
import { readBrowserStorageItem, writeBrowserStorageItem } from "@/shared/browser-storage";

const DICTIONARIES: Record<UiLocale, Record<string, unknown>> = { en, ko };
// Exported so callers can check "has anyone ever explicitly picked a UI
// language on this browser" without duplicating the key -- see
// patient-list-page.tsx's one-time auto-adopt-from-participant-locale.
export const UI_LOCALE_STORAGE_KEY = "tbct-ui-locale";
const STORAGE_KEY = UI_LOCALE_STORAGE_KEY;

function readLocaleCookie(): string | null {
  if (typeof document === "undefined") return null;
  // decodeURIComponent throws URIError on a mangled value (a bare "%"), and
  // this runs inside the provider's mount effect -- an unguarded decode
  // would take the whole app down for a bad cookie. A cookie we cannot read
  // is the same as no cookie.
  try {
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${STORAGE_KEY}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

function readStoredLocale(): UiLocale {
  // The cookie is the fallback, not decoration: when storage is blocked
  // (Safari private mode, blocked cookies-and-storage settings) it is the only
  // thing setLocale managed to write, and without reading it back the chosen
  // locale silently reverted to DEFAULT_LOCALE on every load.
  const stored = readBrowserStorageItem(STORAGE_KEY) ?? readLocaleCookie();
  return isUiLocale(stored) ? stored : DEFAULT_LOCALE;
}

function lookup(dictionary: Record<string, unknown>, path: string): string | undefined {
  const value = path.split(".").reduce<unknown>((node, key) => {
    if (node && typeof node === "object" && key in (node as Record<string, unknown>)) {
      return (node as Record<string, unknown>)[key];
    }
    return undefined;
  }, dictionary);
  return typeof value === "string" ? value : undefined;
}

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
}

interface LocaleContextValue {
  locale: UiLocale;
  setLocale: (locale: UiLocale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<UiLocale>(DEFAULT_LOCALE);

  useEffect(() => {
    setLocaleState(readStoredLocale());
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const setLocale = useCallback((next: UiLocale) => {
    setLocaleState(next);
    // Cookie first: it used to run after the storage write, so a throwing
    // setItem meant neither was persisted and the choice was lost on reload.
    if (typeof document !== "undefined") {
      document.cookie = `${STORAGE_KEY}=${next}; path=/; max-age=31536000`;
    }
    writeBrowserStorageItem(STORAGE_KEY, next);
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const primary = lookup(DICTIONARIES[locale], key);
      const fallback = primary ?? lookup(DICTIONARIES[DEFAULT_LOCALE], key);
      return interpolate(fallback ?? key, vars);
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useT() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useT must be used within a LocaleProvider");
  return ctx;
}
