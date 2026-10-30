import { errorMessage, type LocalizedText } from "../i18n/messages";
import { useUiText } from "../i18n/LocaleContext";
import { useEffect, useRef, useState } from "react";
import type { JsonValue } from "../data/conversation-types";

interface JsonValueEditorProps {
  readonly id: string;
  readonly label: string;
  readonly value: JsonValue;
  readonly onValidChange: (value: JsonValue) => void;
}

function pretty(value: JsonValue): string {
  return JSON.stringify(value, null, 2);
}

export function JsonValueEditor({ id, label, value, onValidChange }: JsonValueEditorProps) {
  const t = useUiText();
  const incoming = pretty(value);
  const [draft, setDraft] = useState(incoming);
  const [error, setError] = useState<LocalizedText>();
  const lastSubmitted = useRef(incoming);

  useEffect(() => {
    if (incoming === lastSubmitted.current) return;
    lastSubmitted.current = incoming;
    setDraft(incoming);
    setError(undefined);
  }, [incoming]);

  function handleChange(next: string) {
    setDraft(next);
    try {
      const parsed = JSON.parse(next) as JsonValue;
      lastSubmitted.current = pretty(parsed);
      setError(undefined);
      onValidChange(parsed);
    } catch (cause) {
      setError(errorMessage(cause, "JSON 格式不对"));
    }
  }

  return (
    <div className="editor-field editor-field--full">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        className={error ? "json-source is-invalid" : "json-source"}
        value={draft}
        rows={6}
        spellCheck={false}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => handleChange(event.target.value)}
      />
      {error ? <small className="editor-field__error" id={`${id}-error`}>{t("暂未写入预览：{0}", t(error))}</small> : null}
    </div>
  );
}
