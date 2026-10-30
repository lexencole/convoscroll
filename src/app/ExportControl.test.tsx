import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { getFixture } from "../data/fixtures";
import { PngExportError, type PngExportSessionResult } from "../export/export-types";
import editorStyles from "../styles/editor.css?raw";
import { ExportControl, type ExportControlHandle } from "./ExportControl";

const loaded = getFixture("basic");
if (loaded.status !== "valid") throw new Error("basic fixture must stay valid");
const document = loaded.document;

Object.defineProperties(URL, {
  createObjectURL: { configurable: true, value: vi.fn(() => "blob:export-result") },
  revokeObjectURL: { configurable: true, value: vi.fn() },
});

function createResult(): PngExportSessionResult {
  return {
    effectiveSettings: {
      fileName: document.metadata.title || "conversation",
      preset: "portrait",
      width: 480,
      scale: 3,
      foldStrategy: "block",
    },
    durationMs: 1_230,
    diagnostics: [],
    contentMetrics: {
      messageCount: 1,
      blockCount: 1,
      tableCount: 0,
      unsupportedCount: 0,
      missingAssetCount: 0,
      formulaFallbackCount: 0,
      formulaScaledCount: 0,
    },
    parts: [{
      blob: new Blob(["png"], { type: "image/png" }),
      fileName: "长图排版测试.png",
      durationMs: 1_230,
      index: 0,
      total: 1,
      messageIds: ["message-1"],
      blockIds: ["block-1"],
      metrics: {
        cssWidth: 480,
        cssHeight: 1_000,
        pixelWidth: 1_440,
        pixelHeight: 3_000,
        estimatedRgbaBytes: 17_280_000,
        imageCount: 0,
        codeBlockCount: 0,
        mathCount: 0,
      },
    }],
  };
}

function createMultiResult(): PngExportSessionResult {
  const first = createResult();
  return {
    ...first,
    diagnostics: [{
      code: "semantic-segmentation",
      severity: "warning",
      message: "内容将按语义边界导出为 2 张 PNG。",
    }],
    parts: [
      { ...first.parts[0], fileName: "长图-part-01-of-02.png", index: 0, total: 2 },
      { ...first.parts[0], fileName: "长图-part-02-of-02.png", index: 1, total: 2 },
    ],
  };
}

function renderControl(overrides: Partial<Parameters<typeof ExportControl>[0]> = {}) {
  const canvasRef = createRef<HTMLElement>();
  canvasRef.current = globalThis.document.createElement("section");
  const props = {
    canvasRef,
    document,
    applyPresentation: vi.fn(),
    runSession: vi.fn(async () => createResult()),
    download: vi.fn(),
    ...overrides,
  };
  const view = render(<ExportControl {...props} />);
  return { ...props, view };
}

