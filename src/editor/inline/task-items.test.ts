import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { editableContent, inlineExtensions } from "./inline-extensions";
import { editorToMarkdown } from "./markdown-adapter";

let editor: Editor;
afterEach(() => { const element = editor?.options.element; editor?.destroy(); if (element instanceof HTMLElement) element.remove(); });
function open(source = "") {
  const onReject = vi.fn();
  const element = document.createElement("div"); document.body.append(element);
  editor = new Editor({ element, extensions: inlineExtensions({ onReject, onMath: vi.fn() }), content: editableContent(source) });
  editor.commands.setTextSelection(editor.state.doc.content.size - (source ? 3 : 1));
  return onReject;
}
function type(text: string) {
  for (const character of text) {
    const { from, to } = editor.state.selection;
    const view = editor.view;
    if (!view.someProp("handleTextInput", (handle) => handle(view, from, to, character, () => view.state.tr.insertText(character, from, to)))) {
      view.dispatch(view.state.tr.insertText(character, from, to));
    }
  }
}
function key(key: string, shiftKey = false) {
  editor.view.someProp("handleKeyDown", (handle) => handle(editor.view, new KeyboardEvent("keydown", { key, shiftKey })));
}
function checks() {
  const result: (boolean | null)[] = [];
  editor.state.doc.descendants((node) => { if (node.type.name === "listItem") result.push(node.attrs.checked); });
  return result;
}

describe("direct task editing", () => {
  it.each(["", " ", "x", "X"])("converts on the closing bracket and reopens an empty task: [%s]", (marker) => {
    const onReject = open();
    const checked = marker === "x" || marker === "X";
    type(`- [${marker}]`);
    expect(checks()).toEqual([checked]);
    expect(editor.state.doc.textContent).toBe("");
    const source = editorToMarkdown(editor.getJSON());
    expect(source).toBe(`- [${checked ? "x" : " "}]\n`);
    editor.commands.setContent(editableContent(source));
    expect(checks()).toEqual([checked]);
    editor.commands.setTextSelection(3);
    type("继续输入");
    expect(editor.state.doc.textContent).toBe("继续输入");
    expect(onReject).not.toHaveBeenCalled();
  });

  it("creates an unchecked next task, nests it, and can exit an empty task", () => {
    const onReject = open();
    type("- [x]完成"); key("Enter");
    expect(checks()).toEqual([true, false]);
    type("子任务"); key("Tab");
    expect(editorToMarkdown(editor.getJSON())).toContain("  - [ ] 子任务");
    key("Tab", true); key("Enter"); key("Enter");
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
    expect(editor.state.selection.$from.depth).toBe(1);
    expect(onReject).not.toHaveBeenCalled();
  });

  it("keeps ordinary paragraphs, code and literal markers unchanged", () => {
    open(); type("[ ]"); expect(checks()).toEqual([]);
    editor.commands.setContent(editableContent("- [] 原样"));
    expect(checks()).toEqual([null]); expect(editor.state.doc.textContent).toBe("[] 原样");
    editor.commands.setContent(editableContent("- 字面")); editor.commands.setTextSelection(5); type("[ ]");
    expect(checks()).toEqual([null]);
    editor.commands.setContent(editableContent("```txt\ncode\n```")); editor.commands.setTextSelection(5); type("- [x]");
    expect(checks()).toEqual([]);
  });

  it("toggles through its checkbox without moving the caret and blocks edits when disabled", () => {
    open("- [ ] 待办");
    const position = editor.state.selection.from;
    const checkbox = editor.view.dom.querySelector<HTMLInputElement>("input[type=checkbox]")!;
    expect(checkbox).not.toBeNull();
    checkbox.click(); expect(checks()).toEqual([true]);
    expect(editor.state.selection.from).toBe(position);
    expect(editorToMarkdown(editor.getJSON())).toContain("- [x] 待办");
    editor.setEditable(false);
    expect(checkbox.disabled).toBe(true);
    checkbox.click(); expect(checks()).toEqual([true]);
  });
});
