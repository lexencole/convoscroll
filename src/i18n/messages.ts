import english from "./en.json";
import type { Locale } from "./locale";

const catalog: Readonly<Record<string, string>> = english;
export interface MessageText {
  readonly key: string;
  readonly values: readonly TextValue[];
}
export type TextValue = string | number | MessageText;
export type LocalizedText = string | MessageText;
export type Translator = (message: LocalizedText, ...values: TextValue[]) => string;

export const message = (key: string, ...values: TextValue[]): MessageText => ({ key, values });

function format(locale: Locale, source: LocalizedText, values: readonly TextValue[]): string {
  const key = typeof source === "string" ? source : source.key;
  const parameters = typeof source === "string" ? values : source.values;
  const template = locale === "en" && Object.hasOwn(catalog, key) ? catalog[key] : key;
  return template.replace(/\{(\d+)\}/g, (match, index: string) => {
    const value = parameters[Number(index)];
    return value === undefined ? match : typeof value === "object" ? format(locale, value, []) : String(value);
  });
}

const translators: Record<Locale, Translator> = {
  "zh-CN": (text, ...values) => format("zh-CN", text, values),
  en: (text, ...values) => format("en", text, values),
};

/** Only product-authored messages belong here; document content never passes through this function. */
export function translator(locale: Locale): Translator {
  return translators[locale];
}

/** Error.message remains a plain Chinese diagnostic for existing CLI consumers. */
export class LocalizedError extends Error {
  constructor(readonly messageText: LocalizedText, options?: ErrorOptions) {
    super(translator("zh-CN")(messageText), options);
  }
}

export function errorMessage(cause: unknown, fallback: LocalizedText): LocalizedText {
  return cause instanceof LocalizedError ? cause.messageText : cause instanceof Error ? cause.message : fallback;
}

export function diagnosticMessage(text: LocalizedText): { message: string; messageText?: MessageText } {
  return { message: translator("zh-CN")(text), ...(typeof text === "string" ? {} : { messageText: text }) };
}
