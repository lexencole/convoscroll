import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Vitest keeps Node's existing global localStorage on newer Node versions.
// Always use this test environment's browser storage, including its Storage prototype.
const browserWindow = (globalThis as unknown as { jsdom: { window: Window } }).jsdom.window;
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  get: () => browserWindow.localStorage,
});

afterEach(() => cleanup());

class ResizeObserverMock implements ResizeObserver {
  disconnect = vi.fn();
  observe = vi.fn();
  unobserve = vi.fn();
}

vi.stubGlobal("ResizeObserver", ResizeObserverMock);

if (!("arrayBuffer" in Blob.prototype)) {
  Object.defineProperty(Blob.prototype, "arrayBuffer", {
    configurable: true,
    value(this: Blob) {
      return new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(this);
      });
    },
  });
}

vi.mock("@shikijs/core", () => ({
  createCssVariablesTheme: vi.fn(() => ({ name: "conversation-neutral" })),
  createHighlighterCore: vi.fn(async () => ({
    getLoadedLanguages: vi.fn(() => []),
    loadLanguage: vi.fn(async () => undefined),
    codeToHtml: vi.fn((code: string) => {
    const escaped = code
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
    return `<pre class="shiki"><code>${escaped}</code></pre>`;
    }),
  })),
}));

vi.mock("@shikijs/engine-oniguruma", () => ({
  createOnigurumaEngine: vi.fn(async () => ({})),
}));
vi.mock("@shikijs/langs/json", () => ({ default: [] }));
vi.mock("@shikijs/langs/python", () => ({ default: [] }));
vi.mock("@shikijs/langs/typescript", () => ({ default: [] }));
