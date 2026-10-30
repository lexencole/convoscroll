import { describe, expect, it } from "vitest";
import type { EditorIdFactory } from "../editor/document-operations";
import { importMarkdown } from "./markdown-import";
import { prepareImportFile } from "./prepare-import";
import { PROJECT_LIMITS } from "./project-format";

function ids(): EditorIdFactory {
  let index = 0;
  return (kind) => `${kind}-${++index}`;
}

describe("Markdown import", () => {
  it("imports ordinary Markdown as one Assistant message and one block", () => {
    const result = importMarkdown("# 标题\n\n正文", "notes.md", ids());
    expect(result.markdownKind).toBe("plain");
    expect(result.document.metadata.title).toBe("notes");
    expect(result.document.messages).toHaveLength(1);
    expect(result.document.messages[0].role).toBe("assistant");
    expect(result.document.messages[0].blocks[0]).toMatchObject({ type: "markdown", source: "# 标题\n\n正文" });
  });

  it("imports deterministic message metadata and document metadata", () => {
    const source = `<!-- conversation-markdown:v1 -->
<!-- document: {"title":"旅行计划","locale":"zh-CN"} -->
<!-- message: {"role":"user","displayName":"周川"} -->
帮我规划两天行程。
<!-- /message -->

<!-- message: {"role":"assistant","displayName":"Atlas","model":"Demo 2.4"} -->
第一天去博物馆。
<!-- /message -->`;
    const result = importMarkdown(source, "trip.md", ids());
    expect(result.markdownKind).toBe("conversation");
    expect(result.markdownVersion).toBe(1);
    expect(result.document.metadata).toMatchObject({ title: "旅行计划", locale: "zh-CN" });
    expect(result.document.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(result.document.messages[1].model).toBe("Demo 2.4");
  });

  it("does not treat a closing marker inside fenced code as a message boundary", () => {
    const source = `<!-- conversation-markdown:v1 -->
<!-- message: {"role":"assistant"} -->
\
\`\`\`html
<!-- /message -->
\`\`\`
正文
<!-- /message -->`;
    const result = importMarkdown(source.replace("\\\n", ""), "code.md", ids());
    const block = result.document.messages[0].blocks[0];
    expect(block.type === "markdown" ? block.source : "").toContain("<!-- /message -->\n```");
  });

  it("rejects an unclosed message instead of partially importing", () => {
    expect(() => importMarkdown(`<!-- conversation-markdown:v1 -->
<!-- message: {"role":"user"} -->
未结束`, "broken.md", ids())).toThrow(/缺少 <!-- \/message -->/);
  });

  it("rejects a newer Conversation Markdown version", () => {
    expect(() => importMarkdown("<!-- conversation-markdown:v3 -->", "future.md", ids())).toThrow(/不支持 Conversation Markdown v3/);
  });

  it("rejects duplicate title-only document metadata", () => {
    const source = `<!-- conversation-markdown:v1 -->
<!-- document: {"title":"第一个标题"} -->
<!-- document: {"title":"第二个标题"} -->
<!-- message: {"role":"user"} -->
正文
<!-- /message -->`;

    expect(() => importMarkdown(source, "duplicate.md", ids())).toThrow(/document 标记只能有一个/);
  });

  it("rejects oversized Markdown before reading the complete file", async () => {
    const file = new File(["# small"], "oversized.md", { type: "text/markdown" });
    Object.defineProperty(file, "size", {
      configurable: true,
      value: PROJECT_LIMITS.markdownBytes + 1,
    });

    await expect(prepareImportFile(file)).rejects.toMatchObject({
      code: "MARKDOWN_TOO_LARGE",
      path: "oversized.md",
    });
  });

  it("rejects malformed UTF-8 without replacing its bytes with replacement characters", async () => {
    const file = new File([new Uint8Array([0x61, 0xc3, 0x28, 0x62])], "invalid.md", { type: "text/markdown" });
    await expect(prepareImportFile(file)).rejects.toMatchObject({ code: "INPUT_NOT_UTF8", path: "invalid.md" });
  });

  it("retains a genuine replacement character in valid UTF-8", async () => {
    const result = await prepareImportFile(new File(["中文 � 😀"], "valid.md", { type: "text/markdown" }));
    expect(result.document.messages[0].blocks[0]).toMatchObject({ source: "中文 � 😀" });
  });

  it("does not misclassify explicit Markdown beginning with PK as a ZIP package", async () => {
    const source = "PK 是一段正常的 Markdown 开头。\n\n- 继续渲染正文";
    const result = await prepareImportFile(new File(
      [source],
      "pk-notes.md",
      { type: "text/markdown" },
    ));

    expect(result.kind).toBe("markdown");
    expect(result.document.messages[0].blocks[0]).toMatchObject({
      type: "markdown",
      source,
    });
  });

  it("applies the Markdown pre-read limit to PK-prefixed plain text", async () => {
    const file = new File(["PK small"], "notes.txt", { type: "text/plain" });
    Object.defineProperty(file, "size", {
      configurable: true,
      value: PROJECT_LIMITS.markdownBytes + 1,
    });

    await expect(prepareImportFile(file)).rejects.toMatchObject({
      code: "MARKDOWN_TOO_LARGE",
      path: "notes.txt",
    });
  });

  it("rejects Markdown whose normalized project JSON cannot be re-exported", () => {
    const escapingSource = "\u0000".repeat(Math.ceil(PROJECT_LIMITS.documentBytes / 6));

    expect(() => importMarkdown(escapingSource, "escaping.md", ids())).toThrow(
      /内容太多了/,
    );
  });
});
