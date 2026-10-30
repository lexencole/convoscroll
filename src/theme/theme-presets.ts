import type { CSSProperties } from "react";

export const themeTokenNames = [
  "--font-family-body",
  "--font-family-display",
  "--font-family-mono",
  "--font-family-meta",
  "--font-weight-body",
  "--font-weight-display",
  "--canvas-header-background",
  "--canvas-title-letter-spacing",
  "--content-heading-letter-spacing",
  "--color-canvas",
  "--color-canvas-raised",
  "--color-ink",
  "--color-ink-soft",
  "--color-ink-faint",
  "--color-border",
  "--color-border-strong",
  "--color-accent",
  "--color-accent-soft",
  "--color-user",
  "--color-user-border",
  "--color-assistant",
  "--color-assistant-border",
  "--color-assistant-line",
  "--color-system",
  "--color-code",
  "--color-code-ink",
  "--color-code-comment",
  "--color-code-keyword",
  "--color-code-string",
  "--color-code-constant",
  "--color-code-function",
  "--color-code-variable",
  "--color-code-punctuation",
  "--color-success",
  "--color-success-soft",
  "--color-running",
  "--color-running-soft",
  "--color-pending",
  "--color-pending-soft",
  "--color-error",
  "--color-error-soft",
  "--color-neutral-soft",
  "--shadow-canvas",
  "--radius-xs",
  "--radius-sm",
  "--radius-md",
  "--radius-lg",
  "--font-md",
  "--font-xl",
  "--font-code",
  "--font-table",
  "--line-table",
  "--font-content-h1",
  "--font-content-h2",
  "--font-content-h3",
  "--line-body",
  "--message-user-max-width",
  "--message-user-max-width-en",
  "--canvas-header-padding-x",
  "--canvas-header-padding-top",
  "--canvas-header-padding-bottom",
  "--stream-padding-x",
  "--stream-padding-top",
  "--stream-padding-bottom",
  "--stream-gap",
  "--message-user-padding-x",
  "--message-user-padding-y",
  "--message-assistant-padding",
  "--message-assistant-border-width",
  "--message-assistant-outline-width",
  "--message-avatar-radius",
  "--message-user-radius",
  "--message-assistant-radius",
  "--message-model-background",
  "--checkbox-size",
  "--checkbox-radius",
  "--checkbox-border",
  "--checkbox-background",
  "--checkbox-checked",
  "--checkbox-mark",
] as const;

export type ThemeTokenName = (typeof themeTokenNames)[number];
export type ThemeTokens = Readonly<Record<ThemeTokenName, string>>;
export type ThemeStyle = CSSProperties & Record<ThemeTokenName, string>;

export type ThemePresetId = "warm-editorial" | "clean-technical" | "soft-minimal";
export type Density = "compact" | "balanced" | "airy";
export type BodyScale = "small" | "standard" | "large";
export type LineHeight = "balanced" | "relaxed";
export type HeadingStyle = "sans" | "editorial";
export type CornerStyle = "precise" | "balanced" | "soft";
export type AccentPalette = "forest" | "blue" | "plum";
export type SurfaceStyle = "open" | "defined" | "soft";

export interface ThemeAdjustments {
  readonly density: Density;
  readonly bodyScale: BodyScale;
  readonly lineHeight: LineHeight;
  readonly headingStyle: HeadingStyle;
  readonly cornerStyle: CornerStyle;
  readonly accent: AccentPalette;
  readonly surface: SurfaceStyle;
}

export interface ThemePreset {
  readonly id: ThemePresetId;
  readonly name: string;
  readonly shortName: string;
  readonly description: string;
  readonly traits: readonly string[];
  readonly tokens: ThemeTokens;
  readonly defaults: ThemeAdjustments;
}

export interface ThemeDraft {
  readonly presetId: ThemePresetId;
  readonly isCustom: boolean;
  readonly adjustments: ThemeAdjustments;
}

export const systemSansFontStack =
  'ui-sans-serif, -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Noto Sans CJK SC", "Segoe UI", sans-serif';
