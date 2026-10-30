import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { SortTarget } from "./workbench-operations";

interface DropPosition { readonly before?: SortTarget; readonly marker: string; readonly edge: "before" | "after" }
interface Gesture { source: SortTarget; startX: number; startY: number; x: number; y: number; pointerId: number; active: boolean; drop?: DropPosition }

/** One pointer transaction per drop; pointer capture and touch-action belong only to the handle. */
export function usePointerSort(onDrop: (source: SortTarget, before?: SortTarget) => void, disabled: boolean) {
  const gesture = useRef<Gesture | undefined>(undefined);
  const callbacks = useRef({ onDrop, disabled });
  callbacks.current = { onDrop, disabled };
  const [marker, setMarker] = useState<{ id: string; edge: string }>();
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    let frame = 0;
    function finish(cancelled: boolean) {
      const current = gesture.current;
      gesture.current = undefined;
      cancelAnimationFrame(frame);
      setMarker(undefined); setDragging(false);
      if (!cancelled && current?.active && current.drop && !callbacks.current.disabled) callbacks.current.onDrop(current.source, current.drop.before);
    }
    function locate() {
      const current = gesture.current;
      if (!current?.active) return;
      const blocks = Boolean(current.source.blockId);
      const messages = [...document.querySelectorAll<HTMLElement>(".conversation-canvas [data-message-id]")];
      const elements = blocks ? [...document.querySelectorAll<HTMLElement>("[data-workbench-block]")] : messages;
      // Horizontal bounds keep settings and unrelated controls out of the targets.
      const containsPointer = (item: HTMLElement) => {
        const rect = item.getBoundingClientRect();
        return current.x >= rect.left - 24 && current.x <= rect.right + 24 && current.y >= rect.top && current.y <= rect.bottom;
      };
      const element = elements.find(containsPointer);
      if (!element && blocks) {
        const empty = messages.find((item) => !item.querySelector("[data-workbench-block]") && containsPointer(item));
        if (empty) {
          const id = empty.dataset.messageId!;
          current.drop = { before: { messageId: id }, marker: id, edge: "after" };
          setMarker((previous) => previous?.id === id && previous.edge === "after" ? previous : { id, edge: "after" });
          return;
        }
      }
      if (!element) { current.drop = undefined; setMarker(undefined); return; }
      const rect = element.getBoundingClientRect();
      const after = current.y > rect.top + rect.height / 2;
      const siblings = blocks ? elements.filter((item) => item.dataset.ownerMessage === element.dataset.ownerMessage) : elements;
      const beforeElement = after ? siblings[siblings.indexOf(element) + 1] : element;
      const before = blocks ? { messageId: element.dataset.ownerMessage!, ...(beforeElement ? { blockId: beforeElement.dataset.workbenchBlock! } : {}) }
        : beforeElement ? { messageId: beforeElement.dataset.messageId! } : undefined;
      const id = blocks ? element.dataset.workbenchBlock! : element.dataset.messageId!;
      const edge = after ? "after" : "before";
      current.drop = { before, marker: id, edge };
      // React may process this after another move/frame clears or replaces current.drop.
      // Capture this hit's values so the queued updater never reads the mutable gesture.
      setMarker((previous) => previous?.id === id && previous.edge === edge ? previous : { id, edge });
    }
    function tick() {
      const current = gesture.current;
      if (!current?.active) return;
      const amount = current.y < 72 ? -12 : current.y > window.innerHeight - 72 ? 12 : 0;
      if (amount) window.scrollBy(0, amount);
      locate(); frame = requestAnimationFrame(tick);
    }
    const move = (event: PointerEvent) => {
      const current = gesture.current;
      if (!current || current.pointerId !== event.pointerId) return;
      if (callbacks.current.disabled) { finish(true); return; }
      current.x = event.clientX; current.y = event.clientY;
      if (!current.active && Math.hypot(current.x - current.startX, current.y - current.startY) > 6) {
        current.active = true; setDragging(true); frame = requestAnimationFrame(tick);
      }
      if (current.active) { event.preventDefault(); locate(); }
    };
    const up = (event: PointerEvent) => { if (event.pointerId === gesture.current?.pointerId) finish(false); };
    const cancel = () => finish(true);
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && gesture.current) { event.preventDefault(); finish(true); } };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", up); window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key); window.addEventListener("blur", cancel);
    return () => { cancelAnimationFrame(frame); gesture.current = undefined;
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel); window.removeEventListener("keydown", key); window.removeEventListener("blur", cancel); };
  }, []);
  function start(event: ReactPointerEvent<HTMLElement>, source: SortTarget) {
    if (callbacks.current.disabled || event.button !== 0) return;
    event.preventDefault(); event.currentTarget.focus();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    gesture.current = { source, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, pointerId: event.pointerId, active: false };
  }
  return { start, marker, dragging };
}