describe("ExportControl", () => {
  it("starts a direct export on the first click without a second settings confirmation", async () => {
    const props = renderControl({ directExport: true });
    fireEvent.click(screen.getByRole("button", { name: "导出 PNG" }));
    expect(props.runSession).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "导出设置" })).not.toBeInTheDocument();
    await screen.findByText("图片已生成，已开始下载");
    expect(props.download).toHaveBeenCalledTimes(1);
  });
  it("keeps keyboard-selected settings for the next direct export", async () => {
    const controlsRef = createRef<ExportControlHandle>();
    const props = renderControl({ directExport: true, controlsRef });
    act(() => controlsRef.current?.openSettings());
    fireEvent.keyDown(screen.getByRole("radio", { name: "竖版" }), { key: "ArrowRight" });
    expect(screen.getByRole("radio", { name: "宽版" })).toHaveFocus();
    expect(screen.getByRole("radio", { name: "2×" })).toBeChecked();
    fireEvent.keyDown(screen.getByRole("radio", { name: "2×" }), { key: "Home" });
    expect(screen.getByRole("radio", { name: "1×" })).toHaveFocus();
    expect(screen.getByRole("radio", { name: "1×" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "2×" })).toHaveAttribute("tabindex", "-1");
    fireEvent.click(screen.getByText("更多选项"));
    fireEvent.change(screen.getByLabelText("文件名"), { target: { value: "自定文件名" } });
    fireEvent.click(screen.getByRole("button", { name: "完成" }));
    expect(props.runSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "导出 PNG" }));
    await screen.findByText("图片已生成，已开始下载");
    expect(props.runSession).toHaveBeenCalledWith(expect.objectContaining({ settings: expect.objectContaining({
      preset: "wide", width: 720, scale: 1, fileName: "自定文件名",
    }) }));
  });
  it("focuses cancellation during a direct export and can retry after cancelling", async () => {
    const runSession = vi.fn<typeof import("../export/export-session").runPngExportSession>()
      .mockImplementationOnce(({ signal }) => new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new PngExportError("cancelled", "已取消", "重试")), { once: true });
      })).mockResolvedValue(createResult());
    const props = renderControl({ directExport: true, runSession });
    fireEvent.click(screen.getByRole("button", { name: "导出 PNG" }));
    const cancel = screen.getByRole("button", { name: "取消导出" });
    await waitFor(() => expect(cancel).toHaveFocus());
    fireEvent.click(cancel);
    await screen.findByRole("button", { name: "开始导出" });
    expect(props.download).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "开始导出" }));
    await screen.findByText("图片已生成，已开始下载");
    expect(runSession).toHaveBeenCalledTimes(2);
  });
  it("exports folded blocks as they are shown unless the document sets them per block", async () => {
    const props = renderControl();
    fireEvent.click(screen.getByRole("button", { name: "导出 PNG" }));
    const fold = screen.getByRole("combobox", { name: "折叠的内容" });
    expect(fold).toHaveTextContent("和现在看到的一样");
    fireEvent.click(fold);
    expect(screen.queryByRole("option", { name: "按每一块自己的设置" })).not.toBeInTheDocument();
    fireEvent.keyDown(fold, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "开始导出" }));
    await screen.findByText("图片已生成，已开始下载");
    expect(props.runSession).toHaveBeenCalledWith(expect.objectContaining({ settings: expect.objectContaining({ foldStrategy: "preview" }) }));
  });

  it("keeps the per-block choice as the default for documents that set it", () => {
    const rich = getFixture("rich");
    if (rich.status !== "valid") throw new Error("rich fixture must stay valid");
    renderControl({ document: rich.document });
    fireEvent.click(screen.getByRole("button", { name: "导出 PNG" }));
    expect(screen.getByRole("combobox", { name: "折叠的内容" })).toHaveTextContent("按每一块自己的设置");
  });

  it("offers the download again with a short hint about blocked downloads", async () => {
    renderControl(); fireEvent.click(screen.getByRole("button", { name: "导出 PNG" }));
    // Before exporting the secondary action cancels; after a result it closes.
    expect(screen.getByRole("button", { name: "取消" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "开始导出" }));
    await screen.findByText("图片已生成，已开始下载");
    expect(screen.getByRole("link", { name: "再次下载 PNG" })).toBeVisible();
    expect(screen.getByText("没收到文件？看看浏览器是否拦截了下载")).toBeVisible();
    expect(screen.queryByText("下载遇到问题？")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "关闭" })).toBeInTheDocument();
  });
  it("clears a previous export result when the document changes", async () => {
    const { view, ...props } = renderControl();
    fireEvent.click(screen.getByRole("button", { name: "导出 PNG" }));
    fireEvent.click(screen.getByRole("button", { name: "开始导出" }));
    await screen.findByText("图片已生成，已开始下载");
    fireEvent.click(screen.getByRole("button", { name: "关闭" }));
    view.rerender(<ExportControl {...props} document={{ ...document, metadata: { title: "更新后" } }} />);
    expect(screen.queryByText(/已导出 PNG/)).not.toBeInTheDocument();
    expect(screen.queryByText(/已生成/)).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:export-result");
  });
  it("disables export when the current document cannot be exported", () => {
    renderControl({ disabledReason: "异常 Fixture 不能导出。" });
    expect(screen.getByRole("button", { name: "导出 PNG" })).toBeDisabled();
    expect(screen.getByText("异常 Fixture 不能导出")).toBeInTheDocument();
  });

  it("keeps a compact disabled reason available to pointer and assistive-tech users", () => {
    const disabledReason = "预览正在同步，完成后即可导出。";
    renderControl({ compact: true, disabledReason });

    const trigger = screen.getByRole("button", { name: "导出 PNG" });
    expect(trigger).toBeDisabled();
    // Short reasons are shown without the closing "。" (see noticeText).
    expect(trigger).toHaveAttribute("title", disabledReason.replace(/。$/, ""));
    expect(trigger).toHaveAccessibleDescription(disabledReason.replace(/。$/, ""));
  });

  it("keeps the header and footer outside an independently scrollable short-viewport body", () => {
    expect(editorStyles).toContain("grid-template-rows: auto minmax(0, 1fr) auto;");
    expect(editorStyles).toMatch(
      /\.export-dialog__body\s*\{[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s,
    );
    expect(editorStyles).toContain("max-height: min(760px, calc(100dvh - 16px));");
  });

  it("opens deterministic local settings and downloads the session result", async () => {
    const props = renderControl();
    fireEvent.click(screen.getByRole("button", { name: "导出 PNG" }));

    expect(screen.getByRole("dialog", { name: "导出设置" })).toBeInTheDocument();
    expect(screen.getByLabelText("文件名")).toHaveValue(document.metadata.title);
    expect(screen.getByRole("radio", { name: "竖版" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "3×" })).toBeChecked();
    // The PNG is always full-bleed, so there is no background choice.
    expect(screen.getAllByRole("radiogroup")).toHaveLength(2);
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.queryByRole("combobox", { name: "背景" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "开始导出" }));
    expect(await screen.findByText("图片已生成，已开始下载")).toBeInTheDocument();
    expect(screen.getByText("已开始下载")).toBeInTheDocument();
    expect(props.runSession).toHaveBeenCalledWith(expect.objectContaining({
      document,
      settings: expect.objectContaining({ width: 480, scale: 3 }),
    }));
    expect(props.download).toHaveBeenCalledWith(expect.any(Blob), "长图排版测试.png");
  });

  it("focuses the dialog instead of opening the mobile keyboard", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn((query: string) => ({
        matches: query === "(max-width: 960px)",
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => true),
      })),
    });
    try {
      renderControl();
      fireEvent.click(screen.getByRole("button", { name: "导出 PNG" }));
      const dialog = screen.getByRole("dialog", { name: "导出设置" });
      await waitFor(() => expect(dialog).toHaveFocus());
      expect(screen.getByLabelText("文件名")).not.toHaveFocus();
    } finally {
      if (originalDescriptor) Object.defineProperty(window, "matchMedia", originalDescriptor);
      else Reflect.deleteProperty(window, "matchMedia");
    }
  });

  it("keeps both Tab directions inside the mobile dialog when focus starts on the dialog", async () => {
    const originalDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn((query: string) => ({
        matches: query === "(max-width: 960px)",
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(() => true),
      })),
    });
    try {
      renderControl();
      const trigger = screen.getByRole("button", { name: "导出 PNG" });
      fireEvent.click(trigger);
      const dialog = screen.getByRole("dialog", { name: "导出设置" });
      await waitFor(() => expect(dialog).toHaveFocus());
      const first = screen.getByRole("button", { name: "关闭导出设置" });
      const last = screen.getByRole("button", { name: "开始导出" });

      fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
      expect(last).toHaveFocus();
      expect(trigger).not.toHaveFocus();

      dialog.focus();
      fireEvent.keyDown(dialog, { key: "Tab" });
      expect(first).toHaveFocus();
      expect(trigger).not.toHaveFocus();
    } finally {
      if (originalDescriptor) Object.defineProperty(window, "matchMedia", originalDescriptor);
      else Reflect.deleteProperty(window, "matchMedia");
    }
  });

  it("locks background scrolling while the dialog is open and restores prior styles", () => {
    const root = globalThis.document.documentElement;
    const body = globalThis.document.body;
    const originalRootOverflow = root.style.overflow;
    const originalBodyOverflow = body.style.overflow;
    root.style.overflow = "clip";
    body.style.overflow = "scroll";
    try {
      renderControl();
      const trigger = screen.getByRole("button", { name: "导出 PNG" });
      fireEvent.click(trigger);
      expect(root.style.overflow).toBe("hidden");
      expect(body.style.overflow).toBe("scroll");
      expect(trigger.closest("[inert]")).not.toBeNull();
      expect(trigger.closest('[aria-hidden="true"]')).not.toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "关闭导出设置" }));
      expect(root.style.overflow).toBe("clip");
      expect(body.style.overflow).toBe("scroll");
      expect(trigger.closest("[inert]")).toBeNull();
      expect(trigger.closest('[aria-hidden="true"]')).toBeNull();
    } finally {
      root.style.overflow = originalRootOverflow;
      body.style.overflow = originalBodyOverflow;
    }
  });

  it("restores pre-existing background semantics when an open dialog unmounts", () => {
    const outside = globalThis.document.createElement("main");
    outside.setAttribute("aria-hidden", "false");
    globalThis.document.body.append(outside);
    try {
      const control = renderControl();
      fireEvent.click(screen.getByRole("button", { name: "导出 PNG" }));
      expect(outside).toHaveAttribute("inert");
      expect(outside).toHaveAttribute("aria-hidden", "true");

      control.view.unmount();
      expect(outside).not.toHaveAttribute("inert");
      expect(outside).toHaveAttribute("aria-hidden", "false");
    } finally {
      outside.remove();
    }
  });

  it("uses the wide recommended scale when the preset changes", () => {
    renderControl();
    fireEvent.click(screen.getByRole("button", { name: "导出 PNG" }));
    fireEvent.click(screen.getByRole("radio", { name: "宽版" }));

    expect(screen.getByRole("radio", { name: "2×" })).toBeChecked();
  });

  it("resets the export file name when another document is loaded", () => {
    const canvasRef = createRef<HTMLElement>();
    canvasRef.current = globalThis.document.createElement("section");
    const props = {
      canvasRef,
      document,
      applyPresentation: vi.fn(),
      runSession: vi.fn(async () => createResult()),
      download: vi.fn(),
    };
    const view = render(<ExportControl {...props} />);

    fireEvent.click(screen.getByRole("button", { name: "导出 PNG" }));
    fireEvent.change(screen.getByLabelText("文件名"), { target: { value: "custom-name" } });
    fireEvent.click(screen.getByRole("button", { name: "关闭导出设置" }));

    const nextDocument = {
      ...document,
      id: "fixture-second-document",
      metadata: { ...document.metadata, title: "第二份对话" },
    };
    view.rerender(<ExportControl {...props} document={nextDocument} />);
    fireEvent.click(screen.getByRole("button", { name: "导出 PNG" }));

    expect(screen.getByLabelText("文件名")).toHaveValue("第二份对话");
  });

  it("follows title changes until the export file name is customized", () => {
    const canvasRef = createRef<HTMLElement>();
    canvasRef.current = globalThis.document.createElement("section");
    const props = {
      canvasRef,
      document,
      applyPresentation: vi.fn(),
      runSession: vi.fn(async () => createResult()),
      download: vi.fn(),
    };
    const view = render(<ExportControl {...props} />);
    const renamedDocument = {
      ...document,
      metadata: { ...document.metadata, title: "到了海边，然后呢？" },
    };

    view.rerender(<ExportControl {...props} document={renamedDocument} />);
    fireEvent.click(screen.getByRole("button", { name: "导出 PNG" }));
    expect(screen.getByLabelText("文件名")).toHaveValue("到了海边，然后呢？");

    fireEvent.change(screen.getByLabelText("文件名"), { target: { value: "海边的对话" } });
    fireEvent.click(screen.getByRole("button", { name: "关闭导出设置" }));
    view.rerender(
      <ExportControl
        {...props}
        document={{
          ...renamedDocument,
          metadata: { ...renamedDocument.metadata, title: "到了海边，然后呢？· 重看笔记" },
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "导出 PNG" }));

    expect(screen.getByLabelText("文件名")).toHaveValue("海边的对话");
  });

  it("replaces the conversation fallback when an untitled document gets a title", () => {
    const canvasRef = createRef<HTMLElement>();
    canvasRef.current = globalThis.document.createElement("section");
    const untitledDocument = {
      ...document,
      metadata: { ...document.metadata, title: "" },
    };
    const props = {
      canvasRef,
      document: untitledDocument,
      applyPresentation: vi.fn(),
      runSession: vi.fn(async () => createResult()),
      download: vi.fn(),
    };
    const view = render(<ExportControl {...props} />);

    view.rerender(
      <ExportControl
        {...props}
        document={{
          ...untitledDocument,
          metadata: { ...untitledDocument.metadata, title: "新对话" },
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "导出 PNG" }));

    expect(screen.getByLabelText("文件名")).toHaveValue("新对话");
  });

  it("keeps duplicate actions disabled while export is in progress", async () => {
    let finish: ((result: PngExportSessionResult) => void) | undefined;
    const runSession = vi.fn(() => new Promise<PngExportSessionResult>((resolve) => {
      finish = resolve;
    }));
    renderControl({ runSession });
    const trigger = screen.getByRole("button", { name: "导出 PNG" });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("button", { name: "开始导出" }));

    expect(screen.getByRole("button", { name: "正在生成…" })).toBeDisabled();
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveTextContent("导出中…");
    await act(async () => finish?.(createResult()));
    expect(await screen.findByText("图片已生成，已开始下载")).toBeInTheDocument();
  });

  it("moves focus to Cancel when Start becomes disabled and keeps Tab inside a delayed export", async () => {
    const runSession = vi.fn(() => new Promise<PngExportSessionResult>(() => undefined));
    renderControl({ runSession });
    const trigger = screen.getByRole("button", { name: "导出 PNG" });
    fireEvent.click(trigger);
    const start = screen.getByRole("button", { name: "开始导出" });
    start.focus();
    fireEvent.click(start);

    const cancel = screen.getByRole("button", { name: "取消导出" });
    await waitFor(() => expect(cancel).toHaveFocus());
    expect(screen.getByRole("button", { name: "正在生成…" })).toBeDisabled();

    fireEvent.keyDown(cancel, { key: "Tab" });
    expect(cancel).toHaveFocus();
    expect(trigger).not.toHaveFocus();
  });

  it("asks before lowering clarity and updates the visible setting only after confirmation", async () => {
    const runSession = vi.fn(async (options: Parameters<NonNullable<Parameters<typeof ExportControl>[0]["runSession"]>>[0]) => {
      const choice = await options.onMultiPartPlan?.({ currentScale: 3, partCount: 2, suggestedScale: 2 });
      expect(choice).toEqual({ kind: "use-scale", scale: 2 });
      const result = createResult();
      return { ...result, effectiveSettings: { ...result.effectiveSettings, scale: 2 as const } };
    });
    const props = renderControl({ runSession });
    fireEvent.click(screen.getByRole("button", { name: "导出 PNG" }));
    fireEvent.click(screen.getByRole("button", { name: "开始导出" }));

    expect(await screen.findByText("按 3× 要拆成 2 张图")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "3×" })).toBeChecked();
    fireEvent.click(screen.getByRole("button", { name: "改成 2×，合成一张" }));

    expect(await screen.findByText("图片已生成，已开始下载")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "2×" })).toBeChecked();
    expect(props.download).toHaveBeenCalledTimes(1);
    expect(props.download).toHaveBeenCalledWith(expect.any(Blob), "长图排版测试.png");
  });

  it("returns focus to Cancel after the focused multipart choice is removed", async () => {
    let finishExport: (() => void) | undefined;
    const exportGate = new Promise<void>((resolve) => { finishExport = resolve; });
    const runSession = vi.fn(async (options: Parameters<NonNullable<Parameters<typeof ExportControl>[0]["runSession"]>>[0]) => {
      await options.onMultiPartPlan?.({ currentScale: 3, partCount: 2, suggestedScale: 2 });
      await exportGate;
      return createResult();
    });
    renderControl({ runSession });
    fireEvent.click(screen.getByRole("button", { name: "导出 PNG" }));
    fireEvent.click(screen.getByRole("button", { name: "开始导出" }));
    const choice = await screen.findByRole("button", { name: "改成 2×，合成一张" });
    choice.focus();
    fireEvent.click(choice);

    const cancel = screen.getByRole("button", { name: "取消导出" });
    await waitFor(() => expect(cancel).toHaveFocus());

    await act(async () => finishExport?.());
    expect(await screen.findByText("图片已生成，已开始下载")).toBeInTheDocument();
  });

  it("aborts and resolves a pending multipart choice when unmounted", async () => {
    let observedSignal: AbortSignal | undefined;
    let resolvedChoice: unknown;
    const runSession = vi.fn(async (options: Parameters<NonNullable<Parameters<typeof ExportControl>[0]["runSession"]>>[0]) => {
      observedSignal = options.signal;
      resolvedChoice = await options.onMultiPartPlan?.({ currentScale: 3, partCount: 2, suggestedScale: 2 });
      throw new PngExportError("cancelled", "已取消 PNG 导出。", "预览状态已经恢复。");
    });
    const control = renderControl({ runSession });
    fireEvent.click(screen.getByRole("button", { name: "导出 PNG" }));
    fireEvent.click(screen.getByRole("button", { name: "开始导出" }));
    await screen.findByRole("button", { name: "改成 2×，合成一张" });

    control.view.unmount();

    await waitFor(() => expect(resolvedChoice).toEqual({ kind: "cancel" }));
    expect(observedSignal?.aborted).toBe(true);
  });

  it("downloads multipart PNGs as one ZIP when the current scale is kept", async () => {
    const runSession = vi.fn(async (options: Parameters<NonNullable<Parameters<typeof ExportControl>[0]["runSession"]>>[0]) => {
      const choice = await options.onMultiPartPlan?.({ currentScale: 3, partCount: 2, suggestedScale: 2 });
      expect(choice).toEqual({ kind: "continue" });
      return createMultiResult();
    });
    const props = renderControl({ runSession });
    fireEvent.click(screen.getByRole("button", { name: "导出 PNG" }));
    fireEvent.click(screen.getByRole("button", { name: "开始导出" }));
    fireEvent.click(await screen.findByRole("button", { name: "保持 3×，拆成 2 张（打包成 ZIP）" }));

    expect(await screen.findByText("已生成 2 张图，请点下面下载 ZIP")).toBeInTheDocument();
    expect(props.download).not.toHaveBeenCalled();
    // The blocked-download hint waits until a download has been tried.
    expect(screen.queryByText("没收到文件？看看浏览器是否拦截了下载")).not.toBeInTheDocument();
    const downloadLink = screen.getByRole("link", { name: "下载 ZIP（2 张 PNG）" });
    expect(downloadLink).toHaveAttribute("href", "blob:export-result");
    expect(downloadLink).toHaveAttribute("download", "剩饭放了一夜-parts.zip");
    downloadLink.addEventListener("click", (event) => event.preventDefault());
    fireEvent.click(downloadLink);
    expect(await screen.findByText("已生成 2 张图，已开始下载 ZIP")).toBeInTheDocument();
    expect(screen.getByText("没收到文件？看看浏览器是否拦截了下载")).toBeInTheDocument();
    expect(props.download).not.toHaveBeenCalled();
  });

  it("does not expose or download a delivery cancelled during packaging", async () => {
    let finishRead: ((buffer: ArrayBuffer) => void) | undefined;
    const slowBlob = new Blob(["first"], { type: "image/png" });
    const read = vi.spyOn(slowBlob, "arrayBuffer").mockImplementation(() => (
      new Promise<ArrayBuffer>((resolve) => { finishRead = resolve; })
    ));
    const multiResult = createMultiResult();
    const result = {
      ...multiResult,
      parts: [
        { ...multiResult.parts[0], blob: slowBlob },
        multiResult.parts[1],
      ],
    };
    const props = renderControl({ runSession: vi.fn(async () => result) });
    vi.mocked(URL.createObjectURL).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "导出 PNG" }));
    fireEvent.click(screen.getByRole("button", { name: "开始导出" }));

    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "取消导出" }));
    await act(async () => finishRead?.(new Uint8Array([1]).buffer));

    await waitFor(() => expect(screen.queryByText(/已开始下载|请下载|请点下面下载/)).not.toBeInTheDocument());
    expect(screen.queryByRole("link", { name: /ZIP/ })).not.toBeInTheDocument();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(props.download).not.toHaveBeenCalled();
  });

  it("stays retryable after an actionable failure", async () => {
    const runSession = vi.fn(async () => {
      throw new PngExportError("single-block-too-large", "Block 过高。", "拆分该 Block 后重试。");
    });
    renderControl({ runSession });
    fireEvent.click(screen.getByRole("button", { name: "导出 PNG" }));
    fireEvent.click(screen.getByRole("button", { name: "开始导出" }));

    expect(await screen.findAllByText("Block 过高")).toHaveLength(2);
    expect(screen.getAllByText("拆分该 Block 后重试")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "重试导出" })).toBeEnabled();
  });
});
