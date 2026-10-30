import {
  systemSansFontStack,
  type ThemeStyle,
  type ThemeTokenName,
  type ThemeTokens,
} from "./theme-presets";
import { themeV1Tokens } from "./theme-v1";

export const typographyTokenNames = [
  "--font-family-body",
  "--font-family-display",
  "--font-weight-body",
  "--font-weight-display",
  "--canvas-title-letter-spacing",
  "--content-heading-letter-spacing",
  "--font-md",
  "--font-xl",
  "--font-code",
  "--font-content-h1",
  "--font-content-h2",
  "--font-content-h3",
  "--line-body",
] as const satisfies readonly ThemeTokenName[];

export type TypographyTokenName = (typeof typographyTokenNames)[number];
export type TypographyCandidateId = "apple-clean" | "avenir-soft" | "hiragino-reading";

export interface TypographyCandidate {
  readonly id: TypographyCandidateId;
  readonly marker: "A" | "B" | "C";
  readonly name: string;
  readonly description: string;
  readonly familyLabel: string;
  readonly metricsLabel: string;
  readonly note?: string;
  readonly tokens: Readonly<Pick<ThemeTokens, TypographyTokenName>>;
}

const avenirSystemStack =
  '"Avenir Next", "SF Pro Text", -apple-system, BlinkMacSystemFont, "PingFang SC", "Noto Sans CJK SC", sans-serif';
const hiraginoSystemStack =
  '"Hiragino Sans GB", "PingFang SC", "SF Pro Text", -apple-system, BlinkMacSystemFont, "Noto Sans CJK SC", sans-serif';

export const typographyCandidates: readonly TypographyCandidate[] = [
  {
    id: "apple-clean",
    marker: "A",
    name: "Apple Clean",
    description: "SF Pro / 苹方，标题字重 600，不用负字距。",
    familyLabel: "SF Pro · 苹方",
    metricsLabel: "标题 600 · H1 20px · 正文 16px / 1.68",
    tokens: {
      "--font-family-body": systemSansFontStack,
      "--font-family-display": systemSansFontStack,
      "--font-weight-body": "400",
      "--font-weight-display": "600",
      "--canvas-title-letter-spacing": "-0.006em",
      "--content-heading-letter-spacing": "0em",
      "--font-md": "16px",
      "--font-xl": "26px",
      "--font-code": "12px",
      "--font-content-h1": "20px",
      "--font-content-h2": "18px",
      "--font-content-h3": "17px",
      "--line-body": "1.68",
    },
  },
  {
    id: "avenir-soft",
    marker: "B",
    name: "Avenir Soft",
    description: "英文更圆润，中文继续回退苹方，整体更轻、更松弛。",
    familyLabel: "Avenir Next · 苹方",
    metricsLabel: "标题 500 · 正文 16px / 1.78",
    tokens: {
      "--font-family-body": avenirSystemStack,
      "--font-family-display": avenirSystemStack,
      "--font-weight-body": "400",
      "--font-weight-display": "500",
      "--canvas-title-letter-spacing": "0em",
      "--content-heading-letter-spacing": "0em",
      "--font-md": "16px",
      "--font-xl": "28px",
      "--font-code": "11px",
      "--font-content-h1": "23px",
      "--font-content-h2": "20px",
      "--font-content-h3": "17px",
      "--line-body": "1.78",
    },
  },
  {
    id: "hiragino-reading",
    marker: "C",
    name: "Hiragino Reading",
    description: "优先观察冬青黑体的中文阅读质感，行距最舒展。",
    familyLabel: "冬青黑体 · 苹方回退",
    metricsLabel: "标题 600 · 正文 15.5px / 1.76",
    note: "iOS 上没有冬青黑体，会回退到苹方。",
    tokens: {
      "--font-family-body": hiraginoSystemStack,
      "--font-family-display": hiraginoSystemStack,
      "--font-weight-body": "400",
      "--font-weight-display": "600",
      "--canvas-title-letter-spacing": "0em",
      "--content-heading-letter-spacing": "0.006em",
      "--font-md": "15.5px",
      "--font-xl": "26px",
      "--font-code": "10.5px",
      "--font-content-h1": "21px",
      "--font-content-h2": "18px",
      "--font-content-h3": "16px",
      "--line-body": "1.76",
    },
  },
] as const;

export function getTypographyCandidate(id: TypographyCandidateId): TypographyCandidate {
  const candidate = typographyCandidates.find((item) => item.id === id);
  if (!candidate) throw new Error(`Unknown typography candidate: ${id}`);
  return candidate;
}

export function buildTypographyCandidateStyle(id: TypographyCandidateId): ThemeStyle {
  return {
    ...themeV1Tokens,
    ...getTypographyCandidate(id).tokens,
  } as ThemeStyle;
}
