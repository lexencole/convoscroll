import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterAll, describe, expect, it, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { EditorView } from "@tiptap/pm/view";
import { caretAfterReplace, InlineMarkdownEditor } from "./InlineMarkdownEditor";
import { inlineExtensions } from "./inline-extensions";
import { markdownToEditor } from "./markdown-adapter";

// jsdom has no text-range layout. Real selection/scrolling is verified in-browser.
vi.spyOn(EditorView.prototype, "coordsAtPos").mockReturnValue({ left: 0, right: 0, top: 0, bottom: 0 });

describe("code-context toolbar", () => {
  it("uses the saved source snapshot when a slash command is opened from an imported block", async () => {
    const onInsertBlock = vi.fn();
    render(<InlineMarkdownEditor source="/reason" toolbarHost={null} active enabled initialFocus="end" label="导入正文"
      onChange={vi.fn()} onActivate={vi.fn()} onBusy={vi.fn()} onUndo={vi.fn()} onRedo={vi.fn()} onNotice={vi.fn()} onInsertBlock={onInsertBlock} />);
    fireEvent.click(await screen.findByRole("option", { name: "思考过程" }));
    expect(onInsertBlock).toHaveBeenCalledWith("reasoning", { source: "/reason", before: "", after: "" }, expect.any(HTMLElement));
  });
  it("shows only relevant code controls and keeps the source until a deliberate language edit", async () => {
    const onChange = vi.fn();
    const host = document.createElement("div");
    document.body.append(host);
    const view = render(<InlineMarkdownEditor source={'```py\nprint("sea")\n```'} toolbarHost={host}
      active enabled label="代码正文" onChange={onChange} onActivate={vi.fn()} onBusy={vi.fn()} onUndo={vi.fn()} onRedo={vi.fn()} onNotice={vi.fn()} />);
    try {
      const selector = await screen.findByRole("combobox", { name: "代码语言" });
      expect(selector).toHaveTextContent("py");
      expect(selector.parentElement).toHaveClass("select-field--toolbar");
      expect(screen.queryByRole("combobox", { name: "段落样式" })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "加粗" })).not.toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
      fireEvent.click(selector);
      expect(screen.getByRole("listbox")).toHaveClass("select-field__menu--toolbar");
      fireEvent.click(screen.getByRole("option", { name: /^JSON$/ }));
      await waitFor(() => expect(onChange).toHaveBeenCalled());
      expect(onChange.mock.calls[0][0]).toContain('```json\nprint("sea")');
      fireEvent.click(screen.getByRole("button", { name: "转为正文" }));
      expect((await screen.findByRole("combobox", { name: "段落样式" })).parentElement).toHaveClass("select-field--toolbar");
      expect(screen.getByRole("button", { name: "加粗" })).toBeInTheDocument();
    } finally { view.unmount(); host.remove(); }
  });
});

describe("caret after undo / redo", () => {
  // Both versions must share one schema, as they do inside the mounted editor.
  const editor = new Editor({ extensions: inlineExtensions({ onReject: vi.fn(), onMath: vi.fn() }) });
  afterAll(() => editor.destroy());
  function doc(source: string) {
    editor.commands.setContent(markdownToEditor(source), { emitUpdate: false });
    return editor.state.doc;
  }
  function caret(beforeSource: string, afterSource: string, fallback: number) {
    const before = doc(beforeSource);
    const after = doc(afterSource);
    const position = after.resolve(caretAfterReplace(before, after, fallback));
    return { text: position.parent.textContent, offset: position.parentOffset };
  }

  it("returns to where typed text was removed instead of moving into the next paragraph", () => {
    // The caret sat after “你好世界” at the end of the first paragraph; undo removes them.
    const fallback = 1 + "重看到第一次看海那集了。你好世界".length;
    expect(caret("重看到第一次看海那集了。你好世界\n\n大家冲进海里。", "重看到第一次看海那集了。\n\n大家冲进海里。", fallback))
      .toEqual({ text: "重看到第一次看海那集了。", offset: 12 });
  });

  it("puts the caret after restored text on redo and after a restored deletion", () => {
    expect(caret("第一段\n\n第二段", "第一段你好\n\n第二段", 4)).toEqual({ text: "第一段你好", offset: 5 });
    expect(caret("海风吹到这里", "海风吹到了这里", 5)).toEqual({ text: "海风吹到了这里", offset: 5 });
  });

  it("handles repeated characters and unchanged content", () => {
    expect(caret("啊啊", "啊啊啊", 3)).toEqual({ text: "啊啊啊", offset: 3 });
    expect(caret("啊啊啊", "啊啊", 4)).toEqual({ text: "啊啊", offset: 2 });
    expect(caret("不变", "不变", 2)).toEqual({ text: "不变", offset: 1 });
  });
});
