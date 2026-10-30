import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { editableContent, inlineExtensions } from "./inline-extensions";

let editor: Editor | undefined;
afterEach(() => { editor?.destroy(); editor = undefined; });

function editorWith(source: string) {
  editor = new Editor({ extensions: inlineExtensions({ onReject: vi.fn(), onMath: vi.fn() }), content: editableContent(source) });
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  return editor;
}

/** Types one character at a time through the same path as the browser's text input. */
function type(current: Editor, text: string) {
  for (const character of Array.from(text)) {
    const { from, to } = current.state.selection;
    const view = current.view;
    const handled = view.someProp("handleTextInput", (handle) => handle(view, from, to, character, () => view.state.tr.insertText(character, from, to)));
    if (!handled) view.dispatch(view.state.tr.insertText(character, from, to));
  }
}

function paragraph(current: Editor) {
  return current.getHTML().replace(/^<p>|<\/p>$/g, "");
}

describe("Markdown shortcuts after Chinese text", () => {
  it("turns bold, italic and strikethrough into formatting right after Chinese characters", () => {
    const current = editorWith("");
    type(current, "这是**粗体**和*斜体*，~~删掉~~");
    expect(paragraph(current)).toBe("这是<strong>粗体</strong>和<em>斜体</em>，<s>删掉</s>");
  });

  it("converts after full-width punctuation and quotes", () => {
    const current = editorWith("");
    type(current, "他说：“*然后呢*”。**好**");
    expect(paragraph(current)).toBe("他说：“<em>然后呢</em>”。<strong>好</strong>");
  });

  it("keeps the earlier rules for line starts and spaces, and leaves Latin text alone", () => {
    const current = editorWith("");
    type(current, "**开头** a*b*c 2*3*4");
    expect(paragraph(current)).toBe("<strong>开头</strong> a*b*c 2*3*4");
  });

  it("puts the asterisks back when Backspace follows the conversion", () => {
    const current = editorWith("");
    type(current, "这是**粗体**");
    expect(paragraph(current)).toBe("这是<strong>粗体</strong>");
    const view = current.view;
    view.someProp("handleKeyDown", (handle) => handle(view, new KeyboardEvent("keydown", { key: "Backspace" })));
    expect(paragraph(current)).toBe("这是**粗体**");
  });
});
