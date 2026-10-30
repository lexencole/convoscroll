import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../app/App";
import { sample } from "../app/sample-document";
import type { ConversationDocument } from "../data/conversation-types";
import { loadConversationDocument } from "../data/document-loader";
import { addMessage, createBlock, createEmptyDocument } from "../editor/document-operations";
import { MemoryProjectStore } from "../persistence/project-store";
import { exportProjectPackage, sha256Hex } from "../project/project-export";
import { importProjectPackage } from "../project/project-import";
import { importMarkdown } from "../project/markdown-import";
import { prepareImportFile } from "../project/prepare-import";
import { ProjectFormatError } from "../project/project-format";
import { diagnosticDetails, projectErrorPresentation, readableDiagnostic } from "../app/error-presentation";
import { ConversationCanvas } from "../renderer/ConversationCanvas";
import { browserLocale, canvasLocale } from "./locale";
import { initialUiLocale, UI_LOCALE_KEY, UiLocaleProvider, useUiLocale } from "./LocaleContext";
import { message, translator } from "./messages";
import english from "./en.json";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

const savedDocument: ConversationDocument = {
  ...createEmptyDocument(),
  metadata: { title: "保留标题 {0}", locale: "zh-CN" },
  messages: [{ id: "user-test", role: "user", displayName: "用户", status: "complete", blocks: [
    { id: "body-test", type: "markdown", source: "原文 English 正文" },
  ] }],
};

afterEach(() => { vi.restoreAllMocks(); localStorage.clear(); });
function chooseUiLanguage(current: "en" | "zh-CN") {
  fireEvent.click(screen.getByRole("button", { name: current === "en" ? "Document" : "文档" }));
  fireEvent.click(screen.getByRole("menuitem", { name: current === "en" ? "Language · 简体中文" : "语言 · English" }));
}
async function storedApp(initialLocale: "en" | "zh-CN" = "en", document = savedDocument) {
  const store = new MemoryProjectStore();
  await store.saveDocument(document, "2026-01-15T08:00:00Z");
  const save = vi.spyOn(store, "saveDocument");
  const load = vi.spyOn(store, "loadCurrentProject");
  const view = render(<UiLocaleProvider initialLocale={initialLocale}><App store={store} showDevelopmentTools={false} /></UiLocaleProvider>);
  await screen.findByTestId("conversation-canvas");
  return { ...view, store, save, load };
}

