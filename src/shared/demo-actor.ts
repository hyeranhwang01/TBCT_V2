import { readBrowserStorageItem, writeBrowserStorageItem } from "@/shared/browser-storage";

export type DemoActorRole =
  | "research_coordinator"
  | "clinician"
  | "supervisor"
  | "safety_reviewer"
  | "research_analyst";

export interface DemoActor {
  id: string;
  role: DemoActorRole;
  name: string;
  initials: string;
}

export const DEMO_ACTORS: DemoActor[] = [
  { id: "RC-1", role: "research_coordinator", name: "Demo Research Coordinator", initials: "RC" },
  { id: "CLIN-A", role: "clinician", name: "Demo Clinician A", initials: "DA" },
  { id: "SUP-1", role: "supervisor", name: "Demo Supervisor", initials: "SV" },
  { id: "SAFE-R", role: "safety_reviewer", name: "Demo Safety Reviewer", initials: "SR" },
  { id: "RA-1", role: "research_analyst", name: "Demo Research Analyst", initials: "RA" },
];

const STORAGE_KEY = "tbct-demo-actor";

export function getDefaultDemoActor() {
  return DEMO_ACTORS[0];
}

export function getDemoActorById(actorId: string) {
  return DEMO_ACTORS.find((actor) => actor.id === actorId) ?? null;
}

/**
 * Falls back to the default actor whenever nothing is stored -- including when
 * storage is unavailable (SSR, Safari private mode, blocked cookies). This
 * runs while the app shell renders, so an unguarded access here took the whole
 * page down in those contexts.
 *
 * Note the default is the research COORDINATOR, not the research analyst, so
 * failing to read the stored actor never silently applies analyst redaction.
 * The demo actor is a display/attribution switcher, not the authorization
 * boundary -- that is the Supabase session checked in the store route.
 */
export function getCurrentDemoActor() {
  const raw = readBrowserStorageItem(STORAGE_KEY);
  if (!raw) return getDefaultDemoActor();
  try {
    const parsed = JSON.parse(raw) as Partial<DemoActor>;
    if (!parsed.id) return getDefaultDemoActor();
    return getDemoActorById(parsed.id) ?? getDefaultDemoActor();
  } catch {
    return getDefaultDemoActor();
  }
}

/** Returns whether the selection was actually persisted. */
export function setCurrentDemoActor(actorId: string) {
  const actor = getDemoActorById(actorId) ?? getDefaultDemoActor();
  return writeBrowserStorageItem(STORAGE_KEY, JSON.stringify(actor));
}
