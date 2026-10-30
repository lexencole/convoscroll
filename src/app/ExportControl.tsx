import { message as msg, type LocalizedText } from "../i18n/messages";
import { useUiText } from "../i18n/LocaleContext";
import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent, type Ref, type RefObject } from "react";
import { createPortal } from "react-dom";
import { SegmentedControl } from "./SegmentedControl";
import type { ConversationDocument } from "../data/conversation-types";
import { createPngDelivery, downloadBlob, type PngDelivery } from "../export/download-png";
import { runPngExportSession } from "../export/export-session";
import {
  PngExportError,
  type ExportSessionStage,
  type MultiPartPlanChoice,
  type MultiPartPlanChoiceRequest,
  type PngExportSessionResult,
  type PngExportSettings,
} from "../export/export-types";
import type { ExportPresentation } from "../renderer/ExportPresentationContext";
import { Icon, IconButton } from "./Icon";
import { SelectField } from "./SelectField";
import { useModalIsolation } from "./use-modal-isolation";
import { noticeText } from "./notice-text";

type ExportSessionFunction = typeof runPngExportSession;
type DownloadFunction = typeof downloadBlob;

export interface ExportControlHandle { readonly openSettings: (trigger?: HTMLElement) => void }
interface ExportControlProps {
  readonly controlsRef?: Ref<ExportControlHandle>;
  readonly directExport?: boolean;
  readonly canvasRef: RefObject<HTMLElement | null>;
  readonly document: ConversationDocument;
  readonly applyPresentation: (presentation: ExportPresentation | undefined) => void;
  readonly disabledReason?: string;
  readonly compact?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly runSession?: ExportSessionFunction;
  readonly download?: DownloadFunction;
}

type ControlState =
  | { readonly kind: "idle" }
  | { readonly kind: "busy"; readonly label: LocalizedText }
  | {
      readonly kind: "success";
      readonly result: PngExportSessionResult;
      readonly delivery: PngDelivery;
      readonly downloadStarted: boolean;
    }
  | { readonly kind: "error"; readonly message: LocalizedText; readonly recommendation: LocalizedText };

const presetOptions = [
  { value: "portrait", label: "竖版" },
  { value: "wide", label: "宽版" },
] as const;
const scaleOptions = [
  { value: "1", label: "1×" },
  { value: "2", label: "2×" },
  { value: "3", label: "3×" },
] as const;
const foldOptions = [
  { value: "block", label: "按每一块自己的设置" },
  { value: "preview", label: "和现在看到的一样" },
  { value: "collapsed", label: "全部收起" },
  { value: "expanded", label: "全部展开" },
] as const;
const DIALOG_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  '[tabindex]:not([tabindex="-1"]):not([disabled])',
].join(",");

/** Only imported data and older projects set an export state per block; the editor no longer does. */
function hasBlockFoldSettings(document: ConversationDocument) {
  return document.messages.some((message) => message.blocks.some((block) => "exportState" in block && block.exportState !== "current"));
}

function defaultFoldStrategy(document: ConversationDocument): PngExportSettings["foldStrategy"] {
  return hasBlockFoldSettings(document) ? "block" : "preview";
}

function defaultSettings(document: ConversationDocument): PngExportSettings {
  return {
    fileName: document.metadata.title || "conversation",
    preset: "portrait",
    width: 480,
    scale: 3,
    foldStrategy: defaultFoldStrategy(document),
  };
}

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function stageLabel(stage: ExportSessionStage, part?: { readonly index: number; readonly total: number }): LocalizedText {
  if (stage === "preparing") return "正在加载字体、图片和公式…";
  if (stage === "planning") return "正在检查是否需要分段…";
  if (stage === "awaiting-choice") return "内容太长，按现在的清晰度一张图放不下，请选一种导出方式。";
  if (stage === "restoring") return "正在恢复预览…";
  return part ? msg("正在生成第 {0}/{1} 张 PNG…", part.index + 1, part.total) : "正在生成 PNG…";
}

