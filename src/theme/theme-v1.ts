import type { CanvasSettings } from "../data/conversation-types";
import {
  buildThemeTokens,
  type ThemeDraft,
  type ThemeStyle,
  type ThemeTokens,
} from "./theme-presets";

export const THEME_V1_ID = "warm-editorial-v1";
export const THEME_V1_NAME = "Warm Editorial";

export const themeV1Canvas = Object.freeze({
  preset: "portrait",
  width: 480,
  scale: 3,
} satisfies CanvasSettings);

export const themeV1Draft = Object.freeze({
  presetId: "warm-editorial",
  isCustom: false,
  adjustments: Object.freeze({
    density: "compact",
    bodyScale: "standard",
    lineHeight: "balanced",
    headingStyle: "sans",
    cornerStyle: "soft",
    accent: "forest",
    surface: "defined",
  }),
} satisfies ThemeDraft);

export const sansFontStack = '"Geist Variable", "PingFang SC", "Noto Sans SC Variable", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
export const monoFontStack = '"Geist Mono Variable", "PingFang SC", "Noto Sans SC Variable", ui-monospace, monospace';
export const themeV1Tokens: ThemeTokens = Object.freeze({
  ...buildThemeTokens(themeV1Draft),
  "--font-family-body": sansFontStack,
  "--font-family-display": sansFontStack,
  "--font-family-meta": sansFontStack,
  "--font-family-mono": monoFontStack,
});
export const themeV1Style = themeV1Tokens as ThemeStyle;

export function resolveThemeStyle(themeId: string): ThemeStyle | undefined {
  return themeId === THEME_V1_ID ? themeV1Style : undefined;
}
