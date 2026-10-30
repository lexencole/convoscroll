import { describe, expect, it } from "vitest";
import mainSource from "../main.tsx?raw";
import tokensCss from "./tokens.css?raw";
import workbenchCss from "./workbench.css?raw";

function parse(css: string): CSSRule[] {
  const element = document.createElement("style");
  element.textContent = css;
  document.head.append(element);
  try { return [...element.sheet!.cssRules]; }
  finally { element.remove(); }
}
function rule(css: CSSRule[], selector: string): CSSStyleDeclaration {
  const found = css.find((item): item is CSSStyleRule => "selectorText" in item && (item as CSSStyleRule).selectorText.replace(/\s+/g, " ") === selector);
  if (!found) throw new Error(`Missing rule: ${selector}`);
  return found.style;
}
function media(css: CSSRule[], condition: string): CSSRule[] {
  const found = css.find((item) => "conditionText" in item && item.conditionText === condition) as CSSMediaRule | undefined;
  if (!found) throw new Error(`Missing media: ${condition}`);
  return [...found.cssRules];
}
function selectors(css: CSSRule[]): string[] {
  return css.filter((item): item is CSSStyleRule => "selectorText" in item).map((item) => item.selectorText.replace(/\s+/g, " "));
}
const css = parse(workbenchCss);
const tokenRules = parse(tokensCss);
const workbenchTokens = (tokenRules.find((item) => "style" in item && (item as CSSStyleRule).style.getPropertyValue("--ui-control")) as CSSStyleRule).style;