export function ExportControl({
  canvasRef,
  document,
  applyPresentation,
  disabledReason,
  compact = false,
  directExport = false,
  controlsRef,
  onOpenChange,
  runSession = runPngExportSession,
  download = downloadBlob,
}: ExportControlProps) {
  const t = useUiText();
  const [view, setView] = useState<"settings" | "export">("settings");
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(() => defaultSettings(document));
  const [state, setState] = useState<ControlState>({ kind: "idle" });
  const [pendingChoice, setPendingChoice] = useState<MultiPartPlanChoiceRequest>();
  const [resultDownloadUrl, setResultDownloadUrl] = useState<string>();
  const disabledReasonId = `export-disabled-${useId()}`;
  const abortRef = useRef<AbortController | undefined>(undefined);
  const choiceResolverRef = useRef<((choice: MultiPartPlanChoice) => void) | undefined>(undefined);
  const resultDownloadUrlRef = useRef<string | undefined>(undefined);
  const settingsDocumentIdRef = useRef(document.id);
  const resultDocumentRef = useRef(document);
  const settingsDefaultFileNameRef = useRef(document.metadata.title || "conversation");
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const fileNameRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const busy = state.kind === "busy";

  useModalIsolation(open, dialogRef);
  useImperativeHandle(controlsRef, () => ({ openSettings }));

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const mobile = typeof window.matchMedia === "function"
        && window.matchMedia("(max-width: 960px)").matches;
      if (cancelRef.current) cancelRef.current.focus({ preventScroll: true });
      else if (mobile) dialogRef.current?.focus({ preventScroll: true });
      else (dialogRef.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]:not([disabled])') ?? dialogRef.current)?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      requestAnimationFrame(() => { const target = returnFocusRef.current; (target?.isConnected ? target : triggerRef.current)?.focus(); });
    };
  }, [open]);

  useEffect(() => {
    if (!open || !busy) return;
    const dialog = dialogRef.current;
    const activeElement = globalThis.document.activeElement;
    const activeIsEnabledControl = activeElement instanceof HTMLElement
      && dialog?.contains(activeElement)
      && activeElement.matches(DIALOG_FOCUSABLE_SELECTOR);
    if (activeIsEnabledControl) return;

    (cancelRef.current ?? dialog)?.focus({ preventScroll: true });
  }, [busy, open, pendingChoice]);

  // Release the workbench's disabled controls before the queued focus return.
  useLayoutEffect(() => {
    onOpenChange?.(open);
  }, [onOpenChange, open]);

  useEffect(() => () => onOpenChange?.(false), [onOpenChange]);

  useEffect(() => () => {
    choiceResolverRef.current?.({ kind: "cancel" });
    choiceResolverRef.current = undefined;
    abortRef.current?.abort();
    abortRef.current = undefined;
    if (resultDownloadUrlRef.current) URL.revokeObjectURL(resultDownloadUrlRef.current);
  }, []);

  function setResultBlob(blob?: Blob) {
    if (resultDownloadUrlRef.current) URL.revokeObjectURL(resultDownloadUrlRef.current);
    const nextUrl = blob ? URL.createObjectURL(blob) : undefined;
    resultDownloadUrlRef.current = nextUrl;
    setResultDownloadUrl(nextUrl);
  }

  useEffect(() => {
    if (resultDocumentRef.current === document || busy) return;
    resultDocumentRef.current = document;
    // A previous PNG is no longer an export of the currently edited document.
    setState({ kind: "idle" });
    setResultBlob();
  }, [document, busy]);

  function refreshedSettings() {
    const documentChanged = settingsDocumentIdRef.current !== document.id;
    const previousDefaultFileName = settingsDefaultFileNameRef.current;
    const nextDefaultFileName = document.metadata.title || "conversation";
    const defaultFileNameChanged = previousDefaultFileName !== nextDefaultFileName;
    settingsDocumentIdRef.current = document.id;
    settingsDefaultFileNameRef.current = nextDefaultFileName;
    const current = settings;
    const next: PngExportSettings = {
      ...current,
      fileName: documentChanged
        || (defaultFileNameChanged && (
          current.fileName === previousDefaultFileName
          || !current.fileName.trim()
        ))
        ? nextDefaultFileName
        : current.fileName || nextDefaultFileName,
      foldStrategy: documentChanged || (current.foldStrategy === "block" && !hasBlockFoldSettings(document))
        ? defaultFoldStrategy(document)
        : current.foldStrategy,
    };
    setSettings(next);
    return next;
  }
  function openSettings(trigger?: HTMLElement) {
    if (busy || disabledReason) return;
    returnFocusRef.current = trigger ?? triggerRef.current;
    refreshedSettings(); setView("settings");
    setState({ kind: "idle" });
    setResultBlob();
    setOpen(true);
  }

  function requestMultiPartChoice(request: MultiPartPlanChoiceRequest) {
    return new Promise<MultiPartPlanChoice>((resolve) => {
      choiceResolverRef.current = resolve;
      setPendingChoice(request);
    });
  }

  function resolveMultiPartChoice(choice: MultiPartPlanChoice) {
    if (choice.kind === "use-scale") {
      setSettings((current) => ({ ...current, scale: choice.scale }));
    }
    const resolve = choiceResolverRef.current;
    choiceResolverRef.current = undefined;
    setPendingChoice(undefined);
    resolve?.(choice);
  }

  function cancelExport() {
    if (pendingChoice) resolveMultiPartChoice({ kind: "cancel" });
    else abortRef.current?.abort();
  }

  async function handleExport(exportSettings = settings) {
    if (abortRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) {
      setState({
        kind: "error",
        message: "还没有可以导出的内容。",
        recommendation: "等页面显示完再试。",
      });
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setPendingChoice(undefined);
    setResultBlob();
    try {
      setState({ kind: "busy", label: stageLabel("preparing") });
      const result = await runSession({
        document,
        canvas,
        settings: exportSettings,
        applyPresentation,
        signal: controller.signal,
        onStage(stage, part) {
          setState({ kind: "busy", label: stageLabel(stage, part) });
        },
        onMultiPartPlan: requestMultiPartChoice,
      });
      setSettings(result.effectiveSettings);
      const delivery = await createPngDelivery(
        result.parts,
        result.effectiveSettings.fileName,
        controller.signal,
      );
      if (controller.signal.aborted) {
        throw new PngExportError("cancelled", "已取消 PNG 导出。", "预览已恢复。");
      }
      setResultBlob(delivery.blob);
      const downloadStarted = delivery.kind === "png";
      if (downloadStarted) {
        if (controller.signal.aborted) {
          throw new PngExportError("cancelled", "已取消 PNG 导出。", "预览已恢复。");
        }
        download(delivery.blob, delivery.fileName);
      }
      setState({ kind: "success", result, delivery, downloadStarted });
    } catch (error) {
      if (error instanceof PngExportError) {
        if (error.code === "cancelled") {
          setState({ kind: "idle" });
          return;
        }
        setState({
          kind: "error",
          message: error.messageText,
          recommendation: error.recommendationText,
        });
      } else {
        setState({
          kind: "error",
          message: "导出出错了。",
          recommendation: "刷新页面后再试。",
        });
      }
    } finally {
      abortRef.current = undefined;
      choiceResolverRef.current = undefined;
      setPendingChoice(undefined);
    }
  }

  function markResultDownloadStarted() {
    if (state.kind !== "success") return;
    setState({ ...state, downloadStarted: true });
  }

  function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape" && !busy) {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      DIALOG_FOCUSABLE_SELECTOR,
    ) ?? []).filter((item) => !item.closest('[hidden]') && !item.matches(':disabled')
      && (!item.closest('details:not([open])') || item.matches('details:not([open]) > summary')));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    const activeElement = globalThis.document.activeElement;
    if (activeElement === dialogRef.current) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    } else if (event.shiftKey && activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  return (
    <div className={`export-control${compact ? " export-control--compact" : ""}`}>
      <button
        ref={triggerRef}
        type="button"
        className="export-control__button"
        aria-describedby={disabledReason ? disabledReasonId : undefined}
        title={compact && disabledReason ? noticeText(t(disabledReason)) : undefined}
        disabled={busy || Boolean(disabledReason)}
        onClick={() => {
          if (!directExport) { openSettings(); return; }
          returnFocusRef.current = triggerRef.current;
          const next = refreshedSettings(); setView("export"); setOpen(true);
          void handleExport(next);
        }}
      >
        <Icon name="download" />
        <span>{busy ? t("导出中…") : t("导出 PNG")}</span>
      </button>
      <div
        id={disabledReason ? disabledReasonId : undefined}
        className={`export-control__feedback${disabledReason ? " export-control__feedback--disabled" : ""}`}
        role="status"
        aria-live="polite"
      >
        {disabledReason ? <span>{noticeText(t(disabledReason))}</span> : null}
        {state.kind === "busy" ? <span>{t(state.label)}</span> : null}
        {state.kind === "success" ? (
          <span className="export-control__success">
            {state.delivery.kind === "zip"
              ? state.downloadStarted
                ? t("已开始下载 ZIP")
                : t("请下载 ZIP")
              : t("已开始下载")}
          </span>
        ) : null}
        {state.kind === "error" ? (
          <span className="export-control__error">
            <strong>{noticeText(t(state.message))}</strong>
            <small>{noticeText(t(state.recommendation))}</small>
          </span>
        ) : null}
      </div>

      {open ? createPortal(
        <div
          className="export-dialog-backdrop"
          role="presentation"
          onPointerDown={(event) => {
            if (!busy && event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            ref={dialogRef}
            className="export-dialog"
            role="dialog"
            tabIndex={-1}
            aria-modal="true"
            aria-labelledby="export-dialog-title"
            onKeyDown={handleDialogKeyDown}
          >
            <header>
              <h2 id="export-dialog-title">{view === "settings" ? t("导出设置") : t("导出 PNG")}</h2>
              <IconButton icon="close" label={t("关闭导出设置")} disabled={busy} onClick={() => setOpen(false)} />
            </header>

            <div className="export-dialog__body">
              {view === "settings" ? <>
              <div className="editor-field editor-field--full"><span>{t("版式")}</span>
                <SegmentedControl label={t("版式")} value={settings.preset} options={presetOptions.map((option) => ({ ...option, label: t(option.label) }))} disabled={busy}
                  onChange={(preset) => setSettings({ ...settings, preset, width: preset === "portrait" ? 480 : 720, scale: preset === "portrait" ? 3 : 2 })} />
              </div>
              <div className="editor-field editor-field--full"><span>{t("清晰度")}</span>
                <SegmentedControl label={t("清晰度")} value={String(settings.scale) as "1" | "2" | "3"} options={scaleOptions} disabled={busy}
                  onChange={(scale) => setSettings({ ...settings, scale: Number(scale) as 1 | 2 | 3 })} />
              </div>
              <details hidden={busy} className="workbench-more-fields export-dialog__more"><summary><span>{t("更多选项")}</span><Icon name="chevron-right" /></summary><div>
                <div className="editor-field editor-field--full"><label htmlFor="export-file-name">{t("文件名")}</label>
                  <input ref={fileNameRef} id="export-file-name" value={settings.fileName} disabled={busy}
                    onChange={(event) => setSettings({ ...settings, fileName: event.target.value })} />
                </div>
                <div className="editor-field editor-field--full"><label htmlFor="export-fold">{t("折叠的内容")}</label>
                  <SelectField id="export-fold" value={settings.foldStrategy}
                    options={(hasBlockFoldSettings(document) ? foldOptions : foldOptions.filter((option) => option.value !== "block")).map((option) => ({ ...option, label: t(option.label) }))} disabled={busy}
                    onChange={(foldStrategy) => setSettings({ ...settings, foldStrategy })} />
                </div>
              </div></details>
              </> : null}
              {state.kind === "idle" ? <p className="export-dialog__summary"><Icon name="document" /><span>{t("PNG · {0} px 宽", settings.width * settings.scale)}</span></p> : null}
              {state.kind === "busy" && !pendingChoice ? (
                <div className="export-dialog__progress" role="status">
                  <span className="export-dialog__spinner" aria-hidden="true" />
                  <span>{noticeText(t(state.label))}</span>
                </div>
              ) : null}
              {pendingChoice ? (
                <div className="export-dialog__choice" role="group" aria-label={t("选择长图导出方式")}>
                  <strong>{t("按 {0}× 要拆成 {1} 张图", pendingChoice.currentScale, pendingChoice.partCount)}</strong>
                  {pendingChoice.suggestedScale ? (
                    <span>{t("使用 {0}× 可导出为一张图，清晰度会降低", pendingChoice.suggestedScale)}</span>
                  ) : (
                    <span>{t("内容太长，降低清晰度也放不进一张图，只能拆开")}</span>
                  )}
                  <div>
                    {pendingChoice.suggestedScale ? (
                      <button
                        type="button"
                        className="export-dialog__primary"
                        onClick={() => resolveMultiPartChoice({ kind: "use-scale", scale: pendingChoice.suggestedScale! })}
                      >{t("改成 {0}×，合成一张", pendingChoice.suggestedScale)}</button>
                    ) : null}
                    <button type="button" onClick={() => resolveMultiPartChoice({ kind: "continue" })}>{t("保持 {0}×，拆成 {1} 张（打包成 ZIP）", pendingChoice.currentScale, pendingChoice.partCount)}</button>
                  </div>
                </div>
              ) : null}
              {state.kind === "error" ? (
                <div className="export-dialog__error" role="alert">
                  <strong>{noticeText(t(state.message))}</strong>
                  <span>{noticeText(t(state.recommendation))}</span>
                </div>
              ) : null}
              {state.kind === "success" ? (
                <div className="export-dialog__result">
                  <strong>
                    {state.delivery.kind === "zip"
                      ? state.downloadStarted
                        ? t("已生成 {0} 张图，已开始下载 ZIP", state.result.parts.length)
                        : t("已生成 {0} 张图，请点下面下载 ZIP", state.result.parts.length)
                      : t("图片已生成，已开始下载")}
                  </strong>
                  <span>
                    {state.result.parts.map((part) => `${part.metrics.pixelWidth} × ${part.metrics.pixelHeight}px · ${formatBytes(part.blob.size)}`).join("；")}
                  </span>
                  {state.result.diagnostics.filter((diagnostic) => diagnostic.severity === "warning").map((diagnostic) => (
                    <small key={diagnostic.code}>{t(diagnostic.messageText ?? diagnostic.message)}</small>
                  ))}
                  <small>{t("下载文件：{0}", state.delivery.fileName)}</small>
                  {resultDownloadUrl ? (
                    <div className="export-dialog__download">
                      <a
                        className="export-dialog__download-link"
                        href={resultDownloadUrl}
                        download={state.delivery.fileName}
                        onClick={markResultDownloadStarted}
                      >
                        {state.delivery.kind === "zip"
                          ? t("{0}下载 ZIP（{1} 张 PNG）", state.downloadStarted ? t("再次") : "", state.result.parts.length)
                          : t("再次下载 PNG")}
                      </a>
                      {state.downloadStarted ? <small>{t("没收到文件？看看浏览器是否拦截了下载")}</small> : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <footer>
              {directExport && view === "settings" ? <>
                <button type="button" className="export-dialog__primary" disabled={!settings.fileName.trim()} onClick={() => setOpen(false)}><Icon name="check" />{t("完成")}</button>
              </> : <>
                {busy ? <button ref={cancelRef} type="button" onClick={cancelExport}>{t("取消导出")}</button>
                  : <button type="button" onClick={() => setOpen(false)}>{state.kind === "success" ? t("关闭") : t("取消")}</button>}
                {!pendingChoice ? <button type="button" className="export-dialog__primary" disabled={busy || !settings.fileName.trim()}
                  onClick={() => void handleExport()}>{busy ? t("正在生成…") : state.kind === "error" ? t("重试导出") : state.kind === "success" ? t("再次导出") : t("开始导出")}</button> : null}
              </>}
            </footer>
          </section>
        </div>, globalThis.document.body
      ) : null}
    </div>
  );
}
