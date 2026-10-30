import { describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { editableContent, inlineExtensions, insertMultilineCode } from "./inline-extensions";
import { editorToMarkdown, markdownToEditor } from "./markdown-adapter";
import { getFixture } from "../../data/fixtures";

describe("inline editing transaction safety", () => {
  it.each(["toggleBulletList", "toggleOrderedList", "toggleBlockquote"] as const)("keeps an empty %s editable after saving and reopening", (command) => {
    const editor = new Editor({ extensions: inlineExtensions({ onReject: vi.fn(), onMath: vi.fn() }), content: editableContent("") });
    try {
      editor.commands[command]();
      const source = editorToMarkdown(editor.getJSON());
      const restored = editableContent(source);
      editor.commands.setContent(restored);
      editor.commands.insertContent("继续输入");
      expect(editorToMarkdown(editor.getJSON())).toContain("继续输入");
    } finally { editor.destroy(); }
  });

  it.each(["-", "1.", "前文\n\n-", "- 第一项\n-", "- 外层\n\n  -", "-\n  - 子项", ">", ">\n> -"])("opens imported empty list or quote content: %s", (source) => {
    const editor = new Editor({ extensions: inlineExtensions({ onReject: vi.fn(), onMath: vi.fn() }), content: editableContent(source) });
    try {
      expect(() => editableContent(editorToMarkdown(editor.getJSON()))).not.toThrow();
    } finally { editor.destroy(); }
  });

  it("replaces multiline code atomically while leaving composition events to the browser", () => {
    const editor = new Editor({ extensions: inlineExtensions({ onReject: vi.fn(), onMath: vi.fn() }), content: markdownToEditor("```python\nold\n```") });
    try {
      editor.commands.setTextSelection({ from: 1, to: 4 });
      const event = new InputEvent("beforeinput", { cancelable: true, inputType: "insertText", data: "from math import sqrt\nprint(sqrt(2))" });
      expect(insertMultilineCode(editor.view, event)).toBe(true);
      expect(event.defaultPrevented).toBe(true);
      expect(editor.state.doc.firstChild?.textContent).toBe("from math import sqrt\nprint(sqrt(2))");
      expect(insertMultilineCode(editor.view, new InputEvent("beforeinput", { inputType: "insertText", data: "组合\n输入", isComposing: true }))).toBe(false);
    } finally { editor.destroy(); }
  });
  it("rejects unsupported nesting or ragged tables before mounting; accepts an empty draft", () => {
    expect(() => editableContent("**`代码上加粗`**")).toThrow(/原文已保留/);
    expect(() => editableContent("- ## 列表项以标题开头")).toThrow(/原文已保留/);
    expect(() => editableContent("| A | B |\n| --- | --- |\n| C |")).toThrow(/原文已保留/);
    expect(editableContent("").content).toEqual([{ type: "paragraph" }]);
  });
  it("round-trips every Markdown block of the default story without losing content", () => {
    const story = getFixture("story");
    if (story.status !== "valid") throw new Error("Story fixture must be valid.");
    for (const block of story.document.messages.flatMap((message) => message.blocks)) {
      if (block.type !== "markdown") continue;
      const editor = new Editor({ extensions: inlineExtensions({ onReject: vi.fn(), onMath: vi.fn() }), content: markdownToEditor(block.source) });
      try { expect(markdownToEditor(editorToMarkdown(editor.getJSON()))).toEqual(markdownToEditor(block.source)); }
      finally { editor.destroy(); }
    }
  });

  it("rejects unrepresentable table transactions before content changes", async () => {
    const onReject = vi.fn();
    const editor = new Editor({ extensions: inlineExtensions({ onReject, onMath: vi.fn() }), content: markdownToEditor("| A | B |\n| --- | --- |\n| C | D |") });
    try {
      const before = editor.getJSON();
      let position = 0;
      editor.state.doc.descendants((node, pos) => { if (node.type.name === "tableCell" && !position) position = pos; });
      const tr = editor.state.tr.setNodeMarkup(position, undefined, { colspan: 2 });
      editor.view.dispatch(tr);
      await Promise.resolve();
      expect(onReject).toHaveBeenCalled();
      expect(editor.getJSON()).toEqual(before);
    } finally { editor.destroy(); }
  });

  it("retains table alignment and code language after a normal text edit", () => {
    const source = "## 海\n\n| A | B |\n| :--- | ---: |\n| 1 | 2 |\n\n```python\nx = 1\n```";
    const editor = new Editor({ extensions: inlineExtensions({ onReject: vi.fn(), onMath: vi.fn() }), content: markdownToEditor(source) });
    try {
      editor.view.dispatch(editor.state.tr.insertText("边", 2));
      const saved = editorToMarkdown(editor.getJSON());
      expect(saved).toContain("海边");
      expect(saved).toContain("```python");
      expect(markdownToEditor(saved).content?.find((node) => node.type === "table")?.content?.[0].content?.map((cell) => cell.attrs?.align)).toEqual(["left", "right"]);
    } finally { editor.destroy(); }
  });
});
