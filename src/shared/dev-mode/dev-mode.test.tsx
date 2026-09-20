import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { DEV_MODE_STORAGE_KEY, devToolsAvailable, setDevModeEnabled, useDevMode } from "@/shared/dev-mode/dev-mode";

// Developer mode unlocks the session journey, so "is it on?" has to be answered
// the same way everywhere and has to survive a page change. The store is the one
// place that decides, and these are its rules.

function Probe() {
  const { available, enabled, toggle } = useDevMode();
  return (
    <button type="button" onClick={toggle} data-testid="probe">
      {available ? "available" : "hidden"}/{enabled ? "on" : "off"}
    </button>
  );
}

function state() {
  return screen.getByTestId("probe").textContent;
}

beforeEach(() => setDevModeEnabled(false));
afterEach(() => {
  cleanup();
  setDevModeEnabled(false);
});

describe("whether developer mode is on offer", () => {
  it("is offered when nothing is configured, so the switch works on a fresh deployment", () => {
    expect(devToolsAvailable(undefined)).toBe(true);
    expect(devToolsAvailable("")).toBe(true);
    expect(devToolsAvailable("on")).toBe(true);
  });

  // The one setting that hides it. It has to be set before real participants
  // use the app: a participant who can skip sessions is running a different
  // protocol than the one being studied.
  it("is hidden by NEXT_PUBLIC_DEV_TOOLS=off, however it is spelled", () => {
    for (const value of ["off", "OFF", " off ", "Off"]) expect(devToolsAvailable(value), value).toBe(false);
  });
});

describe("the developer mode switch", () => {
  it("starts off, turns on, and turns back off", () => {
    render(<Probe />);
    expect(state()).toBe("available/off");
    act(() => setDevModeEnabled(true));
    expect(state()).toBe("available/on");
    act(() => setDevModeEnabled(false));
    expect(state()).toBe("available/off");
  });

  it("toggles from the hook itself, and remembers the answer for the next page", () => {
    render(<Probe />);
    act(() => screen.getByTestId("probe").click());
    expect(state()).toBe("available/on");
    expect(globalThis.localStorage.getItem(DEV_MODE_STORAGE_KEY)).toBe("on");
    // A fresh mount -- what a navigation to another patient page looks like.
    cleanup();
    render(<Probe />);
    expect(state()).toBe("available/on");
  });

  it("reads anything that is not ours as off, rather than throwing", () => {
    globalThis.localStorage.setItem(DEV_MODE_STORAGE_KEY, "yes please");
    render(<Probe />);
    expect(state()).toBe("available/off");
  });

  it("follows the switch being thrown in another tab", () => {
    render(<Probe />);
    globalThis.localStorage.setItem(DEV_MODE_STORAGE_KEY, "on");
    act(() => {
      globalThis.dispatchEvent(new StorageEvent("storage", { key: DEV_MODE_STORAGE_KEY, newValue: "on" }));
    });
    expect(state()).toBe("available/on");
  });
});
