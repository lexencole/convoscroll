import { afterEach, describe, expect, it, vi } from "vitest";
import { focusPopoverItem, placePopover } from "./popover-position";

const original = Object.getOwnPropertyDescriptor(window, "visualViewport");
afterEach(() => {
  if (original) Object.defineProperty(window, "visualViewport", original);
  else delete (window as { visualViewport?: unknown }).visualViewport;
  vi.restoreAllMocks();
});
function viewport(height: number, top = 0, width = 390, left = 0) {
  Object.defineProperty(window, "visualViewport", { configurable: true, value: { height, offsetTop: top, width, offsetLeft: left } });
}
const rect = (top: number, left = 20) => new DOMRect(left, top, 100, 44);

describe("visible-area popover placement", () => {
  it("caps a long menu below a phone toolbar without covering its trigger", () => {
    viewport(844);
    const position = placePopover(rect(76), { width: 220, height: 650 });
    expect(position.top).toBe(126); expect(position.maxHeight).toBe(280);
  });
  it("opens above a bottom trigger and leaves the full trigger visible", () => {
    viewport(844);
    const position = placePopover(rect(760), { width: 220, height: 650 });
    expect(position.top + position.maxHeight).toBe(754);
  });
  it("shrinks inside the visible keyboard area without a forced minimum height", () => {
    viewport(220, 300);
    const position = placePopover(rect(390), { width: 220, height: 650 });
    expect(position.top).toBe(308); expect(position.maxHeight).toBe(76);
    expect(position.top + position.maxHeight).toBeLessThan(390);
  });
  it("uses both visible offsets when the page is zoomed and panned", () => {
    viewport(400, 200, 250, 80);
    const position = placePopover(rect(300, 270), { width: 320, height: 200 });
    expect(position.left).toBe(88); expect(position.width).toBe(234);
    expect(position.top).toBe(350); expect(position.top + Math.min(200, position.maxHeight)).toBeLessThanOrEqual(592);
  });
  it("allows a full calendar height when it fits but still avoids the trigger", () => {
    viewport(844);
    const position = placePopover(rect(600), { width: 318, height: 380 }, { maxHeight: Infinity });
    expect(position.top).toBe(214); expect(position.maxHeight).toBe(586);
  });
});


describe("popup focus readiness", () => {
  it("waits until an initially hidden item is visible without scrolling the page", () => {
    const panel = document.createElement("div");
    const button = document.createElement("button"); panel.append(button); document.body.append(panel);
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.push(callback); return frames.length; });
    button.style.visibility = "hidden";
    const focus = vi.spyOn(button, "focus");
    const stop = focusPopoverItem(panel, button);
    expect(focus).not.toHaveBeenCalled();
    frames.shift()?.(0); // A second frame can still precede inherited-style invalidation.
    expect(focus).not.toHaveBeenCalled();
    button.style.visibility = "visible";
    frames.shift()?.(0);
    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(document.activeElement).toBe(button);
    stop?.(); panel.remove();
  });
  it("cancels pending focus when the popup closes", () => {
    const panel = document.createElement("div"); const button = document.createElement("button");
    panel.append(button); document.body.append(panel); button.style.visibility = "hidden";
    vi.spyOn(window, "requestAnimationFrame").mockReturnValue(7);
    const cancel = vi.spyOn(window, "cancelAnimationFrame");
    const stop = focusPopoverItem(panel, button); stop?.();
    expect(cancel).toHaveBeenCalledWith(7);
    panel.remove();
  });
});