describe("workbench stylesheet", () => {
  it("is the single workbench layer, loaded after the shared editor styles", () => {
    const order = ["./styles/tokens.css", "./styles/global.css", "./styles/editor.css", "./styles/workbench.css"].map((path) => mainSource.indexOf(path));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(mainSource).not.toContain("workbench-controls.css");
  });

  it("defines only editor tokens and never redefines the canonical theme", () => {
    const tokens = workbenchTokens;
    for (let index = 0; index < tokens.length; index++) expect(tokens.item(index)).toMatch(/^--ui-/);
    // The settings panel may scope the source-editor size; theme tokens stay untouched.
    expect(workbenchCss.replace(/--font-source-editor:/g, "")).not.toMatch(/--(color|message|font|space|radius|stream|canvas|shadow|line)-[a-z0-9-]+\s*:/);
  });

  it("floats every canvas control so the editing layout matches the export", () => {
    for (const selector of [".workbench .workbench-block-tools", ".workbench-message-tools"]) {
      expect(rule(css, selector).getPropertyValue("position")).toBe("absolute");
    }
    // Adding content lives in the toolbar; the in-flow add chip only appears in an emptied message.
    expect(rule(css, ".workbench .workbench-add-block").getPropertyValue("position")).toBe("");
    expect(rule(css, ".workbench-message-heading > .message__header").getPropertyValue("margin-bottom")).toBe("0px");
    expect(rule(css, ".workbench-message-heading").getPropertyValue("margin-bottom")).toBe("var(--space-3)");
    expect(rule(css, ".workbench .workbench-editable").getPropertyValue("min-height")).toBe("");
    expect(rule(css, ".workbench .workbench-editable:has(> .workbench-placeholder)").getPropertyValue("min-height")).toBe("var(--size-touch-target)");
    expect(workbenchCss).not.toMatch(/\.workbench-block-tools\s*\{[^}]*position:\s*static/);
  });

  it("keeps floating controls inside the canvas and compensates the phone preview scale", () => {
    expect(parseFloat(workbenchTokens.getPropertyValue("--ui-chip-offset"))).toBeLessThanOrEqual(16);
    const host = rule(css, ".workbench .preview-scale-host");
    expect(host.getPropertyValue("--ui-c-chip").replace(/\s/g, "")).toBe("calc(var(--ui-chip)/var(--preview-scale,1))");
    expect(host.getPropertyValue("--ui-c-font").replace(/\s/g, "")).toBe("calc(var(--ui-font-sm)/var(--preview-scale,1))");
    expect(workbenchCss).not.toContain("right: calc(100%");
  });

  it("sizes controls by pointer: compact for fine pointers, 44px for touch", () => {
    expect(workbenchTokens.getPropertyValue("--ui-control")).toBe("32px");
    const coarse = rule(media(tokenRules, "(any-pointer: coarse)"), ":root");
    expect(coarse.getPropertyValue("--ui-control")).toBe("44px");
    expect(coarse.getPropertyValue("--ui-chip")).toBe("44px");
    expect(coarse.getPropertyValue("--ui-toolbar-font-size")).toBe("");
  });

  it("reveals only the hovered or focused region on desktop, without hover-only access", () => {
    const desktop = media(css, "(hover: hover) and (pointer: fine)");
    const hidden = rule(desktop, ".workbench .workbench-item-tools");
    expect(hidden.getPropertyValue("opacity")).toBe("0");
    expect(hidden.getPropertyValue("pointer-events")).toBe("none");
    expect(hidden.getPropertyValue("display")).toBe("");
    const reveal = selectors(desktop)[1];
    expect(reveal).toContain(".workbench-block[data-current]");
    expect(reveal).toContain(".workbench-block-tools:focus-within");
    expect(reveal).toContain("[aria-expanded=true]");
    expect(reveal).toContain(".workbench-drag:active");
  });

  it("shows touch actions only for the item being worked on and never over the caret", () => {
    const touch = media(css, "(hover: none), (pointer: coarse)");
    const hidden = rule(touch, ".workbench .workbench-item-tools");
    expect(hidden.getPropertyValue("opacity")).toBe("0");
    const reveal = selectors(touch)[1];
    expect(reveal).not.toContain(":hover");
    expect(reveal).toContain(":focus-within");
    expect(reveal).toContain(":not(:has(.inline-editable-block, .workbench-editable))");
    // iOS Safari blurs the text block before a tapped button receives the click, so the
    // edited message keeps its controls by state rather than by :focus-within.
    expect(reveal).toContain(".workbench-message-tools[data-current] .workbench-item-tools");
  });

  it("keeps one button weight, one small-text size and balanced lines outside the canvas", () => {
    // A filled main button is already marked by its fill; bold made it read as larger text.
    expect(rule(css, ".workbench .workbench-primary, .workbench .export-control__button, .workbench-settings button.workbench-primary").getPropertyValue("font-weight")).toBe("var(--ui-weight-medium)");
    expect(workbenchCss).not.toContain("--ui-font-xs");
    // Interface text avoids a last line of a few characters; the canvas must keep the export layout.
    // Paragraphs fill their lines: balance cut a two-line note in half, and WebKit's pretty evened it out the same way.
    expect(rule(css, "body:has(.workbench) :is(small, label, legend, summary, strong):not(.conversation-canvas *)").getPropertyValue("text-wrap")).toBe("balance");
    expect(rule(css, "body:has(.workbench) :is([role=alert], [role=status]):not(.conversation-canvas *)").getPropertyValue("text-wrap")).toBe("pretty");
    expect(workbenchCss).not.toMatch(/:is\(p, li/);
    expect(rule(css, "body:has(.workbench) :is(input, textarea)").getPropertyValue("text-wrap")).toBe("wrap");
  });

  it("keeps the phone editing bar at the top of the visible area", () => {
    // Above the keyboard Safari floats its own form bar and address pill, so the bar
    // stays at the top and follows the visible area while the keyboard is up.
    const phone = media(css, "(max-width: 600px)");
    const bar = rule(phone, ":root[data-keyboard-open] .workbench-chrome");
    expect(bar.getPropertyValue("position")).toBe("");
    expect(bar.getPropertyValue("top")).toContain("var(--ui-viewport-top, 0px)");
    expect(rule(css, ".workbench-chrome").getPropertyValue("position")).toBe("sticky");
    expect(rule(phone, ":root[data-keyboard-open] .workbench-notice").getPropertyValue("top")).toContain("var(--ui-edit-bar, 0px)");
  });

  it("draws drop markers in the gap between items", () => {
    expect(rule(css, ".workbench .message[data-drop-edge=before]::before").getPropertyValue("top").replace(/\s/g, "")).toBe("calc(-1*var(--stream-gap)/2-1px)");
    expect(rule(css, ".workbench .workbench-block[data-drop-edge=after]::after").getPropertyValue("bottom").replace(/\s/g, "")).toBe("calc(-1*var(--space-3)/2-1px)");
  });

  it("keeps renderer disclosures out of the generic chrome button style", () => {
    const base = selectors(css).find((selector) => selector.startsWith(".workbench button:where("))!;
    const host = document.createElement("main");
    host.className = "workbench";
    host.innerHTML = '<button class="trace-card__toggle"></button><button class="unsupported-card__toggle"></button><button class="workbench-context"></button>';
    document.body.append(host);
    try {
      expect(host.children[0].matches(base)).toBe(false);
      expect(host.children[1].matches(base)).toBe(false);
      expect(host.children[2].matches(base)).toBe(true);
    } finally { host.remove(); }
  });

  it("rounds only the paper in the editor and clips the canvas to it", () => {
    const paper = rule(css, ".workbench .inline-canvas-stage .preview-frame");
    expect(paper.getPropertyValue("border-radius")).toBe("var(--ui-radius-lg)");
    expect(paper.getPropertyValue("overflow")).toBe("clip");
    expect(rule(css, ".workbench .inline-canvas-stage .conversation-canvas").getPropertyValue("border-radius")).toBe("");
  });

  it("never clips the fields inside block settings", () => {
    // editor.css gives .block-editor a rounded, clipped card; in the panel it shaved the last field's bottom corners.
    const card = rule(css, ".workbench-settings .block-editor");
    expect(card.getPropertyValue("overflow")).toBe("visible");
    expect(card.getPropertyValue("border-radius")).toBe("0px");
  });

  it("keeps scrollable contents inside the rounded panel and its persistent header", () => {
    expect(rule(css, ".workbench-settings").getPropertyValue("overflow")).toBe("hidden");
    expect(rule(css, ".workbench-settings").getPropertyValue("display")).toBe("flex");
    const body = rule(css, ".workbench-settings__scroll");
    expect(body.getPropertyValue("overflow-y")).toBe("auto");
    expect(Number.parseFloat(body.getPropertyValue("min-height"))).toBe(0);
    // A reserved gutter would make the right margin wider than the left in browsers with classic scrollbars.
    expect(body.getPropertyValue("scrollbar-gutter")).toBe("");
  });

  it("keeps native scrollbars visible with a system fallback in forced colors", () => {
    const scrollers = css.find((item) => "selectorText" in item && typeof item.selectorText === "string" && item.selectorText.startsWith("html:has(.workbench),")) as CSSStyleRule;
    expect(scrollers.style.getPropertyValue("scrollbar-width")).toBe("thin");
    expect(scrollers.style.getPropertyValue("scrollbar-color")).toBe("var(--ui-scroll-thumb) transparent");
    const fallback = media(css, "(forced-colors: active)").find((item) => "selectorText" in item && typeof item.selectorText === "string" && item.selectorText.startsWith("html:has(.workbench),")) as CSSStyleRule;
    expect(fallback.style.getPropertyValue("scrollbar-width")).toBe("auto");
    expect(fallback.style.getPropertyValue("scrollbar-color")).toBe("auto");
    expect(workbenchCss).not.toMatch(/scrollbar-width:\s*none|::-webkit-scrollbar\s*\{[^}]*display:\s*none/);
  });

  it("activates native scrollbar parts only with standard overrides reset and normal desktop colors", () => {
    const supported = media(css, "(hover: hover) and (pointer: fine) and (forced-colors: none)")[0] as CSSSupportsRule;
    expect(supported.conditionText).toBe("selector(::-webkit-scrollbar)");
    const reset = supported.cssRules[0] as CSSStyleRule;
    expect(reset.style.getPropertyValue("scrollbar-width")).toBe("auto");
    expect(reset.style.getPropertyValue("scrollbar-color")).toBe("auto");
    expect(reset.selectorText).toContain("html:has(.workbench)");
    expect(reset.selectorText).toContain(".workbench-settings__scroll");
    expect(css.filter((item) => "selectorText" in item && typeof item.selectorText === "string" && item.selectorText.includes("::-webkit-scrollbar") && !item.selectorText.includes(".inline-format-tools"))).toHaveLength(0);
  });

  it("draws a slim rounded thumb inside a wider, stable native drag target", () => {
    const tokens = workbenchTokens;
    expect(tokens.getPropertyValue("--ui-scroll-width")).toBe("12px");
    expect(tokens.getPropertyValue("--ui-scroll-inset")).toBe("4px");
    expect(tokens.getPropertyValue("--ui-scroll-inset-active")).toBe("3px");
    const parts = [...(media(css, "(hover: hover) and (pointer: fine) and (forced-colors: none)")[0] as CSSSupportsRule).cssRules] as CSSStyleRule[];
    const thumb = parts.find((item) => item.selectorText.startsWith("html:has(.workbench)::-webkit-scrollbar-thumb,"))!.style;
    expect(thumb.getPropertyValue("border-radius")).toBe("var(--radius-pill)");
    expect(thumb.getPropertyValue("background-clip")).toBe("padding-box");
    const active = parts.find((item) => item.selectorText.includes("scrollbar-thumb:hover"))!;
    expect(active.selectorText).toContain("scrollbar-thumb:active");
    expect(active.style.getPropertyValue("border-width")).toBe("var(--ui-scroll-inset-active)");
    expect(rule(css, "html:has(.workbench)").getPropertyValue("background")).toBe("var(--ui-workspace)");
  });

  it("keeps toolbar, input and select typography consistent across screens", () => {
    const tokens = workbenchTokens;
    expect(tokens.getPropertyValue("--ui-toolbar-font-size")).toBe("13px");
    expect(tokens.getPropertyValue("--ui-font")).toBe("13px");
    expect(tokens.getPropertyValue("--ui-font-field")).toBe("13px");
    expect(tokens.getPropertyValue("--ui-font-select")).toBe("13px");
    const coarse = rule(media(tokenRules, "(any-pointer: coarse)"), ":root");
    expect(coarse.getPropertyValue("--ui-font-field")).toBe("");
    expect(coarse.getPropertyValue("--ui-font-select")).toBe("");
    expect(rule(css, ".workbench .select-field--toolbar .select-field__trigger, .select-field__menu--toolbar .select-field__option").getPropertyValue("font-size")).toBe("var(--ui-toolbar-font-size)");
    for (const item of css) {
      if ("conditionText" in item && /width/.test((item as CSSMediaRule).conditionText)) expect(item.cssText).not.toMatch(/--ui-(toolbar-)?font[a-z-]*\s*:/);
    }
    expect(workbenchCss).not.toMatch(/font-size:\s*var\(--font-control\)/);
  });

  it("keeps a single fixed-height toolbar and hides it completely during modal settings", () => {
    const bar = rule(css, ".workbench .inline-toolbar");
    expect(bar.getPropertyValue("flex-wrap")).toBe("nowrap");
    expect(bar.getPropertyValue("height")).toBe("var(--ui-toolbar-height)");
    expect(rule(css, ".workbench .inline-toolbar[hidden]").getPropertyValue("display")).toBe("none");
    expect(rule(media(css, "(max-width: 600px)"), ".workbench .inline-format-tools .inline-format-wide").getPropertyValue("display")).toBe("none");
  });

  it("keeps confirmation notices out of document flow", () => {
    const notice = rule(css, ".workbench-notice");
    expect(notice.getPropertyValue("position")).toBe("fixed");
    expect(notice.getPropertyValue("max-width")).toContain("100vw");
  });

  it("animates chrome only and honours reduced motion", () => {
    const motion = css.find((item) => "conditionText" in item && item.conditionText === "(prefers-reduced-motion: no-preference)") as CSSMediaRule;
    expect(motion.cssText).toContain("transition:");
    expect(motion.cssText).not.toMatch(/\.conversation-canvas|\.message__|\.trace-|\.markdown-/);
    expect(workbenchCss).toContain("(prefers-reduced-motion: reduce)");
  });

  it("uses neutral field focus and retains a forced-color keyboard outline", () => {
    const focus = css.find((item) => "selectorText" in item && typeof item.selectorText === "string" && item.selectorText.startsWith(".workbench-settings :is(input:not([type=checkbox]), textarea, .select-field__trigger):focus-visible")) as CSSStyleRule;
    expect(focus.style.getPropertyValue("outline")).toBe("none");
    expect(focus.style.getPropertyValue("box-shadow")).toBe("var(--ui-field-focus-shadow)");
    expect(workbenchTokens.getPropertyValue("--ui-field-focus-shadow")).toBe("none");
    expect(media(css, "(forced-colors: active)").some((item) => "style" in item && (item as CSSStyleRule).style.getPropertyValue("outline") === "var(--ui-focus-width) solid Highlight")).toBe(true);
  });
});
