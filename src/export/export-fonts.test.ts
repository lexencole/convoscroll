import { afterEach, describe, expect, it, vi } from "vitest";
import { embedCanvasFonts, includesFontText, waitForCanvasFonts } from "./export-fonts";

const originalFonts = Object.getOwnPropertyDescriptor(document, "fonts");
afterEach(() => {
  document.head.querySelectorAll("style[data-font-test]").forEach((node) => node.remove());
  document.body.innerHTML = "";
  if (originalFonts) Object.defineProperty(document, "fonts", originalFonts);
  else Reflect.deleteProperty(document, "fonts");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function face(family: string, status: FontFaceLoadStatus, unicodeRange = "U+0-10FFFF", style = "normal") {
  return { family, status, unicodeRange, style, weight: "400", stretch: "normal" } as FontFace;
}
function fonts(faces: FontFace[]) {
  Object.defineProperty(document, "fonts", { configurable: true, value: {
    ready: Promise.resolve(), status: "loaded", [Symbol.iterator]: () => faces[Symbol.iterator](),
  } });
}
function target(text: string) {
  const element = document.createElement("section");
  element.style.fontFamily = '"Geist Variable", "Noto Sans SC Variable"';
  element.append(text);
  document.body.append(element);
  return element;
}
// jsdom does not parse src/unicode-range descriptors; browser checks cover the real CSSOM.
function stylesheet(entries: Record<string, string>[], unreadable = false) {
  vi.spyOn(document, "styleSheets", "get").mockReturnValue([{ cssRules: entries.map((entry) => ({
    type: CSSRule.FONT_FACE_RULE,
    style: { ...Object.keys(entry), length: Object.keys(entry).length, getPropertyValue: (name: string) => entry[name] ?? "" },
  })) }, ...(unreadable ? [{ get cssRules() { throw new DOMException("Extension stylesheet is not readable", "SecurityError"); } }] : [])] as unknown as StyleSheetList);
}

describe("local canvas fonts", () => {
  it("matches ranges, wildcards and supplementary characters without splitting surrogate pairs", () => {
    expect(includesFontText("U+4E00-9FFF, U+20000-2FFFF", "𠮷")).toBe(true);
    expect(includesFontText("U+4E??", "一")).toBe(true);
    expect(includesFontText("U+0-FF", "你好")).toBe(false);
  });
  it("rejects a failed face used in the canvas, but ignores hidden or unrelated text", async () => {
    fonts([face("Geist Variable", "error", "U+0-FF"), face("Other", "error")]);
    const element = target("文字");
    const hidden = document.createElement("span"); hidden.hidden = true; hidden.textContent = "English"; element.append(hidden);
    await expect(waitForCanvasFonts(element)).resolves.toBeUndefined();
    element.append("English");
    await expect(waitForCanvasFonts(element)).rejects.toMatchObject({ code: "font-load-failed" });
  });
  it("embeds only loaded matching slices, retaining KaTeX and true italic faces", async () => {
    fonts([face("Geist Variable", "loaded", "U+0-FF"), face("Geist Variable", "loaded", "U+0-FF", "italic"),
      face("Noto Sans SC Variable", "unloaded", "U+4E00-9FFF"), face("KaTeX_Main", "loaded")]);
    stylesheet([
      { "font-family": "Geist Variable", src: 'url("data:font/woff2;base64,AAA=")', "unicode-range": "U+0-FF" },
      { "font-family": "Geist Variable", "font-style": "italic", src: 'url("data:font/woff2;base64,AAB=")', "unicode-range": "U+0-FF" },
      { "font-family": "Noto Sans SC Variable", src: 'url("/should-not-fetch.woff2")', "unicode-range": "U+4E00-9FFF" },
      { "font-family": "KaTeX_Main", src: 'url("data:font/woff2;base64,AAC=")' },
    ]);
    const element = target("Hello 一");
    const italic = document.createElement("em"); italic.style.fontFamily = '"Geist Variable"'; italic.style.fontStyle = "italic"; italic.textContent = "Italic"; element.append(italic);
    const math = document.createElement("span"); math.style.fontFamily = "KaTeX_Main"; math.textContent = "x"; element.append(math);
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const css = await embedCanvasFonts(element);
    expect(css.match(/@font-face/g)).toHaveLength(3);
    expect(css).toContain("KaTeX_Main");
    expect(css).toContain("font-style:italic");
    expect(css).not.toContain("Noto");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("reports a failed local font fetch and permits retry instead of caching the failure", async () => {
    fonts([face("Geist Variable", "loaded", "U+0-FF")]);
    stylesheet([{ "font-family": "Geist Variable", src: 'url("/retry-test.woff2")', "unicode-range": "U+0-FF" }]);
    const fetcher = vi.fn().mockResolvedValueOnce({ ok: false, status: 503 }).mockResolvedValueOnce({ ok: true, blob: async () => new Blob(["font"], { type: "font/woff2" }) });
    vi.stubGlobal("fetch", fetcher);
    const element = target("Hello");
    await expect(embedCanvasFonts(element)).rejects.toMatchObject({ code: "font-load-failed" });
    await expect(embedCanvasFonts(element)).resolves.toContain("data:font/woff2;base64,");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("ignores an unreadable extension stylesheet while requiring every used font rule", async () => {
    fonts([face("Geist Variable", "loaded", "U+0-FF")]);
    stylesheet([{ "font-family": "Geist Variable", src: 'url("data:font/woff2;base64,AAA=")', "unicode-range": "U+0-FF" }], true);
    const element = target("Hello");
    await expect(embedCanvasFonts(element)).resolves.toContain("Geist Variable");
    stylesheet([], true);
    await expect(embedCanvasFonts(element)).rejects.toMatchObject({ code: "font-load-failed" });
  });
});
