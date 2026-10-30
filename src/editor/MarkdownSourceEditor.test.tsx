import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownSourceEditor } from "./MarkdownSourceEditor";

describe("MarkdownSourceEditor", () => {
  it("inserts code, formula and table templates through explicit controls", () => {
    const onChange = vi.fn();
    render(<MarkdownSourceEditor id="source" value="正文" onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "代码块" }));
    fireEvent.click(screen.getByRole("button", { name: "行内公式" }));
    fireEvent.click(screen.getByRole("button", { name: "块级公式" }));
    fireEvent.click(screen.getByRole("button", { name: "表格" }));

    expect(onChange.mock.calls[0][0]).toContain("```typescript");
    expect(onChange.mock.calls[1][0]).toContain("$E = mc^2$");
    expect(onChange.mock.calls[2][0]).toContain("W_{output}");
    expect(onChange.mock.calls[3][0]).toContain("| 项目 | 说明 |");
  });
});
