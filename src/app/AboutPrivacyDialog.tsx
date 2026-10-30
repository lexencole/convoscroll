import { useUiText } from "../i18n/LocaleContext";
import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  APP_VERSION,
  PRODUCT_NAME_ZH,
} from "../product-info";
import { useModalIsolation } from "./use-modal-isolation";

export function AboutPrivacyDialog({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: () => void;
}) {
  const t = useUiText();
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const frame = requestAnimationFrame(() => closeButtonRef.current?.focus());

    return () => {
      cancelAnimationFrame(frame);
      requestAnimationFrame(() => opener?.isConnected && opener.focus());
    };
  }, [open]);

  useModalIsolation(open, dialogRef);

  if (!open || typeof document === "undefined") return null;

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      event.nativeEvent.stopImmediatePropagation();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ) ?? [])];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleBackdropPointerDown(event: PointerEvent<HTMLDivElement>) {
    event.stopPropagation();
    event.nativeEvent.stopImmediatePropagation();
    if (event.target === event.currentTarget) onClose();
  }

  return createPortal(
    <div className="about-dialog-backdrop" onPointerDown={handleBackdropPointerDown}>
      <section
        ref={dialogRef}
        className="about-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-dialog-title"
        aria-describedby="about-dialog-summary"
        onKeyDown={handleKeyDown}
      >
        <header className="about-dialog__header">
          <h2 id="about-dialog-title">{t(PRODUCT_NAME_ZH)}</h2>
          <button ref={closeButtonRef} type="button" onClick={onClose}>{t("关闭")}</button>
        </header>

        <p id="about-dialog-summary" className="about-dialog__tagline">{t("对话只存在这个浏览器里，不会上传。清除浏览器数据前，记得先导出项目。")}</p>

        <footer className="about-dialog__footer">
          <span>{t("版本 {0}", APP_VERSION)}</span>
          <a href="/THIRD_PARTY_NOTICES.txt" target="_blank" rel="noreferrer noopener">{t("开源许可")}</a>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
