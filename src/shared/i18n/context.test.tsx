import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { LocaleProvider } from "@/shared/i18n/context";

const STORAGE_KEY = "tbct-ui-locale";

function clearLocaleState() {
  globalThis.localStorage.removeItem(STORAGE_KEY);
  document.cookie = `${STORAGE_KEY}=; path=/; max-age=0`;
}

beforeEach(clearLocaleState);
afterEach(clearLocaleState);

describe("locale persistence", () => {
  it("survives a malformed locale cookie instead of crashing the provider", () => {
    // decodeURIComponent throws URIError on a bare "%" -- and the cookie is
    // read inside the provider's mount effect, so an unguarded decode took
    // the whole app down for anyone whose cookie jar held a mangled value.
    document.cookie = `${STORAGE_KEY}=%; path=/`;
    expect(() => render(<LocaleProvider>{null}</LocaleProvider>)).not.toThrow();
    expect(document.documentElement.lang).toBe("ko");
  });

  it("falls back to the cookie when storage holds nothing", () => {
    // In a storage-blocked browser the cookie is the only thing setLocale
    // managed to write; without reading it back the chosen locale silently
    // reverted to the default on every load.
    document.cookie = `${STORAGE_KEY}=en; path=/`;
    render(<LocaleProvider>{null}</LocaleProvider>);
    expect(document.documentElement.lang).toBe("en");
  });

  it("prefers the stored locale over the cookie", () => {
    globalThis.localStorage.setItem(STORAGE_KEY, "ko");
    document.cookie = `${STORAGE_KEY}=en; path=/`;
    render(<LocaleProvider>{null}</LocaleProvider>);
    expect(document.documentElement.lang).toBe("ko");
  });
});
