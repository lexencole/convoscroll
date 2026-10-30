import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

/** A slanted desktop caret follows italic text and clears its outer edges. */
export const ItalicCaret = Extension.create({
  name: "italicCaret",
  addProseMirrorPlugins() {
    return [new Plugin({
      view(view) {
        const document = view.dom.ownerDocument;
        const window = document.defaultView!;
        const pointer = window.matchMedia?.("(hover: hover) and (pointer: fine)");
        const caret = document.createElement("span");
        caret.className = "inline-italic-caret";
        caret.setAttribute("aria-hidden", "true");
        caret.hidden = true;
        // Outside the canvas: it cannot enter the document or the exported image.
        document.body.append(caret);
        let frame = 0;
        let destroyed = false;
        let composing = false;

        function hide() {
          caret.hidden = true;
          view.dom.removeAttribute("data-italic-caret");
        }
        function draw() {
          frame = 0;
          if (destroyed) return;
          const { selection, storedMarks } = view.state;
          const marks = storedMarks ?? selection.$from.marks();
          const beforeItalic = selection.$from.nodeBefore?.marks.some((mark) => mark.type.name === "italic") ?? false;
          const afterItalic = selection.$from.nodeAfter?.marks.some((mark) => mark.type.name === "italic") ?? false;
          const italic = beforeItalic || marks.some((mark) => mark.type.name === "italic");
          if (!pointer?.matches || !view.editable || !view.hasFocus() || composing || view.composing || !selection.empty || !italic) {
            hide();
            return;
          }
          const box = view.coordsAtPos(selection.from, -1);
          const host = view.dom.getBoundingClientRect();
          if (box.bottom <= 0 || box.top >= window.innerHeight || box.left < host.left || box.left > host.right) {
            hide();
            return;
          }
          caret.style.left = `${box.left}px`;
          caret.style.top = `${box.top}px`;
          caret.style.height = `${box.bottom - box.top}px`;
          if (!beforeItalic && afterItalic) caret.dataset.edge = "start";
          else if (beforeItalic && !afterItalic) caret.dataset.edge = "end";
          else delete caret.dataset.edge;
          caret.hidden = false;
          view.dom.setAttribute("data-italic-caret", "");
          caret.getAnimations?.().forEach((animation) => { animation.currentTime = 0; });
        }
        function schedule() {
          if (!destroyed && !frame) frame = window.requestAnimationFrame(draw);
        }
        function suspend() { hide(); }
        function startComposition() { composing = true; hide(); }
        function endComposition() { composing = false; schedule(); }
        view.dom.addEventListener("focus", schedule);
        view.dom.addEventListener("blur", suspend);
        view.dom.addEventListener("compositionstart", startComposition);
        view.dom.addEventListener("compositionend", endComposition);
        window.addEventListener("scroll", schedule, true);
        window.addEventListener("resize", schedule);
        pointer?.addEventListener?.("change", schedule);
        document.fonts?.addEventListener?.("loadingdone", schedule);
        const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(schedule);
        observer?.observe(view.dom);
        schedule();
        return {
          update: schedule,
          destroy() {
            destroyed = true;
            window.cancelAnimationFrame(frame);
            observer?.disconnect();
            view.dom.removeEventListener("focus", schedule);
            view.dom.removeEventListener("blur", suspend);
            view.dom.removeEventListener("compositionstart", startComposition);
            view.dom.removeEventListener("compositionend", endComposition);
            window.removeEventListener("scroll", schedule, true);
            window.removeEventListener("resize", schedule);
            pointer?.removeEventListener?.("change", schedule);
            document.fonts?.removeEventListener?.("loadingdone", schedule);
            hide();
            caret.remove();
          },
        };
      },
    })];
  },
});
