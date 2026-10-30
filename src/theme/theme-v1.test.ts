import { describe, expect, it } from "vitest";
import {
  resolveThemeStyle,
  THEME_V1_ID,
  THEME_V1_NAME,
  themeV1Canvas,
  themeV1Draft,
  themeV1Tokens,
} from "./theme-v1";

describe("Theme v1", () => {
  it("freezes the reviewed Warm Editorial baseline", () => {
    expect(THEME_V1_ID).toBe("warm-editorial-v1");
    expect(THEME_V1_NAME).toBe("Warm Editorial");
    expect(themeV1Canvas).toEqual({ preset: "portrait", width: 480, scale: 3 });
    expect(themeV1Draft.adjustments).toEqual({
      density: "compact",
      bodyScale: "standard",
      lineHeight: "balanced",
      headingStyle: "sans",
      cornerStyle: "soft",
      accent: "forest",
      surface: "defined",
    });
    expect(Object.isFrozen(themeV1Canvas)).toBe(true);
    expect(Object.isFrozen(themeV1Draft)).toBe(true);
    expect(Object.isFrozen(themeV1Draft.adjustments)).toBe(true);
    expect(Object.isFrozen(themeV1Tokens)).toBe(true);
  });

  it("resolves only the formal theme id and preserves its reviewed tokens", () => {
    expect(resolveThemeStyle(THEME_V1_ID)).toBe(themeV1Tokens);
    expect(resolveThemeStyle("missing-theme")).toBeUndefined();
    expect(themeV1Tokens["--color-canvas"]).toBe("#fbfaf6");
    expect(themeV1Tokens["--font-md"]).toBe("16px");
    expect(themeV1Tokens["--line-body"]).toBe("1.68");
    expect(themeV1Tokens["--font-family-display"]).toBe(themeV1Tokens["--font-family-body"]);
    expect(themeV1Tokens["--font-family-display"]).toContain("Geist Variable");
    expect(themeV1Tokens["--font-family-display"]).not.toContain("New York");
    expect(themeV1Tokens["--font-weight-body"]).toBe("400");
    expect(themeV1Tokens["--font-weight-display"]).toBe("600");
    expect(themeV1Tokens["--canvas-title-letter-spacing"]).toBe("-0.006em");
    expect(themeV1Tokens["--content-heading-letter-spacing"]).toBe("0em");
    expect(themeV1Tokens["--font-xl"]).toBe("26px");
    expect(themeV1Tokens["--font-code"]).toBe("12px");
    expect(themeV1Tokens["--font-table"]).toBe("13px");
    expect(themeV1Tokens["--line-table"]).toBe("1.5");
    expect(themeV1Tokens["--font-content-h1"]).toBe("20px");
    expect(themeV1Tokens["--font-content-h2"]).toBe("18px");
    expect(themeV1Tokens["--font-content-h3"]).toBe("17px");
    expect(themeV1Tokens["--stream-gap"]).toBe("24px");
    expect(themeV1Tokens["--message-assistant-outline-width"]).toBe("1px");
    expect(themeV1Tokens["--message-assistant-border-width"]).toBe("3px");
    expect(themeV1Tokens["--message-assistant-radius"]).toBe("20px");
  });
});