export const systemSerifFontStack =
  'ui-serif, "New York", "Songti SC", "STSong", "Noto Serif CJK SC", Georgia, serif';
export const systemMonoFontStack =
  '"SFMono-Regular", "SF Mono", Consolas, "Liberation Mono", monospace';

const sharedTokens = {
  "--font-family-body": systemSansFontStack,
  "--font-family-display": systemSansFontStack,
  "--font-family-mono": systemMonoFontStack,
  "--font-family-meta": systemSansFontStack,
  "--font-weight-body": "400",
  "--font-weight-display": "760",
  "--canvas-header-background":
    "radial-gradient(circle at 94% 0%, var(--color-accent-soft), transparent 34%), var(--color-canvas)",
  "--canvas-title-letter-spacing": "-0.035em",
  "--content-heading-letter-spacing": "-0.025em",
  "--color-success": "#297247",
  "--color-success-soft": "#e0f0e5",
  "--color-running": "#336d8b",
  "--color-running-soft": "#e0edf3",
  "--color-pending": "#956b25",
  "--color-pending-soft": "#f6edd9",
  "--color-error": "#a2453e",
  "--color-error-soft": "#f7e7e4",
  "--color-code-comment": "#7f8981",
  "--color-code-keyword": "#d0aa87",
  "--color-code-string": "#a8c3a4",
  "--color-code-constant": "#c1afd0",
  "--color-code-function": "#a8bec5",
  "--color-code-variable": "#dde1da",
  "--color-code-punctuation": "#929a94",
  "--font-md": "15px",
  "--font-xl": "26px",
  "--font-code": "10.5px",
  "--font-table": "10px",
  "--line-table": "1.45",
  "--font-content-h1": "21px",
  "--font-content-h2": "18px",
  "--font-content-h3": "16px",
  "--line-body": "1.72",
  "--message-user-max-width": "88%",
  "--message-user-max-width-en": "96%",
  "--canvas-header-padding-x": "34px",
  "--canvas-header-padding-top": "38px",
  "--canvas-header-padding-bottom": "28px",
  "--stream-padding-x": "28px",
  "--stream-padding-top": "30px",
  "--stream-padding-bottom": "38px",
  "--stream-gap": "32px",
  "--message-user-padding-x": "20px",
  "--message-user-padding-y": "16px",
  "--message-assistant-padding": "20px",
  "--message-assistant-border-width": "3px",
  "--message-assistant-outline-width": "1px",
  "--message-avatar-radius": "10px",
  "--message-user-radius": "14px 6px 14px 14px",
  "--message-assistant-radius": "14px",
  "--message-model-background": "var(--color-neutral-soft)",
  "--checkbox-size": "15px",
  "--checkbox-radius": "4px",
  "--checkbox-border": "#9ca49c",
  "--checkbox-background": "#ffffff",
  "--checkbox-checked": "#44624c",
  "--checkbox-mark": "#ffffff",
} satisfies Partial<ThemeTokens>;

const warmEditorialTokens = {
  ...sharedTokens,
  "--font-family-display": systemSansFontStack,
  "--font-weight-display": "600",
  "--canvas-header-background":
    "radial-gradient(circle at 94% 0%, var(--color-accent-soft), transparent 34%), var(--color-canvas)",
  "--canvas-title-letter-spacing": "-0.006em",
  "--content-heading-letter-spacing": "0em",
  "--font-md": "16px",
  "--font-code": "12px",
  "--font-table": "13px",
  "--line-table": "1.5",
  "--font-content-h1": "20px",
  "--font-content-h2": "18px",
  "--font-content-h3": "17px",
  "--line-body": "1.68",
  "--message-avatar-radius": "9px",
  "--message-user-radius": "20px 6px 20px 20px",
  "--message-assistant-radius": "20px",
  "--message-model-background": "transparent",
  "--color-canvas": "#fbfaf6",
  "--color-canvas-raised": "#fffefa",
  "--color-ink": "#22241f",
  "--color-ink-soft": "#5e625b",
  "--color-ink-faint": "#888c83",
  "--color-border": "#ddded6",
  "--color-border-strong": "#c7cabf",
  "--color-accent": "#3f6550",
  "--color-accent-soft": "#e4eee6",
  "--color-user": "#e8f0ea",
  "--color-user-border": "#bdccbf",
  "--color-assistant": "color-mix(in srgb, #fffefa 76%, transparent)",
  "--color-assistant-border": "#d8ddd5",
  "--color-assistant-line": "#7d9985",
  "--color-system": "#f1efe7",
  "--color-code": "#171916",
  "--color-code-ink": "#f3f4ef",
  "--color-neutral-soft": "#eff0e9",
  "--shadow-canvas": "0 24px 70px rgba(35, 39, 33, 0.17), 0 2px 8px rgba(35, 39, 33, 0.08)",
  "--radius-xs": "6px",
  "--radius-sm": "10px",
  "--radius-md": "14px",
  "--radius-lg": "20px",
} satisfies ThemeTokens;

