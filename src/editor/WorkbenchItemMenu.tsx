import { useUiText } from "../i18n/LocaleContext";
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { focusPopoverItem, measurePopover, observePopoverPosition, placePopover, revealPopoverItem } from "../app/popover-position";
import { Icon, type IconName } from "../app/Icon";

export interface WorkbenchMenuAction {
  readonly label: string;
  readonly icon: IconName;
  readonly group: string;
  readonly disabled?: boolean;
  readonly opensSettings?: boolean;
  readonly shortcut?: string;
  readonly run: (trigger: HTMLButtonElement) => void;
}

/** A viewport-positioned menu: canvas scaling must not shrink its hit targets. */
export function WorkbenchItemMenu({ label, title, disabled, actions, icon = "more", text, className, align = "end", messageId }: {
  label: string; title: string; disabled: boolean; actions: readonly WorkbenchMenuAction[];
  icon?: IconName; text?: string; className?: string; align?: "start" | "end";
  messageId?: string;
}) {
  const t = useUiText();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>();
  const positioned = position !== undefined;
  const initialEdge = useRef<"first" | "last">("first");
  const neighbours = useRef<HTMLElement[]>([]);
  function items() { return [...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])]; }
  function close(restore = true) {
    setOpen(false);
    if (restore) window.requestAnimationFrame(() => {
      if (trigger.current?.isConnected) { trigger.current.focus({ preventScroll: true }); return; }
      // The item was removed: continue from the nearest remaining message, else the document context.
      const nearest = neighbours.current.find((item) => item.isConnected);
      if (nearest) nearest.focus();
      else document.querySelector<HTMLElement>(".workbench .workbench-context, .workbench-add-message button")?.focus({ preventScroll: true });
    });
  }
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const rect = trigger.current?.getBoundingClientRect();
      const panel = menu.current;
      if (!rect || !panel) return;
      setPosition(placePopover(rect, measurePopover(panel), { align }));
    }
    place();
    return observePopoverPosition(menu.current, place);
  }, [open, align]);
  useLayoutEffect(() => {
    // The first render is hidden until measured; browsers cannot focus it yet.
    if (!open || !positioned) return;
    const enabled = items();
    const target = initialEdge.current === "last" ? enabled.at(-1) : enabled[0];
    return focusPopoverItem(menu.current, target ?? null);
  }, [open, positioned]);
  useEffect(() => {
    if (!open) return;
    function outside(event: Event) {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) close(false);
    }
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside, true);
    return () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("focusin", outside, true); };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  return <>
    <button ref={trigger} type="button" className={["workbench-menu-trigger", className].filter(Boolean).join(" ")} aria-label={text ? undefined : label} title={text ? undefined : label}
      aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled}
      onClick={() => { initialEdge.current = "first"; if (!open) setPosition(undefined); setOpen(!open); }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); initialEdge.current = event.key === "ArrowUp" ? "last" : "first"; if (!open) setPosition(undefined); setOpen(true); }
      }}><Icon name={icon} />{text ? <span>{t(text)}</span> : null}</button>
    {open ? createPortal(<div ref={menu} id={id} className="workbench-action-menu" role="menu" aria-label={t(label)} data-owner-message={messageId}
      style={position ? { ...position, visibility: "visible" } : { visibility: "hidden" }} onKeyDown={(event) => {
        const enabled = items();
        const index = enabled.indexOf(document.activeElement as HTMLButtonElement);
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + enabled.length) % enabled.length;
          enabled[next]?.focus({ preventScroll: true });
          revealPopoverItem(menu.current, enabled[next] ?? null);
        } else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
        else if (event.key === "Tab") {
          // Resume normal page tab order from the persistent trigger, not the portal.
          trigger.current?.focus({ preventScroll: true }); close(false);
        }
      }}>
      <div className="workbench-action-menu__title">{t(title)}</div>
      {actions.map((action, index) => <div key={action.label} className={index && action.group !== actions[index - 1].group ? "workbench-action-menu__group" : undefined}>
        <button type="button" role="menuitem" tabIndex={-1} disabled={action.disabled} className={action.group === "danger" ? "is-danger" : undefined}
          aria-keyshortcuts={action.shortcut ? "Meta+Shift+Backspace Control+Shift+Backspace" : undefined}
          onClick={() => {
            const anchor = trigger.current; if (!anchor || action.disabled) return;
            const message = anchor.closest("[data-message-id]");
            neighbours.current = [message, message?.nextElementSibling, message?.previousElementSibling]
              .map((item) => item?.querySelector<HTMLElement>('.message__header[role="button"]'))
              .filter((item): item is HTMLElement => Boolean(item));
            close(!action.opensSettings); action.run(anchor);
          }}>
          <Icon name={action.icon} /><span>{t(action.label)}</span>{action.shortcut ? <kbd className="workbench-action-menu__shortcut" aria-hidden="true">{action.shortcut}</kbd> : null}
        </button>
      </div>)}
    </div>, document.body) : null}
  </>;
}
