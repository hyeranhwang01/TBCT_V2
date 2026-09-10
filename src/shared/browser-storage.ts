/**
 * Guarded access to `window.localStorage`.
 *
 * `typeof window === "undefined"` alone is not a sufficient guard. A browser
 * can expose `window` while refusing storage entirely: Safari private mode and
 * blocked-cookie settings throw on the property access, and a write can throw
 * `QuotaExceededError` even when the read succeeded. Both cases used to
 * propagate out of ordinary render paths -- `getCurrentDemoActor()` runs while
 * the app shell renders -- and take the page down.
 *
 * Every storage failure degrades to "no stored value", which is the same state
 * a first visit produces, so no caller needs a new branch.
 */

export function getBrowserStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    const storage = window.localStorage;
    // Shape-checked rather than merely truthy: some runtimes expose the
    // property with a value that is not a usable Storage.
    return storage && typeof storage.getItem === "function" ? storage : null;
  } catch {
    return null;
  }
}

export function readBrowserStorageItem(key: string): string | null {
  const storage = getBrowserStorage();
  if (!storage) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/** Returns whether the value was actually persisted. */
export function writeBrowserStorageItem(key: string, value: string): boolean {
  const storage = getBrowserStorage();
  if (!storage) return false;
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}
