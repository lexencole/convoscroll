/// <reference types="node" />
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { waitFor } from "@testing-library/react";
import { Editor } from "@tiptap/core";
import { createHighlighterCore, createCssVariablesTheme } from "@shikijs/core";
import { createOnigurumaEngine } from "@shikijs/engine-oniguruma";
import samples from "../../../fixtures/syntax/samples.json";
import { loadCodeLanguages, normalizeLanguage, supportedLanguages } from "../../renderer/code-languages";
import * as shared from "../../renderer/ShikiCodeBlock";
import { codeDecorations } from "./code-highlighting";
import { inlineExtensions } from "./inline-extensions";
import { editorToMarkdown, markdownToEditor } from "./markdown-adapter";

vi.unmock("@shikijs/core");
vi.unmock("@shikijs/engine-oniguruma");
vi.unmock("@shikijs/langs/python");
vi.unmock("@shikijs/langs/json");
vi.unmock("@shikijs/langs/typescript");

let highlighter: Awaited<ReturnType<typeof shared.getHighlighter>>;
beforeAll(async () => {
  highlighter = await createHighlighterCore({
    engine: createOnigurumaEngine(readFileSync(createRequire(import.meta.url).resolve("shiki/onig.wasm"))),
    langs: await loadCodeLanguages([...supportedLanguages]),
    themes: [createCssVariablesTheme({ name: shared.HIGHLIGHT_THEME, variablePrefix: "--syntax-", fontStyle: false })],
  });
});

function editorFor(source: string) {
  return new Editor({ extensions: inlineExtensions({ onReject: vi.fn(), onMath: vi.fn() }), content: markdownToEditor(source) });
}

