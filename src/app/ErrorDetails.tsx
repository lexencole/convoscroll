import type { LocalizedText } from "../i18n/messages";
import { useUiText } from "../i18n/LocaleContext";
export function ErrorDetails({ text }: { readonly text: LocalizedText }) {
  const t = useUiText();
  return <details className="error-details">
    <summary>{t("错误详情")}</summary>
    <pre>{t(text)}</pre>
  </details>;
}
