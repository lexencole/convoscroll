import { useUiText } from "../i18n/LocaleContext";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { observePopoverPosition, placePopover, revealPopoverItem, visibleViewport } from "./popover-position";

export interface SelectOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly disabled?: boolean;
  readonly icon?: ReactNode;
}

interface SelectFieldProps<T extends string> {
  readonly restoreFocusOnSelect?: boolean;
  readonly id?: string;
  readonly value: T;
  readonly options: readonly SelectOption<T>[];
  readonly onChange: (value: T) => void;
  readonly ariaLabel?: string;
  readonly ariaLabelledBy?: string;
  readonly disabled?: boolean;
  readonly compact?: boolean;
  readonly typography?: "form" | "toolbar";
  readonly className?: string;
}

interface MenuPosition {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly maxHeight: number;
}

const MENU_GAP = 6;
const MENU_MARGIN = 8;
const MENU_MAX_HEIGHT = 280;
const OPTION_ESTIMATED_HEIGHT = 38;
const MOBILE_OPTION_ESTIMATED_HEIGHT = 44;
const MENU_VERTICAL_CHROME = 12;
const MENU_MAX_WIDTH = 320;

function nextEnabledIndex<T extends string>(
  options: readonly SelectOption<T>[],
  current: number,
  direction: 1 | -1,
): number {
  if (options.length === 0) return -1;
  for (let offset = 1; offset <= options.length; offset += 1) {
    const index = (current + direction * offset + options.length) % options.length;
    if (!options[index]?.disabled) return index;
  }
  return current;
}

function edgeEnabledIndex<T extends string>(
  options: readonly SelectOption<T>[],
  edge: "first" | "last",
): number {
  const start = edge === "first" ? 0 : options.length - 1;
  const direction = edge === "first" ? 1 : -1;
  for (let index = start; index >= 0 && index < options.length; index += direction) {
    if (!options[index]?.disabled) return index;
  }
  return -1;
}