const cleanTechnicalTokens = {
  ...sharedTokens,
  "--line-body": "1.62",
  "--font-family-meta": systemMonoFontStack,
  "--canvas-header-background":
    "linear-gradient(135deg, #e7f0f7 0%, #f5f9fc 42%, #f5f9fc 100%)",
  "--canvas-title-letter-spacing": "-0.045em",
  "--message-avatar-radius": "5px",
  "--message-user-radius": "9px 3px 9px 9px",
  "--message-assistant-radius": "8px",
  "--message-model-background": "#e8eff4",
  "--color-canvas": "#f5f9fc",
  "--color-canvas-raised": "#ffffff",
  "--color-ink": "#17212b",
  "--color-ink-soft": "#52606d",
  "--color-ink-faint": "#7d8995",
  "--color-border": "#d9e0e7",
  "--color-border-strong": "#bcc8d3",
  "--color-accent": "#315f85",
  "--color-accent-soft": "#e3edf5",
  "--color-user": "#e7f0f7",
  "--color-user-border": "#b8ccdc",
  "--color-assistant": "#ffffff",
  "--color-assistant-border": "#cdd7df",
  "--color-assistant-line": "#5781a2",
  "--color-system": "#eef2f5",
  "--color-code": "#101820",
  "--color-code-ink": "#edf4f8",
  "--color-neutral-soft": "#edf2f6",
  "--shadow-canvas": "0 20px 56px rgba(32, 52, 68, 0.16), 0 2px 7px rgba(32, 52, 68, 0.08)",
  "--radius-xs": "4px",
  "--radius-sm": "7px",
  "--radius-md": "10px",
  "--radius-lg": "14px",
} satisfies ThemeTokens;

const softMinimalTokens = {
  ...sharedTokens,
  "--line-body": "1.62",
  "--canvas-header-background":
    "radial-gradient(circle at 88% 4%, #e8ddec 0%, transparent 42%), #faf7fb",
  "--canvas-title-letter-spacing": "-0.052em",
  "--message-avatar-radius": "999px",
  "--message-user-radius": "20px 8px 20px 20px",
  "--message-assistant-radius": "20px",
  "--message-model-background": "#f0eaf2",
  "--color-canvas": "#faf7fb",
  "--color-canvas-raised": "#ffffff",
  "--color-ink": "#29252c",
  "--color-ink-soft": "#625c66",
  "--color-ink-faint": "#918a95",
  "--color-border": "#e5e0e7",
  "--color-border-strong": "#cfc7d2",
  "--color-accent": "#68566f",
  "--color-accent-soft": "#eee8f0",
  "--color-user": "#f0ebf2",
  "--color-user-border": "#d8cddd",
  "--color-assistant": "color-mix(in srgb, #ffffff 70%, transparent)",
  "--color-assistant-border": "#e2dce5",
  "--color-assistant-line": "#9d8aa4",
  "--color-system": "#f3f0f4",
  "--color-code": "#1d1920",
  "--color-code-ink": "#f6f1f7",
  "--color-neutral-soft": "#f1eef2",
  "--shadow-canvas": "0 26px 72px rgba(52, 42, 56, 0.14), 0 2px 8px rgba(52, 42, 56, 0.06)",
  "--radius-xs": "8px",
  "--radius-sm": "13px",
  "--radius-md": "19px",
  "--radius-lg": "26px",
} satisfies ThemeTokens;

