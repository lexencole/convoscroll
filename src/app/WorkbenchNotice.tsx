import type { LocalizedText } from "../i18n/messages";
import { useUiText } from "../i18n/LocaleContext";
import { useEffect, useRef, useState } from "react";
import { Icon, IconButton } from "./Icon";
import { noticeText } from "./notice-text";

export interface WorkbenchNoticeValue {
  readonly id: number;
  readonly message: LocalizedText;
  readonly tone: "status" | "alert";
}

// Only ordinary confirmations expire. Errors remain until explicitly dismissed.
export function WorkbenchNotice({ notice, onDismiss }: {
  readonly notice: WorkbenchNoticeValue;
  readonly onDismiss: () => void;
}) {
  const t = useUiText();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const previousFocus = useRef(document.activeElement);
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;

  useEffect(() => {
    if (notice.tone === "alert" || hovered || focused) return;
    const timer = window.setTimeout(() => dismiss.current(), 6000);
    return () => window.clearTimeout(timer);
  }, [notice.id, notice.tone, hovered, focused]);

  return <aside className="workbench-notice" data-tone={notice.tone}
    onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)}
    onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <Icon name={notice.tone === "alert" ? "error" : "check"} />
    <span role={notice.tone} aria-atomic="true">{noticeText(t(notice.message))}</span>
    <IconButton icon="close" label={t("关闭提示")} onClick={() => {
      onDismiss();
      if (focused) window.requestAnimationFrame(() => {
        const target = previousFocus.current;
        const reachable = target instanceof HTMLElement && target.isConnected && target !== document.body
          && !target.closest('[hidden], [inert]') && !target.matches(':disabled')
          && (!target.closest('details:not([open])') || target.matches('details:not([open]) > summary'));
        if (reachable) target.focus();
        else document.querySelector<HTMLElement>(".document-menu__trigger")?.focus();
      });
    }} />
  </aside>;
}
