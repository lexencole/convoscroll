import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import v2Sample from "../../fixtures/conversation-v2.md?raw";
import type { EditorIdFactory } from "../editor/document-operations";
import { attachMarkdownFiles, importMarkdown, prepareMarkdownSource } from "./markdown-import";
import { PROJECT_LIMITS } from "./project-format";

function ids(): EditorIdFactory {
  let index = 0;
  return (kind) => `${kind}-${++index}`;
}

function errorOf(action: () => unknown) {
  try {
    action();
  } catch (error) {
    return error as { readonly message: string; readonly code: string; readonly path?: string };
  }
  throw new Error("Expected the action to throw.");
}

const fence = "```";

const fullSource = `<!-- conversation-markdown:v2 -->
<!-- document: {"title":"海边那一集"} -->

<!-- message: {"role":"user","displayName":"周川","timestamp":"2026-10-04T09:30:00+08:00"} -->
帮我看看这张图

<!-- image: {"src":"./images/beach.png","alt":"海边照片","caption":"第一季海边","width":"medium"} -->
<!-- /message -->

<!-- message: {"role":"assistant","model":"Claude Opus 4.5"} -->
<!-- reasoning: {"title":"思考了 12 秒","durationMs":12000} -->
先确认是哪一集。

${fence}text
<!-- /reasoning -->
${fence}
<!-- /reasoning -->

<!-- tool-call: {"toolName":"web_search","input":{"query":"进击的巨人 海边"}} -->
<!-- tool-result: {"output":{"results":3},"summary":"找到 3 条"} -->

这是**第 59 话**。

<!-- file: {"src":"notes/episode.pdf","label":"分集笔记"} -->

最后一段。
<!-- /message -->`;

