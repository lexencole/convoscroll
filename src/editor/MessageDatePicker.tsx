import { useUiText } from "../i18n/LocaleContext";
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { focusPopoverItem, measurePopover, observePopoverPosition, placePopover, visibleViewport } from "../app/popover-position";
import { Icon, IconButton } from "../app/Icon";

const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
const pad = (value: number) => String(value).padStart(2, "0");
function todayDate() {
  const now = new Date();
  return `${String(now.getFullYear()).padStart(4, "0")}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
function parseDate(value: string): Date | undefined {
  const date = new Date(`${value}T12:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !value.startsWith("0000") && Number.isFinite(date.getTime())
    && date.toISOString().slice(0, 10) === value ? date : undefined;
}
function dateLabel(value: string, t: import("../i18n/messages").Translator) {
  const [year, month, day] = value.split("-");
  return t("{0}年{1}月{2}日", Number(year), Number(month), Number(day));
}
function moveDate(value: string, days = 0, months = 0): string {
  const date = parseDate(value)!;
  if (months) {
    const day = date.getUTCDate();
    date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + months);
    const end = new Date(date); end.setUTCMonth(end.getUTCMonth() + 1); end.setUTCDate(0);
    date.setUTCDate(Math.min(day, end.getUTCDate()));
  }
  date.setUTCDate(date.getUTCDate() + days);
  return date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999 ? value : date.toISOString().slice(0, 10);
}

/** Calendar arithmetic is date-only; timezone interpretation belongs to the timestamp field. */
export function MessageDatePicker({ value, disabled, invalid, onChange }: {
  value: string; disabled: boolean; invalid: boolean; onChange: (date: string) => void;
}) {
  const t = useUiText();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [focusedDate, setFocusedDate] = useState(() => parseDate(value) ? value : todayDate());
  const [position, setPosition] = useState<CSSProperties>();
  const positioned = Boolean(position);
  const month = focusedDate.slice(0, 7);
  const monthStart = parseDate(`${month}-01`)!;
  const leadingDays = (monthStart.getUTCDay() + 6) % 7;
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(monthStart); date.setUTCDate(index - leadingDays + 1);
    return date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999 ? "" : date.toISOString().slice(0, 10);
  });
  function close(restore = true) {
    setOpen(false);
    if (restore) window.requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  }
  function choose(date: string) { onChange(date); close(); }
  function show() {
    setFocusedDate(parseDate(value) ? value : todayDate());
    setPosition(undefined); setOpen(true);
  }
  useLayoutEffect(() => {
    if (!open) return;
    function place(event?: Event) {
      if (event?.type === "scroll" && event.target instanceof Node && panel.current?.contains(event.target)) return;
      const anchor = trigger.current?.getBoundingClientRect();
      const popup = panel.current;
      if (!anchor || !popup) return;
      const size = measurePopover(popup);
      setPosition(placePopover(anchor, size, { maxHeight: Infinity, horizontalMargin: Math.min(8, Math.max(0, (visibleViewport().width - size.width) / 2)) }));
    }
    place();
    return observePopoverPosition(panel.current, place);
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !positioned) return;
    const day = panel.current?.querySelector<HTMLButtonElement>(`[data-date="${focusedDate}"]`);
    return focusPopoverItem(panel.current, day ?? null);
  }, [open, positioned, focusedDate]);
  useEffect(() => {
    if (!open) return;
    function outside(event: Event) {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !panel.current?.contains(target)) close(false);
    }
    document.addEventListener("pointerdown", outside, true); document.addEventListener("focusin", outside, true);
    return () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("focusin", outside, true); };
  }, [open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === "Tab") { trigger.current?.focus({ preventScroll: true }); close(false); return; }
    if (!(event.target as HTMLElement).dataset.date) return;
    const weekday = (parseDate(focusedDate)!.getUTCDay() + 6) % 7;
    const delta: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -weekday, End: 6 - weekday };
    if (event.key in delta) { event.preventDefault(); setFocusedDate(moveDate(focusedDate, delta[event.key])); }
    else if (event.key === "PageUp" || event.key === "PageDown") {
      event.preventDefault(); setFocusedDate(moveDate(focusedDate, 0, (event.key === "PageUp" ? -1 : 1) * (event.shiftKey ? 12 : 1)));
    }
  }
  return <>
    <button ref={trigger} type="button" className="select-field__trigger message-date-trigger" aria-label={t("消息日期")}
      aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined} aria-invalid={invalid || undefined}
      disabled={disabled} onClick={() => open ? close() : show()}
      onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); show(); } }}>
      <span className={!value ? "is-placeholder" : undefined}>{value ? value.replaceAll("-", "/") : t("选择日期")}</span><Icon name="chevron-down" />
    </button>
    {open ? createPortal(<div ref={panel} id={id} role="dialog" aria-label={t("选择日期")} className="message-date-popover"
      style={position ? { ...position, visibility: "visible" } : { visibility: "hidden" }} onKeyDown={keyboard}>
      <header><IconButton icon="chevron-right" className="message-date-previous" label={t("上个月")} disabled={month === "0001-01"} onClick={() => setFocusedDate(moveDate(focusedDate, 0, -1))} />
        <strong aria-live="polite">{t("{0} 年 {1} 月", Number(month.slice(0, 4)), Number(month.slice(5)))}</strong>
        <IconButton icon="chevron-right" label={t("下个月")} disabled={month === "9999-12"} onClick={() => setFocusedDate(moveDate(focusedDate, 0, 1))} /></header>
      <div role="grid" aria-label={t("{0}年{1}月", Number(month.slice(0, 4)), Number(month.slice(5)))}>
        <div role="row" className="message-date-weekdays">{weekdays.map(day => <span role="columnheader" key={day}>{t(day)}</span>)}</div>
        {Array.from({ length: 6 }, (_, row) => <div key={row} role="row" className="message-date-week">{days.slice(row * 7, row * 7 + 7).map((day, column) => <div role="gridcell" key={column} aria-selected={Boolean(day && day === value)}>
          {day ? <button type="button" data-date={day} aria-label={dateLabel(day, t)} aria-current={day === todayDate() ? "date" : undefined}
            className={day.slice(0, 7) !== month ? "is-outside" : undefined} tabIndex={day === focusedDate ? 0 : -1} onClick={() => choose(day)}>{Number(day.slice(8))}</button> : null}
        </div>)}</div>)}
      </div>
      <footer><button type="button" onClick={() => choose(todayDate())}>{t("今天")}</button></footer>
    </div>, document.body) : null}
  </>;
}
