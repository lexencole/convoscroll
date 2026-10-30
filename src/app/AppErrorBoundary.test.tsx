import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { APP_VERSION } from "../product-info";
import { AppErrorBoundary } from "./AppErrorBoundary";

function BrokenView(): never {
  throw new Error("private conversation body");
}

describe("AppErrorBoundary", () => {
  it("shows a privacy-safe local recovery screen", () => {
    const reload = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(
      <AppErrorBoundary onReload={reload}>
        <BrokenView />
      </AppErrorBoundary>,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("页面出错了");
    expect(alert).toHaveTextContent(`版本 ${APP_VERSION}`);
    expect(alert).not.toHaveTextContent("private conversation body");
    fireEvent.click(screen.getByRole("button", { name: "刷新页面" }));
    expect(reload).toHaveBeenCalledOnce();
    consoleError.mockRestore();
  });
});
