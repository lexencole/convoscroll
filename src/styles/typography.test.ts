import { describe, expect, it } from "vitest";
import editorCss from "./editor.css?raw";
import globalCss from "./global.css?raw";
import tokensCss from "./tokens.css?raw";

function rules(css: string): CSSRule[] {
  const element = document.createElement("style");
  element.textContent = css;
  document.head.append(element);
  try {
    return [...element.sheet!.cssRules];
  } finally {
    element.remove();
  }
}

function declaration(cssRules: CSSRule[], selector: string, property: string): string {
  return cssRules.reduce((value, rule) => {
    if (!("selectorText" in rule)) return value;
    const styleRule = rule as CSSStyleRule;
    return styleRule.selectorText.split(",").map((part) => part.trim()).includes(selector)
      ? styleRule.style.getPropertyValue(property) || value
      : value;
  }, "");
}

describe("shared typography rules", () => {
  it("keeps canvas supporting text legible at phone scale", () => {
    const tokens = rules(tokensCss);
    const size = (name: string) => Number.parseFloat(declaration(tokens, ":root", name));
    expect(size("--canvas-font-badge")).toBe(10);
    expect(size("--canvas-font-pill")).toBe(11);
    expect(size("--canvas-font-label")).toBe(12);
    expect(size("--canvas-font-secondary")).toBe(13);
    expect(size("--canvas-font-lead")).toBe(14);
    // Canvas rules start at .conversation-canvas; nothing there uses the old sub-11px tokens.
    const canvasCss = globalCss.slice(globalCss.indexOf(".conversation-canvas {"));
    expect(canvasCss).not.toMatch(/var\(--font-(2xs|xs|sm|icon-label)\)/);
    expect(canvasCss).not.toMatch(/font-weight:\s*(650|750|800|850)\b/);
  });

  it("keeps exported titles and paragraphs from ending in a lone character", () => {
    // Titles and subtitles balance their lines at punctuation. Body text fills its lines
    // (Safari's `pretty` shortens every line) and keeps its last characters together.
    expect(globalCss).toMatch(/\.canvas-header h1,\s*\.canvas-header > p \{\s*text-wrap: balance;\s*word-break: keep-all;/);
    expect(globalCss).toMatch(/\.markdown-body \.keep-together \{\s*white-space: nowrap;/);
    expect(globalCss).not.toMatch(/text-wrap: pretty/);
  });

  it("justifies body text so early line breaks leave no gap on the right", () => {
    // Set on the paragraphs themselves, so containers that align left (user bubbles) do not undo it.
    expect(globalCss).toMatch(/\.markdown-body :is\(p, li\) \{\s*text-align: justify;/);
    expect(globalCss).not.toMatch(/\.markdown-body[^{]*\b(p|li)\b[^{]*\{[^}]*text-align: (left|start)/);
  });

  it("slants Chinese italics without faking bold", () => {
    // Chinese system fonts have no italic face, so `none` left Chinese emphasis upright.
    expect(declaration(rules(tokensCss), ":root", "font-synthesis")).toBe("style");
  });

  it("draws strikethrough with a visible, softened line over CJK text", () => {
    const del = rules(globalCss).find((rule) => "selectorText" in rule && (rule as CSSStyleRule).selectorText === ".markdown-body del") as CSSStyleRule;
    expect(del.style.getPropertyValue("text-decoration-thickness")).toBe("1.5px");
    expect(del.style.getPropertyValue("color")).toBe("var(--color-ink-soft)");
  });

  it("changes legacy control and source-editor tokens together on touch devices", () => {
    const tokens = rules(tokensCss);
    expect(declaration(tokens, ":root", "--font-control")).toBe("13px");
    expect(declaration(tokens, ":root", "--line-control")).toBe("1.45");
    const mobile = tokens.find((rule) => (
      "conditionText" in rule && rule.conditionText === "(any-pointer: coarse)"
    )) as CSSMediaRule;
    expect(declaration([...mobile.cssRules], ":root", "--font-control")).toBe("16px");
    expect(declaration([...mobile.cssRules], ":root", "--font-source-editor")).toBe("16px");
  });

  it("uses the same typography for inputs, selectors and portalled options", () => {
    const editor = rules(editorCss);
    for (const selector of [
      ".editor-field input", ".editor-field textarea", ".select-field__trigger",
      ".select-field__option",
    ]) {
      expect(declaration(editor, selector, "font-size")).toBe("var(--font-control)");
      expect(declaration(editor, selector, "line-height")).toBe("var(--line-control)");
    }
    expect(declaration(editor, ".select-field--compact .select-field__trigger", "font-size")).toBe("");
  });

  it("gives operation-dialog titles and table text dedicated semantic tokens", () => {
    const editor = rules(editorCss);
    for (const selector of [".import-dialog h2", ".export-dialog > header h2"]) {
      expect(declaration(editor, selector, "font-size")).toBe("var(--font-dialog-title)");
      expect(declaration(editor, selector, "font-weight")).toBe("var(--font-weight-display)");
      expect(declaration(editor, selector, "line-height")).toBe("var(--line-dialog-title)");
    }
    const global = rules(globalCss);
    expect(declaration(global, ".table-wrap table", "font-size")).toBe("var(--font-table)");
    expect(declaration(global, ".table-wrap table", "line-height")).toBe("var(--line-table)");
  });

  it("lets export fields use the full dialog width on phones", () => {
    const mobile = rules(editorCss).find((rule) => (
      "conditionText" in rule && rule.conditionText === "(max-width: 520px)"
    )) as CSSMediaRule;
    expect(declaration([...mobile.cssRules], ".export-dialog__body", "grid-template-columns"))
      .toBe("1fr");
  });
});
