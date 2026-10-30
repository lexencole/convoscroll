import { Extension } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { keptRange } from "../../renderer/keep-line-end";

// The preview keeps the last characters of each paragraph together
// (renderer/keep-line-end.ts). The editor shows the same line ends with inline
// decorations, which change only the display, never the document. While an input
// method is composing, the decorations move with the text instead of being
// recomputed, so the text being composed is never re-wrapped; they are recomputed
// once the composition ends.

const key = new PluginKey<DecorationSet>("keepLineEnd");

export const KeepLineEnd = Extension.create({
  name: "keepLineEnd",
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key,
      state: {
        init: (_, state) => decorate(state.doc),
        apply(tr, decorations) {
          if (tr.getMeta("composition")) return decorations.map(tr.mapping, tr.doc);
          return tr.docChanged || tr.getMeta(key) ? decorate(tr.doc) : decorations;
        },
      },
      props: {
        decorations: (state) => key.getState(state),
        handleDOMEvents: {
          compositionend(view) {
            setTimeout(() => {
              if (view.isDestroyed || view.composing) return;
              view.dispatch(view.state.tr.setMeta(key, true));
              // Chromium can report the old text node as the current selection
              // after rewrapping. Clear that stale DOM range before syncing the
              // existing model selection; focus() does not scroll the editor.
              if (view.hasFocus()) {
                view.dom.ownerDocument.getSelection()?.removeAllRanges();
                view.focus();
              }
            });
            return false;
          },
        },
      },
    })];
  },
});

export function decorate(doc: Node): DecorationSet {
  const decorations: Decoration[] = [];
  doc.descendants((node, position) => {
    // The preview does not guard table cells.
    if (node.type.name === "table") return false;
    if (node.type.name !== "paragraph") return true;
    const range = lastTextRange(node);
    // inclusiveEnd lets text typed at the end of the run join it while composing.
    if (range) decorations.push(Decoration.inline(position + 1 + range.from, position + 1 + range.to, { class: "keep-together" }, { inclusiveEnd: true }));
    return false;
  });
  return DecorationSet.create(doc, decorations);
}

/** Mirrors the preview: the last text decides; code, formulas and line breaks end the search. */
function lastTextRange(paragraph: Node): { from: number; to: number } | undefined {
  const children: { node: Node; offset: number }[] = [];
  paragraph.forEach((node, offset) => children.push({ node, offset }));
  for (let index = children.length - 1; index >= 0; index--) {
    const { node, offset } = children[index];
    if (!node.isText || node.marks.some((mark) => mark.type.name === "code")) return undefined;
    const text = node.text ?? "";
    if (!text.trim()) continue;
    const range = keptRange(text);
    // Only closing punctuation: keep looking in the text before it.
    if (range) return { from: offset + range.start, to: offset + range.end };
  }
  return undefined;
}
