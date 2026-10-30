import { describe, expect, it } from "vitest";
import { normalizeLanguage } from "./code-languages";

describe("code language names", () => {
  it.each(["__proto__", "constructor", "hasOwnProperty", "toString"])("preserves unknown language %s as text", (language) => {
    expect(normalizeLanguage(language)).toBe(language.toLowerCase());
  });
});
