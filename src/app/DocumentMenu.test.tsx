import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DocumentMenu } from "./DocumentMenu";

function TestMenu() {
  return (
    <>
      <button type="button">上一个操作</button>
      <DocumentMenu>
        {(close) => <>
          <button role="menuitem" tabIndex={-1} type="button" onClick={close}>新建空白</button>
          <button role="menuitem" tabIndex={-1} type="button">载入示例</button>
          <button role="menuitem" tabIndex={-1} type="button">导出项目</button>
        </>}
      </DocumentMenu>
      <button type="button">下一个操作</button>
    </>
  );
}

function FirstControlMenu() {
  return (
    <DocumentMenu>
      {() => <button role="menuitem" tabIndex={-1} type="button">新建空白</button>}
    </DocumentMenu>
  );
}

describe("DocumentMenu", () => {
  it("opens outside its layout container and closes after an action", () => {
    const { container } = render(<TestMenu />);
    const trigger = screen.getByRole("button", { name: "文档" });

    fireEvent.click(trigger);
    const panel = screen.getByRole("menu", { name: "文档操作" });
    expect(panel).not.toHaveAttribute("hidden");
    expect(container.querySelector(".document-menu__panel")).toBeNull();
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    expect(screen.getByRole("menuitem", { name: "新建空白" })).toHaveFocus();

    fireEvent.click(screen.getByRole("menuitem", { name: "新建空白" }));
    expect(panel).toHaveAttribute("hidden");
  });

  it("closes with Escape and restores focus to the trigger", async () => {
    render(<TestMenu />);
    const trigger = screen.getByRole("button", { name: "文档" });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "新建空白" }), { key: "Escape" });

    expect(document.querySelector(".document-menu__panel")).toHaveAttribute("hidden");
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("supports roving arrow, Home and End navigation", () => {
    render(<TestMenu />);
    const trigger = screen.getByRole("button", { name: "文档" });
    fireEvent.keyDown(trigger, { key: "ArrowUp" });
    const first = screen.getByRole("menuitem", { name: "新建空白" });
    const middle = screen.getByRole("menuitem", { name: "载入示例" });
    const last = screen.getByRole("menuitem", { name: "导出项目" });
    expect(last).toHaveFocus();

    fireEvent.keyDown(last, { key: "ArrowDown" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "End" });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "Home" });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: "ArrowUp" });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "ArrowUp" });
    expect(middle).toHaveFocus();
  });

  it("closes on Tab and continues to the adjacent page control", async () => {
    render(<TestMenu />);
    const trigger = screen.getByRole("button", { name: "文档" });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "新建空白" }), { key: "Tab" });

    expect(document.querySelector(".document-menu__panel")).toHaveAttribute("hidden");
    await waitFor(() => expect(screen.getByRole("button", { name: "下一个操作" })).toHaveFocus());

    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "新建空白" }), { key: "Tab", shiftKey: true });
    await waitFor(() => expect(screen.getByRole("button", { name: "上一个操作" })).toHaveFocus());
  });

  it("returns focus to the trigger when Shift+Tab has no previous page control", async () => {
    render(<FirstControlMenu />);
    const trigger = screen.getByRole("button", { name: "文档" });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("menuitem", { name: "新建空白" }), {
      key: "Tab",
      shiftKey: true,
    });

    expect(document.querySelector(".document-menu__panel")).toHaveAttribute("hidden");
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
