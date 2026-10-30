import { translator } from "../../i18n/messages";
import type { Locale } from "../../i18n/locale";
import { Extension } from "@tiptap/core";
import type { Node } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { getHighlighter, HIGHLIGHT_THEME, normalizeLanguage, supportedLanguages } from "../../renderer/ShikiCodeBlock";

type Highlighter = Awaited<ReturnType<typeof getHighlighter>>;
const key = new PluginKey<DecorationSet>("inlineCodeHighlight");

export function codeDecorations(document: Node, highlighter?: Highlighter, failed: ReadonlySet<string> = new Set(), locale: Locale = "zh-CN"): DecorationSet {
  const decorations: Decoration[] = [];
  const t = translator(locale);
  document.descendants((node, position) => {
    if (node.type.name !== "codeBlock") return;
    const language = normalizeLanguage(node.attrs.language);
    const supported = supportedLanguages.has(language);
    const ready = highlighter?.getLoadedLanguages().includes(language);
    let status = supported ? (ready ? "ready" : failed.has(language) ? "fallback" : "loading") : "plain";
    if (supported && ready && highlighter) {
      try {
        for (const line of highlighter.codeToTokensBase(node.textContent, { lang: language, theme: HIGHLIGHT_THEME })) {
          for (const token of line) {
            if (!token.content.length || !token.color) continue;
            const from = position + 1 + token.offset;
            decorations.push(Decoration.inline(from, from + token.content.length, { style: `color: ${token.color}`, class: "inline-code-token" }));
          }
        }
      } catch { status = "fallback"; }
    }
    const caption = `${language}${status === "plain" && language !== "text" ? t(" · 纯文本") : status === "fallback" ? t(" · 高亮暂不可用") : ""}`;
    decorations.push(Decoration.node(position, position + node.nodeSize, { class: "inline-code-block", "data-code-language": caption, "data-highlight-state": status }));
    return false;
  });
  return DecorationSet.create(document, decorations);
}

// Decorations only color existing text. They never replace code DOM, change the
// document, or add an undo step when the shared local highlighter finishes loading.
export const InlineCodeHighlight = Extension.create<{ getLocale: () => Locale }>({
  name: "inlineCodeHighlight",
  addOptions: () => ({ getLocale: () => "zh-CN" }),
  addProseMirrorPlugins() {
    const getLocale = this.options.getLocale;
    let highlighter: Highlighter | undefined;
    const failed = new Set<string>();
    return [new Plugin<DecorationSet>({
      key,
      state: {
        init: (_, state) => codeDecorations(state.doc, undefined, failed, getLocale()),
        apply: (transaction, previous) => transaction.docChanged || transaction.getMeta(key) || transaction.getMeta("localeChanged")
          ? codeDecorations(transaction.doc, highlighter, failed, getLocale()) : previous,
      },
      props: { decorations: (state) => key.getState(state) },
      view(view) {
        let destroyed = false;
        const requested = new Set<string>();
        let timer: ReturnType<typeof setTimeout> | undefined;
        function refresh() {
          if (destroyed) return;
          if (view.composing) { timer = setTimeout(refresh, 50); return; }
          view.dispatch(view.state.tr.setMeta(key, true).setMeta("addToHistory", false));
        }
        function load() {
          view.state.doc.descendants((node) => {
            if (node.type.name !== "codeBlock") return;
            const language = normalizeLanguage(node.attrs.language);
            if (!supportedLanguages.has(language) || requested.has(language)) return false;
            requested.add(language);
            void getHighlighter([language]).then(
              (instance) => { highlighter = instance; refresh(); },
              () => { failed.add(language); refresh(); },
            );
            return false;
          });
        }
        load();
        return { update: load, destroy() { destroyed = true; clearTimeout(timer); } };
      },
    })];
  },
});
