import { useEffect } from "react";

/**
 * Keeps the phone editing bar in sight while the on-screen keyboard is up.
 *
 * iOS does not shrink the layout viewport for the keyboard; it lets the page scroll
 * underneath, so a bar stuck to the top of the layout viewport can end up above the
 * visible area. The bottom is no better: Safari floats its own form bar (∧ ∨ ✓) and
 * address pill above the keyboard. So the bar stays at the top and follows the
 * visible area, read from the visual viewport and published as CSS variables:
 *
 * - `--ui-viewport-top`: where the visible area starts inside the layout viewport;
 * - `--ui-keyboard-inset`: how much of the layout viewport the keyboard covers;
 * - `--ui-edit-bar`: the bar's height, so notices can sit just below it;
 * - `data-keyboard-open` on <html> while a keyboard is up.
 */
export function useEditBar(bar: HTMLElement | null) {
  useEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    let frame = 0;
    function update() {
      frame = 0;
      const active = document.activeElement;
      const editable = active instanceof HTMLElement && (
        active.isContentEditable || active.getAttribute("contenteditable") === "true"
        || (active instanceof HTMLTextAreaElement && !active.readOnly && !active.disabled)
        || (active instanceof HTMLInputElement && !active.readOnly && !active.disabled
          && ["text", "search", "email", "url", "tel", "password", "number"].includes(active.type))
      );
      // Panning changes offsetTop, not keyboard height. Normalize pinch/input zoom
      // before detecting occlusion; a zoomed page alone is not an open keyboard.
      const covered = viewport ? Math.max(0, window.innerHeight - viewport.height * (viewport.scale || 1)) : 0;
      const keyboard = Boolean(editable && covered > 120);
      const top = keyboard && viewport ? Math.max(0, Math.round(viewport.offsetTop)) : 0;
      const inset = keyboard && viewport ? Math.max(0, Math.round(window.innerHeight - viewport.height - top)) : 0;
      for (const [name, value] of [["--ui-viewport-top", `${top}px`], ["--ui-keyboard-inset", `${inset}px`]]) {
        if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
      }
      if (root.hasAttribute("data-keyboard-open") !== keyboard) root.toggleAttribute("data-keyboard-open", keyboard);
    }
    function schedule() { if (!frame) frame = window.requestAnimationFrame(update); }
    update();
    window.addEventListener("resize", schedule);
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    return () => {
      window.removeEventListener("resize", schedule);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      if (frame) window.cancelAnimationFrame(frame);
      for (const name of ["--ui-viewport-top", "--ui-keyboard-inset"]) root.style.removeProperty(name);
      root.removeAttribute("data-keyboard-open");
    };
  }, []);

  useEffect(() => {
    if (!bar) return;
    const root = document.documentElement;
    const measure = () => root.style.setProperty("--ui-edit-bar", `${Math.round(bar.getBoundingClientRect().height)}px`);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(bar);
    return () => { observer?.disconnect(); root.style.removeProperty("--ui-edit-bar"); };
  }, [bar]);
}
