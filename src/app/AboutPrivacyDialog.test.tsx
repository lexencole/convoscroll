import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { APP_VERSION } from "../product-info";
import { AboutPrivacyDialog } from "./AboutPrivacyDialog";

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>打开说明</button>
      <AboutPrivacyDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

describe("AboutPrivacyDialog", () => {
  it("explains the local-first boundary and restores focus after Escape", async () => {
    const requestFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const view = render(<Harness />);
    view.container.setAttribute("aria-hidden", "false");
    const trigger = screen.getByRole("button", { name: "打开说明" });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "话卷" });
    expect(dialog).toHaveTextContent(`版本 ${APP_VERSION}`);
    expect(dialog).toHaveTextContent("对话只存在这个浏览器里，不会上传");
    expect(dialog).toHaveTextContent("导出项目");
    expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(document.body.style.overflow).toBe("");
    expect(view.container).toHaveAttribute("inert");
    expect(view.container).toHaveAttribute("aria-hidden", "true");

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "话卷" })).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
    expect(document.documentElement.style.overflow).toBe("");
    expect(document.body.style.overflow).toBe("");
    expect(view.container).not.toHaveAttribute("inert");
    expect(view.container).toHaveAttribute("aria-hidden", "false");
    requestFrame.mockRestore();
  });
});
