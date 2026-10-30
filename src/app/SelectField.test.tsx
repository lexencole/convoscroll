import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { SelectField } from "./SelectField";

const options = [
  { value: "user", label: "User" },
  { value: "assistant", label: "Assistant" },
  { value: "developer", label: "Developer" },
] as const;

function StatefulSelect() {
  const [value, setValue] = useState<(typeof options)[number]["value"]>("user");
  return <SelectField ariaLabel="角色" value={value} options={options} onChange={setValue} />;
}

describe("SelectField", () => {
  it("carries toolbar typography to the portalled menu without changing ordinary fields", () => {
    const view = render(<SelectField ariaLabel="段落样式" typography="toolbar" value="user" options={options} onChange={vi.fn()} />);
    const trigger = screen.getByRole("combobox", { name: "段落样式" });
    expect(trigger.parentElement).toHaveClass("select-field--toolbar");
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox")).toHaveClass("select-field__menu--toolbar");
    view.rerender(<SelectField ariaLabel="段落样式" value="user" options={options} onChange={vi.fn()} />);
    expect(trigger.parentElement).not.toHaveClass("select-field--toolbar");
    expect(screen.getByRole("listbox")).not.toHaveClass("select-field__menu--toolbar");
  });
  it("keeps decorative model icons out of option names and keyboard semantics", () => {
    const onChange = vi.fn();
    render(<SelectField ariaLabel="模型" value="a" options={[
      { value: "a", label: "Claude", icon: <svg role="img" aria-label="brand name" /> },
      { value: "b", label: "Gemini", icon: <svg role="img" aria-label="another brand" /> },
    ]} onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: "模型" });
    fireEvent.click(trigger);
    expect(screen.getByRole("option", { name: "Claude" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("img")).toBeNull();
    fireEvent.keyDown(trigger, { key: "ArrowDown" }); fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("b");
  });
  it("opens a themed listbox and selects an option", () => {
    render(<StatefulSelect />);

    fireEvent.click(screen.getByRole("combobox", { name: "角色" }));
    const listbox = screen.getByRole("listbox", { name: "角色" });
    expect(listbox).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "角色" })).toHaveFocus();
    fireEvent.click(screen.getByRole("option", { name: "Developer" }));

    expect(screen.getByRole("combobox", { name: "角色" })).toHaveTextContent("Developer");
    expect(screen.queryByRole("listbox", { name: "角色" })).not.toBeInTheDocument();
  });

  it("names a portalled listbox from the real outer field label", () => {
    const onChange = vi.fn();
    const view = render(
      <>
        <label htmlFor="outer-labelled-role">角色</label>
        <SelectField
          id="outer-labelled-role"
          value="user"
          options={options}
          onChange={onChange}
        />
      </>,
    );
    const label = screen.getByText("角色");
    fireEvent.click(screen.getByRole("combobox", { name: "角色" }));

    expect(screen.getByRole("listbox", { name: "角色" })).toBeInTheDocument();
    expect(label).toHaveAttribute("id");

    view.rerender(<label htmlFor="outer-labelled-role">角色</label>);
    expect(label).not.toHaveAttribute("id");
  });

  it.each([110, 174, 360])("fits the measured %ipx menu content within its width limit", (contentWidth) => {
    const measure = vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(contentWidth);
    try {
      render(<SelectField ariaLabel="导出状态" value="current" options={[
        { value: "current", label: "保持当前预览状态" },
      ]} onChange={vi.fn()} />);
      fireEvent.click(screen.getByRole("combobox", { name: "导出状态" }));
      expect(screen.getByRole("listbox", { name: "导出状态" }))
        .toHaveStyle({ width: `${Math.min(contentWidth, 320)}px` });
    } finally { measure.mockRestore(); }
  });

  it("supports an explicit labelled-by relationship for both trigger and listbox", () => {
    render(
      <>
        <span id="role-caption">消息角色</span>
        <SelectField
          id="explicit-labelled-role"
          ariaLabelledBy="role-caption"
          value="user"
          options={options}
          onChange={vi.fn()}
        />
      </>,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "消息角色" }));
    expect(screen.getByRole("listbox", { name: "消息角色" })).toBeInTheDocument();
  });

  it("supports arrow navigation, selection and Escape without changing the value", () => {
    const onChange = vi.fn();
    render(<SelectField ariaLabel="角色" value="user" options={options} onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: "角色" });

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("assistant");

    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Escape" });
    expect(screen.queryByRole("listbox", { name: "角色" })).not.toBeInTheDocument();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("closes when focus interaction moves outside", () => {
    render(<><StatefulSelect /><button type="button">其他操作</button></>);
    fireEvent.click(screen.getByRole("combobox", { name: "角色" }));
    fireEvent.focusIn(screen.getByRole("button", { name: "其他操作" }));
    expect(screen.queryByRole("listbox", { name: "角色" })).not.toBeInTheDocument();
  });

  it("lets Tab leave the trigger while closing the portalled listbox", () => {
    render(<StatefulSelect />);
    const trigger = screen.getByRole("combobox", { name: "角色" });
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "Tab" });
    expect(screen.queryByRole("listbox", { name: "角色" })).not.toBeInTheDocument();
  });

  it("closes immediately when it becomes disabled", async () => {
    const onChange = vi.fn();
    const view = render(
      <SelectField ariaLabel="角色" value="user" options={options} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "角色" }));
    view.rerender(
      <SelectField ariaLabel="角色" value="user" options={options} onChange={onChange} disabled />,
    );

    await waitFor(() => expect(screen.queryByRole("listbox", { name: "角色" })).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("combobox", { name: "角色" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reveals keyboard options within the list without scrolling the page", () => {
    render(<StatefulSelect />);
    const trigger = screen.getByRole("combobox", { name: "角色" });
    fireEvent.click(trigger);
    const menu = screen.getByRole("listbox");
    vi.spyOn(menu, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 100, 200, 100));
    vi.spyOn(screen.getByRole("option", { name: "Assistant" }), "getBoundingClientRect").mockReturnValue(new DOMRect(0, 220, 180, 44));
    const pageScroll = vi.spyOn(window, "scrollTo");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(menu.scrollTop).toBe(64);
    expect(pageScroll).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
  it("leaves wheel and pointer scrolling alone while still following keyboard navigation", () => {
    render(<StatefulSelect />);
    const trigger = screen.getByRole("combobox", { name: "角色" });
    fireEvent.click(trigger);
    const menu = screen.getByRole("listbox");
    menu.scrollTop = 80;
    const measure = vi.spyOn(trigger, "getBoundingClientRect");
    fireEvent.scroll(menu);
    fireEvent.pointerMove(screen.getByRole("option", { name: "Assistant" }));
    expect(measure).not.toHaveBeenCalled();
    expect(menu.scrollTop).toBe(80);
    vi.spyOn(menu, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 100, 200, 100));
    vi.spyOn(screen.getByRole("option", { name: "Developer" }), "getBoundingClientRect").mockReturnValue(new DOMRect(0, 220, 180, 44));
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(menu.scrollTop).toBe(144);
    vi.restoreAllMocks();
  });

  it("uses the mobile 44px option height when positioning a menu above its trigger", () => {
    const originalMatchMedia = window.matchMedia;
    const originalInnerHeight = window.innerHeight;
    const originalInnerWidth = window.innerWidth;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn().mockReturnValue({ matches: true }),
    });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 320 });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 400 });

    try {
      render(<StatefulSelect />);
      const trigger = screen.getByRole("combobox", { name: "角色" });
      vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
        x: 100,
        y: 250,
        top: 250,
        right: 220,
        bottom: 294,
        left: 100,
        width: 120,
        height: 44,
        toJSON: () => ({}),
      });

      fireEvent.click(trigger);

      expect(screen.getByRole("listbox", { name: "角色" })).toHaveStyle({ top: "100px" });
    } finally {
      Object.defineProperty(window, "matchMedia", {
        configurable: true,
        value: originalMatchMedia,
      });
      Object.defineProperty(window, "innerHeight", {
        configurable: true,
        value: originalInnerHeight,
      });
      Object.defineProperty(window, "innerWidth", {
        configurable: true,
        value: originalInnerWidth,
      });
    }
  });
  it("uses the larger space above instead of squeezing a long list into 160px below", () => {
    render(<SelectField ariaLabel="模型" value="0" options={Array.from({ length: 9 }, (_, index) => ({ value: String(index), label: `Model ${index}` }))} onChange={vi.fn()} />);
    const trigger = screen.getByRole("combobox", { name: "模型" });
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({ top: window.innerHeight - 212, bottom: window.innerHeight - 168, left: 20, right: 300, width: 280, height: 44, x: 20, y: window.innerHeight - 212, toJSON: () => ({}) });
    fireEvent.click(trigger);
    expect(screen.getByRole("listbox")).toHaveStyle({ top: `${window.innerHeight - 212 - 280 - 6}px`, maxHeight: "280px" });
    vi.restoreAllMocks();
  });
});
