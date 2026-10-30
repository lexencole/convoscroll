import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { getFixture, type FixtureKey } from "../../data/fixtures";
import { MarkdownBody } from "../../renderer/MarkdownBody";
import { editableContent, inlineExtensions } from "./inline-extensions";
import { editorToMarkdown } from "./markdown-adapter";

const editors: Editor[] = [];
afterEach(() => { editors.splice(0).forEach((editor) => editor.destroy()); cleanup(); });

function editorFor(source: string) {
  const editor = new Editor({ extensions: inlineExtensions({ onReject: vi.fn(), onMath: vi.fn() }), content: editableContent(source) });
  editors.push(editor);
  return editor;
}

const keptIn = (root: ParentNode) => [...root.querySelectorAll(".keep-together")].map((span) => span.textContent);

function editable(source: string) {
  try { editableContent(source); return true; } catch { return false; }
}

describe("editor line ends", () => {
  it("keeps the same characters together as the preview for every sample paragraph", () => {
    let compared = 0;
    for (const key of ["story", "rich", "long", "basic"] satisfies FixtureKey[]) {
      const fixture = getFixture(key);
      if (fixture.status !== "valid") throw new Error(`${key} fixture must be valid.`);
      for (const block of fixture.document.messages.flatMap((message) => message.blocks)) {
        if (block.type !== "markdown" || !editable(block.source)) continue;
        const preview = render(<MarkdownBody source={block.source} />);
        expect(keptIn(editorFor(block.source).view.dom), `${key}: ${block.source.slice(0, 40)}`).toEqual(keptIn(preview.container));
        preview.unmount();
        compared++;
      }
    }
    expect(compared).toBeGreaterThan(20);
  });

  it("only changes the display, not the document", () => {
    const source = "小时候天天喊着要出墙看海的明明是他啊，怎么真到了，**一点都不开心？**";
    const editor = editorFor(source);
    expect(keptIn(editor.view.dom)).toEqual(["开心？"]);
    expect(editorToMarkdown(editor.getJSON()).trim()).toBe(source);
  });

  it("moves with the text while an input method composes and recomputes afterwards", async () => {
    const editor = editorFor("一点都不开心");
    const end = editor.state.doc.content.size - 1;
    editor.view.dispatch(editor.state.tr.insertText("ni", end).setMeta("composition", 1));
    expect(keptIn(editor.view.dom)).toEqual(["不开心ni"]);
    editor.view.dom.dispatchEvent(new CompositionEvent("compositionend"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(keptIn(editor.view.dom)).toEqual(["心ni"]);
  });

  it("recomputes on ordinary typing", () => {
    const editor = editorFor("一点都不开心");
    editor.view.dispatch(editor.state.tr.insertText("啊。", editor.state.doc.content.size - 1));
    expect(keptIn(editor.view.dom)).toEqual(["心啊。"]);
  });
  it("does not take focus back when another field is selected before composition cleanup", async () => {
    const editor = editorFor("你好 懂啊");
    const { container, getByLabelText } = render(<><div /><input aria-label="另一个字段" /></>);
    container.firstElementChild!.append(editor.view.dom);
    editor.commands.setTextSelection(6); editor.view.focus();
    editor.view.dom.dispatchEvent(new CompositionEvent("compositionend"));
    getByLabelText("另一个字段").focus();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(getByLabelText("另一个字段")).toHaveFocus();
    expect(editor.state.selection.head).toBe(6);
    expect(editor.state.doc.textContent).toBe("你好 懂啊");
  });
  it("keeps a newly selected range instead of forcing the caret to the paragraph end", async () => {
    const editor = editorFor("你好 懂啊 后文");
    const { container } = render(<div />);
    container.firstElementChild!.append(editor.view.dom);
    editor.view.focus();
    editor.view.dom.dispatchEvent(new CompositionEvent("compositionend"));
    editor.commands.setTextSelection({ from: 6, to: 4 });
    await new Promise(resolve => setTimeout(resolve, 0));
    const selection = document.getSelection()!;
    expect(editor.state.selection.anchor).toBe(6);
    expect(editor.state.selection.head).toBe(4);
    expect(editor.view.posAtDOM(selection.anchorNode!, selection.anchorOffset)).toBe(6);
    expect(editor.view.posAtDOM(selection.focusNode!, selection.focusOffset)).toBe(4);
  });
});
