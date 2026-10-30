import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CodeLanguageControl } from "./CodeLanguageControl";

function startCustom() {
  fireEvent.click(screen.getByRole("combobox", { name: "代码语言" }));
  fireEvent.click(screen.getByRole("option", { name: "其他语言…" }));
  return screen.getByRole("textbox", { name: "其他语言" });
}

describe("contextual code language control", () => {
  it("preserves unknown or aliased language markers without a mount-time edit", () => {
    const onChange = vi.fn();
    const view = render(<CodeLanguageControl value="my_custom.lang+1" disabled={false} onChange={onChange} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("my_custom.lang+1");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    view.rerender(<CodeLanguageControl value="py" disabled={false} onChange={onChange} />);
    expect(screen.getByRole("combobox")).toHaveTextContent("py");
    expect(onChange).not.toHaveBeenCalled();
  });
  it("chooses a supported local syntax with a keyboard", () => {
    const onChange = vi.fn();
    render(<CodeLanguageControl value="text" disabled={false} onChange={onChange} />);
    const selector = screen.getByRole("combobox");
    fireEvent.click(selector);
    fireEvent.keyDown(selector, { key: "ArrowDown" });
    fireEvent.keyDown(selector, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("python");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });
  it("keeps custom edits local until confirmed and rejects unsafe markers", () => {
    const onChange = vi.fn();
    render(<CodeLanguageControl value="python" disabled={false} onChange={onChange} />);
    const input = startCustom();
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "bad label<" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "c++" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("c++");
  });
  it("cancels without changing source and returns keyboard focus to the selector", async () => {
    const onChange = vi.fn();
    render(<CodeLanguageControl value="json" disabled={false} onChange={onChange} />);
    const input = startCustom();
    fireEvent.change(input, { target: { value: "bash" } });
    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveFocus());
    expect(screen.getByRole("combobox")).toHaveTextContent("JSON");
    expect(onChange).not.toHaveBeenCalled();
  });
  it("blocks changes when editing is disabled", () => {
    const onChange = vi.fn();
    const view = render(<CodeLanguageControl value="json" disabled={false} onChange={onChange} />);
    const input = startCustom();
    view.rerender(<CodeLanguageControl value="json" disabled onChange={onChange} />);
    expect(input).toBeDisabled();
    expect(screen.getByRole("button", { name: "确定" })).toBeDisabled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
  });
});
