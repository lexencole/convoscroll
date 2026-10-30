import { canvasLocale, type Locale } from "../i18n/locale";
import { message as msg, translator } from "../i18n/messages";
import type {
  CollapseState,
  ContentBlock,
  ConversationAsset,
  ConversationDocument,
  ConversationMessage,
  DocumentMetadata,
  ExecutionStatus,
  ExportState,
  JsonValue,
  MessageRole,
  MessageStatus,
} from "../data/conversation-types";
import { loadConversationDocument } from "../data/document-loader";
import { createBlock, createEmptyDocument, createEditorId, type EditorIdFactory } from "../editor/document-operations";
import { PROJECT_LIMITS, ProjectFormatError, type PreparedMarkdownImport } from "./project-format";

const versionHeaderPattern = /^<!--\s*conversation-markdown:v([^\s]+)\s*-->$/;
const supportedVersions: Readonly<Record<string, ConversationMarkdownVersion>> = { 1: 1, 2: 2 };
const documentPattern = /^<!--\s*document:\s*(\{.*\})\s*-->$/;
const messagePattern = /^<!--\s*message:\s*(\{.*\})\s*-->$/;
const messageEnd = "<!-- /message -->";
const blockMarkerPattern = /^<!--\s*(reasoning|tool-call|tool-result|image|file):\s*(\{.*\})\s*-->$/;
const reasoningEnd = "<!-- /reasoning -->";
const messageRoles = new Set<MessageRole>(["user", "assistant", "system", "developer", "tool", "unknown"]);
const messageStatuses = new Set<MessageStatus>(["complete", "streaming", "error", "cancelled"]);
const executionStatuses = new Set<ExecutionStatus>(["neutral", "pending", "running", "success", "error"]);
const collapseStates = new Set<CollapseState>(["collapsed", "expanded"]);
const exportStates = new Set<ExportState>(["current", "collapsed", "expanded"]);
const imageWidths = new Set<"small" | "medium" | "full">(["small", "medium", "full"]);

const imageMimeTypes: Readonly<Record<string, string>> = {
  avif: "image/avif",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
};

const fileMimeTypes: Readonly<Record<string, string>> = {
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  json: "application/json",
  md: "text/markdown",
  pdf: "application/pdf",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip",
  ...imageMimeTypes,
};

export type ConversationMarkdownVersion = 1 | 2;

/** A v2 `image` / `file` marker that points at a file next to the Markdown source. */
export interface ConversationMarkdownReference {
  readonly assetId: string;
  readonly kind: "image" | "file";
  /** Normalized path relative to the Markdown file, using `/` separators. */
  readonly src: string;
  readonly line: number;
}

export interface PreparedMarkdownSource {
  readonly markdownKind: "plain" | "conversation";
  readonly version?: ConversationMarkdownVersion;
  readonly document: ConversationDocument;
  readonly references: readonly ConversationMarkdownReference[];
}

/** What the caller learned after reading a referenced local file. */
export interface ResolvedMarkdownFile {
  readonly byteSize: number;
  readonly width?: number;
  readonly height?: number;
}

interface SourceLine {
  readonly text: string;
  readonly line: number;
}

interface ParseContext {
  readonly idFactory: EditorIdFactory;
  locale?: string;
  readonly assets: ConversationAsset[];
  readonly references: ConversationMarkdownReference[];
  readonly assetsBySource: Map<string, ConversationAsset>;
  readonly blockLines: Map<string, number>;
  lastToolCallId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCommentJson(source: string, path: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(source);
    if (!isRecord(value)) throw new Error();
    return value;
  } catch {
    throw new ProjectFormatError(msg("{0} 的 JSON 写错了。", path), "INVALID_CONVERSATION_MARKDOWN_JSON", path);
  }
}

function assertOnlyKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>, path: string) {
  const unknown = Object.keys(record).find((key) => !allowed.has(key));
  if (unknown) {
    throw new ProjectFormatError(msg("{0} 有不认识的字段：{1}。", path, unknown), "UNKNOWN_CONVERSATION_MARKDOWN_FIELD", `${path}.${unknown}`);
  }
}