export const themePresets: readonly ThemePreset[] = [
  {
    id: "warm-editorial",
    name: "Warm Editorial",
    shortName: "Warm",
    description: "清晰卡片式回答，保留暖调长文阅读感，适合中英文混排。",
    traits: ["舒服阅读", "系统无衬线", "完整描边"],
    tokens: warmEditorialTokens,
    defaults: {
      density: "compact",
      bodyScale: "standard",
      lineHeight: "balanced",
      headingStyle: "sans",
      cornerStyle: "soft",
      accent: "forest",
      surface: "defined",
    },
  },
  {
    id: "clean-technical",
    name: "Clean Technical",
    shortName: "Technical",
    description: "完整描边、方形头像与紧凑网格，让技术内容更像工作台。",
    traits: ["高密度", "等宽元信息", "完整卡片"],
    tokens: cleanTechnicalTokens,
    defaults: {
      density: "compact",
      bodyScale: "standard",
      lineHeight: "balanced",
      headingStyle: "sans",
      cornerStyle: "precise",
      accent: "blue",
      surface: "defined",
    },
  },
  {
    id: "soft-minimal",
    name: "Soft Minimal",
    shortName: "Soft",
    description: "圆形头像与悬浮柔面，让短对话和轻内容更亲和。",
    traits: ["大字号", "圆形头像", "悬浮柔面"],
    tokens: softMinimalTokens,
    defaults: {
      density: "airy",
      bodyScale: "large",
      lineHeight: "relaxed",
      headingStyle: "sans",
      cornerStyle: "soft",
      accent: "plum",
      surface: "soft",
    },
  },
] as const;

export function getThemePreset(id: ThemePresetId): ThemePreset {
  const preset = themePresets.find((candidate) => candidate.id === id);
  if (!preset) throw new Error(`Unknown theme preset: ${id}`);
  return preset;
}

export function createThemeDraft(presetId: ThemePresetId): ThemeDraft {
  const preset = getThemePreset(presetId);
  return {
    presetId,
    isCustom: false,
    adjustments: { ...preset.defaults },
  };
}

const densityTokens: Record<Density, Partial<ThemeTokens>> = {
  compact: {
    "--stream-padding-x": "24px",
    "--stream-padding-top": "26px",
    "--stream-padding-bottom": "32px",
    "--stream-gap": "24px",
    "--message-user-padding-x": "17px",
    "--message-user-padding-y": "13px",
    "--message-assistant-padding": "16px",
  },
  balanced: {
    "--stream-padding-x": "28px",
    "--stream-padding-top": "30px",
    "--stream-padding-bottom": "38px",
    "--stream-gap": "30px",
    "--message-user-padding-x": "20px",
    "--message-user-padding-y": "16px",
    "--message-assistant-padding": "20px",
  },
  airy: {
    "--stream-padding-x": "30px",
    "--stream-padding-top": "34px",
    "--stream-padding-bottom": "44px",
    "--stream-gap": "38px",
    "--message-user-padding-x": "22px",
    "--message-user-padding-y": "18px",
    "--message-assistant-padding": "22px",
  },
};

const bodyScaleTokens: Record<BodyScale, Partial<ThemeTokens>> = {
  small: {
    "--font-md": "14px",
    "--font-code": "10px",
    "--font-content-h1": "20px",
    "--font-content-h2": "17px",
    "--font-content-h3": "15px",
    "--font-xl": "24px",
  },
  // Each preset owns its reviewed standard scale. This keeps the selected
  // Warm Editorial hierarchy from leaking into the internal comparison themes.
  standard: {},
  large: {
    "--font-md": "16px",
    "--font-code": "11px",
    "--font-content-h1": "23px",
    "--font-content-h2": "20px",
    "--font-content-h3": "17px",
    "--font-xl": "28px",
  },
};

