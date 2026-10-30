import { useUiText } from "../i18n/LocaleContext";
import { useRef, type ReactNode } from "react";
import { MessageDatePicker } from "./MessageDatePicker";
import { messageTimestampFields, type MessageTimestampDraft } from "./message-timestamp";

export function MessageTimestampFields({ value, draft, disabled, invalid, revision, validation, onChange, onClear }: {
  value?: string; draft?: MessageTimestampDraft; disabled: boolean; invalid: boolean; revision: number;
  validation?: ReactNode; onChange: (draft: MessageTimestampDraft, composing?: boolean) => void; onClear: () => void;
}) {
  const t = useUiText();
  const composing = useRef(false);
  const fields = draft ?? messageTimestampFields(value);
  return <div className="identity-timestamp" role="group" aria-label={t("消息时间")}>
    <div className="identity-timestamp__heading"><span>{t("消息时间")}<small>{t("（可选）")}</small></span>
      <button type="button" disabled={disabled || (!value && !draft)} onClick={onClear}>{t("清除时间")}</button>
    </div>
    <div className="editor-field"><span>{t("日期")}</span><MessageDatePicker key={`date-${revision}`} value={fields.date} disabled={disabled} invalid={invalid && !fields.date}
      onChange={date => onChange({ ...fields, date })} /></div>
    <label className="editor-field">{t("时间")}<input key={`time-${revision}`} type="text" aria-label={t("消息时刻")} placeholder="HH:mm"
      value={fields.time} disabled={disabled} autoComplete="off" spellCheck={false}
      aria-invalid={invalid && Boolean(fields.date) || undefined}
      onChange={event => onChange({ ...fields, time: event.target.value }, composing.current)}
      onCompositionStart={event => { composing.current = true; onChange({ ...fields, time: event.currentTarget.value }, true); }}
      onCompositionEnd={event => { composing.current = false; onChange({ ...fields, time: event.currentTarget.value }); }} /></label>
    {validation}
  </div>;
}
