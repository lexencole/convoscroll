import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WorkbenchItemMenu, type WorkbenchMenuAction } from "./WorkbenchItemMenu";

function setup(overrides: Partial<WorkbenchMenuAction> = {}) {
  const run = vi.fn();
  const actions: WorkbenchMenuAction[] = [
    { label: "编辑身份", group: "edit", icon: "settings", run, ...overrides },
    { label: "复制消息", group: "edit", icon: "copy", run },
    { label: "上移消息", group: "order", icon: "arrow-up", disabled: true, run },
    { label: "删除消息", group: "danger", icon: "trash", run },
  ];
  const view = render(<><WorkbenchItemMenu label="消息操作" title="消息 1" actions={actions} disabled={false} /><button>外部</button></>);
  return { ...view, actions, run, trigger: screen.getByRole("button", { name: "消息操作" }) };
}

describe("WorkbenchItemMenu", () => {
  it("waits until the measured menu is visible before its initial focus", () => {
    const focus = HTMLElement.prototype.focus;
    const spy = vi.spyOn(HTMLElement.prototype, "focus").mockImplementation(function (this: HTMLElement, options) {
      // Match real browsers: jsdom otherwise allows focus inside visibility:hidden.
      if (this.closest<HTMLElement>('[role="menu"]')?.style.visibility === "hidden") return;
      focus.call(this, options);
    });
    try {
      const { trigger } = setup();
      fireEvent.keyDown(trigger, { key: "ArrowDown" });
      expect(screen.getByRole("menuitem", { name: "编辑身份" })).toHaveFocus();
    } finally { spy.mockRestore(); }
  });
  it("portals a grouped menu and navigates past disabled items", () => {
    const { trigger, container } = setup();
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const menu = screen.getByRole("menu");
    expect(container.contains(menu)).toBe(false);
    expect(screen.getByRole("menuitem", { name: "编辑身份" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "复制消息" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(screen.getByRole("menuitem", { name: "删除消息" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "Home" });
    expect(screen.getByRole("menuitem", { name: "编辑身份" })).toHaveFocus();
    fireEvent.keyDown(menu, { key: "End" });
    expect(screen.getByRole("menuitem", { name: "删除消息" })).toHaveFocus();
    expect(menu.querySelectorAll(".workbench-action-menu__group")).toHaveLength(2);
  });
  it("opens at the last action with ArrowUp and returns focus on Escape", async () => {
    const { trigger, run } = setup();
    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    expect(screen.getByRole("menuitem", { name: "删除消息" })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(run).not.toHaveBeenCalled();
  });
  it("closes for outside interaction and hands Tab back to the trigger", () => {
    const { trigger } = setup();
    fireEvent.click(trigger); fireEvent.pointerDown(screen.getByRole("button", { name: "外部" }));
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(trigger); fireEvent.keyDown(screen.getByRole("menu"), { key: "Tab" });
    expect(screen.queryByRole("menu")).toBeNull(); expect(trigger).toHaveFocus();
    fireEvent.click(trigger); screen.getByRole("button", { name: "外部" }).focus();
    // React's focus event update must be flushed by the test event helper.
    fireEvent.focusIn(screen.getByRole("button", { name: "外部" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });
  it("runs an action once using the persistent anchor and restores its focus", async () => {
    const { trigger, run } = setup();
    fireEvent.click(trigger); fireEvent.click(screen.getByRole("menuitem", { name: "复制消息" }));
    expect(run).toHaveBeenCalledExactlyOnceWith(trigger);
    expect(screen.queryByRole("menu")).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
  it("does not steal focus from a settings dialog", async () => {
    const { trigger } = setup({ opensSettings: true, run: () => screen.getByRole("button", { name: "外部" }).focus() });
    fireEvent.click(trigger); fireEvent.click(screen.getByRole("menuitem", { name: "编辑身份" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "外部" })).toHaveFocus());
  });
  it("closes an open menu when editing becomes locked", () => {
    const { trigger, rerender, actions } = setup();
    fireEvent.click(trigger);
    rerender(<WorkbenchItemMenu label="消息操作" title="消息 1" actions={actions} disabled />);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: "消息操作" })).toBeDisabled();
  });
});
