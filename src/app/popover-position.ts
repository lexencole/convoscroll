/** Fixed portals and DOM rectangles share layout-viewport coordinates. */
export function visibleViewport() {
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft ?? 0;
  const top = viewport?.offsetTop ?? 0;
  const width = viewport?.width ?? window.innerWidth;
  const height = viewport?.height ?? window.innerHeight;
  return { left, top, width, height, right: left + width, bottom: top + height };
}

export function placePopover(anchor: DOMRect, size: { width: number; height: number }, {
  maxHeight = 280, align = "start", gap = 6, horizontalMargin = 8,
}: { maxHeight?: number; align?: "start" | "end"; gap?: number; horizontalMargin?: number } = {}) {
  const viewport = visibleViewport();
  const margin = 8;
  const width = Math.min(size.width, Math.max(0, viewport.width - horizontalMargin * 2));
  const below = Math.max(0, viewport.bottom - margin - anchor.bottom - gap);
  const above = Math.max(0, anchor.top - gap - viewport.top - margin);
  const expected = Math.min(size.height, maxHeight);
  const opensBelow = below >= expected || below >= above;
  const limit = Math.min(maxHeight, opensBelow ? below : above, viewport.height - margin * 2);
  const height = Math.max(0, Math.min(size.height, limit));
  const top = opensBelow ? anchor.bottom + gap : anchor.top - height - gap;
  const left = align === "end" ? anchor.right - width : anchor.left;
  return {
    left: Math.max(viewport.left + horizontalMargin, Math.min(left, viewport.right - width - horizontalMargin)),
    top: Math.max(viewport.top + margin, Math.min(top, viewport.bottom - height - margin)),
    width, maxHeight: Math.max(0, limit),
  };
}

const naturalWidths = new WeakMap<HTMLElement, number>();

/** Retain the opening CSS width while the visible viewport temporarily clamps it. */
export function measurePopover(panel: HTMLElement) {
  const width = naturalWidths.get(panel) ?? panel.offsetWidth;
  naturalWidths.set(panel, width);
  return { width, height: panel.scrollHeight + panel.offsetHeight - panel.clientHeight };
}

/** Ignore the popup's own scrolling; coalesce viewport movement into one frame. */
export function observePopoverPosition(panel: HTMLElement | null, update: () => void) {
  let frame = 0;
  const viewport = window.visualViewport;
  function schedule(event: Event) {
    if (event.type === "scroll" && event.target instanceof Node && panel?.contains(event.target)) return;
    if (!frame) frame = window.requestAnimationFrame(() => { frame = 0; update(); });
  }
  window.addEventListener("resize", schedule);
  window.addEventListener("scroll", schedule, true);
  viewport?.addEventListener("resize", schedule);
  viewport?.addEventListener("scroll", schedule);
  return () => {
    window.removeEventListener("resize", schedule);
    window.removeEventListener("scroll", schedule, true);
    viewport?.removeEventListener("resize", schedule);
    viewport?.removeEventListener("scroll", schedule);
    if (frame) window.cancelAnimationFrame(frame);
  };
}

/** Reveal keyboard navigation inside its menu without scrolling the page. */
export function revealPopoverItem(panel: HTMLElement | null, item: HTMLElement | null) {
  if (!panel || !item) return;
  const bounds = panel.getBoundingClientRect();
  const rect = item.getBoundingClientRect();
  if (rect.top < bounds.top) panel.scrollTop -= bounds.top - rect.top;
  else if (rect.bottom > bounds.bottom) panel.scrollTop += rect.bottom - bounds.bottom;
}

/** Wait for inherited visibility to update before moving focus into a measured portal. */
export function focusPopoverItem(panel: HTMLElement | null, item: HTMLElement | null) {
  if (!item) return;
  let frame = 0;
  const focus = () => {
    if (!item.isConnected) return;
    if (getComputedStyle(item).visibility === "hidden") {
      frame = window.requestAnimationFrame(focus);
      return;
    }
    item.focus({ preventScroll: true });
    revealPopoverItem(panel, item);
  };
  focus();
  return () => { if (frame) window.cancelAnimationFrame(frame); };
}
