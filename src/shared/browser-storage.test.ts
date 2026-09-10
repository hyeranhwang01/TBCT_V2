import { afterEach, describe, expect, it } from "vitest";
import { getBrowserStorage, readBrowserStorageItem, writeBrowserStorageItem } from "@/shared/browser-storage";
import { getCurrentDemoActor, setCurrentDemoActor } from "@/shared/demo-actor";

const realStorage = globalThis.localStorage;

function restoreStorage() {
  Object.defineProperty(globalThis, "localStorage", { value: realStorage, configurable: true, writable: true });
}

/** Replaces the global Storage with one that fails the way a blocked browser
 * does -- Safari private mode and blocked-cookie settings throw on access
 * rather than returning null. */
function installFailingStorage(mode: "throws-on-access" | "throws-on-write" | "absent") {
  if (mode === "absent") {
    Object.defineProperty(globalThis, "localStorage", { value: undefined, configurable: true, writable: true });
    return;
  }
  if (mode === "throws-on-access") {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("The operation is insecure.");
      },
    });
    return;
  }
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => undefined,
      clear: () => undefined,
      key: () => null,
      length: 0,
    },
  });
}

describe("browser storage is usable under the test harness", () => {
  afterEach(restoreStorage);

  it("exposes a working Storage on both window and globalThis", () => {
    // Node >= 22 defines a disabled `localStorage` global, which makes vitest's
    // jsdom environment skip copying the real one. Without the polyfill in
    // src/test/polyfills/web-storage.ts this is undefined and any app code
    // touching storage throws.
    expect(getBrowserStorage()).not.toBeNull();
    expect(window.localStorage).toBe(globalThis.localStorage);
  });

  it("round-trips values", () => {
    expect(writeBrowserStorageItem("tbct.test.key", "value-1")).toBe(true);
    expect(readBrowserStorageItem("tbct.test.key")).toBe("value-1");
    globalThis.localStorage.removeItem("tbct.test.key");
    expect(readBrowserStorageItem("tbct.test.key")).toBeNull();
  });

  it("actually persists the demo actor, so a no-op storage would not satisfy the suite", () => {
    expect(setCurrentDemoActor("SUP-1")).toBe(true);
    expect(getCurrentDemoActor().id).toBe("SUP-1");
    setCurrentDemoActor("RC-1");
  });
});

describe("blocked storage degrades instead of throwing", () => {
  afterEach(restoreStorage);

  it.each(["throws-on-access", "absent"] as const)("survives storage that is %s", (mode) => {
    installFailingStorage(mode);
    expect(getBrowserStorage()).toBeNull();
    expect(readBrowserStorageItem("tbct-demo-actor")).toBeNull();
    expect(writeBrowserStorageItem("tbct-demo-actor", "x")).toBe(false);
    // The real regression: this runs while the app shell renders, so an
    // unguarded read took the whole page down in these contexts.
    expect(() => getCurrentDemoActor()).not.toThrow();
    expect(getCurrentDemoActor().id).toBe("RC-1");
    expect(setCurrentDemoActor("SUP-1")).toBe(false);
  });

  it("survives a storage that reads but refuses to write", () => {
    installFailingStorage("throws-on-write");
    expect(getBrowserStorage()).not.toBeNull();
    expect(writeBrowserStorageItem("tbct-demo-actor", "x")).toBe(false);
    expect(setCurrentDemoActor("SUP-1")).toBe(false);
    expect(getCurrentDemoActor().id).toBe("RC-1");
  });

  it("falls back to the research coordinator, never the analyst", () => {
    installFailingStorage("absent");
    // Failing open here must not silently apply analyst redaction, and must
    // not be mistaken for the authorization boundary (that is the Supabase
    // session checked in the store route).
    expect(getCurrentDemoActor().role).toBe("research_coordinator");
  });
});
