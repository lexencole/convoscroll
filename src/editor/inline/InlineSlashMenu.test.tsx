import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { EditorView } from "@tiptap/pm/view";
import { InlineSlashMenu } from "./InlineSlashMenu";
import { inlineExtensions } from "./inline-extensions";
import { markdownToEditor } from "./markdown-adapter";

vi.spyOn(EditorView.prototype, "coordsAtPos").mockReturnValue({ left: 30, right: 30, top: 100, bottom: 120 });
vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);
const mounted: Array<() => void> = [];
afterEach(() => { for (const cleanup of mounted.splice(0)) cleanup(); });

async function setup(source = "/", hasToolCall = false) {
  const element = document.createElement("div"); document.body.append(element);
  const editor = new Editor({ element, extensions: inlineExtensions({ onReject: vi.fn(), onMath: vi.fn() }), content: markdownToEditor(source) });
  const callbacks = { onBeforeCommand: vi.fn(), onAfterCommand: vi.fn(), onMath: vi.fn(), onInsertBlock: vi.fn(), onError: vi.fn() };
  const view = render(<InlineSlashMenu editor={editor} enabled hasToolCall={hasToolCall} {...callbacks} />);
  mounted.push(() => { view.unmount(); editor.destroy(); element.remove(); });
  await act(async () => { editor.commands.setTextSelection(editor.state.doc.content.size - 1); editor.view.focus(); });
  await screen.findByRole("listbox", { name: "添加内容" });
  return { editor, view, callbacks };
}

describe("inline slash menu", () => {
  it("keeps editing focus, exposes the active option, navigates past unavailable results and applies one command", async () => {
    const { editor, callbacks } = await setup();
    expect(editor.view.dom).toHaveFocus();
    expect(screen.getByRole("option", { name: /工具结果/ })).toBeDisabled();
    fireEvent.keyDown(editor.view.dom, { key: "End" });
    expect(screen.getByRole("option", { name: "工具调用" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(editor.view.dom, { key: "Home" });
    fireEvent.keyDown(editor.view.dom, { key: "ArrowDown" });
    const selected = screen.getByRole("option", { name: "标题 1" });
    expect(editor.view.dom).toHaveAttribute("aria-activedescendant", selected.id);
    fireEvent.keyDown(editor.view.dom, { key: "Enter" });
    expect(editor.state.doc.firstChild?.type.name).toBe("heading");
    expect(editor.state.doc.textContent).toBe("");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(callbacks.onBeforeCommand).toHaveBeenCalledTimes(1); expect(callbacks.onAfterCommand).toHaveBeenCalledTimes(1);
  });
  it("Escape keeps the slash text literal until the user starts a new command", async () => {
    const { editor } = await setup("/code");
    fireEvent.keyDown(editor.view.dom, { key: "Escape" });
    expect(editor.state.doc.textContent).toBe("/code");
    await act(async () => { editor.commands.insertContent("x"); });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await act(async () => { editor.commands.setTextSelection({ from: 1, to: editor.state.doc.content.size - 1 }); editor.commands.insertContent("/表格"); });
    expect(await screen.findByRole("option", { name: "表格" })).toBeInTheDocument();
  });
  it("preserves manual menu scrolling during viewport changes and still reveals keyboard selection", async () => {
    const { editor } = await setup();
    const panel = screen.getByRole("listbox");
    vi.spyOn(panel, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 200, 100));
    for (const [index, item] of screen.getAllByRole("option").entries()) {
      vi.spyOn(item, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, index * 44 - panel.scrollTop, 200, 44));
    }
    panel.scrollTop = 200;
    await act(async () => {
      fireEvent(window, new Event("resize"));
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    expect(panel.scrollTop).toBe(200);
    fireEvent.keyDown(editor.view.dom, { key: "Home" });
    expect(panel.scrollTop).toBe(0);
    fireEvent.keyDown(editor.view.dom, { key: "End" });
    expect(panel.scrollTop).toBeGreaterThan(200);
    fireEvent.keyDown(editor.view.dom, { key: "Home" });
    expect(panel.scrollTop).toBe(0);
  });
  it("does not consume Enter during composition, then accepts a mobile insertParagraph event", async () => {
    const { editor } = await setup("/code");
    fireEvent.compositionStart(editor.view.dom);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    fireEvent.keyDown(editor.view.dom, { key: "Enter", isComposing: true });
    fireEvent(editor.view.dom, new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertParagraph", isComposing: true }));
    expect(editor.state.doc.firstChild?.type.name).toBe("paragraph");
    expect(editor.state.doc.textContent).toBe("/code");
    fireEvent.compositionEnd(editor.view.dom);
    await screen.findByRole("option", { name: "代码块" });
    fireEvent(editor.view.dom, new InputEvent("beforeinput", { bubbles: true, cancelable: true, inputType: "insertParagraph" }));
    expect(editor.state.doc.firstChild?.type.name).toBe("codeBlock");
  });
  it("hands off attachments without deleting their command before a successful upload", async () => {
    const { editor, callbacks } = await setup("前段\n\n/file");
    const option = screen.getByRole("option", { name: "文件" });
    fireEvent.pointerDown(option); fireEvent.click(option);
    expect(callbacks.onInsertBlock).toHaveBeenCalledWith("file", expect.objectContaining({ before: "前段\n", after: "" }), editor.view.dom);
    expect(editor.state.doc.textContent).toBe("前段/file");
    expect(callbacks.onError).not.toHaveBeenCalled();
  });
  it("opens the existing formula editor after adding a block formula", async () => {
    const { callbacks } = await setup("/math");
    fireEvent.click(screen.getByRole("option", { name: "公式" }));
    expect(callbacks.onMath).toHaveBeenCalledWith(expect.objectContaining({ attrs: expect.objectContaining({ latex: "E = mc^2" }) }), 0);
  });
  it("keeps unmatched text, closes on blur and removes the editor's popup attributes", async () => {
    const { editor } = await setup("/unmatched");
    expect(screen.getByRole("status")).toHaveTextContent("没有匹配的内容");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
    const button = document.createElement("button"); document.body.append(button);
    try {
      await act(async () => { button.focus(); });
      await waitFor(() => expect(screen.queryByRole("listbox")).not.toBeInTheDocument());
      expect(editor.state.doc.textContent).toBe("/unmatched");
      expect(editor.view.dom).not.toHaveAttribute("aria-controls");
    } finally { button.remove(); }
  });
});
