import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { ItalicCaret } from "./italic-caret";

const editors: Editor[] = [];
const tick = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
afterEach(() => { editors.splice(0).forEach((editor) => editor.destroy()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup(finePointer = true) {
  vi.stubGlobal("matchMedia", () => Object.assign(new EventTarget(), { matches: finePointer }));
  const editor = new Editor({ extensions: [StarterKit, ItalicCaret], content: "<p><em>斜体文字</em></p>" });
  editors.push(editor);
  vi.spyOn(editor.view, "hasFocus").mockReturnValue(true);
  vi.spyOn(editor.view, "coordsAtPos").mockReturnValue({ top: 20, bottom: 40, left: 60, right: 60 });
  vi.spyOn(editor.view.dom, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 80, left: 0, right: 100, width: 100, height: 80, x: 0, y: 0, toJSON() {} });
  editor.commands.setTextSelection(5);
  return editor;
}

describe("italic caret", () => {
  it("clears italic edges without treating a bold boundary as an italic edge", async () => {
    const editor = setup();
    editor.commands.setContent("<p><em>斜<strong>体</strong></em>正文</p>");
    const before = editor.getJSON();
    const caret = document.querySelector<HTMLElement>(".inline-italic-caret")!;
    editor.commands.setTextSelection(1);
    await tick();
    expect(caret).toHaveAttribute("data-edge", "start");
    editor.commands.setTextSelection(2);
    await tick();
    expect(caret).not.toHaveAttribute("data-edge");
    editor.commands.setTextSelection(3);
    await tick();
    expect(caret).toHaveAttribute("data-edge", "end");
    editor.commands.setTextSelection(4);
    await tick();
    expect(caret.hidden).toBe(true);
    expect(editor.getJSON()).toEqual(before);
  });

  it("paints outside the editor while preserving source and native selection", async () => {
    const editor = setup();
    const before = editor.getJSON();
    await tick();
    const caret = document.querySelector<HTMLElement>(".inline-italic-caret")!;
    expect(caret.hidden).toBe(false);
    expect(caret.parentElement).toBe(document.body);
    expect(caret.style.left).toBe("60px");
    expect(editor.view.dom).toHaveAttribute("data-italic-caret");
    expect(editor.getJSON()).toEqual(before);
    expect(editor.state.selection.from).toBe(5);
    const dom = editor.view.dom;
    editor.destroy();
    expect(caret.isConnected).toBe(false);
    expect(dom).not.toHaveAttribute("data-italic-caret");
  });

  it("returns to the native caret for selections, composition and blur", async () => {
    const editor = setup();
    await tick();
    editor.commands.setTextSelection({ from: 1, to: 5 });
    await tick();
    expect(editor.view.dom).not.toHaveAttribute("data-italic-caret");
    editor.commands.setTextSelection(5);
    await tick();
    editor.view.dom.dispatchEvent(new CompositionEvent("compositionstart"));
    expect(editor.view.dom).not.toHaveAttribute("data-italic-caret");
    await tick();
    expect(editor.view.dom).not.toHaveAttribute("data-italic-caret");
    editor.view.dom.dispatchEvent(new CompositionEvent("compositionend"));
    editor.view.dom.dispatchEvent(new FocusEvent("blur"));
    expect(editor.view.dom).not.toHaveAttribute("data-italic-caret");
  });

  it("keeps the native touch caret and handles plain text after italic text", async () => {
    const touch = setup(false);
    await tick();
    expect(touch.view.dom).not.toHaveAttribute("data-italic-caret");
    const editor = setup();
    await tick();
    editor.commands.unsetItalic();
    editor.commands.insertContent("正文");
    await tick();
    expect(editor.view.dom).not.toHaveAttribute("data-italic-caret");
    expect(editor.getText()).toBe("斜体文字正文");
  });
});
