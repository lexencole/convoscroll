import type { Locale } from "../../i18n/locale";
import type { LocalizedText } from "../../i18n/messages";
import { errorMessage } from "../../i18n/messages";
import { Extension, getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { BlockMath, InlineMath } from "@tiptap/extension-mathematics";
import { Plugin } from "@tiptap/pm/state";
import type { Node } from "@tiptap/pm/model";
import type { EditorView } from "@tiptap/pm/view";
import { editorToMarkdown, InlineCompatibilityError, markdownToEditor, safeHref } from "./markdown-adapter";
import { CjkMarkInputRules } from "./cjk-mark-input-rules";
import { InlineCodeHighlight } from "./code-highlighting";
import { KeepLineEnd } from "./inline-keep-line-end";
import { ItalicCaret } from "./italic-caret";
import { TaskItems } from "./task-items";

export function inlineExtensions({
  onReject, onMath, getCanvasLocale = () => "zh-CN", getUiLocale = () => "zh-CN",
}: {
  getCanvasLocale?: () => Locale;
  getUiLocale?: () => Locale;
  onReject: (message: LocalizedText) => void;
  onMath: (node: Node, position: number) => void;
}) {
  return [
    StarterKit.configure({
      underline: false, trailingNode: false, undoRedo: false,
      link: { openOnClick: false, autolink: false, linkOnPaste: false, isAllowedUri: safeHref },
    }),
    CjkMarkInputRules,
    TaskItems.configure({ getLocale: getUiLocale }),
    InlineCodeHighlight.configure({ getLocale: getCanvasLocale }),
    KeepLineEnd,
    ItalicCaret,
    TableKit.configure({ table: { resizable: false, renderWrapper: true, View: null, HTMLAttributes: { style: "width: 100%" } } }),
    InlineMath.configure({ katexOptions: { trust: false, throwOnError: false }, onClick: onMath }),
    BlockMath.configure({ katexOptions: { trust: false, throwOnError: false, displayMode: true }, onClick: onMath }),
    Extension.create({
      name: "preserveMarkdown",
      addProseMirrorPlugins() {
        return [new Plugin({
          filterTransaction(transaction) {
            if (!transaction.docChanged) return true;
            try {
              // Use the same schema check as mounting/reopening the editor, so
              // a change cannot save successfully and then disable its own editor.
              editableContent(editorToMarkdown(transaction.doc.toJSON()));
              return true;
            } catch (cause) {
              queueMicrotask(() => onReject(errorMessage(cause, "这个改动没法用 Markdown 保存，已取消。")));
              return false;
            }
          },
        })];
      },
    }),
  ];
}

const compatibilitySchema = getSchema(inlineExtensions({ onReject: () => undefined, onMath: () => undefined }));

export function editableContent(source: string) {
  const content = markdownToEditor(source);
  if (!content.content?.length) content.content = [{ type: "paragraph" }];
  try {
    const node = compatibilitySchema.nodeFromJSON(content);
    node.check();
    // Also rejects ragged tables before the table plugin can silently repair them.
    editorToMarkdown(node.toJSON());
    return content;
  } catch (cause) {
    if (cause instanceof InlineCompatibilityError) throw cause;
    throw new InlineCompatibilityError();
  }
}

export function insertMultilineCode(view: EditorView, event: InputEvent): boolean {
  if (event.isComposing || event.inputType !== "insertText" || !event.data?.includes("\n")) return false;
  if (view.state.selection.$from.parent.type.name !== "codeBlock") return false;
  // Chromium splits one multiline insertText into several DOM mutations. Keep it
  // one model transaction so a React save render cannot publish the deleted half.
  event.preventDefault();
  view.dispatch(view.state.tr.insertText(event.data));
  return true;
}
