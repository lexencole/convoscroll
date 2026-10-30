import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { usePointerSort } from "./use-pointer-sort";
import type { SortTarget } from "./workbench-operations";

function Harness({ drop, disabled = false, block = false }: { drop: (source: SortTarget, before?: SortTarget) => void; disabled?: boolean; block?: boolean }) {
  const sort = usePointerSort(drop, disabled);
  return <div className="conversation-canvas">
    <button onPointerDown={(event) => sort.start(event, { messageId: "m1", ...(block ? { blockId: "b1" } : {}) })}>拖动</button>
    <output>{sort.dragging ? "dragging" : "idle"}:{sort.marker?.id}:{sort.marker?.edge}</output>
    <article data-message-id="m1"><div data-workbench-block="b1" data-owner-message="m1" /><div data-workbench-block="b2" data-owner-message="m1" /></article>
    <article data-message-id="m2"><div data-workbench-block="b3" data-owner-message="m2" /></article>
  </div>;
}
function setup(drop = vi.fn(), block = false, getScrollY = () => 0) {
  // JSDOM has no pointer geometry. Feed a real pointer-shaped event and deterministic element boxes.
  vi.stubGlobal("PointerEvent", class extends MouseEvent { pointerId = 1; });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const y = (this.dataset.messageId === "m2" || this.dataset.workbenchBlock === "b3" ? 400 : this.dataset.workbenchBlock === "b2" ? 200 : 0) - getScrollY();
    const height = this.dataset.messageId === "m1" ? 400 : 200;
    return { x: 0, y, left: 0, top: y, right: 400, bottom: y + height, width: 400, height, toJSON() {} };
  });
  const view = render(<Harness drop={drop} block={block} />, { wrapper: StrictMode });
  fireEvent.pointerDown(screen.getByText("拖动"), { button: 0, clientX: 30, clientY: 30 });
  return { ...view, drop };
}
function mockAnimationFrames() {
  let id = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
  vi.stubGlobal("cancelAnimationFrame", (frame: number) => { frames.delete(frame); });
  return { frames, tick() {
    const pending = [...frames.values()]; frames.clear();
    for (const callback of pending) callback(0);
  } };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("pointer sorting", () => {
  it.each([false, true])("clears a queued marker when rapidly leaving a target (block=%s)", (block) => {
    const { drop } = setup(vi.fn(), block);
    // Browser pointer moves and animation frames may run before React flushes marker updates.
    act(() => {
      fireEvent.pointerMove(window, { clientX: 80, clientY: 250 });
      fireEvent.pointerMove(window, { clientX: 600, clientY: 250 });
    });
    expect(screen.getByText("dragging::")).toBeInTheDocument();
    fireEvent.pointerUp(window);
    expect(drop).not.toHaveBeenCalled();
    expect(screen.getByText("idle::")).toBeInTheDocument();
  });

  it.each([false, true])("can re-enter after repeated boundary crossings and commit only once (block=%s)", (block) => {
    const { drop } = setup(vi.fn(), block);
    act(() => {
      for (let i = 0; i < 20; i++) {
        fireEvent.pointerMove(window, { clientX: 80, clientY: 250 });
        fireEvent.pointerMove(window, { clientX: 600, clientY: 250 });
      }
      fireEvent.pointerMove(window, { clientX: 80, clientY: block ? 350 : 550 });
    });
    expect(screen.getByText(`dragging:${block ? "b2" : "m2"}:after`)).toBeInTheDocument();
    expect(drop).not.toHaveBeenCalled();
    fireEvent.pointerUp(window);
    fireEvent.pointerUp(window);
    expect(drop).toHaveBeenCalledExactlyOnceWith({ messageId: "m1", ...(block ? { blockId: "b1" } : {}) }, block ? { messageId: "m1" } : undefined);
    expect(screen.getByText("idle::")).toBeInTheDocument();
  });

  it.each([false, true])("clears a pending marker after autoscroll moves the target away (block=%s)", (block) => {
    const animation = mockAnimationFrames();
    let scrollY = 0;
    const scroll = vi.spyOn(window, "scrollBy").mockImplementation((_x, y) => { scrollY += Number(y); });
    vi.stubGlobal("innerHeight", 600);
    const { drop } = setup(vi.fn(), block, () => scrollY);
    act(() => {
      fireEvent.pointerMove(window, { clientX: 80, clientY: 250 });
      fireEvent.pointerMove(window, { clientX: 80, clientY: 595 });
      animation.tick();
    });
    expect(scroll).toHaveBeenCalledExactlyOnceWith(0, 12);
    expect(screen.getByText("dragging::")).toBeInTheDocument();
    expect(drop).not.toHaveBeenCalled();
    expect(animation.frames.size).toBe(1);
    // Returning to a valid target must restore the marker; cancelling must stop the scroll loop.
    fireEvent.pointerMove(window, { clientX: 80, clientY: 250 });
    expect(screen.getByText(`dragging:${block ? "b2:before" : "m1:after"}`)).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(animation.frames.size).toBe(0);
    act(() => animation.tick());
    fireEvent.pointerUp(window);
    expect(drop).not.toHaveBeenCalled();
    expect(scroll).toHaveBeenCalledOnce();
    expect(screen.getByText("idle::")).toBeInTheDocument();
  });

  it("re-measures targets while scrolling up and stops the frame loop on drop", () => {
    const animation = mockAnimationFrames();
    let scrollY = 360;
    const scroll = vi.spyOn(window, "scrollBy").mockImplementation((_x, y) => { scrollY += Number(y); });
    const { drop } = setup(vi.fn(), false, () => scrollY);
    fireEvent.pointerMove(window, { clientX: 80, clientY: 60 });
    expect(screen.getByText("dragging:m2:before")).toBeInTheDocument();
    act(() => { animation.tick(); animation.tick(); });
    expect(scroll).toHaveBeenCalledTimes(2);
    expect(scroll).toHaveBeenLastCalledWith(0, -12);
    expect(screen.getByText("dragging:m1:after")).toBeInTheDocument();
    fireEvent.pointerUp(window);
    expect(drop).toHaveBeenCalledExactlyOnceWith({ messageId: "m1" }, { messageId: "m2" });
    expect(animation.frames.size).toBe(0);
  });

  it("removes pending frames and listeners on unmount", () => {
    const animation = mockAnimationFrames();
    const { drop, unmount } = setup();
    fireEvent.pointerMove(window, { clientX: 80, clientY: 550 });
    expect(animation.frames.size).toBe(1);
    unmount();
    expect(animation.frames.size).toBe(0);
    fireEvent.pointerMove(window, { clientX: 80, clientY: 250 });
    fireEvent.pointerUp(window);
    expect(drop).not.toHaveBeenCalled();
  });

  it("only commits once on drop and exposes the before/after marker", () => {
    const { drop } = setup();
    fireEvent.pointerMove(window, { clientX: 80, clientY: 550 });
    expect(screen.getByText("dragging:m2:after")).toBeInTheDocument(); expect(drop).not.toHaveBeenCalled();
    fireEvent.pointerUp(window); expect(drop).toHaveBeenCalledExactlyOnceWith({ messageId: "m1" }, undefined);
    fireEvent.pointerUp(window); expect(drop).toHaveBeenCalledOnce();
  });
  it.each(["Escape", "pointercancel", "blur"])("cancels on %s without history changes", (cancel) => {
    const { drop } = setup(); fireEvent.pointerMove(window, { clientX: 80, clientY: 550 });
    if (cancel === "Escape") fireEvent.keyDown(window, { key: cancel });
    else fireEvent(window, new Event(cancel));
    fireEvent.pointerUp(window); expect(drop).not.toHaveBeenCalled(); expect(screen.getByText("idle::")).toBeInTheDocument();
  });
  it("does not reorder for a click or a drop outside the canvas", () => {
    const { drop } = setup(vi.fn(), true);
    fireEvent.pointerMove(window, { clientX: 32, clientY: 32 }); fireEvent.pointerUp(window); expect(drop).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByText("拖动"), { button: 0, clientX: 30, clientY: 30 });
    fireEvent.pointerMove(window, { clientX: 600, clientY: 550 }); fireEvent.pointerUp(window); expect(drop).not.toHaveBeenCalled();
  });
  it.each([450, 550])("moves across owners without treating the next message as an insertion anchor at y=%s", (y) => {
    const { drop } = setup(vi.fn(), true);
    fireEvent.pointerMove(window, { clientX: 80, clientY: y });
    expect(screen.getByText(`dragging:b3:${y === 450 ? "before" : "after"}`)).toBeInTheDocument();
    fireEvent.pointerUp(window);
    expect(drop).toHaveBeenCalledExactlyOnceWith({ messageId: "m1", blockId: "b1" }, { messageId: "m2", ...(y === 450 ? { blockId: "b3" } : {}) });
  });
  it("accepts an empty destination message", () => {
    const { drop } = setup(vi.fn(), true);
    document.querySelector('[data-workbench-block="b3"]')!.remove();
    fireEvent.pointerMove(window, { clientX: 80, clientY: 450 });
    expect(screen.getByText("dragging:m2:after")).toBeInTheDocument();
    fireEvent.pointerUp(window);
    expect(drop).toHaveBeenCalledExactlyOnceWith({ messageId: "m1", blockId: "b1" }, { messageId: "m2" });
  });
  it("reorders blocks inside their owner and cancels when disabled mid-gesture", () => {
    const { drop, rerender } = setup(vi.fn(), true);
    fireEvent.pointerMove(window, { clientX: 80, clientY: 220 });
    expect(screen.getByText("dragging:b2:before")).toBeInTheDocument();
    rerender(<Harness drop={drop} block disabled />);
    fireEvent.pointerMove(window, { clientX: 80, clientY: 240 }); fireEvent.pointerUp(window); expect(drop).not.toHaveBeenCalled();
  });
});
