import { describe, expect, it } from "vitest";
import globalCss from "./global.css?raw";
import inlineCss from "./inline-editor.css?raw";

function rules(css: string): CSSStyleRule[] {
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
  const result = [...style.sheet!.cssRules].filter((rule): rule is CSSStyleRule => "selectorText" in rule);
  style.remove();
  return result;
}

describe("shared trace surfaces", () => {
  it("does not stretch read-only task-list checkboxes into 44px form fields", () => {
    const host = document.createElement("main");
    host.className = "workbench";
    host.innerHTML = '<input type="checkbox" disabled><input type="text">';
    const field = rules(inlineCss).find((rule) => rule.selectorText.includes(".workbench input") && rule.style.getPropertyValue("min-height"))!;
    expect(host.children[0].matches(field.selectorText)).toBe(false);
    expect(host.children[1].matches(field.selectorText)).toBe(true);
  });
  it("groups records with space instead of nesting and connecting borders", () => {
    const css = rules(globalCss);
    const stack = css.find((rule) => rule.selectorText === ".trace-stack")!.style;
    expect(stack.getPropertyValue("gap")).toBe("var(--space-2)");
    expect(stack.getPropertyValue("border")).toBe("");
    expect(parseFloat(css.find((rule) => rule.selectorText === ".trace-card")!.style.getPropertyValue("border"))).toBe(0);
    expect(globalCss).not.toContain(".trace-stack > .content-block + .content-block");
    expect(css.find((rule) => rule.selectorText === ".trace-card__meta")!.style.getPropertyValue("border-top")).toBe("");
  });
  it("keeps renderer disclosure buttons outside generic editor button styles", () => {
    const host = document.createElement("main");
    host.className = "workbench";
    host.innerHTML = '<button class="trace-card__toggle" disabled></button><button class="unsupported-card__toggle" disabled></button><button class="workbench-drag" disabled></button>';
    for (const selector of rules(inlineCss).filter((rule) => rule.selectorText.startsWith(".workbench button")).map((rule) => rule.selectorText)) {
      expect(host.children[0].matches(selector)).toBe(false);
      expect(host.children[1].matches(selector)).toBe(false);
    }
    const disabled = rules(inlineCss).find((rule) => rule.style.getPropertyValue("opacity") === "0.5")!;
    expect(host.children[2].matches(disabled.selectorText)).toBe(true);
    const toggle = rules(globalCss).find((rule) => rule.selectorText === ".trace-card__toggle")!.style;
    expect(toggle.getPropertyValue("min-height")).toBe("var(--size-touch-target)");
    expect(parseFloat(toggle.getPropertyValue("border"))).toBe(0);
  });
});
