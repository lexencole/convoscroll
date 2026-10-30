export type Locale = "zh-CN" | "en";

/** Unknown document languages keep the original Chinese presentation. */
export function canvasLocale(value?: string): Locale {
  return /^en(?:-|$)/i.test(value ?? "") ? "en" : "zh-CN";
}

export function browserLocale(languages: readonly string[]): Locale {
  return languages[0]?.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}
