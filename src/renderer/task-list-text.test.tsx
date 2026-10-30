import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MarkdownBody } from "./MarkdownBody";

describe("wrapTaskListText", () => {
  it("puts everything after the checkbox into one flex item", () => {
    const { container } = render(<MarkdownBody source={"- [x] 画一张不含**角色**和 `logo` 的海报\n- [ ] 写下设定\n  - 只写第一集"} />);
    const items = [...container.querySelectorAll(":scope .contains-task-list > li.task-list-item")];
    expect(items.map((item) => [...item.children].map((child) => child.tagName))).toEqual([["INPUT", "DIV"], ["INPUT", "DIV"]]);
    expect(items.map((item) => item.querySelector(".task-list-item__body")?.textContent?.replace(/\s+/g, " ").trim())).toEqual(["画一张不含角色和 logo 的海报", "写下设定 只写第一集"]);
  });

  it("leaves ordinary list items alone", () => {
    const { container } = render(<MarkdownBody source={"- 普通的一项"} />);
    expect(container.querySelector(".task-list-item__body")).toBeNull();
  });

  it("keeps loose task paragraphs and nested lists in one vertical body", () => {
    const { container } = render(<MarkdownBody source={"- [ ] 第一段\n\n  第二段\n\n  - [x] 子任务\n"} />);
    const item = container.querySelector("li.task-list-item")!;
    expect([...item.children].map((node) => node.tagName)).toEqual(["INPUT", "DIV"]);
    const body = item.querySelector(":scope > .task-list-item__body")!;
    expect([...body.children].map((node) => node.tagName)).toEqual(["P", "P", "UL"]);
    expect(container.querySelectorAll("input")).toHaveLength(2);
  });

  it("renders empty tasks but leaves escaped markers and code literal", () => {
    const { container } = render(<MarkdownBody source={"- [ ]\n- [x] \n- \\[ ]\n\n```md\n- [ ]\n```"} />);
    const boxes = [...container.querySelectorAll<HTMLInputElement>("input")];
    expect(boxes.map((input) => input.checked)).toEqual([false, true]);
    expect(boxes.every((input) => input.disabled)).toBe(true);
  });

  it("uses stable nested task indexes and retains keyboard focus after a toggle", () => {
    const onTaskToggle = vi.fn();
    const source = "- [ ] 外层\n  - [x] 内层\n- [ ]\n";
    const { container, rerender } = render(<MarkdownBody source={source} onTaskToggle={onTaskToggle} />);
    const checkbox = container.querySelectorAll<HTMLInputElement>("input")[1];
    checkbox.focus(); fireEvent.click(checkbox);
    expect(onTaskToggle).toHaveBeenCalledWith(1);
    rerender(<MarkdownBody source={source.replace("[x]", "[ ]")} onTaskToggle={onTaskToggle} />);
    expect(document.activeElement).toBe(checkbox);
    expect(checkbox.checked).toBe(false);
  });
});
