import type { Editor } from "@tiptap/core";
import type { EditorState } from "@tiptap/pm/state";
import type { IconName } from "../../app/Icon";
import type { MarkdownInsertion } from "../workbench-operations";
import { editorToMarkdown } from "./markdown-adapter";

export type SlashBlockType = "image" | "file" | "reasoning" | "toolCall" | "toolResult";
type InlineCommand = "paragraph" | "heading1" | "heading2" | "heading3" | "bulletList" | "orderedList" | "taskList" | "codeBlock" | "blockMath" | "table";
export interface SlashCommand {
  id: InlineCommand | SlashBlockType;
  label: string;
  icon: IconName;
  keywords: string;
  block?: SlashBlockType;
}
export const slashCommands: readonly SlashCommand[] = [
  { id: "paragraph", label: "正文", icon: "text", keywords: "text paragraph zhengwen" },
  { id: "heading1", label: "标题 1", icon: "text", keywords: "h1 heading title biaoti" },
  { id: "heading2", label: "标题 2", icon: "text", keywords: "h2 heading title biaoti" },
  { id: "heading3", label: "标题 3", icon: "text", keywords: "h3 heading title biaoti" },
  { id: "bulletList", label: "无序列表", icon: "list", keywords: "bullet list wuxu liebiao" },
  { id: "orderedList", label: "有序列表", icon: "list-ordered", keywords: "number ordered list 编号 liebiao" },
  { id: "taskList", label: "任务列表", icon: "check", keywords: "task todo checkbox renwu" },
  { id: "codeBlock", label: "代码块", icon: "code", keywords: "code daima" },
  { id: "blockMath", label: "公式", icon: "braces", keywords: "math formula latex gongshi" },
  { id: "table", label: "表格", icon: "document", keywords: "table biaoge" },
  { id: "image", label: "图片", icon: "image", keywords: "image photo picture tupian", block: "image" },
  { id: "file", label: "文件", icon: "paperclip", keywords: "file attachment wenjian", block: "file" },
  { id: "reasoning", label: "思考过程", icon: "spark", keywords: "reasoning think sikao", block: "reasoning" },
  { id: "toolCall", label: "工具调用", icon: "tool", keywords: "tool call gongju diaoyong", block: "toolCall" },
  { id: "toolResult", label: "工具结果", icon: "output", keywords: "tool result output jieguo", block: "toolResult" },
];

export interface SlashMatch { from: number; to: number; start: number; end: number; query: string }

/** A command owns an otherwise empty top-level paragraph, never a URL, list or code fragment. */
export function findSlashMatch(state: EditorState): SlashMatch | undefined {
  const { empty, $from } = state.selection;
  if (!empty || $from.depth !== 1 || $from.parent.type.name !== "paragraph" || $from.parentOffset !== $from.parent.content.size
    || $from.marks().some((mark) => mark.type.name === "code")) return;
  let plain = true;
  $from.parent.forEach((node) => { if (!node.isText || node.marks.some((mark) => mark.type.name === "code")) plain = false; });
  if (!plain) return;
  const match = /^\/([^\s/]{0,40})$/u.exec($from.parent.textContent);
  if (!match) return;
  return { from: $from.start(), to: $from.pos, start: $from.before(), end: $from.after(), query: match[1] };
}

export function filterSlashCommands(query: string, withBlocks = true): readonly SlashCommand[] {
  const value = query.toLocaleLowerCase();
  return slashCommands.filter((command) => (withBlocks || !command.block)
    && `${command.label.replaceAll(" ", "")} ${command.keywords}`.toLocaleLowerCase().includes(value));
}

export function splitAtSlash(state: EditorState, match: SlashMatch): Omit<MarkdownInsertion, "blockId"> {
  return {
    source: editorToMarkdown(state.doc.toJSON()),
    before: editorToMarkdown(state.doc.copy(state.doc.content.cut(0, match.start)).toJSON()),
    after: editorToMarkdown(state.doc.copy(state.doc.content.cut(match.end)).toJSON()),
  };
}

/** The deletion and format command form one editor transaction and one document undo step. */
export function applyInlineSlash(editor: Editor, command: SlashCommand, match: SlashMatch): boolean {
  const chain = editor.chain().focus().deleteRange({ from: match.from, to: match.to });
  switch (command.id) {
    case "paragraph": return chain.run();
    case "heading1": case "heading2": case "heading3": return chain.setHeading({ level: Number(command.id.at(-1)) as 1 | 2 | 3 }).run();
    case "bulletList": return chain.toggleBulletList().run();
    case "orderedList": return chain.toggleOrderedList().run();
    case "taskList": return chain.toggleBulletList().updateAttributes("listItem", { checked: false }).run();
    case "codeBlock": return chain.setCodeBlock().run();
    case "table": return chain.insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run();
    case "blockMath": return chain.insertContent({ type: "blockMath", attrs: { latex: "E = mc^2" } }).run();
    default: return false;
  }
}
