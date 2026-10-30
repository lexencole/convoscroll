import { describe, expect, it } from "vitest";
import { themeTokenNames } from "./theme-presets";
import { themeV1Tokens } from "./theme-v1";
import {
  buildTypographyCandidateStyle,
  getTypographyCandidate,
  typographyCandidates,
  typographyTokenNames,
} from "./typography-candidates";

describe("typography candidates", () => {
  it("defines three clearly named candidates", () => {
    expect(typographyCandidates.map((candidate) => candidate.id)).toEqual([
      "apple-clean",
      "avenir-soft",
      "hiragino-reading",
    ]);
    expect(typographyCandidates.map((candidate) => candidate.marker)).toEqual(["A", "B", "C"]);
  });

  it("changes only approved typography tokens", () => {
    const typographyNames = new Set<string>(typographyTokenNames);
    const lockedNames = themeTokenNames.filter((name) => !typographyNames.has(name));

    for (const candidate of typographyCandidates) {
      const style = buildTypographyCandidateStyle(candidate.id);
      expect(Object.keys(candidate.tokens).sort()).toEqual([...typographyTokenNames].sort());
      for (const tokenName of lockedNames) {
        expect(style[tokenName]).toBe(themeV1Tokens[tokenName]);
      }
    }
  });

  it("preserves the earlier Apple metrics after the formal theme adopts Geist", () => {
    const apple = buildTypographyCandidateStyle("apple-clean");
    const avenir = buildTypographyCandidateStyle("avenir-soft");
    const hiragino = buildTypographyCandidateStyle("hiragino-reading");

    for (const tokenName of typographyTokenNames.filter((name) => !name.startsWith("--font-family-"))) {
      expect(apple[tokenName]).toBe(themeV1Tokens[tokenName]);
    }
    expect(apple["--font-family-body"]).toContain("-apple-system");
    expect(themeV1Tokens["--font-family-body"]).toContain("Geist Variable");
    expect(apple["--font-weight-display"]).toBe("600");
    expect(apple["--font-md"]).toBe("16px");
    expect(apple["--font-code"]).toBe("12px");
    expect(apple["--font-content-h1"]).toBe("20px");
    expect(apple["--font-content-h2"]).toBe("18px");
    expect(avenir["--font-weight-display"]).toBe("500");
    expect(avenir["--font-family-body"]).toContain("Avenir Next");
    expect(hiragino["--font-family-body"]).toContain("Hiragino Sans GB");
    expect(new Set(typographyCandidates.map((candidate) => candidate.metricsLabel)).size).toBe(3);
  });

  it("rejects unknown candidate ids", () => {
    expect(() => getTypographyCandidate("missing" as never)).toThrow(
      "Unknown typography candidate",
    );
  });
});
