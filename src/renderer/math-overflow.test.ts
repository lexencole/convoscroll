import { describe, expect, it } from "vitest";
import { decideMathOverflow, measureMathOverflow } from "./math-overflow";

describe("math overflow", () => {
  it("keeps fitting formulas at their authored size", () => {
    expect(decideMathOverflow(380, 400)).toEqual({ scale: 1, state: "fit" });
  });

  it("allows mild scaling but rejects scaling below 85 percent", () => {
    const scaled = decideMathOverflow(440, 400);
    const fallback = decideMathOverflow(500, 400);

    expect(scaled.state).toBe("scaled");
    expect(scaled.scale).toBeCloseTo(0.909, 3);
    expect(fallback).toEqual({ scale: 0.8, state: "fallback" });
  });

  it("promotes an overlong inline formula and exposes a visible fallback state", () => {
    const root = document.createElement("div");
    const formula = document.createElement("span");
    root.className = "markdown-body";
    formula.className = "katex";
    formula.dataset.mathDisplay = "false";
    formula.dataset.mathIndex = "0";
    formula.dataset.mathSource = String.raw`\mathrm{oneUnbreakableFormula}`;
    root.append(formula);

    Object.defineProperty(root, "clientWidth", { configurable: true, value: 400 });
    formula.getBoundingClientRect = () => ({
      bottom: 20,
      height: 20,
      left: 0,
      right: 500,
      toJSON: () => ({}),
      top: 0,
      width: 500,
      x: 0,
      y: 0,
    });

    measureMathOverflow(root);

    expect(formula).toHaveAttribute("data-math-overflow", "fallback");
    expect(formula).toHaveClass("math-overflow--promoted", "math-overflow--fallback");
    expect(formula).toHaveAttribute(
      "aria-label",
      "公式太宽，显示原文：\\mathrm{oneUnbreakableFormula}",
    );
  });

  it("promotes a wrapped inline formula before deciding whether it needs scaling", () => {
    const root = document.createElement("div");
    const formula = document.createElement("span");
    const punctuation = document.createTextNode("。后续文字");
    formula.className = "katex";
    formula.dataset.mathDisplay = "false";
    formula.dataset.mathIndex = "0";
    root.append(formula, punctuation);

    Object.defineProperty(root, "clientWidth", { configurable: true, value: 400 });
    formula.getClientRects = () => [
      { width: 300 } as DOMRect,
      { width: 80 } as DOMRect,
    ] as unknown as DOMRectList;
    formula.getBoundingClientRect = () => ({
      bottom: 20,
      height: 20,
      left: 0,
      right: formula.classList.contains("math-overflow--promoted") ? 360 : 300,
      toJSON: () => ({}),
      top: 0,
      width: formula.classList.contains("math-overflow--promoted") ? 360 : 300,
      x: 0,
      y: 0,
    });

    measureMathOverflow(root);

    expect(formula).toHaveClass("math-overflow--promoted");
    expect(formula).toHaveAttribute("data-math-layout", "promoted");
    expect(formula).toHaveAttribute("data-math-overflow", "fit");
    expect(formula).toHaveAttribute("title", "公式太长，单独放一行");
    expect(formula.querySelector(".math-overflow__trailing-punctuation")).toHaveTextContent("。");
    expect(punctuation.textContent).toBe("后续文字");

    measureMathOverflow(root);

    expect(formula.querySelectorAll(".math-overflow__trailing-punctuation")).toHaveLength(1);
    expect(punctuation.textContent).toBe("后续文字");
  });

  it("measures formula width in canvas coordinates inside a scaled preview", () => {
    const root = document.createElement("div");
    const formula = document.createElement("span");
    root.className = "markdown-body";
    formula.className = "katex";
    formula.dataset.mathDisplay = "false";
    formula.dataset.mathIndex = "0";
    root.append(formula);

    Object.defineProperty(root, "clientWidth", { configurable: true, value: 400 });
    root.getBoundingClientRect = () => ({
      bottom: 320,
      height: 20,
      left: 0,
      right: 320,
      toJSON: () => ({}),
      top: 0,
      width: 320,
      x: 0,
      y: 0,
    });
    formula.getBoundingClientRect = () => ({
      bottom: 20,
      height: 20,
      left: 0,
      right: 352,
      toJSON: () => ({}),
      top: 0,
      width: 352,
      x: 0,
      y: 0,
    });

    measureMathOverflow(root);

    expect(formula).toHaveClass("math-overflow--promoted", "math-overflow--scaled");
    expect(formula).toHaveAttribute("data-math-overflow", "scaled");
    expect(formula).toHaveAttribute("data-math-scale", "0.909");
  });

  it("scales a mildly overwide display formula without crossing the minimum", () => {
    const root = document.createElement("div");
    const display = document.createElement("div");
    const formula = document.createElement("span");
    display.className = "katex-display";
    formula.className = "katex";
    formula.dataset.mathDisplay = "true";
    formula.dataset.mathIndex = "0";
    display.append(formula);
    root.append(display);

    Object.defineProperty(display, "clientWidth", { configurable: true, value: 400 });
    Object.defineProperty(formula, "scrollWidth", { configurable: true, value: 440 });
    formula.getBoundingClientRect = () => ({
      bottom: 20,
      height: 20,
      left: 0,
      right: 400,
      toJSON: () => ({}),
      top: 0,
      width: 400,
      x: 0,
      y: 0,
    });

    measureMathOverflow(root);

    expect(formula).toHaveClass("math-overflow--scaled");
    expect(formula).toHaveAttribute("data-math-overflow", "scaled");
    expect(formula).toHaveAttribute("data-math-scale", "0.909");
    expect(formula.style.fontSize).toBe("0.9090909090909091em");
  });
});
