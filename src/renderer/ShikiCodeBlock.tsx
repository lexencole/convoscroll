import { useEffect, useState } from "react";
import { loadCodeLanguages, normalizeLanguage, supportedLanguages } from "./code-languages";
export { normalizeLanguage, supportedLanguages } from "./code-languages";
import onigurumaWasmUrl from "shiki/onig.wasm?url";

interface ShikiCodeBlockProps {
  readonly code: string;
  readonly language?: string;
}

interface HighlightCacheEntry {
  readonly code: string;
  readonly pending: Promise<string>;
  weight: number;
}

const highlightedCode = new Map<string, HighlightCacheEntry>();
export const HIGHLIGHT_THEME = "conversation-neutral";
const HIGHLIGHT_CACHE_LIMIT = 64;
const HIGHLIGHT_CACHE_CHARACTER_BUDGET = 256 * 1024;
let highlightedCodeWeight = 0;

async function createHighlighter() {
  const [core, engine] = await Promise.all([
    import("@shikijs/core"),
    import("@shikijs/engine-oniguruma"),
  ]);
  const theme = core.createCssVariablesTheme({
    name: HIGHLIGHT_THEME,
    variablePrefix: "--syntax-",
    fontStyle: false,
  });

  return core.createHighlighterCore({
    engine: engine.createOnigurumaEngine(() => fetch(onigurumaWasmUrl)),
    langs: [],
    themes: [theme],
  });
}

type ShikiHighlighter = Awaited<ReturnType<typeof createHighlighter>>;

let highlighter: Promise<ShikiHighlighter> | undefined;

const languageLoads = new Map<string, Promise<void>>();

export async function getHighlighter(languages: readonly string[] = []): Promise<ShikiHighlighter> {
  if (!highlighter) {
    const pending = createHighlighter();
    highlighter = pending;
    void pending.catch(() => {
      if (highlighter === pending) highlighter = undefined;
    });
  }
  const instance = await highlighter;
  await Promise.all([...new Set(languages.map(normalizeLanguage))].map(async (language) => {
    if (!supportedLanguages.has(language) || instance.getLoadedLanguages().includes(language)) return;
    let pending = languageLoads.get(language);
    if (!pending) {
      pending = loadCodeLanguages([language]).then((grammars) => instance.loadLanguage(...grammars));
      languageLoads.set(language, pending);
      void pending.catch(() => {
        if (languageLoads.get(language) === pending) languageLoads.delete(language);
      });
    }
    await pending;
  }));
  return instance;
}

function removeHighlight(cacheKey: string, expected?: HighlightCacheEntry) {
  const cached = highlightedCode.get(cacheKey);
  if (!cached || (expected && cached !== expected)) return;

  highlightedCode.delete(cacheKey);
  highlightedCodeWeight -= cached.weight;
}

function trimHighlightCache() {
  while (
    highlightedCode.size > HIGHLIGHT_CACHE_LIMIT ||
    highlightedCodeWeight > HIGHLIGHT_CACHE_CHARACTER_BUDGET
  ) {
    const oldestKey = highlightedCode.keys().next().value;
    if (oldestKey === undefined) break;
    removeHighlight(oldestKey);
  }
}

function hashCode(code: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < code.length; index += 1) {
    hash ^= code.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return `${code.length.toString(36)}-${(hash >>> 0).toString(36)}`;
}

function cachedHighlight(cacheKey: string, code: string): Promise<string> | undefined {
  const cached = highlightedCode.get(cacheKey);
  if (!cached || cached.code !== code) return undefined;

  highlightedCode.delete(cacheKey);
  highlightedCode.set(cacheKey, cached);
  return cached.pending;
}

function rememberHighlight(cacheKey: string, code: string, pending: Promise<string>) {
  if (code.length > HIGHLIGHT_CACHE_CHARACTER_BUDGET) return;

  removeHighlight(cacheKey);
  const entry: HighlightCacheEntry = { code, pending, weight: code.length };
  highlightedCode.set(cacheKey, entry);
  highlightedCodeWeight += entry.weight;
  trimHighlightCache();

  void pending.then(
    (html) => {
      if (highlightedCode.get(cacheKey) !== entry) return;

      entry.weight += html.length;
      highlightedCodeWeight += html.length;
      trimHighlightCache();
    },
    () => removeHighlight(cacheKey, entry),
  );
}

function highlight(code: string, language: string): Promise<string> {
  const cacheKey = `${language}\u0000${HIGHLIGHT_THEME}\u0000${hashCode(code)}`;
  const cached = cachedHighlight(cacheKey, code);
  if (cached) return cached;

  const pending = supportedLanguages.has(language)
    ? getHighlighter([language]).then((instance) =>
        instance.codeToHtml(code, { lang: language, theme: HIGHLIGHT_THEME }),
      )
    : Promise.resolve(
        `<pre class="shiki"><code>${code
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")}</code></pre>`,
      );
  rememberHighlight(cacheKey, code, pending);
  return pending;
}

export function ShikiCodeBlock({ code, language }: ShikiCodeBlockProps) {
  const normalizedLanguage = normalizeLanguage(language);
  const [html, setHtml] = useState<string>();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setHtml(undefined);
    setFailed(false);

    void highlight(code, normalizedLanguage)
      .then((result) => {
        if (active) setHtml(result);
      })
      .catch(() => {
        if (active) setFailed(true);
      });

    return () => {
      active = false;
    };
  }, [code, normalizedLanguage]);

  return (
    <figure
      className="code-block"
      data-highlight-state={html ? "ready" : failed ? "fallback" : "loading"}
    >
      <figcaption>{normalizedLanguage}</figcaption>
      {html ? (
        <div className="code-block__highlight" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="code-block__fallback">
          <code>{code}</code>
        </pre>
      )}
    </figure>
  );
}
