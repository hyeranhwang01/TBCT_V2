"use client";

import { useCallback, useSyncExternalStore } from "react";

// Developer mode: a switch that unlocks the session journey so any of the eight
// sessions can be started without finishing the one before it. Off, the patient
// journey behaves exactly as it always has -- one "continue" for the next
// session, the rest inert.
//
// Why a module-level store rather than a React context: the toggle lives in the
// shared patient shell (patient-shell.tsx) and the thing it unlocks lives in a
// page rendered as that shell's child (patient-list-page.tsx). They are siblings
// in the tree, so the state has to sit outside both. useSyncExternalStore over a
// tiny store keeps it to one file with no provider to wire into studio-app.tsx,
// and picks up the change in other tabs through the storage event for free.
//
// The state is per-browser on purpose. It is a tool for whoever is testing the
// app on this device, not a property of the account, so it is never written to
// the participant record and never leaves the browser.

export const DEV_MODE_STORAGE_KEY = "tbct.devMode";

/**
 * Whether the toggle is offered at all.
 *
 * Deliberately fail-open: unset means available, so the switch works on a
 * deployment with no extra configuration. Set NEXT_PUBLIC_DEV_TOOLS=off to hide
 * it. That MUST be done before real participants use the app -- a participant
 * who can skip sessions is running a different protocol than the one being
 * studied.
 *
 * The parameter's default has to spell out process.env.NEXT_PUBLIC_DEV_TOOLS in
 * full: Next inlines that exact expression into the browser bundle at build
 * time, and reading it off a destructured or aliased `process.env` would leave
 * it undefined in the browser -- the switch would silently never hide anything.
 */
export function devToolsAvailable(value = process.env.NEXT_PUBLIC_DEV_TOOLS): boolean {
  return (value ?? "").trim().toLowerCase() !== "off";
}

const listeners = new Set<() => void>();

function readStored(): boolean {
  // Storage can be unavailable (private mode, blocked site data) or hold
  // something that is not ours; either way the answer is "off".
  try {
    return globalThis.localStorage?.getItem(DEV_MODE_STORAGE_KEY) === "on";
  } catch {
    return false;
  }
}

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === DEV_MODE_STORAGE_KEY) listener();
  };
  globalThis.addEventListener?.("storage", onStorage);
  return () => {
    listeners.delete(listener);
    globalThis.removeEventListener?.("storage", onStorage);
  };
}

export function setDevModeEnabled(next: boolean) {
  try {
    if (next) globalThis.localStorage?.setItem(DEV_MODE_STORAGE_KEY, "on");
    else globalThis.localStorage?.removeItem(DEV_MODE_STORAGE_KEY);
  } catch {
    // Nothing to persist to. The in-memory notification below still runs, so
    // the switch works for this page view.
  }
  emit();
}

/** Reads the stored value; false when the toggle is not on offer at all, so a
 * value left behind from earlier cannot quietly keep the journey unlocked. */
export function useDevMode() {
  const available = devToolsAvailable();
  const stored = useSyncExternalStore(
    subscribe,
    () => readStored(),
    // Server render: always off, so the markup matches a first paint that has
    // not read storage yet.
    () => false,
  );
  const enabled = available && stored;
  const toggle = useCallback(() => setDevModeEnabled(!readStored()), []);
  return { available, enabled, toggle };
}
