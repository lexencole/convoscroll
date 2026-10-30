import { useUiText } from "../i18n/LocaleContext";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";
import { focusPopoverItem, observePopoverPosition, placePopover, revealPopoverItem } from "./popover-position";

interface MenuPosition {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly maxHeight: number;
}

const MENU_GAP = 7;
const MENU_WIDTH = 220;
const MENU_MAX_HEIGHT = 280;
const TABBABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function DocumentMenu({ children, trigger, triggerRef: externalTriggerRef, disabled }: {
  readonly trigger?: ReactNode; readonly triggerRef?: RefObject<HTMLButtonElement | null>; readonly disabled?: boolean;
  readonly children: (close: () => void) => ReactNode;
}) {
  const t = useUiText();
  const generatedId = useId();
  const panelId = `document-menu-${generatedId}`;
  const ownTriggerRef = useRef<HTMLButtonElement>(null);
  const triggerRef = externalTriggerRef ?? ownTriggerRef;
  const panelRef = useRef<HTMLDivElement>(null);
  const focusEdgeRef = useRef<"first" | "last">("first");
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition>();

  function updatePosition() {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const panel = panelRef.current;
    let width = MENU_WIDTH;
    if (panel) {
      const previousWidth = panel.style.width;
      panel.style.width = "max-content";
      width = Math.max(width, Math.ceil(parseFloat(getComputedStyle(panel).width) || panel.offsetWidth));
      panel.style.width = previousWidth;
    }
    setPosition(placePopover(rect, {
      width, height: panel?.scrollHeight || MENU_MAX_HEIGHT,
    }, { align: "end", maxHeight: MENU_MAX_HEIGHT, gap: MENU_GAP }));
  }

  function close({ restoreFocus = true } = {}) {
    setOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => {
      // An action may have opened a dialog before this queued frame executes.
      // Do not steal its initial focus or focus a now-inert background control.
      if (triggerRef.current?.closest('[inert]') || document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      triggerRef.current?.focus({ preventScroll: true });
    });
  }

  function menuItems() {
    return [...(panelRef.current?.querySelectorAll<HTMLElement>(
      '[role="menuitem"]:not([disabled])',
    ) ?? [])];
  }

  function focusAdjacentControl(backward: boolean) {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const controls = [...document.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)].filter((element) => (
      !panelRef.current?.contains(element)
      && !element.hidden
      && !element.closest("[hidden]")
      && element.getAttribute("aria-hidden") !== "true"
    ));
    const triggerIndex = controls.indexOf(trigger);
    const nextIndex = triggerIndex + (backward ? -1 : 1);
    const target = controls[nextIndex] ?? trigger;
    window.requestAnimationFrame(() => target.focus());
  }

  function openMenu(edge: "first" | "last" = "first") {
    focusEdgeRef.current = edge;
    setOpen(true);
  }

  function handleTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    openMenu(event.key === "ArrowUp" || event.key === "End" ? "last" : "first");
  }

  function handlePanelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.defaultPrevented) return;
    const items = menuItems();
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      close({ restoreFocus: false });
      focusAdjacentControl(event.shiftKey);
      return;
    }
    if (items.length === 0) return;
    let nextIndex: number | undefined;
    if (event.key === "ArrowDown") nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length;
    if (event.key === "ArrowUp") nextIndex = currentIndex < 0 ? items.length - 1 : (currentIndex - 1 + items.length) % items.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = items.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    items[nextIndex]?.focus({ preventScroll: true });
    revealPopoverItem(panelRef.current, items[nextIndex] ?? null);
  }

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open]);

  const positioned = position !== undefined;
  useLayoutEffect(() => {
    if (!open || !positioned) return;
    const items = menuItems();
    const target = focusEdgeRef.current === "last" ? items.at(-1) : items[0];
    return focusPopoverItem(panelRef.current, target ?? null);
  }, [open, positioned]);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      close({ restoreFocus: false });
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      close();
    };
    const stopPosition = observePopoverPosition(panelRef.current, updatePosition);

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
      stopPosition();
    };
  }, [open]);

  const panel = typeof document === "undefined" ? null : createPortal(
    <div
      ref={panelRef}
      id={panelId}
      className="document-menu__panel"
      role="menu"
      aria-label={t("文档操作")}
      hidden={!open}
      style={position ? {
        left: position.left,
        top: position.top,
        width: position.width,
        maxHeight: position.maxHeight,
      } : undefined}
      onKeyDown={handlePanelKeyDown}
    >
      {children(() => close())}
    </div>,
    document.body,
  );

  return (
    <div className="document-menu">
      <button
        ref={triggerRef}
        type="button"
        className={`document-menu__trigger${trigger ? " document-menu__trigger--brand" : ""}`}
        disabled={disabled}
        aria-label={t("文档")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => open ? close({ restoreFocus: false }) : openMenu()}
        onKeyDown={handleTriggerKeyDown}
      >
        {trigger ?? <><Icon name="document" /><span>{t("文档")}</span></>}
      </button>
      {panel}
    </div>
  );
}
