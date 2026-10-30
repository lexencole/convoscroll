import { PngExportError } from "./export-types";

interface FontUse { family: string; text: string; weight: number; style: string }
const embeddedFonts = new Map<string, Promise<string>>();
const normalize = (value: string) => value.replace(/["']/g, "").trim().toLowerCase();

/** Match CSS unicode ranges without expanding the Chinese font's large slices. */
export function includesFontText(range: string, text: string): boolean {
  if (!range) return Boolean(text);
  const intervals = range.split(",").flatMap((part) => {
    const match = /^u\+([\da-f?]+)(?:-([\da-f]+))?$/i.exec(part.trim());
    if (!match) return [];
    return [[parseInt(match[1].replace(/\?/g, "0"), 16), parseInt(match[2] ?? match[1].replace(/\?/g, "f"), 16)]];
  });
  return [...text].some((character) => intervals.some(([start, end]) => character.codePointAt(0)! >= start && character.codePointAt(0)! <= end));
}

function canvasFontUses(element: HTMLElement): FontUse[] {
  const uses = new Map<string, FontUse>();
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    const text = node.textContent ?? "";
    if (!parent || !text.trim() || parent.closest('[data-ui-only], [hidden], script, style')) continue;
    let hidden = false;
    for (let ancestor: Element | null = parent; ancestor; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor);
      if (style.display === "none" || style.visibility === "hidden") { hidden = true; break; }
      if (ancestor === element) break;
    }
    if (hidden) continue;
    const style = getComputedStyle(parent);
    for (const family of style.fontFamily.split(",").map(normalize)) {
      const weight = style.fontWeight === "bold" ? 700 : Number(style.fontWeight) || 400;
      const key = `${family}:${weight}:${style.fontStyle}`;
      const previous = uses.get(key);
      if (previous) previous.text += text;
      else uses.set(key, { family, text, weight, style: style.fontStyle || "normal" });
    }
  }
  return [...uses.values()];
}

function faceIsUsed(face: FontFace, uses: FontUse[]) {
  const [min, max = min] = face.weight.split(/\s+/).map((weight) => weight === "bold" ? 700 : Number(weight) || 400);
  return uses.some((use) => use.family === normalize(face.family)
    // Normal faces may supply synthesized Chinese italics; true italic faces only supply italic text.
    && (face.style === "normal" || use.style.startsWith(face.style.split(" ")[0]))
    // Browser weight matching can select a nearby face, so a loaded static face is retained.
    && (min === max || (use.weight >= min && use.weight <= max))
    && includesFontText(face.unicodeRange, use.text));
}

function fontFailure(cause?: unknown) {
  return new PngExportError("font-load-failed", "字体没能加载完整，这次没有导出。", "检查网络后刷新页面，再试一次。", { cause });
}

export async function waitForCanvasFonts(element: HTMLElement) {
  const fonts = element.ownerDocument.fonts;
  if (!fonts) return;
  // Force the current presentation to resolve its fonts before awaiting the set.
  void element.offsetHeight;
  await fonts.ready;
  if (fonts.status !== "loaded") throw fontFailure();
  if (typeof fonts[Symbol.iterator] !== "function") return;
  const uses = canvasFontUses(element);
  if ([...fonts].some((face) => face.status === "error" && faceIsUsed(face, uses))) throw fontFailure();
}

function faceKey(family: string, weight: string, style: string, stretch: string, range: string) {
  return [normalize(family), weight === "normal" ? "400" : weight || "400", style || "normal",
    stretch === "100%" ? "normal" : stretch || "normal", (range || "U+0-10FFFF").replace(/\s/g, "").toLowerCase()].join("|");
}

function fontRules(document: Document): CSSFontFaceRule[] {
  const result: CSSFontFaceRule[] = [];
  const visited = new Set<CSSStyleSheet>();
  function read(sheet: CSSStyleSheet) {
    if (visited.has(sheet)) return;
    visited.add(sheet);
    function walk(rules: CSSRuleList) {
      for (const rule of rules) {
        if (rule.type === CSSRule.FONT_FACE_RULE) result.push(rule as CSSFontFaceRule);
        else if (rule.type === CSSRule.IMPORT_RULE) {
          const imported = (rule as CSSImportRule).styleSheet;
          if (imported) read(imported);
        } else if ("cssRules" in rule) walk((rule as CSSGroupingRule).cssRules);
      }
    }
    try { walk(sheet.cssRules); } catch (cause) {
      // Browser extensions can add unreadable stylesheets. They are unrelated to
      // the local fonts; the loaded-face check below still rejects a missing rule.
      if (!(cause instanceof DOMException && cause.name === "SecurityError")) throw fontFailure(cause);
    }
  }
  for (const sheet of document.styleSheets) read(sheet);
  return result;
}

function embed(url: string, signal?: AbortSignal) {
  const existing = embeddedFonts.get(url);
  if (existing) return existing;
  const loading = fetch(url, { signal }).then(async (response) => {
    if (!response.ok) throw new Error(`Font response: ${response.status}`);
    const blob = await response.blob();
    if (!blob.size) throw new Error("Empty font");
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }).catch((error) => { embeddedFonts.delete(url); throw error; });
  embeddedFonts.set(url, loading);
  return loading;
}

/** The screenshot library's cssText path expects already embedded data URLs. */
export async function embedCanvasFonts(element: HTMLElement, signal?: AbortSignal): Promise<string> {
  const fonts = element.ownerDocument.fonts;
  if (!fonts || typeof fonts[Symbol.iterator] !== "function") return "";
  const uses = canvasFontUses(element);
  const loaded = new Set([...fonts].filter((face) => face.status === "loaded" && faceIsUsed(face, uses))
    .map((face) => faceKey(face.family, face.weight, face.style, face.stretch, face.unicodeRange)));
  try {
    const rules = fontRules(element.ownerDocument).filter((rule) => {
      const value = (property: string) => rule.style.getPropertyValue(property);
      return loaded.has(faceKey(value("font-family"), value("font-weight"), value("font-style"), value("font-stretch"), value("unicode-range")));
    });
    const matched = new Set(rules.map((rule) => {
      const value = (property: string) => rule.style.getPropertyValue(property);
      return faceKey(value("font-family"), value("font-weight"), value("font-style"), value("font-stretch"), value("unicode-range"));
    }));
    if ([...loaded].some((key) => !matched.has(key))) throw new Error("Loaded font has no embeddable rule");
    const embedded = await Promise.all(rules.map(async (rule) => {
      const source = rule.style.getPropertyValue("src");
      const urls = [...source.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((match) => match[1]);
      const raw = urls.find((url) => /\.woff2(?:[?#]|$)|^data:font\/woff2/.test(url)) ?? urls[0];
      if (!raw) throw new Error("Font source missing");
      const url = new URL(raw, rule.parentStyleSheet?.href ?? element.ownerDocument.baseURI);
      if (url.protocol !== "data:" && url.origin !== element.ownerDocument.location.origin) throw new Error("Font must be local");
      const data = url.protocol === "data:" ? url.href : await embed(url.href, signal);
      const declarations = Array.from(rule.style).filter((property) => property !== "src" && property !== "font-display")
        .map((property) => `${property}:${rule.style.getPropertyValue(property)};`).join("");
      return `@font-face{${declarations}src:url("${data}");}`;
    }));
    return embedded.join("\n");
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw fontFailure(cause);
  }
}
