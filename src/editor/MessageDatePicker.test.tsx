import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MessageDatePicker } from "./MessageDatePicker";
function setup(value: string) {
  const change = vi.fn();
  render(<MessageDatePicker value={value} disabled={false} invalid={false} onChange={change} />);
  fireEvent.click(screen.getByRole("button", { name: "消息日期" }));
  return change;
}
describe("message date picker", () => {
  it("clamps month navigation at the month end and accepts a day", () => {
    const change = setup("2026-01-31");
    expect(screen.getByRole("button", { name: "2026年1月31日" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "PageDown" });
    expect(screen.getByRole("button", { name: "2026年2月28日" })).toHaveFocus();
    fireEvent.click(document.activeElement!);
    expect(change).toHaveBeenCalledWith("2026-02-28");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("supports leap day, week navigation and year navigation", () => {
    setup("2028-02-28");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(screen.getByRole("button", { name: "2028年2月29日" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "PageDown", shiftKey: true });
    expect(screen.getByRole("button", { name: "2029年2月28日" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Home" });
    expect(screen.getByRole("button", { name: "2029年2月26日" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(screen.getByRole("button", { name: "2029年2月19日" })).toHaveFocus();
  });
  it("closes without changing the saved value and restores focus on Escape", async () => {
    const change = setup("2026-09-20");
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "消息日期" })).toHaveFocus());
    expect(change).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "消息日期" }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(change).not.toHaveBeenCalled();
  });
  it.each(["0001-01-01", "9999-12-31"])("keeps keyboard navigation within the supported years at %s", value => {
    setup(value);
    const key = value.startsWith("0001") ? "PageUp" : "PageDown";
    fireEvent.keyDown(document.activeElement!, { key });
    expect(screen.getByRole("button", { name: value.startsWith("0001") ? "上个月" : "下个月" })).toBeDisabled();
    expect(document.activeElement).toHaveAttribute("data-date", value);
  });
});