describe("Conversation Markdown v2", () => {
  it("maps every v2 marker to a Schema v1 block in source order", () => {
    const prepared = prepareMarkdownSource(fullSource, "beach.md", ids());
    const [user, assistant] = prepared.document.messages;

    expect(prepared.version).toBe(2);
    expect(prepared.document.metadata.title).toBe("海边那一集");
    expect(user.timestamp).toBe("2026-10-04T09:30:00+08:00");
    expect(user.blocks.map((block) => block.type)).toEqual(["markdown", "image"]);
    expect(user.blocks[1]).toMatchObject({ type: "image", alt: "海边照片", caption: "第一季海边", width: "medium" });

    expect(assistant.model).toBe("Claude Opus 4.5");
    expect(assistant.blocks.map((block) => block.type)).toEqual([
      "reasoning",
      "toolCall",
      "toolResult",
      "markdown",
      "file",
      "markdown",
    ]);
    const [reasoning, toolCall, toolResult, body, file, tail] = assistant.blocks;
    expect(reasoning).toMatchObject({
      type: "reasoning",
      title: "思考了 12 秒",
      durationMs: 12000,
      status: "neutral",
      displayState: "collapsed",
      exportState: "current",
    });
    expect(reasoning.type === "reasoning" ? reasoning.source : "").toBe(`先确认是哪一集。\n\n${fence}text\n<!-- /reasoning -->\n${fence}`);
    expect(toolCall).toMatchObject({ type: "toolCall", toolName: "web_search", input: { query: "进击的巨人 海边" } });
    expect(toolResult).toMatchObject({
      type: "toolResult",
      callId: toolCall.type === "toolCall" ? toolCall.callId : "",
      output: { results: 3 },
      summary: "找到 3 条",
      status: "success",
    });
    expect(body).toMatchObject({ type: "markdown", source: "这是**第 59 话**。" });
    expect(file).toMatchObject({ type: "file", label: "分集笔记" });
    expect(tail).toMatchObject({ type: "markdown", source: "最后一段。" });
  });

  it("lists local references with normalized paths, MIME types and lines", () => {
    const prepared = prepareMarkdownSource(fullSource, "beach.md", ids());

    expect(prepared.references).toEqual([
      { assetId: expect.any(String), kind: "image", src: "images/beach.png", line: 7 },
      { assetId: expect.any(String), kind: "file", src: "notes/episode.pdf", line: 24 },
    ]);
    expect(prepared.document.assets.map(({ kind, fileName, mimeType }) => ({ kind, fileName, mimeType }))).toEqual([
      { kind: "image", fileName: "beach.png", mimeType: "image/png" },
      { kind: "file", fileName: "episode.pdf", mimeType: "application/pdf" },
    ]);
  });

  it("produces the same document for the same input", () => {
    expect(prepareMarkdownSource(fullSource, "beach.md", ids())).toEqual(prepareMarkdownSource(fullSource, "beach.md", ids()));
  });

  it("reuses one asset when the same file is referenced twice", () => {
    const prepared = prepareMarkdownSource(`<!-- conversation-markdown:v2 -->
<!-- message: {"role":"user"} -->
<!-- image: {"src":"a.png"} -->
<!-- image: {"src":"./images/../a.png"} -->
<!-- /message -->`, "twice.md", ids());

    expect(prepared.document.assets).toHaveLength(1);
    expect(prepared.references).toHaveLength(1);
    const assetIds = prepared.document.messages[0].blocks.map((block) => block.type === "image" ? block.assetId : "");
    expect(new Set(assetIds).size).toBe(1);
  });

  it.each([
    ["https://example.com/a.png", "INVALID_CONVERSATION_MARKDOWN_SRC"],
    ["data:image/png;base64,AAAA", "INVALID_CONVERSATION_MARKDOWN_SRC"],
    ["/Users/me/a.png", "INVALID_CONVERSATION_MARKDOWN_SRC"],
    ["~/a.png", "INVALID_CONVERSATION_MARKDOWN_SRC"],
    ["images\\\\a.png", "INVALID_CONVERSATION_MARKDOWN_SRC"],
    ["../secret.png", "CONVERSATION_MARKDOWN_SRC_OUTSIDE"],
    ["images/../../secret.png", "CONVERSATION_MARKDOWN_SRC_OUTSIDE"],
  ])("rejects the image source %s", (src, code) => {
    const error = errorOf(() => prepareMarkdownSource(`<!-- conversation-markdown:v2 -->
<!-- message: {"role":"user"} -->
<!-- image: {"src":"${src}"} -->
<!-- /message -->`, "src.md", ids()));

    expect(error.code).toBe(code);
    expect(error.path).toBe("line:3.src");
  });

  it("rejects image formats the canvas cannot show", () => {
    const error = errorOf(() => prepareMarkdownSource(`<!-- conversation-markdown:v2 -->
<!-- message: {"role":"user"} -->
<!-- image: {"src":"photo.heic"} -->
<!-- /message -->`, "heic.md", ids()));

    expect(error.code).toBe("UNSUPPORTED_CONVERSATION_MARKDOWN_IMAGE");
  });

  it("reports unknown marker fields with their line", () => {
    const error = errorOf(() => prepareMarkdownSource(`<!-- conversation-markdown:v2 -->
<!-- message: {"role":"assistant"} -->
正文
<!-- tool-call: {"toolName":"search","arguments":{}} -->
<!-- /message -->`, "field.md", ids()));

    expect(error.code).toBe("UNKNOWN_CONVERSATION_MARKDOWN_FIELD");
    expect(error.path).toBe("line:4.arguments");
  });

  it("requires a tool name and a preceding call for tool results", () => {
    expect(errorOf(() => prepareMarkdownSource(`<!-- conversation-markdown:v2 -->
<!-- message: {"role":"assistant"} -->
<!-- tool-call: {"input":{}} -->
<!-- /message -->`, "tool.md", ids())).code).toBe("MISSING_CONVERSATION_MARKDOWN_TOOL_NAME");

    expect(errorOf(() => prepareMarkdownSource(`<!-- conversation-markdown:v2 -->
<!-- message: {"role":"tool"} -->
<!-- tool-result: {"output":"ok"} -->
<!-- /message -->`, "tool.md", ids())).code).toBe("MISSING_CONVERSATION_MARKDOWN_CALL_ID");
  });

  it("maps document validation failures back to the source line", () => {
    const error = errorOf(() => prepareMarkdownSource(`<!-- conversation-markdown:v2 -->
<!-- message: {"role":"assistant"} -->
<!-- tool-call: {"callId":"c1","toolName":"a"} -->

<!-- tool-call: {"callId":"c1","toolName":"b"} -->
<!-- /message -->`, "duplicate.md", ids()));

    expect(error.code).toBe("DUPLICATE_TOOL_CALL_ID");
    expect(error.path).toMatch(/^line:5 /);
  });

  it("rejects unclosed, stray and nested reasoning markers", () => {
    expect(errorOf(() => prepareMarkdownSource(`<!-- conversation-markdown:v2 -->
<!-- message: {"role":"assistant"} -->
<!-- reasoning: {} -->
想法
<!-- /message -->`, "open.md", ids()))).toMatchObject({ code: "UNCLOSED_CONVERSATION_MARKDOWN_REASONING", path: "line:3" });

    expect(errorOf(() => prepareMarkdownSource(`<!-- conversation-markdown:v2 -->
<!-- message: {"role":"assistant"} -->
<!-- /reasoning -->
<!-- /message -->`, "stray.md", ids()))).toMatchObject({ code: "UNEXPECTED_CONVERSATION_MARKDOWN_END", path: "line:3" });

    expect(errorOf(() => prepareMarkdownSource(`<!-- conversation-markdown:v2 -->
<!-- message: {"role":"assistant"} -->
<!-- reasoning: {} -->
<!-- tool-call: {"toolName":"a"} -->
<!-- /reasoning -->
<!-- /message -->`, "nested.md", ids()))).toMatchObject({ code: "NESTED_CONVERSATION_MARKDOWN_BLOCK", path: "line:4" });
  });

  it("keeps v2 markers as plain text in v1 files and rejects v1 timestamps", () => {
    const prepared = prepareMarkdownSource(`<!-- conversation-markdown:v1 -->
<!-- message: {"role":"assistant"} -->
<!-- tool-call: {"toolName":"a"} -->
<!-- /message -->`, "legacy.md", ids());
    expect(prepared.document.messages[0].blocks).toEqual([
      { id: expect.any(String), type: "markdown", source: "<!-- tool-call: {\"toolName\":\"a\"} -->" },
    ]);
    expect(prepared.references).toEqual([]);

    expect(errorOf(() => prepareMarkdownSource(`<!-- conversation-markdown:v1 -->
<!-- message: {"role":"user","timestamp":"2026-10-04T09:30:00+08:00"} -->
正文
<!-- /message -->`, "legacy.md", ids())).code).toBe("UNKNOWN_CONVERSATION_MARKDOWN_FIELD");
  });

  it("keeps an empty v2 message editable", () => {
    const prepared = prepareMarkdownSource(`<!-- conversation-markdown:v2 -->
<!-- message: {"role":"user"} -->

<!-- /message -->`, "empty.md", ids());
    expect(prepared.document.messages[0].blocks).toEqual([{ id: expect.any(String), type: "markdown", source: "" }]);
  });
});

