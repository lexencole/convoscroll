import { useUiText, useUiLocale } from "../i18n/LocaleContext";
import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import type { ConversationDocument } from "../data/conversation-types";
import { IconButton } from "./Icon";
import { messageNavigationEntries } from "./message-navigation";
import { useModalIsolation } from "./use-modal-isolation";

export function BlockTransferDialog({ conversation, sourceId, copy, error, onChoose, onClose }: {
  conversation: ConversationDocument; sourceId: string; copy: boolean;
  error?: string;
  onChoose: (messageId: string) => void; onClose: () => void;
}) {
  const t = useUiText();
  const { locale } = useUiLocale();
  const panel = useRef<HTMLElement>(null);
  const entries = useMemo(() => messageNavigationEntries(conversation, locale).filter((entry) => entry.id !== sourceId), [conversation, sourceId, locale]);
  useModalIsolation(true, panel);
  useEffect(() => { panel.current?.querySelector<HTMLButtonElement>('[data-destination]')?.focus(); }, []);
  return createPortal(<section ref={panel} className="workbench-settings workbench-transfer" role="dialog" aria-modal="true" aria-label={copy ? t("复制到另一条消息") : t("移动到另一条消息")}
    onKeyDown={(event) => {
      const buttons = [...(panel.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (["ArrowUp", "ArrowDown", "Home", "End", "Tab"].includes(event.key)) {
        event.preventDefault();
        const index = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
          : (current + (event.key === "ArrowUp" || event.key === "Tab" && event.shiftKey ? -1 : 1) + buttons.length) % buttons.length;
        buttons[index]?.focus();
      }
    }}>
    <header><h2>{copy ? t("复制到…") : t("移动到…")}</h2><IconButton icon="close" label={t("取消")} onClick={onClose} /></header>
    <div className="workbench-settings__scroll workbench-transfer__list">
      {error ? <p role="alert" className="inline-notice">{t(error)}</p> : null}
      {entries.map((entry) => <button type="button" key={entry.id} data-destination={entry.id} aria-label={t("消息 {0}，{1}，{2}", entry.index + 1, entry.name, entry.summary)} onClick={() => onChoose(entry.id)}>
        <span className="workbench-transfer__index">{entry.index + 1}</span>
        <span className="workbench-transfer__text"><strong>{entry.name}</strong><span>{entry.summary}</span></span>
      </button>)}
    </div>
  </section>, document.body);
}
