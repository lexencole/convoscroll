import { afterAll, describe, expect, it, vi } from "vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { inlineExtensions, editableContent } from "./inline-extensions";
import { editorToMarkdown, markdownToEditor } from "./markdown-adapter";
import { applyInlineSlash, filterSlashCommands, findSlashMatch, slashCommands, splitAtSlash } from "./slash-commands";

const reject = vi.fn();
const editor = new Editor({ extensions: inlineExtensions({ onReject: reject, onMath: vi.fn() }) });
afterAll(() => editor.destroy());
const paragraph = (text: string): JSONContent => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
function load(content: JSONContent[], position?: number) {
  editor.commands.setContent({ type: "doc", content }, { emitUpdate: false });
  editor.commands.setTextSelection(position ?? editor.state.doc.content.size - 1);
}

describe("slash command detection and insertion", () => {
  it("recognizes an entire command paragraph at the caret and filters Chinese, English and shorthand", () => {
    load([paragraph("前段"), paragraph("/代码")]);
    expect(findSlashMatch(editor.state)).toMatchObject({ query: "代码", from: 5, to: 8, start: 4, end: 9 });
    expect(filterSlashCommands("CODE").map(item => item.id)).toEqual(["codeBlock"]);
    expect(filterSlashCommands("表格").map(item => item.id)).toEqual(["table"]);
    expect(filterSlashCommands("h2").map(item => item.id)).toEqual(["heading2"]);
    expect(filterSlashCommands("标题2").map(item => item.id)).toEqual(["heading2"]);
    expect(filterSlashCommands("missing")).toEqual([]);
  });
  it.each(["内容 /", "https://example.com/", "/usr/local", "//", "/code next", "/" + "a".repeat(41)])("keeps literal slash text %s", text => {
    load([paragraph(text)]); expect(findSlashMatch(editor.state)).toBeUndefined();
  });
  it("ignores code, inline atoms, nested paragraphs, nonempty selections and text after the caret", () => {
    for (const node of [
      { type: "codeBlock", content: [{ type: "text", text: "/code" }] },
      { type: "paragraph", content: [{ type: "text", text: "/code", marks: [{ type: "code" }] }] },
      { type: "paragraph", content: [{ type: "hardBreak" }, { type: "text", text: "/code" }] },
      { type: "paragraph", content: [{ type: "inlineMath", attrs: { latex: "x" } }, { type: "text", text: "/code" }] },
    ]) { load([node]); expect(findSlashMatch(editor.state)).toBeUndefined(); }
    editor.commands.setContent(markdownToEditor("- /code"), { emitUpdate: false });
    editor.commands.setTextSelection(8); expect(findSlashMatch(editor.state)).toBeUndefined();
    load([paragraph("/code")], 3); expect(findSlashMatch(editor.state)).toBeUndefined();
    editor.commands.setTextSelection({ from: 1, to: 6 }); expect(findSlashMatch(editor.state)).toBeUndefined();
  });
  it("splits around the command without losing formatted content or code", () => {
    editor.commands.setContent(markdownToEditor("前段 **保留**\n\n/file\n\n```js\nconst x = 1;\n```"), { emitUpdate: false });
    let position = 0;
    editor.state.doc.descendants((node, offset) => { if (node.type.name === "paragraph" && node.textContent === "/file") position = offset + node.nodeSize - 1; });
    editor.commands.setTextSelection(position);
    const split = splitAtSlash(editor.state, findSlashMatch(editor.state)!);
    expect(split.source).toContain("/file");
    expect(split.before.trim()).toBe("前段 **保留**");
    expect(split.after.trim()).toBe("```js\nconst x = 1;\n```");
  });
  it.each(slashCommands.filter(command => !command.block))("applies $id in one transaction and retains surrounding paragraphs", command => {
    load([paragraph("前段"), paragraph("/"), paragraph("后段")], 6);
    const transactions: string[] = [];
    const track = () => { transactions.push(editorToMarkdown(editor.getJSON())); };
    editor.on("update", track);
    try {
      expect(applyInlineSlash(editor, command, findSlashMatch(editor.state)!)).toBe(true);
      expect(transactions).toHaveLength(1);
      const source = editorToMarkdown(editor.getJSON());
      expect(source).toContain("前段"); expect(source).toContain("后段"); expect(source).not.toContain("/");
      expect(() => editableContent(source)).not.toThrow();
      const node = editor.state.doc.child(1);
      if (command.id.startsWith("heading")) { expect(node.type.name).toBe("heading"); expect(node.attrs.level).toBe(Number(command.id.at(-1))); }
      else if (command.id === "taskList") expect(node.firstChild?.attrs.checked).toBe(false);
      else expect(node.type.name).toBe(command.id);
    } finally { editor.off("update", track); }
  });
});
