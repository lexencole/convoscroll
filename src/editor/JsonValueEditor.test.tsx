import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JsonValueEditor } from "./JsonValueEditor";

describe("JsonValueEditor", () => {
  it("keeps incomplete JSON in the field and only submits valid values", () => {
    const onValidChange = vi.fn();
    render(<JsonValueEditor id="json" label="输入 JSON" value={{ ok: true }} onValidChange={onValidChange} />);
    const input = screen.getByLabelText("输入 JSON");

    fireEvent.change(input, { target: { value: "{" } });
    expect(input).toHaveValue("{");
    expect(screen.getByText(/暂未写入预览/)).toBeInTheDocument();
    expect(onValidChange).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "{\"ok\":false}" } });
    expect(onValidChange).toHaveBeenCalledWith({ ok: false });
    expect(screen.queryByText(/暂未写入预览/)).not.toBeInTheDocument();
  });
});