function optionalString(record: Record<string, unknown>, key: string, path: string): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    throw new ProjectFormatError(msg("{0}.{1} 应该是文本。", path, key), "INVALID_CONVERSATION_MARKDOWN_FIELD", `${path}.${key}`);
  }
  return value;
}

function optionalEnum<T extends string>(
  record: Record<string, unknown>,
  key: string,
  allowed: ReadonlySet<T>,
  path: string,
): T | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !allowed.has(value as T)) {
    throw new ProjectFormatError(
      msg("{0}.{1} 只能是 {2}。", path, key, [...allowed].join(" / ")),
      "INVALID_CONVERSATION_MARKDOWN_FIELD",
      `${path}.${key}`,
    );
  }
  return value as T;
}

function optionalDuration(record: Record<string, unknown>, path: string): number | undefined {
  const value = record.durationMs;
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ProjectFormatError(msg("{0}.durationMs 应该是 0 或正数（毫秒）。", path), "INVALID_CONVERSATION_MARKDOWN_FIELD", `${path}.durationMs`);
  }
  return value;
}

function parseDocumentMetadata(record: Record<string, unknown>): DocumentMetadata {
  assertOnlyKeys(record, new Set(["title", "subtitle", "locale"]), "document");
  for (const key of ["title", "subtitle", "locale"] as const) {
    if (record[key] !== undefined && typeof record[key] !== "string") {
      throw new ProjectFormatError(msg("document.{0} 应该是文本。", key), "INVALID_CONVERSATION_MARKDOWN_METADATA", `document.${key}`);
    }
  }
  return record as DocumentMetadata;
}

function parseMessageMetadata(
  record: Record<string, unknown>,
  version: ConversationMarkdownVersion,
  idFactory: EditorIdFactory,
  index: number,
): Omit<ConversationMessage, "blocks"> {
  const allowed = ["role", "sourceRole", "displayName", "model", "status", ...(version >= 2 ? ["timestamp"] : [])];
  assertOnlyKeys(record, new Set(allowed), `messages[${index}]`);
  if (typeof record.role !== "string" || !messageRoles.has(record.role as MessageRole)) {
    throw new ProjectFormatError("消息的 role 不对。", "INVALID_CONVERSATION_MARKDOWN_ROLE", `messages[${index}].role`);
  }
  const role = record.role as MessageRole;
  if (role === "unknown" && (typeof record.sourceRole !== "string" || !record.sourceRole.trim())) {
    throw new ProjectFormatError("role 为 unknown 时需要 sourceRole。", "MISSING_CONVERSATION_MARKDOWN_SOURCE_ROLE", `messages[${index}].sourceRole`);
  }
  for (const key of ["sourceRole", "displayName", "model", "timestamp"] as const) {
    if (record[key] !== undefined && typeof record[key] !== "string") {
      throw new ProjectFormatError(msg("{0} 应该是文本。", key), "INVALID_CONVERSATION_MARKDOWN_MESSAGE", `messages[${index}].${key}`);
    }
  }
  if (record.status !== undefined && (typeof record.status !== "string" || !messageStatuses.has(record.status as MessageStatus))) {
    throw new ProjectFormatError("消息的 status 不对。", "INVALID_CONVERSATION_MARKDOWN_STATUS", `messages[${index}].status`);
  }
  return {
    id: idFactory("message"),
    role,
    ...(typeof record.sourceRole === "string" ? { sourceRole: record.sourceRole } : {}),
    ...(typeof record.displayName === "string" ? { displayName: record.displayName } : {}),
    ...(typeof record.model === "string" ? { model: record.model } : {}),
    ...(typeof record.timestamp === "string" ? { timestamp: record.timestamp } : {}),
    ...(typeof record.status === "string" ? { status: record.status as MessageStatus } : {}),
  };
}

function trimBoundaryBlankLines(lines: readonly string[]): string {
  let start = 0;
  let end = lines.length;
  if (lines[start] === "") start += 1;
  if (end > start && lines[end - 1] === "") end -= 1;
  return lines.slice(start, end).join("\n");
}