export function SelectField<T extends string>({
  id,
  value,
  options,
  onChange,
  ariaLabel,
  ariaLabelledBy,
  disabled = false,
  compact = false,
  typography = "form",
  className,
  restoreFocusOnSelect = true,
}: SelectFieldProps<T>) {
  const t = useUiText();
  const generatedId = useId();
  const controlId = id ?? `select-${generatedId}`;
  const listboxId = `${controlId}-listbox`;
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const [position, setPosition] = useState<MenuPosition>();
  const positioned = position !== undefined;
  const revealActiveOption = useRef(false);
  const [associatedLabelId, setAssociatedLabelId] = useState<string>();
  const selectedOption = options[selectedIndex];
  const labelledBy = ariaLabel ? undefined : ariaLabelledBy ?? associatedLabelId;
  const fallbackAriaLabel = ariaLabel ?? (labelledBy ? undefined : t("选择选项"));

  useLayoutEffect(() => {
    if (ariaLabel || ariaLabelledBy) {
      setAssociatedLabelId(undefined);
      return;
    }

    const label = buttonRef.current?.labels?.item(0);
    if (!label) {
      setAssociatedLabelId(undefined);
      return;
    }

    const previousId = label.id;
    const labelId = previousId || `${controlId}-label`;
    if (!previousId) label.id = labelId;
    setAssociatedLabelId(labelId);
    return () => {
      if (!previousId && label.id === labelId) label.removeAttribute("id");
    };
  }, [ariaLabel, ariaLabelledBy, controlId]);

  function updatePosition() {
    const button = buttonRef.current;
    const menu = menuRef.current;
    if (!button || !menu) return;
    const rect = button.getBoundingClientRect();
    // Measure the rendered text, icons and checkmark without the previous width
    // constraint or entrance scale. Round up so fractional glyph widths still fit.
    const previousWidth = menu.style.width;
    menu.style.width = "max-content";
    const contentWidth = Math.ceil(Number.parseFloat(window.getComputedStyle(menu).width) || menu.offsetWidth);
    menu.style.width = previousWidth;
    const width = Math.min(
      Math.max(rect.width, contentWidth),
      MENU_MAX_WIDTH,
      visibleViewport().width - MENU_MARGIN * 2,
    );
    const mobileRows = typeof window.matchMedia === "function"
      && window.matchMedia("(any-pointer: coarse)").matches;
    const fallbackHeight = options.length * (
      mobileRows ? MOBILE_OPTION_ESTIMATED_HEIGHT : OPTION_ESTIMATED_HEIGHT
    ) + MENU_VERTICAL_CHROME;
    const measuredHeight = menuRef.current?.scrollHeight ?? 0;
    const expectedHeight = Math.min(
      MENU_MAX_HEIGHT,
      measuredHeight > 0 ? measuredHeight : fallbackHeight,
    );
    const next = placePopover(rect, { width, height: expectedHeight }, { maxHeight: MENU_MAX_HEIGHT, gap: MENU_GAP });
    setPosition((previous) => previous && previous.left === next.left && previous.top === next.top
      && previous.width === next.width && previous.maxHeight === next.maxHeight ? previous : next);
  }

  function openMenu(index = selectedIndex) {
    if (disabled || options.length === 0) return;
    // Safari does not focus a button on pointer click; this combobox owns keyboard navigation.
    buttonRef.current?.focus({ preventScroll: true });
    revealActiveOption.current = true;
    setActiveIndex(options[index]?.disabled ? nextEnabledIndex(options, index, 1) : index);
    setOpen(true);
  }

  function closeMenu({ restoreFocus = true } = {}) {
    setOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => buttonRef.current?.focus({ preventScroll: true }));
  }

  function choose(index: number) {
    const option = options[index];
    if (disabled || !option || option.disabled) return;
    onChange(option.value);
    closeMenu({ restoreFocus: restoreFocusOnSelect });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      revealActiveOption.current = true;
      const direction = event.key === "ArrowDown" ? 1 : -1;
      if (!open) {
        openMenu(selectedIndex);
      } else {
        setActiveIndex((current) => nextEnabledIndex(options, current, direction));
      }
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      revealActiveOption.current = true;
      const index = edgeEnabledIndex(options, event.key === "Home" ? "first" : "last");
      if (!open) openMenu(index);
      else setActiveIndex(index);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(activeIndex);
      else openMenu();
      return;
    }
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      return;
    }
    if (event.key === "Tab" && open) {
      closeMenu({ restoreFocus: false });
    }
  }

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, options.length]);

  useLayoutEffect(() => {
    if (!open || !positioned || activeIndex < 0 || !revealActiveOption.current) return;
    const option = document.getElementById(`${listboxId}-option-${activeIndex}`);
    revealPopoverItem(menuRef.current, option);
  }, [activeIndex, listboxId, open, positioned]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      closeMenu({ restoreFocus: false });
    };
    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target as Node | null;
      if (!target || buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      closeMenu({ restoreFocus: false });
    };
    const stopPosition = observePopoverPosition(menuRef.current, updatePosition);

    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("focusin", handleFocusIn, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("focusin", handleFocusIn, true);
      stopPosition();
    };
  }, [open, options.length]);

  useEffect(() => {
    if (disabled && open) closeMenu({ restoreFocus: false });
  }, [disabled, open]);

  useEffect(() => {
    if (!open) setActiveIndex(selectedIndex);
  }, [open, selectedIndex]);

  return (
    <div className={["select-field", compact ? "select-field--compact" : "", typography === "toolbar" ? "select-field--toolbar" : "", className].filter(Boolean).join(" ")}>
      <button
        ref={buttonRef}
        id={controlId}
        type="button"
        className="select-field__trigger"
        role="combobox"
        aria-label={fallbackAriaLabel}
        aria-labelledby={labelledBy}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined}
        disabled={disabled}
        onClick={() => open ? closeMenu({ restoreFocus: false }) : openMenu()}
        onKeyDown={handleKeyDown}
      >
        <span className="select-field__value">{selectedOption?.icon ? <span className="select-field__icon" aria-hidden="true">{selectedOption.icon}</span> : null}<span>{selectedOption?.label ?? value}</span></span>
        <svg className="select-field__chevron" viewBox="0 0 16 16" aria-hidden="true">
          <path d="m3.5 6 4.5 4 4.5-4" />
        </svg>
      </button>
      {open ? createPortal(
        <div
          ref={menuRef}
          id={listboxId}
          className={["select-field__menu", typography === "toolbar" ? "select-field__menu--toolbar" : ""].filter(Boolean).join(" ")}
          role="listbox"
          aria-label={fallbackAriaLabel}
          aria-labelledby={labelledBy}
          style={position ? {
            left: position.left,
            top: position.top,
            width: position.width,
            maxHeight: position.maxHeight,
          } : {
            left: 0,
            top: 0,
            width: "max-content",
            maxHeight: MENU_MAX_HEIGHT,
            visibility: "hidden",
          }}
        >
          {options.map((option, index) => (
            <div
              id={`${listboxId}-option-${index}`}
              key={option.value}
              className={[
                "select-field__option",
                index === activeIndex ? "is-active" : "",
                option.value === value ? "is-selected" : "",
                option.disabled ? "is-disabled" : "",
              ].filter(Boolean).join(" ")}
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled || undefined}
              onPointerDown={(event) => event.preventDefault()}
              onPointerMove={() => { revealActiveOption.current = false; if (!option.disabled) setActiveIndex(index); }}
              onClick={() => choose(index)}
            >
              <span className="select-field__value">{option.icon ? <span className="select-field__icon" aria-hidden="true">{option.icon}</span> : null}<span>{option.label}</span></span>
              <svg className="select-field__check" viewBox="0 0 16 16" aria-hidden="true">
                <path d="m3.25 8.25 3 3 6.5-6.5" />
              </svg>
            </div>
          ))}
        </div>,
        document.body,
      ) : null}
    </div>
  );
}
