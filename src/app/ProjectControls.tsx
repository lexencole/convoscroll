import type { LocalizedText } from "../i18n/messages";
import { useUiText, useUiLocale } from "../i18n/LocaleContext";
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { ConversationAsset, ConversationDocument } from "../data/conversation-types";
import { downloadBlob } from "../export/download-png";
import type { StoredAssetRecord } from "../persistence/project-store";
import { exportProjectPackage } from "../project/project-export";
import {
  MissingProjectAssetsError,
  type PreparedImport,
} from "../project/project-format";
import { prepareImportFile } from "../project/prepare-import";
import { useModalIsolation } from "./use-modal-isolation";
import { Icon } from "./Icon";
import { noticeText } from "./notice-text";
import { projectErrorPresentation } from "./error-presentation";
import { ErrorDetails } from "./ErrorDetails";

const DIALOG_FOCUSABLE_SELECTOR = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ProjectControls({
  document,
  replaceProject,
  resolveAssetBlob,
  onImported,
  onMenuAction,
  menuItem = false,
  dialogFocusSuspended = false,
}: {
  readonly document: ConversationDocument;
  readonly replaceProject: (
    document: ConversationDocument,
    assets: readonly StoredAssetRecord[],
  ) => Promise<string>;
  readonly resolveAssetBlob: (asset: ConversationAsset) => Promise<Blob | undefined>;
  readonly onImported: (document: ConversationDocument, savedAt: string) => void;
  readonly onMenuAction?: () => void;
  readonly menuItem?: boolean;
  readonly dialogFocusSuspended?: boolean;
}) {
  const t = useUiText();
  const { locale } = useUiLocale();
  const inputRef = useRef<HTMLInputElement>(null);
  const importButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const onMenuActionRef = useRef(onMenuAction);
  const [preparing, setPreparing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [preview, setPreview] = useState<PreparedImport>();
  const [error, setError] = useState<{ readonly message: LocalizedText; readonly detail?: LocalizedText; readonly technicalDetail?: LocalizedText }>();
  const dialogOpen = Boolean(preview && !dialogFocusSuspended);
  onMenuActionRef.current = onMenuAction;

  useModalIsolation(dialogOpen, dialogRef);

  useEffect(() => {
    if (!preview || dialogFocusSuspended) return;
    confirmButtonRef.current?.focus();
  }, [dialogFocusSuspended, preview]);

  useEffect(() => {
    if (!preview) return;
    return () => {
      window.requestAnimationFrame(() => {
        if (menuItem) onMenuActionRef.current?.();
        else importButtonRef.current?.focus();
      });
    };
  }, [menuItem, preview]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (
      !preparing
      || !dialog
      || dialog.querySelector(DIALOG_FOCUSABLE_SELECTOR)
    ) return;
    dialog.focus({ preventScroll: true });
  }, [preparing]);

  function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>) {
    event.stopPropagation();
    if (event.key === "Escape" && !preparing) {
      event.preventDefault();
      setPreview(undefined);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
      DIALOG_FOCUSABLE_SELECTOR,
    ) ?? [])];
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current?.focus({ preventScroll: true });
      return;
    }
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

  async function exportProject(allowMissingAssets = false) {
    if (!allowMissingAssets) onMenuActionRef.current?.();
    setExporting(true);
    setError(undefined);
    try {
      const result = await exportProjectPackage({ document, resolveAssetBlob, allowMissingAssets });
      downloadBlob(result.blob, result.fileName);
    } catch (cause) {
      if (cause instanceof MissingProjectAssetsError && !allowMissingAssets) {
        const confirmed = window.confirm(
          t("{0} 读不到。仍要导出吗？这些文件会标记为缺失。", cause.fileNames.join(", ")),
        );
        if (confirmed) await exportProject(true);
        return;
      }
      setError({
        message: "导出项目失败",
        ...projectErrorPresentation(cause, "无法生成 .convcanvas 文件，请重试。"),
      });
    } finally {
      setExporting(false);
    }
  }

  async function prepare(file: File) {
    setPreparing(true);
    setError(undefined);
    setPreview(undefined);
    try {
      setPreview(await prepareImportFile(file, locale));
    } catch (cause) {
      setError({
        message: "无法导入文件",
        ...projectErrorPresentation(cause, "文件格式有误，请检查后重试。"),
      });
    } finally {
      setPreparing(false);
    }
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) {
      onMenuActionRef.current?.();
      void prepare(file);
    }
  }

  function openImportPicker() {
    onMenuActionRef.current?.();
    inputRef.current?.click();
  }

  async function confirmImport() {
    if (!preview) return;
    setPreparing(true);
    setError(undefined);
    try {
      const savedAt = await replaceProject(preview.document, preview.assets);
      onImported(preview.document, savedAt);
      setPreview(undefined);
    } catch (cause) {
      setError({
        message: "导入失败，当前项目未替换",
        ...projectErrorPresentation(cause, "无法保存到浏览器，请重试。"),
      });
    } finally {
      setPreparing(false);
    }
  }

  return (
    <>
      <button
        type="button"
        role={menuItem ? "menuitem" : undefined}
        tabIndex={menuItem ? -1 : undefined}
        disabled={exporting}
        onClick={() => void exportProject()}
      >
        {menuItem ? <Icon name="download" /> : null}
        {exporting ? t("正在导出…") : t("导出项目")}
      </button>
      <button
        ref={importButtonRef}
        type="button"
        role={menuItem ? "menuitem" : undefined}
        tabIndex={menuItem ? -1 : undefined}
        disabled={preparing}
        onClick={openImportPicker}
      >
        {menuItem ? <Icon name="upload" /> : null}
        {preparing ? t("正在读取…") : t("导入项目或 Markdown")}
      </button>
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="project-import-input"
        // iOS greys out unknown extensions such as .convcanvas; octet-stream lets it
        // open Files with every file selectable. prepareImportFile checks the content.
        accept=".convcanvas,.md,application/octet-stream,text/markdown,text/plain"
        onChange={handleFileInput}
      />

      {typeof globalThis.document === "undefined" ? null : createPortal(
        <>
          {preview && !dialogFocusSuspended ? (
            <div className="import-dialog-backdrop">
              <section
                ref={dialogRef}
                className="import-dialog"
                role="dialog"
                tabIndex={-1}
                aria-modal="true"
                aria-labelledby="import-dialog-title"
                onKeyDown={handleDialogKeyDown}
              >
                <header>
                  <span>{preview.kind === "project" ? t(".convcanvas 项目") : preview.markdownKind === "plain" ? t("普通 Markdown") : `Conversation Markdown v${preview.markdownVersion ?? 1}`}</span>
                  <h2 id="import-dialog-title">{t("导入预览")}</h2>
                  <p>{preview.fileName}</p>
                </header>
                <dl className="import-summary">
                  <div><dt>{t("标题")}</dt><dd>{preview.summary.title}</dd></div>
                  <div><dt>{t("消息")}</dt><dd>{preview.summary.messageCount}</dd></div>
                  <div><dt>{t("内容块")}</dt><dd>{preview.summary.blockCount}</dd></div>
                  <div><dt>{t("附件")}</dt><dd>{preview.summary.assetCount} · {formatBytes(preview.summary.availableAssetBytes)}</dd></div>
                </dl>
                {preview.warnings.length > 0 ? (
                  <div className="import-warning" role="status">
                    <strong>{t("可以导入，但请注意")}</strong>
                    <ul>{preview.warnings.map((warning, index) => <li key={`${warning.code}-${index}`}>{t(warning.messageText ?? warning.message)}</li>)}</ul>
                  </div>
                ) : null}
                <p className="import-replace-note">{t("确认后会替换现在的内容")}</p>
                <footer>
                  <button type="button" disabled={preparing} onClick={() => setPreview(undefined)}>{t("取消")}</button>
                  <button ref={confirmButtonRef} type="button" disabled={preparing} onClick={() => void confirmImport()}>
                    {preparing ? t("正在写入…") : t("替换当前项目")}
                  </button>
                </footer>
              </section>
            </div>
          ) : null}

          {error ? (
            <div
              className="project-error"
              role="alert"
              onKeyDown={(event) => event.stopPropagation()}
            >
              <strong>{t(error.message)}</strong>
              {error.detail ? <span>{noticeText(t(error.detail))}</span> : null}
              {error.technicalDetail ? <ErrorDetails text={error.technicalDetail} /> : null}
              <button type="button" onClick={() => setError(undefined)}>{t("关闭")}</button>
            </div>
          ) : null}
        </>,
        globalThis.document.body,
      )}
    </>
  );
}