function trimAllBoundaryBlankLines(lines: readonly string[]): string {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  return lines.slice(start, end).join("\n");
}

/** Tracks fenced code so boundary markers inside code stay ordinary text. */
function createFenceTracker() {
  let fence: { readonly char: "`" | "~"; readonly length: number } | undefined;
  return {
    /** Returns true when the line belongs to (or opens / closes) a fenced code block. */
    consume(line: string): boolean {
      if (fence) {
        const closePattern = new RegExp(`^ {0,3}${fence.char}{${fence.length},}\\s*$`);
        if (closePattern.test(line)) fence = undefined;
        return true;
      }
      const fenceMatch = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (!fenceMatch) return false;
      fence = { char: fenceMatch[1][0] as "`" | "~", length: fenceMatch[1].length };
      return true;
    },
  };
}

function normalizeLocalSource(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ProjectFormatError(msg("{0}.src 应该是本地文件的相对路径。", path), "INVALID_CONVERSATION_MARKDOWN_SRC", `${path}.src`);
  }
  const raw = value.trim();
  const rejected = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) || raw.startsWith("/") || raw.startsWith("~") || raw.includes("\\") || raw.includes("\0");
  if (rejected) {
    throw new ProjectFormatError(
      msg("{0}.src 要写相对于这个 Markdown 文件的路径，不能是网址或绝对路径：{1}", path, raw),
      "INVALID_CONVERSATION_MARKDOWN_SRC",
      `${path}.src`,
    );
  }
  const segments: string[] = [];
  for (const segment of raw.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (!segments.length) {
        throw new ProjectFormatError(msg("{0}.src 不能指向 Markdown 文件所在文件夹之外：{1}", path, raw), "CONVERSATION_MARKDOWN_SRC_OUTSIDE", `${path}.src`);
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  if (!segments.length) {
    throw new ProjectFormatError(msg("{0}.src 不是文件。", path), "INVALID_CONVERSATION_MARKDOWN_SRC", `${path}.src`);
  }
  return segments.join("/");
}

function extensionOf(fileName: string) {
  const match = fileName.toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

function referenceAsset(
  kind: "image" | "file",
  record: Record<string, unknown>,
  path: string,
  line: number,
  context: ParseContext,
): ConversationAsset {
  const src = normalizeLocalSource(record.src, path);
  const reuseKey = `${kind}:${src}`;
  const existing = context.assetsBySource.get(reuseKey);
  if (existing) return existing;

  const fileName = src.split("/").at(-1)!;
  const extension = extensionOf(fileName);
  const types = kind === "image" ? imageMimeTypes : fileMimeTypes;
  const mimeType = Object.hasOwn(types, extension) ? types[extension]
    : kind === "file" ? "application/octet-stream" : undefined;
  if (!mimeType) {
    throw new ProjectFormatError(
      msg("{0}.src 的图片格式不支持：{1}（支持 {2}）。", path, fileName, Object.keys(imageMimeTypes).join(" / ")),
      "UNSUPPORTED_CONVERSATION_MARKDOWN_IMAGE",
      `${path}.src`,
    );
  }
  const assetId = context.idFactory("asset");
  const asset: ConversationAsset = {
    id: assetId,
    kind,
    fileName,
    mimeType,
    source: { kind: "local", storageKey: `local:${assetId}` },
  };
  context.assets.push(asset);
  context.assetsBySource.set(reuseKey, asset);
  context.references.push({ assetId, kind, src, line });
  return asset;
}

const traceFields = ["summary", "status", "durationMs", "displayState", "exportState"] as const;

/** Shared optional fields of reasoning and tool blocks; omitted fields keep the editor defaults. */
function traceOverrides(record: Record<string, unknown>, path: string) {
  const summary = optionalString(record, "summary", path);
  const status = optionalEnum(record, "status", executionStatuses, path);
  const durationMs = optionalDuration(record, path);
  const displayState = optionalEnum(record, "displayState", collapseStates, path);
  const exportState = optionalEnum(record, "exportState", exportStates, path);
  return {
    ...(summary !== undefined ? { summary } : {}),
    ...(status ? { status } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(displayState ? { displayState } : {}),
    ...(exportState ? { exportState } : {}),
  };
}

function parseBlockMarker(
  type: string,
  record: Record<string, unknown>,
  line: number,
  context: ParseContext,
): ContentBlock {
  const path = `line:${line}`;
  const { idFactory } = context;
  switch (type) {
    case "reasoning": {
      assertOnlyKeys(record, new Set(["title", ...traceFields]), path);
      const base = createBlock("reasoning", { idFactory, locale: context.locale });
      const title = optionalString(record, "title", path);
      return { ...base, ...(title !== undefined ? { title } : {}), ...traceOverrides(record, path) } as ContentBlock;
    }
    case "tool-call": {
      assertOnlyKeys(record, new Set(["callId", "toolName", "input", ...traceFields]), path);
      const toolName = optionalString(record, "toolName", path);
      if (!toolName?.trim()) {
        throw new ProjectFormatError(msg("{0}.toolName 必填。", path), "MISSING_CONVERSATION_MARKDOWN_TOOL_NAME", `${path}.toolName`);
      }
      const base = createBlock("toolCall", { idFactory });
      const callId = optionalString(record, "callId", path) ?? (base.type === "toolCall" ? base.callId : "");
      context.lastToolCallId = callId;
      return {
        ...base,
        callId,
        toolName,
        ...(record.input !== undefined ? { input: record.input as JsonValue } : {}),
        ...traceOverrides(record, path),
      } as ContentBlock;
    }
    case "tool-result": {
      assertOnlyKeys(record, new Set(["callId", "output", ...traceFields]), path);
      const callId = optionalString(record, "callId", path) ?? context.lastToolCallId;
      if (!callId) {
        throw new ProjectFormatError(msg("{0} 的工具结果前面没有工具调用，请写明 callId。", path), "MISSING_CONVERSATION_MARKDOWN_CALL_ID", `${path}.callId`);
      }
      return {
        ...createBlock("toolResult", { callId, idFactory }),
        ...(record.output !== undefined ? { output: record.output as JsonValue } : {}),
        ...traceOverrides(record, path),
      } as ContentBlock;
    }
    case "image": {
      assertOnlyKeys(record, new Set(["src", "alt", "caption", "width"]), path);
      const asset = referenceAsset("image", record, path, line, context);
      const caption = optionalString(record, "caption", path);
      return {
        id: idFactory("block"),
        type: "image",
        assetId: asset.id,
        alt: optionalString(record, "alt", path) ?? asset.fileName,
        ...(caption !== undefined ? { caption } : {}),
        width: optionalEnum(record, "width", imageWidths, path) ?? "full",
      };
    }
    default: {
      assertOnlyKeys(record, new Set(["src", "label"]), path);
      const asset = referenceAsset("file", record, path, line, context);
      return {
        id: idFactory("block"),
        type: "file",
        assetId: asset.id,
        label: optionalString(record, "label", path) ?? asset.fileName,
      };
    }
  }
}

function parseV2Blocks(lines: readonly SourceLine[], messageIndex: number, context: ParseContext): ContentBlock[] {
  const blocks: ContentBlock[] = [];
  const fence = createFenceTracker();
  let markdownLines: SourceLine[] = [];
  let reasoning: { readonly block: ContentBlock; readonly line: number; readonly body: string[] } | undefined;

  const record = (block: ContentBlock, line: number) => {
    context.blockLines.set(`${messageIndex}:${blocks.length}`, line);
    blocks.push(block);
  };
  const flushMarkdown = () => {
    const source = trimAllBoundaryBlankLines(markdownLines.map((entry) => entry.text));
    const firstLine = markdownLines.find((entry) => entry.text.trim())?.line;
    markdownLines = [];
    if (!source || firstLine === undefined) return;
    record({ id: context.idFactory("block"), type: "markdown", source }, firstLine);
  };

  for (const entry of lines) {
    const trimmed = entry.text.trim();
    if (fence.consume(entry.text)) {
      if (reasoning) reasoning.body.push(entry.text);
      else markdownLines.push(entry);
      continue;
    }
    if (reasoning) {
      if (trimmed === reasoningEnd) {
        record({ ...reasoning.block, source: trimAllBoundaryBlankLines(reasoning.body) } as ContentBlock, reasoning.line);
        reasoning = undefined;
        continue;
      }
      if (blockMarkerPattern.test(trimmed)) {
        throw new ProjectFormatError("思考过程内不能再放其他标记，请先写 <!-- /reasoning -->。", "NESTED_CONVERSATION_MARKDOWN_BLOCK", `line:${entry.line}`);
      }
      reasoning.body.push(entry.text);
      continue;
    }
    if (trimmed === reasoningEnd) {
      throw new ProjectFormatError("<!-- /reasoning --> 前面没有对应的思考过程。", "UNEXPECTED_CONVERSATION_MARKDOWN_END", `line:${entry.line}`);
    }
    const marker = trimmed.match(blockMarkerPattern);
    if (!marker) {
      markdownLines.push(entry);
      continue;
    }
    flushMarkdown();
    const block = parseBlockMarker(marker[1], parseCommentJson(marker[2], `line:${entry.line}`), entry.line, context);
    if (block.type === "reasoning") {
      reasoning = { block, line: entry.line, body: [] };
    } else {
      record(block, entry.line);
    }
  }

  if (reasoning) {
    throw new ProjectFormatError("思考过程缺少 <!-- /reasoning --> 结束标识。", "UNCLOSED_CONVERSATION_MARKDOWN_REASONING", `line:${reasoning.line}`);
  }
  flushMarkdown();
  return blocks;
}

/** Maps a loader diagnostic path such as `messages[1].blocks[2].callId` back to its source line. */
function sourceLineForPath(
  path: string,
  messageLines: readonly number[],
  blockLines: ReadonlyMap<string, number>,
): number | undefined {
  const match = path.match(/^messages\[(\d+)\](?:\.blocks\[(\d+)\])?/);
  if (!match) return undefined;
  const messageIndex = Number(match[1]);
  if (match[2] !== undefined) return blockLines.get(`${messageIndex}:${match[2]}`) ?? messageLines[messageIndex];
  return messageLines[messageIndex];
}

function validateParsedDocument(
  rawDocument: unknown,
  messageLines: readonly number[],
  blockLines: ReadonlyMap<string, number>,
): ConversationDocument {
  const loaded = loadConversationDocument(rawDocument);
  if (loaded.status === "valid") return loaded.document;
  const [diagnostic] = loaded.diagnostics;
  const line = sourceLineForPath(diagnostic.path, messageLines, blockLines);
  throw new ProjectFormatError(
    diagnostic.messageText ?? diagnostic.message,
    diagnostic.code,
    line === undefined ? diagnostic.path : `line:${line} (${diagnostic.path})`,
    diagnostic.subject,
  );
}

function parseConversationMarkdown(source: string, fileName: string, idFactory: EditorIdFactory): PreparedMarkdownSource {
  const lines = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const firstContentIndex = lines.findIndex((line) => line.trim() !== "");
  if (firstContentIndex < 0) throw new ProjectFormatError("文件是空的。", "EMPTY_CONVERSATION_MARKDOWN");
  const versionMatch = lines[firstContentIndex].trim().match(versionHeaderPattern);
  const version = versionMatch && Object.hasOwn(supportedVersions, versionMatch[1])
    ? supportedVersions[versionMatch[1]] : undefined;
  if (!versionMatch || !version) {
    throw new ProjectFormatError(
      versionMatch ? msg("不支持 Conversation Markdown v{0}。", versionMatch[1]) : "第一行的 conversation-markdown 标记写错了。",
      versionMatch ? "CONVERSATION_MARKDOWN_VERSION_TOO_NEW" : "INVALID_CONVERSATION_MARKDOWN_HEADER",
      `line:${firstContentIndex + 1}`,
    );
  }

  const context: ParseContext = {
    idFactory,
    assets: [],
    references: [],
    assetsBySource: new Map(),
    blockLines: new Map(),
  };
  const fileTitle = fileName.replace(/\.md$/i, "");
  let metadata: DocumentMetadata = fileTitle ? { title: fileTitle } : {};
  const messages: ConversationMessage[] = [];
  const messageLines: number[] = [];
  let current: { readonly meta: Record<string, unknown>; readonly line: number; readonly lines: SourceLine[] } | undefined;
  let fence = createFenceTracker();
  let hasDocumentMetadata = false;

  for (let index = firstContentIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (current) {
      if (fence.consume(line)) {
        current.lines.push({ text: line, line: index + 1 });
        continue;
      }
      if (line.trim() === messageEnd) {
        const messageIndex = messages.length;
        const header = parseMessageMetadata(current.meta, version, idFactory, messageIndex);
        const blocks = version === 1
          ? [{ id: idFactory("block"), type: "markdown" as const, source: trimBoundaryBlankLines(current.lines.map((entry) => entry.text)) }]
          : parseV2Blocks(current.lines, messageIndex, context);
        messages.push({
          ...header,
          blocks: blocks.length ? blocks : [{ id: idFactory("block"), type: "markdown", source: "" }],
        });
        messageLines.push(current.line);
        current = undefined;
        fence = createFenceTracker();
        continue;
      }
      current.lines.push({ text: line, line: index + 1 });
      continue;
    }

    if (!line.trim()) continue;
    const documentMatch = line.trim().match(documentPattern);
    if (documentMatch) {
      if (messages.length > 0 || hasDocumentMetadata) {
        throw new ProjectFormatError("document 标记只能有一个，并且要放在第一条消息前面。", "DUPLICATE_CONVERSATION_MARKDOWN_DOCUMENT", `line:${index + 1}`);
      }
      metadata = { ...metadata, ...parseDocumentMetadata(parseCommentJson(documentMatch[1], `line:${index + 1}`)) };
      context.locale = metadata.locale;
      hasDocumentMetadata = true;
      continue;
    }
    const messageMatch = line.trim().match(messagePattern);
    if (messageMatch) {
      current = { meta: parseCommentJson(messageMatch[1], `line:${index + 1}`), line: index + 1, lines: [] };
      continue;
    }
    throw new ProjectFormatError("消息外面有多余的内容。", "CONTENT_OUTSIDE_CONVERSATION_MESSAGE", `line:${index + 1}`);
  }

  if (current) throw new ProjectFormatError("最后一条消息缺少 <!-- /message -->。", "UNCLOSED_CONVERSATION_MESSAGE", version >= 2 ? `line:${current.line}` : undefined);
  if (messages.length === 0) throw new ProjectFormatError("没有找到任何消息。", "EMPTY_CONVERSATION_MESSAGES");

  const base = createEmptyDocument(idFactory);
  const rawDocument = { ...base, metadata: { ...base.metadata, title: translator(canvasLocale(metadata.locale))("导入的对话"), ...metadata }, messages, assets: context.assets };
  return {
    markdownKind: "conversation",
    version,
    document: validateParsedDocument(rawDocument, messageLines, context.blockLines),
    references: context.references,
  };
}

function parsePlainMarkdown(source: string, fileName: string, idFactory: EditorIdFactory, locale: Locale): PreparedMarkdownSource {
  const base = createEmptyDocument(idFactory, locale);
  const title = fileName.replace(/\.md$/i, "") || translator(locale)("导入的 Markdown");
  const document = {
    ...base,
    metadata: { ...base.metadata, title },
    messages: [{
      id: idFactory("message"),
      role: "assistant" as const,
      displayName: "Assistant",
      blocks: [{ id: idFactory("block"), type: "markdown" as const, source }],
    }],
  };
  return { markdownKind: "plain", document, references: [] };
}

function assertDocumentWithinLimit(document: ConversationDocument, fileName: string) {
  const documentBytes = new TextEncoder().encode(JSON.stringify(document, null, 2)).byteLength;
  if (documentBytes > PROJECT_LIMITS.documentBytes) {
    throw new ProjectFormatError(
      "内容太多了。",
      "DOCUMENT_TOO_LARGE",
      fileName,
    );
  }
}

/**
 * Parses ordinary Markdown or Conversation Markdown v1 / v2 into a validated document.
 * v2 `image` / `file` markers become local Assets whose bytes the caller must supply
 * through `attachMarkdownFiles`; the browser import cannot read them.
 */
export function prepareMarkdownSource(
  source: string,
  fileName: string,
  idFactory: EditorIdFactory = createEditorId,
  defaultLocale: Locale = "zh-CN",
): PreparedMarkdownSource {
  if (new TextEncoder().encode(source).byteLength > PROJECT_LIMITS.markdownBytes) {
    throw new ProjectFormatError(
      msg("Markdown 文件超过 {0} MB，请缩小文件后重新导入。", PROJECT_LIMITS.markdownBytes / 1024 / 1024),
      "MARKDOWN_TOO_LARGE",
      fileName,
    );
  }
  const firstContent = source.replaceAll("\r\n", "\n").split("\n").find((line) => line.trim());
  const prepared = firstContent?.trim().startsWith("<!-- conversation-markdown:")
    ? parseConversationMarkdown(source, fileName, idFactory)
    : parsePlainMarkdown(source, fileName, idFactory, defaultLocale);
  assertDocumentWithinLimit(prepared.document, fileName);
  return prepared;
}

/** Records the size (and image dimensions) of each referenced local file, then re-validates. */
export function attachMarkdownFiles(
  prepared: PreparedMarkdownSource,
  files: ReadonlyMap<string, ResolvedMarkdownFile>,
): ConversationDocument {
  const byAssetId = new Map(prepared.references.map((reference) => [reference.assetId, reference]));
  const assets = prepared.document.assets.map((asset) => {
    const reference = byAssetId.get(asset.id);
    if (!reference) return asset;
    const file = files.get(reference.src);
    if (!file) {
      throw new ProjectFormatError(msg("找不到引用的文件：{0}", reference.src), "MISSING_CONVERSATION_MARKDOWN_FILE", `line:${reference.line}`);
    }
    if (file.byteSize > PROJECT_LIMITS.singleAssetBytes) {
      throw new ProjectFormatError(msg("引用的文件太大了（单个最多 32 MB）：{0}", reference.src), "CONVERSATION_MARKDOWN_FILE_TOO_LARGE", `line:${reference.line}`);
    }
    return {
      ...asset,
      byteSize: file.byteSize,
      ...(asset.kind === "image" && file.width ? { width: file.width } : {}),
      ...(asset.kind === "image" && file.height ? { height: file.height } : {}),
    };
  });
  const loaded = loadConversationDocument({ ...prepared.document, assets });
  if (loaded.status === "invalid") {
    throw new ProjectFormatError(loaded.diagnostics[0].messageText ?? loaded.diagnostics[0].message, loaded.diagnostics[0].code, loaded.diagnostics[0].path, loaded.diagnostics[0].subject);
  }
  return loaded.document;
}

export function importMarkdown(
  source: string,
  fileName: string,
  idFactory: EditorIdFactory = createEditorId,
  defaultLocale: Locale = "zh-CN",
): PreparedMarkdownImport {
  const prepared = prepareMarkdownSource(source, fileName, idFactory, defaultLocale);
  const [firstReference] = prepared.references;
  if (firstReference) {
    throw new ProjectFormatError(
      msg("这份对话用到了本地文件 {0}，网页读不到。请在命令行出图时加上 --project，再导入生成的 .convcanvas 文件。", firstReference.src),
      "CONVERSATION_MARKDOWN_LOCAL_FILES",
      `line:${firstReference.line}`,
    );
  }
  const { document } = prepared;
  return {
    kind: "markdown",
    markdownKind: prepared.markdownKind,
    ...(prepared.version ? { markdownVersion: prepared.version } : {}),
    fileName,
    document,
    assets: [],
    warnings: [],
    summary: {
      title: document.metadata.title || "未命名对话",
      messageCount: document.messages.length,
      blockCount: document.messages.reduce((total, message) => total + message.blocks.length, 0),
      assetCount: 0,
      availableAssetBytes: 0,
    },
  };
}
