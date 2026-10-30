import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getFixture } from "../data/fixtures";
import { MemoryProjectStore } from "../persistence/project-store";
import { App } from "./App";
import { ProjectControls } from "./ProjectControls";

const basic = getFixture("basic");
if (basic.status !== "valid") throw new Error("The basic fixture must be valid.");
/** The App opens with the simple sample when there is no local project. */
const firstOpenTitle = basic.document.metadata.title!;

describe("project import UI", () => {
  it("lets iOS pick .convcanvas files without offering photos", () => {
    const fixture = getFixture("basic");
    if (fixture.status !== "valid") throw new Error("Basic fixture must be valid");
    render(
      <ProjectControls
        document={fixture.document}
        replaceProject={vi.fn(async () => "2026-10-11T00:00:00.000Z")}
        resolveAssetBlob={vi.fn(async () => undefined)}
        onImported={vi.fn()}
      />,
    );
    const input = document.querySelector<HTMLInputElement>('[data-testid="project-import-input"]');
    const accepted = input?.accept.split(",") ?? [];
    expect(accepted).toEqual(expect.arrayContaining([".convcanvas", ".md", "application/octet-stream"]));
    expect(accepted.some((type) => type.startsWith("image/"))).toBe(false);
  });

  it("isolates and scroll-locks the background until import preview closes", async () => {
    const fixture = getFixture("basic");
    if (fixture.status !== "valid") throw new Error("Basic fixture must be valid");
    const root = globalThis.document.documentElement;
    const body = globalThis.document.body;
    const previousRootOverflow = root.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    root.style.overflow = "clip";
    body.style.overflow = "scroll";
    try {
      const view = render(
        <>
          <main data-testid="import-background" aria-hidden="false">Background</main>
          <ProjectControls
            document={fixture.document}
            replaceProject={vi.fn(async () => "2026-08-30T00:00:00.000Z")}
            resolveAssetBlob={vi.fn(async () => undefined)}
            onImported={vi.fn()}
          />
        </>,
      );
      screen.getByTestId("import-background");
      view.container.setAttribute("aria-hidden", "false");
      const input = view.container.querySelector<HTMLInputElement>('[data-testid="project-import-input"]');
      if (!input) throw new Error("Project input must exist");
      fireEvent.change(input, {
        target: { files: [new File(["# Isolated"], "isolated.md", { type: "text/markdown" })] },
      });

      const dialog = await screen.findByRole("dialog", { name: "导入预览" });
      // Isolation is applied in an effect after the dialog mounts.
      await waitFor(() => expect(view.container).toHaveAttribute("inert"));
      expect(view.container).toHaveAttribute("aria-hidden", "true");
      expect(root.style.overflow).toBe("hidden");
      expect(body.style.overflow).toBe("scroll");

      fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));
      await waitFor(() => expect(dialog).not.toBeInTheDocument());
      expect(view.container).not.toHaveAttribute("inert");
      expect(view.container).toHaveAttribute("aria-hidden", "false");
      expect(root.style.overflow).toBe("clip");
      expect(body.style.overflow).toBe("scroll");
    } finally {
      root.style.overflow = previousRootOverflow;
      body.style.overflow = previousBodyOverflow;
    }
  });

  it("does not steal focus from a higher modal while a prepared preview is suspended", async () => {
    const fixture = getFixture("basic");
    if (fixture.status !== "valid") throw new Error("Basic fixture must be valid");
    const props = {
      document: fixture.document,
      replaceProject: vi.fn(async () => "2026-08-30T00:00:00.000Z"),
      resolveAssetBlob: vi.fn(async () => undefined),
      onImported: vi.fn(),
    };
    const view = render(
      <>
        <button type="button">顶层弹窗控件</button>
        <ProjectControls {...props} dialogFocusSuspended />
      </>,
    );
    const higherModalControl = screen.getByRole("button", { name: "顶层弹窗控件" });
    higherModalControl.focus();
    const input = document.querySelector<HTMLInputElement>('[data-testid="project-import-input"]');
    if (!input) throw new Error("Project input must exist");

    fireEvent.change(input, {
      target: { files: [new File(["# Suspended"], "suspended.md", { type: "text/markdown" })] },
    });

    expect(screen.getByRole("button", { name: "正在读取…" })).toBeDisabled();
    await waitFor(() => expect(
      screen.getByRole("button", { name: "导入项目或 Markdown" }),
    ).toBeEnabled());
    expect(screen.queryByRole("dialog", { name: "导入预览" })).not.toBeInTheDocument();
    expect(higherModalControl).toHaveFocus();

    view.rerender(
      <>
        <button type="button">顶层弹窗控件</button>
        <ProjectControls {...props} dialogFocusSuspended={false} />
      </>,
    );
    const dialog = await screen.findByRole("dialog", { name: "导入预览" });
    const confirm = within(dialog).getByRole("button", { name: "替换当前项目" });
    await waitFor(() => expect(confirm).toHaveFocus());
  });

  it("closes the document menu before opening the local file picker", async () => {
    const store = new MemoryProjectStore();
    render(<App store={store} />);
    await screen.findByRole("heading", { name: firstOpenTitle });
    fireEvent.click(screen.getByRole("button", { name: "文档" }));

    fireEvent.click(screen.getByRole("menuitem", { name: "导入项目或 Markdown" }));

    expect(document.querySelector(".document-menu__panel")).toHaveAttribute("hidden");
    await waitFor(() => expect(screen.getByRole("button", { name: "文档" })).toHaveFocus());
  });

  it("previews Markdown without changing the current project, then atomically replaces it", async () => {
    const store = new MemoryProjectStore();
    render(<App store={store} />);
    const title = await screen.findByRole("heading", { name: firstOpenTitle });
    expect(title).toHaveTextContent(firstOpenTitle);

    fireEvent.click(screen.getByRole("button", { name: "文档" }));
    const input = document.querySelector<HTMLInputElement>('[data-testid="project-import-input"]');
    if (!input) throw new Error("Project input must exist");
    fireEvent.change(input, {
      target: { files: [new File(["# 导入内容"], "imported.md", { type: "text/markdown" })] },
    });

    const dialog = await screen.findByRole("dialog", { name: "导入预览" });
    expect(dialog).toBeInTheDocument();
    expect(dialog.closest('[role="menu"]')).toBeNull();
    expect(document.querySelector(".document-menu__panel")).toHaveAttribute("hidden");
    expect(screen.getByText("普通 Markdown")).toBeInTheDocument();
    expect(title).toHaveTextContent(firstOpenTitle);

    fireEvent.click(screen.getByRole("button", { name: "替换当前项目" }));
    await screen.findByRole("heading", { name: "imported", level: 1 });
    expect((await store.loadCurrentProject())?.document).toMatchObject({
      metadata: { title: "imported" },
    });
  });

  it("labels Conversation Markdown with its version", async () => {
    render(<App store={new MemoryProjectStore()} />);
    await screen.findByRole("heading", { name: firstOpenTitle });
    fireEvent.click(screen.getByRole("button", { name: "文档" }));
    const input = document.querySelector<HTMLInputElement>('[data-testid="project-import-input"]');
    if (!input) throw new Error("Project input must exist");
    const source = "<!-- conversation-markdown:v2 -->\n<!-- message: {\"role\":\"user\"} -->\n你好\n<!-- /message -->";
    fireEvent.change(input, { target: { files: [new File([source], "v2.md", { type: "text/markdown" })] } });
    await screen.findByRole("dialog", { name: "导入预览" });
    expect(screen.getByText("Conversation Markdown v2")).toBeInTheDocument();
  });

  it("reports an unsupported file without changing the editor", async () => {
    const store = new MemoryProjectStore();
    render(<App store={store} />);
    const title = await screen.findByRole("heading", { name: firstOpenTitle });
    fireEvent.click(screen.getByRole("button", { name: "文档" }));
    const input = document.querySelector<HTMLInputElement>('[data-testid="project-import-input"]');
    if (!input) throw new Error("Project input must exist");
    fireEvent.change(input, {
      target: { files: [new File(["invalid"], "notes.pdf", { type: "application/pdf" })] },
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("只支持 .convcanvas");
    expect(alert.closest('[role="menu"]')).toBeNull();
    expect(title).toHaveTextContent(firstOpenTitle);
    expect(await store.loadCurrentProject()).toBeUndefined();
  });

  it("summarizes invalid roles while keeping precise import diagnostics expandable", async () => {
    const store = new MemoryProjectStore();
    render(<App store={store} />);
    const title = await screen.findByRole("heading", { name: firstOpenTitle });
    const source = '<!-- conversation-markdown:v2 -->\n<!-- message: {"role":"invalid"} -->\n原文\n<!-- /message -->';
    fireEvent.change(screen.getByTestId("project-import-input"), {
      target: { files: [new File([source], "invalid-role.md", { type: "text/markdown" })] },
    });
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("消息角色无效")).toBeVisible();
    const details = alert.querySelector("details")!;
    expect(details).not.toHaveAttribute("open");
    expect(details).toHaveTextContent("messages[0].role");
    expect(details).toHaveTextContent("INVALID_CONVERSATION_MARKDOWN_ROLE");
    expect(details).toHaveTextContent("消息的 role 不对。");
    fireEvent.click(within(details).getByText("错误详情"));
    expect(details).toHaveAttribute("open");
    expect(title).toHaveTextContent(firstOpenTitle);
    expect(await store.loadCurrentProject()).toBeUndefined();
  });

  it("moves focus into the portalled preview, closes with Escape, and restores the document trigger", async () => {
    const store = new MemoryProjectStore();
    render(<App store={store} />);
    await screen.findByRole("heading", { name: firstOpenTitle });
    fireEvent.click(screen.getByRole("button", { name: "文档" }));
    const documentTrigger = screen.getByRole("button", { name: "文档" });
    const input = document.querySelector<HTMLInputElement>('[data-testid="project-import-input"]');
    if (!input) throw new Error("Project input must exist");
    fireEvent.change(input, {
      target: { files: [new File(["# Focus"], "focus.md", { type: "text/markdown" })] },
    });

    const dialog = await screen.findByRole("dialog", { name: "导入预览" });
    expect(dialog.closest('[role="menu"]')).toBeNull();
    const confirm = within(dialog).getByRole("button", { name: "替换当前项目" });
    await waitFor(() => expect(confirm).toHaveFocus());
    fireEvent.keyDown(confirm, { key: "ArrowDown" });
    expect(confirm).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });

    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    await waitFor(() => expect(documentTrigger).toHaveFocus());
  });

  it("keeps focus inside the preview while a delayed project replacement disables its controls", async () => {
    let announceStarted: (() => void) | undefined;
    let releaseReplacement: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { announceStarted = resolve; });
    const replacementGate = new Promise<void>((resolve) => { releaseReplacement = resolve; });
    class DelayedStore extends MemoryProjectStore {
      override async replaceProject(
        ...args: Parameters<MemoryProjectStore["replaceProject"]>
      ): Promise<void> {
        announceStarted?.();
        announceStarted = undefined;
        await replacementGate;
        await super.replaceProject(...args);
      }
    }
    const store = new DelayedStore();
    render(<App store={store} />);
    await screen.findByRole("heading", { name: firstOpenTitle });
    fireEvent.click(screen.getByRole("button", { name: "文档" }));
    const documentTrigger = screen.getByRole("button", { name: "文档" });
    const input = document.querySelector<HTMLInputElement>('[data-testid="project-import-input"]');
    if (!input) throw new Error("Project input must exist");
    fireEvent.change(input, {
      target: { files: [new File(["# Delayed"], "delayed.md", { type: "text/markdown" })] },
    });

    const dialog = await screen.findByRole("dialog", { name: "导入预览" });
    const confirm = within(dialog).getByRole("button", { name: "替换当前项目" });
    await waitFor(() => expect(confirm).toHaveFocus());
    fireEvent.click(confirm);
    await started;

    await waitFor(() => {
      expect(confirm).toBeDisabled();
      expect(within(dialog).getByRole("button", { name: "取消" })).toBeDisabled();
      expect(dialog).toHaveFocus();
    });
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(dialog).toHaveFocus();
    expect(documentTrigger).not.toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(dialog).toHaveFocus();
    expect(documentTrigger).not.toHaveFocus();

    await act(async () => releaseReplacement?.());
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  });

  it("keeps the current project when the confirmed storage transaction fails", async () => {
    class FailingStore extends MemoryProjectStore {
      override async replaceProject(): Promise<void> {
        throw new Error("transaction aborted");
      }
    }
    const store = new FailingStore();
    render(<App store={store} />);
    const title = await screen.findByRole("heading", { name: firstOpenTitle });
    fireEvent.click(screen.getByRole("button", { name: "文档" }));
    const input = document.querySelector<HTMLInputElement>('[data-testid="project-import-input"]');
    if (!input) throw new Error("Project input must exist");
    fireEvent.change(input, {
      target: { files: [new File(["# 不应覆盖"], "failed.md", { type: "text/markdown" })] },
    });
    await screen.findByRole("dialog", { name: "导入预览" });
    fireEvent.click(screen.getByRole("button", { name: "替换当前项目" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("当前项目未替换");
    expect(title).toHaveTextContent(firstOpenTitle);
  });
});
