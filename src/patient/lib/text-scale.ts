"use client";

import { useSyncExternalStore } from "react";
import { readBrowserStorageItem, writeBrowserStorageItem } from "@/shared/browser-storage";

// Patient text size: normal / large / extra large. Per device, not per
// participant -- like the mute switch, it's about the screen someone is
// reading on. Applied with CSS zoom on the content column, so every size in
// the patient UI (many are fixed px) grows together.

export const TEXT_SCALES = [1, 1.12, 1.25] as const;
export type TextScale = (typeof TEXT_SCALES)[number];

const STORAGE_KEY = "tbct.patient.textScale";
const listeners = new Set<() => void>();

function read(): TextScale {
  const stored = Number(readBrowserStorageItem(STORAGE_KEY));
  return (TEXT_SCALES as readonly number[]).includes(stored) ? (stored as TextScale) : 1;
}

export function setTextScale(next: TextScale) {
  writeBrowserStorageItem(STORAGE_KEY, String(next));
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useTextScale(): TextScale {
  return useSyncExternalStore(subscribe, read, () => 1);
}
