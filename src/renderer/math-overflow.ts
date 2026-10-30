import { canvasLocale } from "../i18n/locale";
import { translator } from "../i18n/messages";

export const MINIMUM_MATH_SCALE = 0.85;

export type MathOverflowState = "fit" | "scaled" | "fallback";

export interface MathOverflowDecision {
  readonly scale: number;
  readonly state: MathOverflowState;
}

export function decideMathOverflow(
  naturalWidth: number,
  availableWidth: number,
  minimumScale = MINIMUM_MATH_SCALE,
): MathOverflowDecision {
  if (
    !Number.isFinite(naturalWidth)
    || !Number.isFinite(availableWidth)
    || naturalWidth <= 0
    || availableWidth <= 0
    || naturalWidth <= availableWidth
  ) {
    return { scale: 1, state: "fit" };
  }

  const requiredScale = availableWidth / naturalWidth;
  if (requiredScale >= minimumScale) {
    return { scale: requiredScale, state: "scaled" };
  }

  return { scale: requiredScale, state: "fallback" };
}

const OVERFLOW_CLASSES = [
  "math-overflow--promoted",
  "math-overflow--scaled",
  "math-overflow--fallback",
] as const;

const TRAILING_PUNCTUATION = /^([。.，,；;：:！？!?、…]+)/;
const TRAILING_PUNCTUATION_CLASS = "math-overflow__trailing-punctuation";

function restoreTrailingPunctuation(element: HTMLElement) {
  const punctuation = element.dataset.mathTrailingPunctuation;
  if (!punctuation) return;

  element.querySelector(`:scope > .${TRAILING_PUNCTUATION_CLASS}`)?.remove();

  const nextSibling = element.nextSibling;
  if (nextSibling?.nodeType === Node.TEXT_NODE) {
    nextSibling.textContent = `${punctuation}${nextSibling.textContent ?? ""}`;
  } else {
    element.parentNode?.insertBefore(document.createTextNode(punctuation), nextSibling);
  }

  element.removeAttribute("data-math-trailing-punctuation");
}

function moveTrailingPunctuation(element: HTMLElement) {
  const nextSibling = element.nextSibling;
  if (nextSibling?.nodeType !== Node.TEXT_NODE) return;

  const text = nextSibling.textContent ?? "";
  const match = TRAILING_PUNCTUATION.exec(text);
  const punctuation = match?.[1];
  if (!punctuation) return;

  nextSibling.textContent = text.slice(punctuation.length);
  element.dataset.mathTrailingPunctuation = punctuation;

  const marker = document.createElement("span");
  marker.className = TRAILING_PUNCTUATION_CLASS;
  marker.textContent = punctuation;
  element.append(marker);
}

function resetMathElement(element: HTMLElement) {
  restoreTrailingPunctuation(element);
  element.classList.remove(...OVERFLOW_CLASSES);
  element.style.removeProperty("font-size");
  element.removeAttribute("aria-label");
  element.removeAttribute("data-math-scale");
  element.removeAttribute("data-math-layout");
  element.removeAttribute("data-math-overflow");
  element.removeAttribute("title");
}

export function measureMathOverflow(root: HTMLElement) {
  const t = translator(canvasLocale(root.closest("[lang]")?.getAttribute("lang") ?? undefined));
  const mathElements = root.querySelectorAll<HTMLElement>(".katex[data-math-index]");
  const rootVisualWidth = root.getBoundingClientRect().width;
  const rootLayoutWidth = root.clientWidth;
  const previewScale = rootLayoutWidth > 0 && rootVisualWidth > 0
    ? rootVisualWidth / rootLayoutWidth
    : 1;
  const toLayoutWidth = (visualWidth: number) => visualWidth / previewScale;

  mathElements.forEach((element) => resetMathElement(element));

  mathElements.forEach((element) => {
    const display = element.dataset.mathDisplay === "true";
    const container = display ? element.closest<HTMLElement>(".katex-display") : root;
    const availableWidth = container?.clientWidth ?? root.clientWidth;
    const inlineBoxes = display ? [] : Array.from(element.getClientRects());
    const shouldPromote = !display && (
      inlineBoxes.length > 1
      || toLayoutWidth(element.getBoundingClientRect().width) > availableWidth
    );

    if (shouldPromote) element.classList.add("math-overflow--promoted");

    const naturalWidth = Math.max(
      toLayoutWidth(element.getBoundingClientRect().width),
      element.scrollWidth,
    );
    const decision = decideMathOverflow(naturalWidth, availableWidth);

    const promoted = shouldPromote || (!display && decision.state !== "fit");
    if (promoted && !shouldPromote) element.classList.add("math-overflow--promoted");
    if (promoted) moveTrailingPunctuation(element);

    element.dataset.mathLayout = promoted ? "promoted" : display ? "display" : "inline";
    element.dataset.mathOverflow = decision.state;
    element.dataset.mathScale = decision.scale.toFixed(3);

    if (decision.state === "fit") {
      if (shouldPromote) element.title = t("公式太长，单独放一行");
      return;
    }
    if (decision.state === "scaled") {
      element.classList.add("math-overflow--scaled");
      element.style.fontSize = `${decision.scale}em`;
      element.title = t("公式缩小到 {0}%", Math.round(decision.scale * 100));
      return;
    }

    const source = element.dataset.mathSource ?? "";
    element.classList.add("math-overflow--fallback");
    element.setAttribute("aria-label", t("公式太宽，显示原文：{0}", source));
    element.title = t("公式太宽，改为显示原文");
  });
}
