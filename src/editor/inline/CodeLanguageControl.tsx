import { useUiText } from "../../i18n/LocaleContext";
import { useRef, useState } from "react";
import { SelectField } from "../../app/SelectField";

import { codeLanguageOptions as languages } from "../../renderer/code-languages";

export function CodeLanguageControl({ value, disabled, onChange }: {
  value: string;
  disabled: boolean;
  onChange: (language: string) => void;
}) {
  const t = useUiText();
  const [draft, setDraft] = useState<string>();
  const [invalid, setInvalid] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const selected = value || "text";
  const options = languages.some((option) => option.value === selected)
    ? languages : [...languages, { value: selected, label: selected }];

  function cancel() {
    setDraft(undefined);
    setInvalid(false);
    requestAnimationFrame(() => host.current?.querySelector<HTMLButtonElement>("[role=combobox]")?.focus());
  }
  function apply() {
    if (disabled || draft === undefined) return;
    const language = draft.trim();
    if (!/^[a-zA-Z0-9_+.-]*$/.test(language)) { setInvalid(true); return; }
    setDraft(undefined);
    setInvalid(false);
    onChange(language);
  }

  return <div className="inline-code-language" ref={host}>
    {draft === undefined ? <SelectField ariaLabel={t("代码语言")} compact typography="toolbar" disabled={disabled}
      restoreFocusOnSelect={false} value={selected}
      options={[...options.map((option) => ({ ...option, label: option.value === "text" ? t(option.label) : option.label })), { value: "@custom", label: t("其他语言…") }]}
      onChange={(language) => {
        if (language === "@custom") { setInvalid(false); setDraft(value); }
        else onChange(language);
      }} /> : <>
      <input autoFocus aria-label={t("其他语言")} placeholder={t("例如 bash")} value={draft}
        disabled={disabled} aria-invalid={invalid || undefined}
        onChange={(event) => { setInvalid(false); setDraft(event.target.value); }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") { event.preventDefault(); apply(); }
          if (event.key === "Escape") { event.preventDefault(); cancel(); }
        }} />
      <button type="button" disabled={disabled} onClick={apply}>{t("确定")}</button>
      <button type="button" onClick={cancel}>{t("取消")}</button>
      {invalid ? <span className="inline-notice" role="alert">{t("只能用字母、数字和 . + _ -")}</span> : null}
    </>}
  </div>;
}
