import { useUiText, useUiLocale } from "../i18n/LocaleContext";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import type { ConversationDocument } from "../data/conversation-types";
import { Icon } from "./Icon";
import { messageNavigationEntries } from "./message-navigation";
import { useModalIsolation } from "./use-modal-isolation";

/** Reading position is independent of the block currently being edited. */
export function MessageNavigator({ document: conversation, canvas, disabled }: {
  document: ConversationDocument; canvas: RefObject<HTMLElement | null>; disabled: boolean;
}) {
  const t = useUiText();
  const { locale } = useUiLocale();
  const entries = useMemo(() => messageNavigationEntries(conversation, locale), [conversation, locale]);
  const [current, setCurrent] = useState<string | undefined>(entries[0]?.id);
  const [preview, setPreview] = useState<{ id: string; top: number }>();
  const [open, setOpen] = useState(false);
  const rail = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const tooltipId = useId();
  const currentId = entries.some((entry) => entry.id === current) ? current : entries[0]?.id;
  const activePreview = entries.find((entry) => entry.id === preview?.id);
  const modalOpen = open && !disabled && entries.length > 0;
  useModalIsolation(modalOpen, dialog);

  function readingLine() {
    const chrome = window.document.querySelector('.workbench-chrome');
    const gap = parseFloat(getComputedStyle(window.document.documentElement).getPropertyValue('--space-4')) || 16;
    return Math.max(0, chrome?.getBoundingClientRect().bottom ?? 0) + gap;
  }
  useEffect(() => {
    const elements = [...(canvas.current?.querySelectorAll<HTMLElement>('[data-message-id]') ?? [])];
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const line = readingLine();
        let selected: HTMLElement | undefined = elements[0];
        for (const element of elements) {
          if (element.getBoundingClientRect().top <= line + 1) selected = element;
          else break;
        }
        if (window.scrollY > 0 && window.scrollY + window.innerHeight >= window.document.documentElement.scrollHeight - 2) selected = elements.at(-1);
        setCurrent(selected?.dataset.messageId);
      });
    };
    update();
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const observer = new ResizeObserver(update);
    if (canvas.current) observer.observe(canvas.current);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('scroll', update); window.removeEventListener('resize', update); };
  }, [canvas, conversation.messages]);

  useEffect(() => {
    const list = rail.current;
    if (!list || list.contains(window.document.activeElement)) return;
    const active = [...list.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.dataset.entryId === currentId);
    if (!active) return;
    if (active.offsetTop < list.scrollTop) list.scrollTop = active.offsetTop;
    else if (active.offsetTop + active.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = active.offsetTop + active.offsetHeight - list.clientHeight;
  }, [currentId]);

  useEffect(() => {
    if (disabled) { setOpen(false); setPreview(undefined); }
  }, [disabled]);
  useEffect(() => {
    if (!modalOpen) return;
    const frame = requestAnimationFrame(() => {
      const buttons = dialog.current?.querySelectorAll<HTMLButtonElement>('[data-entry-id]');
      ([...(buttons ?? [])].find((button) => button.dataset.entryId === currentId) ?? buttons?.[0])?.focus();
    });
    return () => { cancelAnimationFrame(frame); requestAnimationFrame(() => {
      const desktopEntry = rail.current?.querySelector<HTMLButtonElement>('[aria-current]');
      const visibleTrigger = trigger.current && getComputedStyle(trigger.current).display !== 'none' ? trigger.current : desktopEntry;
      visibleTrigger?.focus({ preventScroll: true });
    }); };
    // Opening selects the reading position once; scrolling must not move keyboard focus.
  }, [modalOpen]);
  useEffect(() => () => clearTimeout(dismissTimer.current), []);

  function jump(id: string) {
    if (disabled) return;
    setOpen(false); setPreview(undefined);
    requestAnimationFrame(() => {
      const target = [...(canvas.current?.querySelectorAll<HTMLElement>('[data-message-id]') ?? [])].find((element) => element.dataset.messageId === id);
      if (!target) return;
      window.scrollTo({ top: Math.max(0, window.scrollY + target.getBoundingClientRect().top - readingLine()), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    });
  }
  function focusEntry(event: KeyboardEvent<HTMLElement>) {
    if (event.nativeEvent.isComposing) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-entry-id]:not(:disabled)')];
    const index = buttons.indexOf(window.document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : event.key === 'ArrowDown' ? (index + 1) % buttons.length : event.key === 'ArrowUp' ? (index - 1 + buttons.length) % buttons.length : undefined;
    if (next !== undefined) { event.preventDefault(); buttons[next]?.focus(); }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setPreview(undefined); setOpen(false); }
  }
  function showPreview(id: string, button: HTMLButtonElement) {
    if (disabled) return;
    clearTimeout(dismissTimer.current);
    setPreview({ id, top: Math.max(16, Math.min(button.getBoundingClientRect().top, window.innerHeight - 168)) });
  }
  if (!entries.length) return null;
  return <>
    <nav className="message-navigator" aria-label={t("消息目录")} data-ui-only="true" onKeyDown={focusEntry}
      onMouseEnter={() => clearTimeout(dismissTimer.current)} onMouseLeave={() => { dismissTimer.current = setTimeout(() => setPreview(undefined), 100); }}>
      <div className="message-navigator__rail" ref={rail} onScroll={() => setPreview(undefined)}>
        {entries.map((entry) => <button key={entry.id} type="button" data-entry-id={entry.id} disabled={disabled}
          aria-label={t("跳到消息 {0}：{1}", entry.index + 1, entry.name)} aria-current={entry.id === currentId ? 'location' : undefined}
          aria-describedby={entry.id === preview?.id ? tooltipId : undefined} tabIndex={entry.id === currentId ? 0 : -1}
          onMouseEnter={(event) => showPreview(entry.id, event.currentTarget)} onFocus={(event) => showPreview(entry.id, event.currentTarget)}
          onBlur={() => setPreview(undefined)} onClick={() => jump(entry.id)}><span aria-hidden="true" /></button>)}
      </div>
      {activePreview && !disabled ? <div className="message-navigator__preview" id={tooltipId} role="tooltip" style={{ top: preview!.top }}>
        <div><strong>{activePreview.name}</strong><span>{activePreview.role} · {activePreview.index + 1}/{entries.length}</span></div><p>{activePreview.summary}</p>
      </div> : null}
    </nav>
    <button ref={trigger} type="button" className="message-navigator-trigger" data-ui-only="true" aria-label={t("打开消息目录")} aria-haspopup="dialog" aria-expanded={modalOpen} disabled={disabled} onClick={() => setOpen(true)}><Icon name="list" /></button>
    {modalOpen ? createPortal(<div className="message-directory-backdrop" onPointerDown={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) setOpen(false); }}>
      <section className="message-directory" ref={dialog} role="dialog" aria-modal="true" aria-label={t("消息目录")} onKeyDown={(event) => {
        event.stopPropagation();
        focusEntry(event);
        if (event.key !== 'Tab') return;
        const buttons = [...(dialog.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
        if (event.shiftKey && window.document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1)?.focus(); }
        else if (!event.shiftKey && window.document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0]?.focus(); }
      }}><header><h2>{t("消息目录")}<span>{entries.length}</span></h2><button type="button" aria-label={t("关闭消息目录")} onClick={() => setOpen(false)}><Icon name="close" /></button></header>
        <nav aria-label={t("按消息跳转")}>{entries.map((entry) => <button key={entry.id} type="button" data-entry-id={entry.id} aria-current={entry.id === currentId ? 'location' : undefined} onClick={() => jump(entry.id)}>
          <span className="message-directory__number">{entry.index + 1}</span><span className="message-directory__text"><span><strong>{entry.name}</strong><small>{entry.role}</small></span><span className="message-directory__summary">{entry.summary}</span></span>
        </button>)}</nav>
      </section>
    </div>, window.document.body) : null}
  </>;
}