describe("Conversation Markdown v2 sample", () => {
  it("parses the repository sample and only references files next to it", () => {
    const prepared = prepareMarkdownSource(v2Sample, "conversation-v2.md", ids());

    expect(prepared.version).toBe(2);
    expect(prepared.document.messages.flatMap((message) => message.blocks.map((block) => block.type))).toEqual([
      "markdown", "image",
      "reasoning", "toolCall", "toolResult", "markdown",
      "markdown", "file",
    ]);
    for (const reference of prepared.references) {
      expect(existsSync(resolve(__dirname, "../../fixtures", reference.src))).toBe(true);
    }
  });
});

describe("Conversation Markdown v2 in the browser import", () => {
  it("imports v2 without local files", () => {
    const result = importMarkdown(`<!-- conversation-markdown:v2 -->
<!-- message: {"role":"assistant"} -->
<!-- reasoning: {} -->
想法
<!-- /reasoning -->
回答
<!-- /message -->`, "thoughts.md", ids());

    expect(result.markdownKind).toBe("conversation");
    expect(result.markdownVersion).toBe(2);
    expect(result.document.messages[0].blocks.map((block) => block.type)).toEqual(["reasoning", "markdown"]);
  });

  it("rejects local file references with a pointer to the command line", () => {
    const error = errorOf(() => importMarkdown(fullSource, "beach.md", ids()));

    expect(error.code).toBe("CONVERSATION_MARKDOWN_LOCAL_FILES");
    expect(error.path).toBe("line:7");
    expect(error.message).toContain("--project");
  });
});

describe("attachMarkdownFiles", () => {
  it("records file sizes and image dimensions", () => {
    const prepared = prepareMarkdownSource(fullSource, "beach.md", ids());
    const document = attachMarkdownFiles(prepared, new Map([
      ["images/beach.png", { byteSize: 2048, width: 1200, height: 800 }],
      ["notes/episode.pdf", { byteSize: 4096, width: 10, height: 10 }],
    ]));

    expect(document.assets.map(({ kind, byteSize, width, height }) => ({ kind, byteSize, width, height }))).toEqual([
      { kind: "image", byteSize: 2048, width: 1200, height: 800 },
      { kind: "file", byteSize: 4096, width: undefined, height: undefined },
    ]);
  });

  it("rejects missing and oversized files", () => {
    const prepared = prepareMarkdownSource(fullSource, "beach.md", ids());

    expect(errorOf(() => attachMarkdownFiles(prepared, new Map([
      ["images/beach.png", { byteSize: 1 }],
    ])))).toMatchObject({ code: "MISSING_CONVERSATION_MARKDOWN_FILE", path: "line:24" });

    expect(errorOf(() => attachMarkdownFiles(prepared, new Map([
      ["images/beach.png", { byteSize: PROJECT_LIMITS.singleAssetBytes + 1 }],
      ["notes/episode.pdf", { byteSize: 1 }],
    ])))).toMatchObject({ code: "CONVERSATION_MARKDOWN_FILE_TOO_LARGE", path: "line:7" });
  });
});