describe("independent interface and image languages", () => {
  it("keeps the unnamed title in the image language while editing and previewing", async () => {
    await storedApp("en", { ...savedDocument, metadata: { locale: "zh-CN" } });
    expect(screen.getByRole("button", { name: "Edit title" })).toHaveTextContent("未命名对话");
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(screen.getByTestId("conversation-canvas").querySelector("h1")).toHaveTextContent("未命名对话");
  });
  it("switches an active editor without changing the document, remounting it or reloading storage", async () => {
    const { store, save, load } = await storedApp();
    expect(screen.getByTestId("conversation-canvas")).toHaveAttribute("lang", "zh-CN");
    fireEvent.keyDown(screen.getByRole("button", { name: "Edit message: 1" }), { key: "Enter" });
    const editor = await screen.findByRole("textbox", { name: "Edit message inline: 1" });
    const loadedBefore = load.mock.calls.length;
    chooseUiLanguage("en");
    expect(screen.getByRole("textbox", { name: "直接编辑消息正文：1" })).toBe(editor);
    expect(editor).toHaveTextContent("原文 English 正文");
    expect(load).toHaveBeenCalledTimes(loadedBefore);
    expect(save).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "撤销" })).toBeDisabled();
    expect((await store.loadCurrentProject())?.document).toEqual(savedDocument);
    expect(localStorage.getItem(UI_LOCALE_KEY)).toBe("zh-CN");
  });

  it("keeps composition protected while switching is unavailable", async () => {
    await storedApp();
    fireEvent.keyDown(screen.getByRole("button", { name: "Edit message: 1" }), { key: "Enter" });
    const editor = await screen.findByRole("textbox", { name: "Edit message inline: 1" });
    fireEvent.compositionStart(editor);
    expect(screen.getByRole("button", { name: "Document" })).toBeDisabled();
    fireEvent.compositionEnd(editor);
    await waitFor(() => expect(screen.getByRole("button", { name: "Document" })).toBeEnabled());
    chooseUiLanguage("en");
    expect(screen.getByRole("textbox", { name: "直接编辑消息正文：1" })).toHaveTextContent("原文 English 正文");
  });

  it("saves image language, preserves user text, and keeps undo after an interface switch", async () => {
    const { store, container } = await storedApp();
    fireEvent.click(screen.getByRole("button", { name: "Document" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Title and description" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Image language" }));
    fireEvent.click(screen.getByRole("option", { name: "English" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Done" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(async () => expect(((await store.loadCurrentProject())?.document as ConversationDocument).metadata.locale).toBe("en"));
    expect(container.querySelector(".message__identity small")).toHaveTextContent("User");
    expect(container.querySelector(".message__identity strong")).toHaveTextContent("用户");
    expect(container.querySelector(".message__status")).toHaveTextContent("Completed");
    expect(screen.getByRole("button", { name: "Edit title" })).toHaveTextContent(savedDocument.metadata.title!);
    chooseUiLanguage("en");
    expect(screen.getByTestId("conversation-canvas")).toHaveAttribute("lang", "en");
    fireEvent.click(screen.getByRole("button", { name: "撤销" }));
    await waitFor(async () => expect((await store.loadCurrentProject())?.document).toEqual(savedDocument));
    expect(screen.getByTestId("conversation-canvas")).toHaveAttribute("lang", "zh-CN");
  });

  it("freezes the initial sample until an explicit load and creates documents in the interface language", async () => {
    render(<UiLocaleProvider initialLocale="en"><App store={new MemoryProjectStore()} showDevelopmentTools={false} /></UiLocaleProvider>);
    await screen.findByTestId("conversation-canvas");
    const title = sample("basic", "en").metadata.title!;
    expect(screen.getByRole("button", { name: "Edit title" })).toHaveTextContent(title);
    chooseUiLanguage("en");
    expect(screen.getByRole("button", { name: "编辑标题" })).toHaveTextContent(title);
    expect(screen.getByTestId("conversation-canvas")).toHaveAttribute("lang", "en");
    fireEvent.click(screen.getByRole("button", { name: "文档" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "载入简洁示例" }));
    expect(screen.getByTestId("conversation-canvas")).toHaveAttribute("lang", "zh-CN");
    chooseUiLanguage("zh-CN");
    fireEvent.click(screen.getByRole("button", { name: "Document" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "New conversation" }));
    expect(screen.getByTestId("conversation-canvas")).toHaveAttribute("lang", "en");
    expect(screen.getByRole("button", { name: "Edit title" })).toHaveTextContent("Untitled conversation");
    fireEvent.click(screen.getByRole("button", { name: "User message" }));
    expect(screen.getByRole("button", { name: "Edit identity: Me" })).toBeInTheDocument();
  });

  it("loads the story in the interface language and retains it across language switches", async () => {
    await storedApp("en");
    fireEvent.click(screen.getByRole("button", { name: "Document" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Load story sample" }));
    expect(screen.getByRole("button", { name: "Edit title" })).toHaveTextContent("Slow Resurrection: A Feasibility Study");
    expect(screen.getByTestId("conversation-canvas")).toHaveAttribute("lang", "en");
    chooseUiLanguage("en");
    expect(screen.getByRole("button", { name: "编辑标题" })).toHaveTextContent("Slow Resurrection: A Feasibility Study");
    expect(screen.getByTestId("conversation-canvas")).toHaveAttribute("lang", "en");
    fireEvent.click(screen.getByRole("button", { name: "文档" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "载入故事示例" }));
    expect(screen.getByRole("button", { name: "编辑标题" })).toHaveTextContent("慢性复活可行性研究");
    expect(screen.getByTestId("conversation-canvas")).toHaveAttribute("lang", "zh-CN");
  });

  it("retains an unsupported saved locale when opening and closing settings", async () => {
    const original = { ...savedDocument, metadata: { ...savedDocument.metadata, locale: "ja-JP" } };
    const { store, save } = await storedApp("en", original);
    fireEvent.click(screen.getByRole("button", { name: "Document" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Title and description" }));
    expect(screen.getByRole("combobox", { name: "Image language" })).toHaveTextContent("ja-JP");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(save).not.toHaveBeenCalled();
    expect((await store.loadCurrentProject())?.document).toEqual(original);
  });

  it("renders concurrent canvases independently of the interface and preserves custom labels", () => {
    const doc = { ...savedDocument, messages: [{ ...savedDocument.messages[0], blocks: [
      { id: "missing", type: "file" as const, assetId: "missing-file", label: "文件找不到" },
      { id: "unknown", type: "unsupported" as const, originalType: "future", reason: "这个版本还不支持这种内容。", raw: {} },
    ] }] };
    render(<UiLocaleProvider initialLocale="en"><ConversationCanvas document={doc} /><ConversationCanvas document={{ ...doc, metadata: { ...doc.metadata, locale: "en-GB" } }} /></UiLocaleProvider>);
    const [zh, en] = screen.getAllByTestId("conversation-canvas");
    expect(zh).toHaveTextContent("找不到文件：missing-file");
    expect(en).toHaveTextContent("File not found: missing-file");
    expect(within(en).getByText("文件找不到")).toBeInTheDocument();
    expect(within(en).getByText("这个版本还不支持这种内容。")).toBeInTheDocument();
    expect(zh.querySelector(".message__status")).toHaveTextContent("已完成");
    expect(en.querySelector(".message__status")).toHaveTextContent("Completed");
  });
});

describe("language defaults and portable data", () => {
  it.each([[undefined, "zh-CN"], ["ja-JP", "zh-CN"], ["zh-TW", "zh-CN"], ["en", "en"], ["en-GB", "en"], ["EN-us", "en"]] as const)("resolves document language %s as %s", (value, expected) => {
    expect(canvasLocale(value)).toBe(expected);
  });
  it("uses a saved interface preference before browser language and tolerates blocked storage", () => {
    expect(browserLocale(["zh-HK", "en"])).toBe("zh-CN");
    expect(browserLocale(["en-GB", "zh-CN"])).toBe("en");
    expect(browserLocale(["fr-FR"])).toBe("en");
    localStorage.setItem(UI_LOCALE_KEY, "en");
    expect(initialUiLocale()).toBe("en");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    function Preference() {
      const { locale, setLocale } = useUiLocale();
      return <button onClick={() => setLocale("en")}>{locale}</button>;
    }
    render(<UiLocaleProvider initialLocale="zh-CN"><Preference /></UiLocaleProvider>);
    fireEvent.click(screen.getByRole("button", { name: "zh-CN" }));
    expect(screen.getByRole("button", { name: "en" })).toBeInTheDocument();
    expect(() => initialUiLocale()).not.toThrow();
  });
  it("uses the document language for new identities and blocks", () => {
    const en = createEmptyDocument(undefined, "en");
    expect(addMessage(en, "user").document.messages[0].displayName).toBe("Me");
    expect(addMessage({ ...en, metadata: {} }, "user").document.messages[0].displayName).toBe("我");
    const reasoning = createBlock("reasoning", { locale: "en-US" });
    expect(reasoning.type === "reasoning" && reasoning.title).toBe("Reasoning");
    const imported = importMarkdown('<!-- conversation-markdown:v2 -->\n<!-- document: {"locale":"en"} -->\n<!-- message: {"role":"assistant"} -->\n<!-- reasoning: {} -->\nVisible source\n<!-- /reasoning -->\n<!-- /message -->', '.md');
    expect(imported.document.metadata.title).toBe("Imported conversation");
    expect(imported.document.messages[0].blocks[0]).toMatchObject({ type: "reasoning", title: "Reasoning" });
    expect(importMarkdown("Body", ".md", undefined, "en").document.metadata.title).toBe("Imported Markdown");
  });
  it("round trips regional and unsupported document languages without translating content", async () => {
    for (const locale of ["en-GB", "ja-JP"]) {
      const document = { ...savedDocument, metadata: { ...savedDocument.metadata, locale } };
      const exported = await exportProjectPackage({ document, resolveAssetBlob: async () => undefined });
      const imported = await importProjectPackage(new File([await exported.blob.arrayBuffer()], "languages.convcanvas"));
      expect(imported.document).toEqual(document);
    }
  });
  it("uses the UI default for plain Markdown, while preserving Conversation Markdown defaults and explicit locales", async () => {
    const source = "用户原文 {0}";
    const plain = await prepareImportFile(new File([source], "笔记.md", { type: "text/markdown" }), "en");
    expect(plain.document.metadata.locale).toBe("en");
    expect(plain.document.messages[0].blocks[0]).toMatchObject({ source });
    const conversation = '<!-- conversation-markdown:v1 -->\n<!-- document: {"locale":"en-GB"} -->\n<!-- message: {"role":"user","displayName":"用户"} -->\n原文\n<!-- /message -->';
    expect(importMarkdown(conversation, "chat.md").document.metadata.locale).toBe("en-GB");
    expect(importMarkdown(conversation.replace('"en-GB"', '"ja-JP"'), "chat.md").document.metadata.locale).toBe("ja-JP");
  });
});

describe("localized diagnostics", () => {
  it("keeps structured diagnostics when rejecting a damaged project document", async () => {
    const exported = await exportProjectPackage({ document: savedDocument, resolveAssetBlob: async () => undefined });
    const archive = unzipSync(new Uint8Array(await exported.blob.arrayBuffer()));
    const raw = JSON.parse(strFromU8(archive["document.json"]));
    raw.metadata.locale = 123;
    archive["document.json"] = strToU8(JSON.stringify(raw));
    const manifest = JSON.parse(strFromU8(archive["manifest.json"]));
    manifest.documentByteSize = archive["document.json"].byteLength;
    manifest.documentSha256 = await sha256Hex(archive["document.json"]);
    archive["manifest.json"] = strToU8(JSON.stringify(manifest));
    const bytes = new Uint8Array(zipSync(archive));
    const cause = await importProjectPackage(new File([bytes], "damaged.convcanvas")).catch((error: unknown) => error);
    expect(cause).toBeInstanceOf(ProjectFormatError);
    const shown = projectErrorPresentation(cause, "fallback");
    expect(translator("en")(shown.detail)).toBe("locale must be text");
    expect(translator("en")(shown.technicalDetail!)).toContain("document.metadata.locale");
  });
  it("formats parameters without translating filenames or interpreting braces in user data", () => {
    const fileName = "用户{1}.md";
    const cause = new ProjectFormatError(message("{0} 太大了，单个文件最多 {1} MB。", fileName, 32), "ASSET_TOO_LARGE", fileName);
    const shown = projectErrorPresentation(cause, "fallback");
    expect(translator("en")(shown.detail)).toBe("用户{1}.md is too large. Each file can be at most 32 MB");
    expect(translator("en")(shown.technicalDetail!)).toContain("Location: 用户{1}.md");
    expect(cause.message).toBe("用户{1}.md 太大了，单个文件最多 32 MB。");
  });
  it("identifies missing image references through structured diagnostics and translates technical details", () => {
    const loaded = loadConversationDocument({ ...savedDocument, messages: [{ ...savedDocument.messages[0], blocks: [{ id: "bad-image", type: "image" }] }] });
    expect(loaded.status).toBe("invalid");
    if (loaded.status !== "invalid") return;
    const diagnostic = loaded.diagnostics.find((item) => item.code === "MISSING_ASSET_ID")!;
    expect(translator("en")(readableDiagnostic({ ...diagnostic, message: "irrelevant translated text" }))).toBe("The image has no file reference");
    expect(translator("en")(diagnosticDetails(diagnostic))).toContain("The image is missing assetId");
  });
  it("keeps every translation parameter and contains no accidental Chinese prose", () => {
    for (const [key, value] of Object.entries(english)) {
      expect([...value.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort(), key).toEqual([...key.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort());
      if (key !== "简体中文") expect(value, key).not.toMatch(/\p{Script=Han}/u);
    }
  });
});
