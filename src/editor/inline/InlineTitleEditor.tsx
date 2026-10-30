import { useUiText } from "../../i18n/LocaleContext";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";

/** Plain document metadata, sharing the same history and IME boundary as body editing. */
export function InlineTitleEditor({ value, disabled, onActivate, onChange, onBusy, onUndo, onRedo }: {
  value: string; disabled: boolean; onActivate: () => void;
  onChange: (value: string, group: string) => void; onBusy: (busy: boolean) => void;
  onUndo: () => void; onRedo: () => void;
}) {
  const t = useUiText();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLTextAreaElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const composing = useRef(false);
  const blurred = useRef(false);
  const session = useId();
  const revision = useRef(0);
  const handlers = useRef({ onChange, onBusy }); handlers.current = { onChange, onBusy };
  useEffect(() => { if (!composing.current) setDraft(value); }, [value]);
  useEffect(() => () => handlers.current.onBusy(false), []);
  useLayoutEffect(() => {
    if (!editing || !input.current) return;
    input.current.style.height = "0";
    input.current.style.height = `${input.current.scrollHeight}px`;
  }, [draft, editing]);
  useEffect(() => { if (editing) { input.current?.focus({ preventScroll: true }); input.current?.select(); } }, [editing]);
  function publish(text: string) { if (!composing.current) handlers.current.onChange(text, `title-${session}-${revision.current}`); }
  function finish(focus = false) {
    setEditing(false); revision.current++;
    if (focus) requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  }
  return editing ? <textarea ref={input} className="workbench-title-input" aria-label={t("标题")} rows={1} value={draft} disabled={disabled}
    onChange={(event) => { const text = event.target.value.replace(/[\r\n]+/g, " "); setDraft(text); publish(text); }}
    onCompositionStart={() => { composing.current = true; onBusy(true); }}
    onCompositionEnd={(event) => {
      composing.current = false; const text = event.currentTarget.value.replace(/[\r\n]+/g, " "); setDraft(text); publish(text); onBusy(false);
      if (blurred.current) finish();
    }}
    onBlur={() => { blurred.current = true; if (!composing.current) finish(); }}
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || composing.current) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault(); event.stopPropagation(); revision.current++;
        if (event.shiftKey) onRedo(); else onUndo();
      } else if (event.key === "Enter" || event.key === "Escape") { event.preventDefault(); finish(true); }
    }} /> : <button type="button" ref={trigger} className="workbench-title" aria-label={t("编辑标题")} data-empty={!value || undefined} disabled={disabled}
      onClick={() => { onActivate(); blurred.current = false; revision.current++; setEditing(true); }}>{value || <span className="workbench-title-placeholder" data-ui-only>{t("点击输入标题")}</span>}</button>;
}
