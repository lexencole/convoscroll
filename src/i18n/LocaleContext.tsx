import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { browserLocale, type Locale } from "./locale";
import { translator } from "./messages";

export const UI_LOCALE_KEY = "convoscroll:ui-locale";
const UiLocaleContext = createContext<{ locale: Locale; setLocale: (locale: Locale) => void }>({ locale: "zh-CN", setLocale: () => undefined });
const CanvasLocaleContext = createContext<Locale>("zh-CN");

export function initialUiLocale(): Locale {
  try {
    const saved = localStorage.getItem(UI_LOCALE_KEY);
    if (saved === "zh-CN" || saved === "en") return saved;
  } catch { /* A blocked preference store must not prevent editing. */ }
  return browserLocale(typeof navigator === "undefined" ? ["zh-CN"] : navigator.languages);
}

export function UiLocaleProvider({ children, initialLocale }: { children: ReactNode; initialLocale?: Locale }) {
  const [locale, updateLocale] = useState(initialLocale ?? initialUiLocale);
  const value = useMemo(() => ({ locale, setLocale(next: Locale) {
    updateLocale(next);
    try { localStorage.setItem(UI_LOCALE_KEY, next); } catch { /* Keep the choice for this visit. */ }
  } }), [locale]);
  useEffect(() => {
    document.documentElement.lang = locale;
    const t = translator(locale);
    document.title = t("话卷 ConvoScroll");
    document.querySelector('meta[name="description"]')?.setAttribute("content", t("话卷 ConvoScroll：把 AI 对话排成适合在手机上看的长图，在浏览器里导出 PNG，不上传。"));
  }, [locale]);
  return <UiLocaleContext.Provider value={value}>{children}</UiLocaleContext.Provider>;
}

export const CanvasLocaleProvider = CanvasLocaleContext.Provider;
export const useUiLocale = () => useContext(UiLocaleContext);
export const useCanvasLocale = () => useContext(CanvasLocaleContext);
export const useUiText = () => translator(useUiLocale().locale);
export const useCanvasText = () => translator(useCanvasLocale());
