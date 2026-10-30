import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkbenchNotice, type WorkbenchNoticeValue } from "./WorkbenchNotice";

const notice: WorkbenchNoticeValue = { id: 1, message: "已换成新内容，可撤销。", tone: "status" };
afterEach(() => vi.useRealTimers());

describe("workbench notices", () => {
  it("expires ordinary confirmations without moving focus", () => {
    vi.useFakeTimers(); const dismiss = vi.fn();
    render(<WorkbenchNotice notice={notice} onDismiss={dismiss} />);
    const active = document.activeElement;
    // Notices drop the closing "。"; it would leave a blank at the end of the pill.
    expect(screen.getByRole("status").textContent).toBe("已换成新内容，可撤销");
    act(() => vi.advanceTimersByTime(5999)); expect(dismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1)); expect(dismiss).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(active);
  });
  it("keeps errors until the user dismisses them", () => {
    vi.useFakeTimers(); const dismiss = vi.fn();
    render(<WorkbenchNotice notice={{ ...notice, tone: "alert", message: "文件没能保存。" }} onDismiss={dismiss} />);
    act(() => vi.advanceTimersByTime(60000)); expect(dismiss).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toBe("文件没能保存");
    fireEvent.click(screen.getByRole("button", { name: "关闭提示" })); expect(dismiss).toHaveBeenCalledOnce();
  });
  it("gives readers a fresh interval after pointer hover", () => {
    vi.useFakeTimers(); const dismiss = vi.fn();
    render(<WorkbenchNotice notice={notice} onDismiss={dismiss} />);
    const surface = screen.getByRole("status").closest("aside")!;
    act(() => vi.advanceTimersByTime(3000)); fireEvent.pointerEnter(surface);
    act(() => vi.advanceTimersByTime(10000)); expect(dismiss).not.toHaveBeenCalled();
    fireEvent.pointerLeave(surface);
    act(() => vi.advanceTimersByTime(5999)); expect(dismiss).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1)); expect(dismiss).toHaveBeenCalledOnce();
  });
  it("never disappears under keyboard focus", () => {
    vi.useFakeTimers(); const dismiss = vi.fn();
    render(<WorkbenchNotice notice={notice} onDismiss={dismiss} />);
    const close = screen.getByRole("button", { name: "关闭提示" });
    act(() => close.focus()); act(() => vi.advanceTimersByTime(20000));
    expect(dismiss).not.toHaveBeenCalled(); expect(close).toHaveFocus();
    act(() => close.blur()); act(() => vi.advanceTimersByTime(6000));
    expect(dismiss).toHaveBeenCalledOnce();
  });
  it("returns keyboard focus to the initiating control when closed", () => {
    vi.useFakeTimers();
    function Example() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>载入示例</button>{open && <WorkbenchNotice notice={notice} onDismiss={() => setOpen(false)} />}</>;
    }
    render(<Example />);
    const trigger = screen.getByRole("button", { name: "载入示例" });
    act(() => trigger.focus()); fireEvent.click(trigger);
    const close = screen.getByRole("button", { name: "关闭提示" });
    act(() => close.focus()); fireEvent.click(close);
    act(() => vi.runOnlyPendingTimers());
    expect(screen.queryByRole("status")).toBeNull(); expect(trigger).toHaveFocus();
  });
  it("cleans up the old confirmation timer when replaced by an error", () => {
    vi.useFakeTimers(); const dismiss = vi.fn();
    const view = render(<WorkbenchNotice notice={notice} onDismiss={dismiss} />);
    act(() => vi.advanceTimersByTime(3000));
    view.rerender(<WorkbenchNotice notice={{ ...notice, id: 2, tone: "alert" }} onDismiss={dismiss} />);
    act(() => vi.advanceTimersByTime(10000)); expect(dismiss).not.toHaveBeenCalled();
  });
  it("falls back to the document control when the initiating menu is now hidden", () => {
    vi.useFakeTimers();
    function Example() {
      const [open, setOpen] = useState(false);
      const [dismissed, setDismissed] = useState(false);
      return <><button className="document-menu__trigger">文档</button><div hidden={open}><button onClick={() => setOpen(true)}>载入示例</button></div>{open && !dismissed && <WorkbenchNotice notice={notice} onDismiss={() => setDismissed(true)} />}</>;
    }
    render(<Example />);
    const trigger = screen.getByRole("button", { name: "载入示例" });
    act(() => trigger.focus()); fireEvent.click(trigger);
    const close = screen.getByRole("button", { name: "关闭提示" });
    act(() => close.focus()); fireEvent.click(close);
    act(() => vi.runOnlyPendingTimers());
    expect(screen.getByRole("button", { name: "文档" })).toHaveFocus();
  });
});
