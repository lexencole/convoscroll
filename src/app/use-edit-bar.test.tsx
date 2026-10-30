import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEditBar } from "./use-edit-bar";

const original = Object.getOwnPropertyDescriptor(window, "visualViewport");
afterEach(() => {
  if (original) Object.defineProperty(window, "visualViewport", original);
  else delete (window as { visualViewport?: unknown }).visualViewport;
  document.querySelectorAll('[data-test-input]').forEach(element => element.remove());
  vi.useRealTimers(); vi.restoreAllMocks();
});

function setup() {
  vi.useFakeTimers();
  const viewport = Object.assign(new EventTarget(), { height: 844, offsetTop: 0, scale: 1 });
  Object.defineProperty(window, "visualViewport", { configurable: true, value: viewport });
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(844);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => window.setTimeout(() => callback(0), 16));
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => clearTimeout(id));
  const input = document.createElement("textarea"); input.dataset.testInput = ""; document.body.append(input);
  const hook = renderHook(() => useEditBar(null));
  const root = document.documentElement;
  function update(values: Partial<typeof viewport>, type = "resize") {
    Object.assign(viewport, values);
    act(() => { viewport.dispatchEvent(new Event(type)); vi.runOnlyPendingTimers(); });
  }
  return { input, hook, root, viewport, update };
}

describe("useEditBar", () => {
  it("keeps following a panned keyboard viewport even when offset consumes the bottom inset", () => {
    const { input, hook, root, update } = setup(); input.focus();
    update({ height: 500, offsetTop: 120 });
    expect(root.style.getPropertyValue("--ui-viewport-top")).toBe("120px");
    expect(root.hasAttribute("data-keyboard-open")).toBe(true);
    update({ offsetTop: 330 }, "scroll");
    expect(root.hasAttribute("data-keyboard-open")).toBe(true);
    expect(root.style.getPropertyValue("--ui-viewport-top")).toBe("330px");
    hook.unmount();
    expect(root.style.getPropertyValue("--ui-viewport-top")).toBe("");
    expect(root.hasAttribute("data-keyboard-open")).toBe(false);
  });
  it("resets stale panning on keyboard dismissal even when the field retains focus", () => {
    const { input, root, update } = setup(); input.focus();
    update({ height: 460, offsetTop: 300 });
    update({ height: 844 });
    expect(root.style.getPropertyValue("--ui-viewport-top")).toBe("0px");
    expect(root.style.getPropertyValue("--ui-keyboard-inset")).toBe("0px");
    expect(root.hasAttribute("data-keyboard-open")).toBe(false);
  });
  it("clears keyboard positioning on blur before a late viewport resize", () => {
    const { input, root, update } = setup(); input.focus();
    update({ height: 460, offsetTop: 300 });
    act(() => { input.blur(); vi.runOnlyPendingTimers(); });
    expect(root.hasAttribute("data-keyboard-open")).toBe(false);
    expect(root.style.getPropertyValue("--ui-viewport-top")).toBe("0px");
  });
  it("ignores pinch zoom and browser chrome while detecting a keyboard during input zoom", () => {
    const { input, root, update } = setup(); input.focus();
    update({ height: 422, scale: 2, offsetTop: 200 });
    expect(root.hasAttribute("data-keyboard-open")).toBe(false);
    update({ height: 760, scale: 1 });
    expect(root.hasAttribute("data-keyboard-open")).toBe(false);
    update({ height: 350, scale: 1.25 });
    expect(root.hasAttribute("data-keyboard-open")).toBe(true);
    update({ height: 844 / 1.25 });
    expect(root.hasAttribute("data-keyboard-open")).toBe(false);
  });
  it("does not infer a keyboard without editable focus and coalesces scroll events", () => {
    const { root, viewport, update } = setup();
    update({ height: 400, offsetTop: 220 });
    expect(root.hasAttribute("data-keyboard-open")).toBe(false);
    const writes = vi.spyOn(root.style, "setProperty");
    act(() => { for (let i = 0; i < 10; i++) viewport.dispatchEvent(new Event("scroll")); vi.runOnlyPendingTimers(); });
    expect(writes).not.toHaveBeenCalled();
  });
  it("keeps normal sticky positioning without visualViewport", () => {
    Object.defineProperty(window, "visualViewport", { configurable: true, value: undefined });
    const hook = renderHook(() => useEditBar(null));
    expect(document.documentElement.hasAttribute("data-keyboard-open")).toBe(false);
    hook.unmount();
  });
});