describe("editing-time Shiki decorations", () => {
  it.each(Object.entries(samples))("highlights %s with real grammars and preserves all source text", (language, code) => {
    expect(supportedLanguages.has(language)).toBe(true);
    const lines = highlighter.codeToTokensBase(code, { lang: language, theme: shared.HIGHLIGHT_THEME });
    expect(lines.map(line => line.map(token => token.content).join("")).join("\n")).toBe(code);
    expect(new Set(lines.flat().map(token => token.color)).size).toBeGreaterThan(1);
    const editor = editorFor(`\`\`\`${language}\n${code}\n\`\`\``);
    try {
      const selection = editor.state.selection.toJSON();
      expect(codeDecorations(editor.state.doc, highlighter).find().filter(item => item.from > 0).length).toBeGreaterThan(1);
      expect(editor.state.doc.firstChild?.textContent).toBe(code);
      expect(editor.state.selection.toJSON()).toEqual(selection);
      expect(editorToMarkdown(editor.getJSON())).toContain(`\`\`\`${language}\n${code}`);
    } finally { editor.destroy(); }
  });
  it.each([['JS', 'javascript'], ['py', 'python'], [' TS ', 'typescript'], ['sh', 'bash'], ['shell', 'bash'], ['yml', 'yaml'], ['c++', 'cpp'], ['c#', 'csharp'], ['cs', 'csharp'], ['golang', 'go'], ['rs', 'rust'], ['md', 'markdown'], ['ps1', 'powershell']])("resolves language alias %s", (alias, canonical) => {
    expect(normalizeLanguage(alias)).toBe(canonical);
    const code = samples[canonical as keyof typeof samples];
    expect(highlighter.codeToHtml(code, { lang: normalizeLanguage(alias), theme: shared.HIGHLIGHT_THEME })).toContain("--syntax-");
  });

  it.each(["python", "ts", "json"])("uses real tokens without changing source or selection: %s", (language) => {
    const code = language === "json" ? '{"海": "🌊", "distance": 4.65}' : '# 海🌊\nvalue = "中文"\nprint(value)';
    const editor = editorFor(`\`\`\`${language}\n${code}\n\`\`\``);
    try {
      const before = editor.getJSON();
      const selection = editor.state.selection.toJSON();
      const decorations = codeDecorations(editor.state.doc, highlighter).find();
      const spans = decorations.filter((decoration) => decoration.from > 0);
      expect(spans.length).toBeGreaterThan(2);
      for (const span of spans) expect(span.to).toBeLessThanOrEqual(code.length + 1);
      expect(editor.getJSON()).toEqual(before);
      expect(editor.state.selection.toJSON()).toEqual(selection);
      expect(editor.state.doc.firstChild?.textContent).toBe(code);
    } finally { editor.destroy(); }
  });

  it("refreshes asynchronously, updates edited text and clears colors for unknown languages", async () => {
    const get = vi.spyOn(shared, "getHighlighter").mockResolvedValue(highlighter);
    const editor = editorFor('```python\nprint("海🌊")\n```');
    const onUpdate = vi.fn();
    editor.on("update", onUpdate);
    try {
      await waitFor(() => expect(editor.view.dom.querySelector("pre")).toHaveAttribute("data-highlight-state", "ready"));
      expect(editor.view.dom.querySelectorAll(".inline-code-token").length).toBeGreaterThan(1);
      expect(onUpdate).not.toHaveBeenCalled();
      editor.commands.setTextSelection({ from: 1, to: editor.state.doc.firstChild!.nodeSize - 1 });
      editor.commands.insertContent('print("另一片海")');
      expect(editor.view.dom.querySelector("code")?.textContent).toBe('print("另一片海")');
      expect(editor.view.dom.querySelectorAll(".inline-code-token").length).toBeGreaterThan(1);
      editor.commands.updateAttributes("codeBlock", { language: "unknown-language" });
      expect(editor.view.dom.querySelector("pre")).toHaveAttribute("data-code-language", "unknown-language · 纯文本");
      expect(editor.view.dom.querySelector(".inline-code-token")).toBeNull();
      expect(editorToMarkdown(editor.getJSON())).toContain('```unknown-language\nprint("另一片海")');
      editor.commands.updateAttributes("codeBlock", { language: "py" });
      expect(editor.view.dom.querySelector("pre")).toHaveAttribute("data-highlight-state", "ready");
      expect(editor.view.dom.querySelectorAll(".inline-code-token").length).toBeGreaterThan(1);
    } finally { editor.destroy(); get.mockRestore(); }
  });

  it("loads a newly selected language without changing text or adding history", async () => {
    const partial = await createHighlighterCore({
      engine: createOnigurumaEngine(readFileSync(createRequire(import.meta.url).resolve("shiki/onig.wasm"))),
      langs: await loadCodeLanguages(["python"]),
      themes: [createCssVariablesTheme({ name: shared.HIGHLIGHT_THEME, variablePrefix: "--syntax-", fontStyle: false })],
    });
    let finish: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => { finish = resolve; });
    const get = vi.spyOn(shared, "getHighlighter").mockImplementation(async (languages = []) => {
      if (languages.includes("json")) await gate;
      await partial.loadLanguage(...await loadCodeLanguages(languages));
      return partial;
    });
    const editor = editorFor('```python\nprint("hello")\n```');
    const onUpdate = vi.fn();
    try {
      await waitFor(() => expect(editor.view.dom.querySelector("pre")).toHaveAttribute("data-highlight-state", "ready"));
      editor.commands.setTextSelection(1);
      editor.commands.updateAttributes("codeBlock", { language: "json" });
      expect(editor.view.dom.querySelector("pre")).toHaveAttribute("data-highlight-state", "loading");
      editor.on("update", onUpdate);
      finish!();
      await waitFor(() => expect(editor.view.dom.querySelector("pre")).toHaveAttribute("data-highlight-state", "ready"));
      expect(get).toHaveBeenCalledWith(["json"]);
      expect(onUpdate).not.toHaveBeenCalled();
      expect(editor.getText()).toBe('print("hello")');
    } finally { editor.destroy(); get.mockRestore(); partial.dispose(); }
  });

  it("keeps empty code editable and failed loading harmless", async () => {
    const get = vi.spyOn(shared, "getHighlighter").mockRejectedValue(new Error("unavailable"));
    const editor = editorFor("```python\n```");
    try {
      await waitFor(() => expect(editor.view.dom.querySelector("pre")).toHaveAttribute("data-highlight-state", "fallback"));
      expect(editor.getText()).toBe("");
      editor.commands.insertContent("# 仍可输入");
      expect(editor.view.dom.querySelector("code")?.textContent).toBe("# 仍可输入");
    } finally { editor.destroy(); get.mockRestore(); }
  });
});
