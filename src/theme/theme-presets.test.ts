import { describe, expect, it } from "vitest";
import {
  buildThemeTokens,
  createThemeDraft,
  getThemePreset,
  themePresets,
  themeTokenNames,
} from "./theme-presets";

describe("theme presets", () => {
  it("defines three complete and uniquely named directions", () => {
    expect(themePresets.map((preset) => preset.id)).toEqual([
      "warm-editorial",
      "clean-technical",
      "soft-minimal",
    ]);
    expect(new Set(themePresets.map((preset) => preset.id)).size).toBe(themePresets.length);

    for (const preset of themePresets) {
      expect(Object.keys(preset.tokens).sort()).toEqual([...themeTokenNames].sort());
    }
  });

  it("creates an immutable baseline draft and applies controlled changes", () => {
    const baseline = createThemeDraft("warm-editorial");
    const changed = {
      ...baseline,
      isCustom: true,
      adjustments: {
        ...baseline.adjustments,
        accent: "blue" as const,
        density: "compact" as const,
        headingStyle: "sans" as const,
      },
    };

    const baselineTokens = buildThemeTokens(baseline);
    const changedTokens = buildThemeTokens(changed);

    expect(baseline.isCustom).toBe(false);
    expect(baselineTokens["--color-accent"]).toBe("#3f6550");
    expect(changedTokens["--color-accent"]).toBe("#315f85");
    expect(changedTokens["--stream-gap"]).toBe("24px");
    expect(changedTokens["--font-family-display"]).toContain("ui-sans-serif");
    expect(getThemePreset("warm-editorial").defaults.accent).toBe("forest");
  });

  it("preserves the reviewed comfortable-reading combination as the Warm baseline", () => {
    expect(getThemePreset("warm-editorial").defaults).toEqual({
      density: "compact",
      bodyScale: "standard",
      lineHeight: "balanced",
      headingStyle: "sans",
      cornerStyle: "soft",
      accent: "forest",
      surface: "defined",
    });
    const tokens = buildThemeTokens(createThemeDraft("warm-editorial"));
    expect(tokens["--color-canvas"]).toBe("#fbfaf6");
    expect(tokens["--font-family-display"]).toBe(tokens["--font-family-body"]);
    expect(tokens["--font-family-display"]).toContain("-apple-system");
    expect(tokens["--font-family-display"]).not.toContain("New York");
    expect(tokens["--font-weight-display"]).toBe("600");
    expect(tokens["--content-heading-letter-spacing"]).toBe("0em");
    expect(tokens["--font-md"]).toBe("16px");
    expect(tokens["--font-code"]).toBe("12px");
    expect(tokens["--font-content-h1"]).toBe("20px");
    expect(tokens["--font-content-h2"]).toBe("18px");
    expect(tokens["--font-content-h3"]).toBe("17px");
    expect(tokens["--line-body"]).toBe("1.68");
    expect(tokens["--message-user-radius"]).toBe("20px 8px 20px 20px");
    expect(tokens["--message-assistant-radius"]).toBe("20px");
    expect(tokens["--message-assistant-outline-width"]).toBe("1px");
    expect(tokens["--message-assistant-border-width"]).toBe("3px");
    expect(tokens["--color-code-comment"]).toBe("#7f8981");
    expect(tokens["--color-code-keyword"]).toBe("#d0aa87");
  });

  it("lets corner language control both message shells and internal elements", () => {
    const baseline = createThemeDraft("warm-editorial");
    const precise = {
      ...baseline,
      isCustom: true,
      adjustments: {
        ...baseline.adjustments,
        cornerStyle: "precise" as const,
      },
    };

    const tokens = buildThemeTokens(precise);

    expect(tokens["--message-user-radius"]).toBe("9px 3px 9px 9px");
    expect(tokens["--message-assistant-radius"]).toBe("8px");
    expect(tokens["--radius-md"]).toBe("10px");
  });

  it("makes the three directions structurally distinct instead of recoloring one skin", () => {
    const warm = buildThemeTokens(createThemeDraft("warm-editorial"));
    const technical = buildThemeTokens(createThemeDraft("clean-technical"));
    const soft = buildThemeTokens(createThemeDraft("soft-minimal"));

    expect(warm["--message-assistant-outline-width"]).toBe("1px");
    expect(technical["--message-assistant-outline-width"]).toBe("1px");
    expect(warm["--message-avatar-radius"]).toBe("9px");
    expect(technical["--message-avatar-radius"]).toBe("5px");
    expect(soft["--message-avatar-radius"]).toBe("999px");
    expect(warm["--message-assistant-radius"]).toBe("20px");
    expect(technical["--message-assistant-radius"]).toBe("8px");
    expect(soft["--message-assistant-radius"]).toBe("20px");
    expect(warm["--message-assistant-border-width"]).not.toBe(
      soft["--message-assistant-border-width"],
    );
    expect(technical["--font-family-meta"]).toContain("SFMono-Regular");
    expect(warm["--line-body"]).toBe("1.68");
    expect(technical["--line-body"]).toBe("1.62");
    expect(soft["--line-body"]).toBe("1.76");
  });

  it("rejects an unknown preset instead of silently falling back", () => {
    expect(() => getThemePreset("missing-theme" as never)).toThrow("Unknown theme preset");
  });
});