const accentTokens: Record<AccentPalette, Partial<ThemeTokens>> = {
  forest: {
    "--color-accent": "#3f6550",
    "--color-accent-soft": "#e4eee6",
    "--color-user": "#e8f0ea",
    "--color-user-border": "#bdccbf",
    "--color-assistant-line": "#7d9985",
    "--checkbox-checked": "#3f6550",
  },
  blue: {
    "--color-accent": "#315f85",
    "--color-accent-soft": "#e3edf5",
    "--color-user": "#e7f0f7",
    "--color-user-border": "#b8ccdc",
    "--color-assistant-line": "#5781a2",
    "--checkbox-checked": "#315f85",
  },
  plum: {
    "--color-accent": "#68566f",
    "--color-accent-soft": "#eee8f0",
    "--color-user": "#f0ebf2",
    "--color-user-border": "#d8cddd",
    "--color-assistant-line": "#9d8aa4",
    "--checkbox-checked": "#68566f",
  },
};

const cornerTokens: Record<CornerStyle, Partial<ThemeTokens>> = {
  precise: {
    "--radius-xs": "4px",
    "--radius-sm": "7px",
    "--radius-md": "10px",
    "--radius-lg": "14px",
    "--message-user-radius": "9px 3px 9px 9px",
    "--message-assistant-radius": "8px",
    "--checkbox-radius": "3px",
  },
  balanced: {
    "--radius-xs": "6px",
    "--radius-sm": "10px",
    "--radius-md": "14px",
    "--radius-lg": "20px",
    "--message-user-radius": "14px 6px 14px 14px",
    "--message-assistant-radius": "14px",
    "--checkbox-radius": "4px",
  },
  soft: {
    "--radius-xs": "8px",
    "--radius-sm": "13px",
    "--radius-md": "19px",
    "--radius-lg": "26px",
    "--message-user-radius": "20px 8px 20px 20px",
    "--message-assistant-radius": "20px",
    "--checkbox-radius": "5px",
  },
};

const surfaceTokens: Record<SurfaceStyle, Partial<ThemeTokens>> = {
  open: {
    "--color-assistant": "color-mix(in srgb, var(--color-canvas-raised) 62%, transparent)",
    "--color-assistant-border": "color-mix(in srgb, var(--color-assistant-line) 24%, var(--color-border))",
    "--message-assistant-border-width": "3px",
    "--message-assistant-outline-width": "0px",
  },
  defined: {
    "--color-assistant": "var(--color-canvas-raised)",
    "--color-assistant-border": "var(--color-border-strong)",
    "--message-assistant-border-width": "3px",
    "--message-assistant-outline-width": "1px",
  },
  soft: {
    "--color-assistant": "color-mix(in srgb, var(--color-canvas-raised) 76%, transparent)",
    "--color-assistant-border": "color-mix(in srgb, var(--color-accent) 14%, var(--color-border))",
    "--message-assistant-border-width": "1px",
    "--message-assistant-outline-width": "1px",
  },
};

export function buildThemeTokens(draft: ThemeDraft): ThemeTokens {
  const preset = getThemePreset(draft.presetId);
  const { adjustments } = draft;

  return {
    ...preset.tokens,
    ...densityTokens[adjustments.density],
    ...bodyScaleTokens[adjustments.bodyScale],
    ...cornerTokens[adjustments.cornerStyle],
    ...accentTokens[adjustments.accent],
    ...surfaceTokens[adjustments.surface],
    "--font-family-display": adjustments.headingStyle === "editorial"
      ? systemSerifFontStack
      : preset.tokens["--font-family-display"],
    "--font-weight-display": adjustments.headingStyle === "editorial"
      ? "700"
      : preset.tokens["--font-weight-display"],
    "--line-body": adjustments.lineHeight === "relaxed"
      ? "1.76"
      : preset.tokens["--line-body"],
  };
}

export function themeStyle(draft: ThemeDraft): ThemeStyle {
  return buildThemeTokens(draft) as ThemeStyle;
}
