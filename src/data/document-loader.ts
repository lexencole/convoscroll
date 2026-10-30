import { message as msg, diagnosticMessage, translator, type LocalizedText } from "../i18n/messages";
import type {
  ContentBlock,
  ConversationAsset,
  ConversationDocument,
  ConversationMessage,
  ExecutionStatus,
  DocumentDiagnostic,
  LoadedDocument,
  MessageRole,
  MessageStatus,
} from "./conversation-types";

const stableIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const fixturePathPattern = /^fixtures\/assets\/[A-Za-z0-9][A-Za-z0-9._/-]*$/;

const messageRoles = new Set<MessageRole>([
  "user",
  "assistant",
  "system",
  "developer",
  "tool",
  "unknown",
]);
const messageStatuses = new Set<MessageStatus>([
  "complete",
  "streaming",
  "error",
  "cancelled",
]);
const executionStatuses = new Set<ExecutionStatus>([
  "neutral",
  "pending",
  "running",
  "success",
  "error",
]);
const collapseStates = new Set(["collapsed", "expanded"]);
const exportStates = new Set(["current", "collapsed", "expanded"]);
const imageWidths = new Set(["small", "medium", "full"]);

const documentFields = new Set([
  "schemaVersion",
  "id",
  "metadata",
  "canvas",
  "theme",
  "messages",
  "assets",
]);
const metadataFields = new Set(["title", "subtitle", "locale", "createdAt", "updatedAt"]);
const canvasFields = new Set(["preset", "width", "scale"]);
const themeFields = new Set(["id"]);
const messageFields = new Set([
  "id",
  "role",
  "sourceRole",
  "displayName",
  "model",
  "avatarAssetId",
  "timestamp",
  "status",
  "blocks",
]);
const assetFields = new Set([
  "id",
  "kind",
  "fileName",
  "mimeType",
  "byteSize",
  "width",
  "height",
  "source",
]);

const blockFields: Record<ContentBlock["type"], ReadonlySet<string>> = {
  markdown: new Set(["id", "type", "source"]),
  image: new Set(["id", "type", "assetId", "alt", "caption", "width"]),
  file: new Set(["id", "type", "assetId", "label"]),
  reasoning: new Set([
    "id",
    "type",
    "title",
    "summary",
    "source",
    "status",
    "durationMs",
    "displayState",
    "exportState",
  ]),
  toolCall: new Set([
    "id",
    "type",
    "callId",
    "toolName",
    "summary",
    "input",
    "status",
    "durationMs",
    "displayState",
    "exportState",
  ]),
  toolResult: new Set([
    "id",
    "type",
    "callId",
    "summary",
    "output",
    "status",
    "durationMs",
    "displayState",
    "exportState",
  ]),
  unsupported: new Set(["id", "type", "originalType", "reason", "raw"]),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStableId(value: unknown): value is string {
  return isNonEmptyString(value) && value.length <= 128 && stableIdPattern.test(value);
}

function isDateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  if (!parts || !Number.isFinite(Date.parse(value))) return false;
  const [, yearText, monthText, dayText] = parts;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/** Diagnostics must not call methods or recursively stringify untrusted objects. */
export function diagnosticValue(value: unknown): string {
  return value !== null && typeof value === "object" ? "格式无效" : String(value);
}

function addDiagnostic(
  diagnostics: DocumentDiagnostic[],
  code: string,
  path: string,
  message: LocalizedText,
  subject?: "image" | "file",
): void {
  diagnostics.push({ code, path, ...(subject ? { subject } : {}), message: translator("zh-CN")(message), ...(typeof message === "string" ? {} : { messageText: message }) });
}

function validateKnownFields(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
  diagnostics: DocumentDiagnostic[],
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      addDiagnostic(
        diagnostics,
        "UNKNOWN_FIELD",
        path === "$" ? key : `${path}.${key}`,
        msg("不认识的字段“{0}”。", key),
      );
    }
  }
}

function validateOptionalString(
  record: Record<string, unknown>,
  key: string,
  path: string,
  diagnostics: DocumentDiagnostic[],
): void {
  if (record[key] !== undefined && typeof record[key] !== "string") {
    addDiagnostic(diagnostics, "INVALID_STRING", `${path}.${key}`, msg("{0} 应该是文本。", key));
  }
}

// Bound container nesting before values reach JSON.stringify, highlighting or IndexedDB.
// 128 leaves ample stack headroom in supported browsers without truncating opaque data.
export const MAX_JSON_NESTING_DEPTH = 128;

function jsonValueIssue(value: unknown, ancestors = new Set<object>(), depth = 0): "INVALID_JSON_VALUE" | "JSON_DEPTH_EXCEEDED" | undefined {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? undefined : "INVALID_JSON_VALUE";
  if (typeof value !== "object" || ancestors.has(value)) return "INVALID_JSON_VALUE";
  if (depth >= MAX_JSON_NESTING_DEPTH) return "JSON_DEPTH_EXCEEDED";

  ancestors.add(value);
  try {
    for (const item of Array.isArray(value) ? value : Object.values(value)) {
      const issue = jsonValueIssue(item, ancestors, depth + 1);
      if (issue) return issue;
    }
    return undefined;
  } finally {
    ancestors.delete(value);
  }
}

function validateJsonValue(value: unknown, path: string, message: string, diagnostics: DocumentDiagnostic[]): void {
  const issue = jsonValueIssue(value);
  if (issue) addDiagnostic(diagnostics, issue, path, issue === "JSON_DEPTH_EXCEEDED"
    ? msg("JSON 嵌套超过 {0} 层，请减少嵌套后重试。", MAX_JSON_NESTING_DEPTH)
    : message);
}

function validateDuration(
  block: Record<string, unknown>,
  path: string,
  diagnostics: DocumentDiagnostic[],
): void {
  if (
    block.durationMs !== undefined &&
    (!Number.isInteger(block.durationMs) || Number(block.durationMs) < 0)
  ) {
    addDiagnostic(
      diagnostics,
      "INVALID_DURATION",
      `${path}.durationMs`,
      "durationMs 应该是 0 或正整数。",
    );
  }
}

function validateCollapsibleBlock(
  block: Record<string, unknown>,
  path: string,
  diagnostics: DocumentDiagnostic[],
): void {
  if (typeof block.displayState !== "string" || !collapseStates.has(block.displayState)) {
    addDiagnostic(
      diagnostics,
      "INVALID_DISPLAY_STATE",
      `${path}.displayState`,
      "折叠状态只能是 collapsed 或 expanded。",
    );
  }
  if (typeof block.exportState !== "string" || !exportStates.has(block.exportState)) {
    addDiagnostic(
      diagnostics,
      "INVALID_EXPORT_STATE",
      `${path}.exportState`,
      "导出状态只能是 current、collapsed 或 expanded。",
    );
  }
  validateDuration(block, path, diagnostics);
}

function validateBlock(
  value: unknown,
  path: string,
  diagnostics: DocumentDiagnostic[],
): value is ContentBlock {
  if (!isRecord(value)) {
    addDiagnostic(diagnostics, "INVALID_BLOCK", path, "内容块格式不对。");
    return false;
  }

  if (!isStableId(value.id)) {
    addDiagnostic(diagnostics, "MISSING_BLOCK_ID", `${path}.id`, "内容块缺少 id，或 id 格式不对。");
  }
  if (!isNonEmptyString(value.type)) {
    addDiagnostic(diagnostics, "MISSING_BLOCK_TYPE", `${path}.type`, "内容块缺少 type。");
    return false;
  }
  if (!hasOwn(blockFields, value.type)) {
    addDiagnostic(
      diagnostics,
      "UNKNOWN_BLOCK_TYPE",
      `${path}.type`,
      msg("不认识的内容块类型“{0}”。", value.type),
    );
    return false;
  }

  const type = value.type as ContentBlock["type"];
  validateKnownFields(value, blockFields[type], path, diagnostics);
  validateOptionalString(value, "summary", path, diagnostics);

  switch (type) {
    case "markdown":
      if (typeof value.source !== "string") {
        addDiagnostic(diagnostics, "INVALID_MARKDOWN_SOURCE", `${path}.source`, "正文缺少 source。");
      }
      break;
    case "image":
      if (!isStableId(value.assetId)) {
        addDiagnostic(diagnostics, "MISSING_ASSET_ID", `${path}.assetId`, "图片缺少 assetId。", "image");
      }
      validateOptionalString(value, "alt", path, diagnostics);
      validateOptionalString(value, "caption", path, diagnostics);
      if (value.width !== undefined && (typeof value.width !== "string" || !imageWidths.has(value.width))) {
        addDiagnostic(diagnostics, "INVALID_IMAGE_WIDTH", `${path}.width`, "图片宽度只能是 small、medium 或 full。");
      }
      break;
    case "file":
      if (!isStableId(value.assetId)) {
        addDiagnostic(diagnostics, "MISSING_ASSET_ID", `${path}.assetId`, "文件缺少 assetId。");
      }
      validateOptionalString(value, "label", path, diagnostics);
      break;
    case "reasoning":
      validateOptionalString(value, "title", path, diagnostics);
      if (typeof value.source !== "string") {
        addDiagnostic(diagnostics, "INVALID_REASONING_SOURCE", `${path}.source`, "思考过程缺少 source。");
      }
      if (value.status !== undefined && !executionStatuses.has(value.status as ExecutionStatus)) {
        addDiagnostic(diagnostics, "INVALID_EXECUTION_STATUS", `${path}.status`, "思考过程的 status 不对。");
      }
      validateCollapsibleBlock(value, path, diagnostics);
      break;
    case "toolCall":
      if (!isStableId(value.callId) || !isNonEmptyString(value.toolName) || !hasOwn(value, "input")) {
        addDiagnostic(diagnostics, "INVALID_TOOL_CALL", path, "工具调用缺少 callId、toolName 或 input。");
      }
      if (hasOwn(value, "input")) validateJsonValue(value.input, `${path}.input`, "工具调用的 input 不是有效的 JSON。", diagnostics);
      if (!executionStatuses.has(value.status as ExecutionStatus)) {
        addDiagnostic(diagnostics, "INVALID_EXECUTION_STATUS", `${path}.status`, "工具调用的 status 不对。");
      }
      validateCollapsibleBlock(value, path, diagnostics);
      break;
    case "toolResult":
      if (!isStableId(value.callId) || !hasOwn(value, "output")) {
        addDiagnostic(diagnostics, "INVALID_TOOL_RESULT", path, "工具结果缺少 callId 或 output。");
      }
      if (hasOwn(value, "output")) validateJsonValue(value.output, `${path}.output`, "工具结果的 output 不是有效的 JSON。", diagnostics);
      if (!executionStatuses.has(value.status as ExecutionStatus)) {
        addDiagnostic(diagnostics, "INVALID_EXECUTION_STATUS", `${path}.status`, "工具结果的 status 不对。");
      }
      validateCollapsibleBlock(value, path, diagnostics);
      break;
    case "unsupported":
      if (!isNonEmptyString(value.originalType) || !hasOwn(value, "raw")) {
        addDiagnostic(diagnostics, "INVALID_UNSUPPORTED_BLOCK", path, "暂不支持的内容缺少 originalType 或 raw。");
      }
      validateOptionalString(value, "reason", path, diagnostics);
      if (hasOwn(value, "raw")) validateJsonValue(value.raw, `${path}.raw`, "暂不支持的内容里，raw 不是有效的 JSON。", diagnostics);
      break;
  }
  return true;
}

function validateMessage(
  value: unknown,
  index: number,
  diagnostics: DocumentDiagnostic[],
): value is ConversationMessage {
  const path = `messages[${index}]`;
  if (!isRecord(value)) {
    addDiagnostic(diagnostics, "INVALID_MESSAGE", path, "消息格式不对。");
    return false;
  }
  validateKnownFields(value, messageFields, path, diagnostics);

  if (!isStableId(value.id)) {
    addDiagnostic(diagnostics, "MISSING_MESSAGE_ID", `${path}.id`, "消息缺少 id，或 id 格式不对。");
  }
  if (!messageRoles.has(value.role as MessageRole)) {
    addDiagnostic(diagnostics, "INVALID_MESSAGE_ROLE", `${path}.role`, "消息的 role 不对。");
  }
  if (value.role === "unknown" && !isNonEmptyString(value.sourceRole)) {
    addDiagnostic(diagnostics, "MISSING_SOURCE_ROLE", `${path}.sourceRole`, "role 为 unknown 时需要 sourceRole。");
  }
  for (const key of ["sourceRole", "displayName", "model"] as const) {
    validateOptionalString(value, key, path, diagnostics);
  }
  if (value.avatarAssetId !== undefined && !isStableId(value.avatarAssetId)) {
    addDiagnostic(diagnostics, "INVALID_AVATAR_ASSET_ID", `${path}.avatarAssetId`, "avatarAssetId 格式不对。");
  }
  if (value.timestamp !== undefined && !isDateTime(value.timestamp)) {
    addDiagnostic(diagnostics, "INVALID_TIMESTAMP", `${path}.timestamp`, "消息时间格式不对，例如 2026-09-20T12:00:00+08:00。");
  }
  if (value.status !== undefined && !messageStatuses.has(value.status as MessageStatus)) {
    addDiagnostic(diagnostics, "INVALID_MESSAGE_STATUS", `${path}.status`, "消息的 status 不对。");
  }
  if (!Array.isArray(value.blocks)) {
    addDiagnostic(diagnostics, "INVALID_BLOCK_LIST", `${path}.blocks`, "blocks 应该是列表。");
    return false;
  }
  value.blocks.forEach((block, blockIndex) => validateBlock(block, `${path}.blocks[${blockIndex}]`, diagnostics));
  return true;
}

function validateAsset(
  value: unknown,
  index: number,
  diagnostics: DocumentDiagnostic[],
): value is ConversationAsset {
  const path = `assets[${index}]`;
  if (!isRecord(value)) {
    addDiagnostic(diagnostics, "INVALID_ASSET", path, "附件格式不对。");
    return false;
  }
  validateKnownFields(value, assetFields, path, diagnostics);

  if (!isStableId(value.id) || !isNonEmptyString(value.fileName) || !isNonEmptyString(value.mimeType)) {
    addDiagnostic(diagnostics, "INVALID_ASSET_METADATA", path, "附件缺少 id、fileName 或 mimeType。");
  } else if (!/^[^\s/]+\/[^\s/]+$/.test(value.mimeType)) {
    addDiagnostic(diagnostics, "INVALID_MIME_TYPE", `${path}.mimeType`, "mimeType 格式不对。");
  }
  if (value.kind !== "image" && value.kind !== "file") {
    addDiagnostic(diagnostics, "INVALID_ASSET_KIND", `${path}.kind`, "附件的 kind 不对。");
  }
  if (value.byteSize !== undefined && (!Number.isInteger(value.byteSize) || Number(value.byteSize) < 0)) {
    addDiagnostic(diagnostics, "INVALID_ASSET_SIZE", `${path}.byteSize`, "byteSize 应该是 0 或正整数。");
  }
  for (const key of ["width", "height"] as const) {
    if (value[key] !== undefined && (!Number.isInteger(value[key]) || Number(value[key]) < 1)) {
      addDiagnostic(diagnostics, "INVALID_ASSET_DIMENSION", `${path}.${key}`, msg("{0} 应该是正整数。", key));
    }
  }

  if (!isRecord(value.source)) {
    addDiagnostic(diagnostics, "INVALID_ASSET_SOURCE", `${path}.source`, "附件的 source 格式不对。");
    return true;
  }
  if (value.source.kind === "fixture") {
    validateKnownFields(value.source, new Set(["kind", "path"]), `${path}.source`, diagnostics);
    if (!isNonEmptyString(value.source.path) || !fixturePathPattern.test(value.source.path) || value.source.path.split("/").includes("..")) {
      addDiagnostic(diagnostics, "INVALID_FIXTURE_PATH", `${path}.source.path`, "示例文件必须在 fixtures/assets/ 下。");
    }
  } else if (value.source.kind === "local") {
    validateKnownFields(value.source, new Set(["kind", "storageKey"]), `${path}.source`, diagnostics);
    if (!isNonEmptyString(value.source.storageKey)) {
      addDiagnostic(diagnostics, "INVALID_STORAGE_KEY", `${path}.source.storageKey`, "本地附件缺少 storageKey。");
    }
  } else {
    addDiagnostic(diagnostics, "INVALID_ASSET_SOURCE", `${path}.source.kind`, "附件 source 的 kind 不对。");
  }
  return true;
}

function validateUniqueIds(
  records: readonly { readonly value: unknown; readonly path: string }[],
  group: "asset" | "block" | "message",
  diagnostics: DocumentDiagnostic[],
): void {
  const seen = new Set<string>();
  for (const { value, path } of records) {
    if (!isRecord(value) || !isStableId(value.id)) continue;
    if (seen.has(value.id)) {
      addDiagnostic(diagnostics, `DUPLICATE_${group.toUpperCase()}_ID`, `${path}.id`, msg("{0} id 重复了：{1}。", msg({ asset: "附件", block: "内容块", message: "消息" }[group]), value.id));
    }
    seen.add(value.id);
  }
}

function validateReferences(
  messages: readonly unknown[],
  assets: readonly unknown[],
  diagnostics: DocumentDiagnostic[],
): void {
  const assetsById = new Map<string, Record<string, unknown>>();
  assets.forEach((asset) => {
    if (isRecord(asset) && isStableId(asset.id) && !assetsById.has(asset.id)) assetsById.set(asset.id, asset);
  });

  const toolCalls = new Map<string, { readonly path: string; readonly block: Record<string, unknown> }[]>();
  messages.forEach((message, messageIndex) => {
    if (!isRecord(message) || !Array.isArray(message.blocks)) return;
    message.blocks.forEach((block, blockIndex) => {
      if (!isRecord(block) || block.type !== "toolCall" || !isStableId(block.callId)) return;
      const records = toolCalls.get(block.callId) ?? [];
      records.push({ path: `messages[${messageIndex}].blocks[${blockIndex}]`, block });
      toolCalls.set(block.callId, records);
    });
  });
  for (const [callId, records] of toolCalls) {
    if (records.length > 1) {
      records.slice(1).forEach(({ path }) => addDiagnostic(diagnostics, "DUPLICATE_TOOL_CALL_ID", `${path}.callId`, msg("工具调用的 callId 重复了：{0}。", callId)));
    }
  }

  messages.forEach((message, messageIndex) => {
    if (!isRecord(message)) return;
    if (isStableId(message.avatarAssetId)) {
      const avatar = assetsById.get(message.avatarAssetId);
      if (!avatar) {
        addDiagnostic(diagnostics, "AVATAR_ASSET_NOT_FOUND", `messages[${messageIndex}].avatarAssetId`, msg("找不到头像文件：{0}。", message.avatarAssetId));
      } else if (avatar.kind !== "image") {
        addDiagnostic(diagnostics, "AVATAR_ASSET_KIND_MISMATCH", `messages[${messageIndex}].avatarAssetId`, "头像必须是图片。");
      }
    }
    if (!Array.isArray(message.blocks)) return;
    message.blocks.forEach((block, blockIndex) => {
      if (!isRecord(block)) return;
      const path = `messages[${messageIndex}].blocks[${blockIndex}]`;
      if (block.type === "image" || block.type === "file") {
        const asset = isStableId(block.assetId) ? assetsById.get(block.assetId) : undefined;
        if (!asset) {
          addDiagnostic(diagnostics, "ASSET_NOT_FOUND", `${path}.assetId`, msg("找不到文件：{0}。", diagnosticValue(block.assetId)));
        } else if (asset.kind !== block.type) {
          addDiagnostic(diagnostics, "ASSET_KIND_MISMATCH", `${path}.assetId`, msg("文件 {0} 的类型和内容块（{1}）对不上。", diagnosticValue(block.assetId), diagnosticValue(block.type)));
        }
      }
      if (block.type === "toolResult" && isStableId(block.callId)) {
        const records = toolCalls.get(block.callId) ?? [];
        if (records.length === 0) {
          addDiagnostic(diagnostics, "ORPHAN_TOOL_RESULT", `${path}.callId`, msg("工具结果找不到对应的工具调用：{0}。", block.callId));
        } else if (records.length > 1) {
          addDiagnostic(diagnostics, "AMBIGUOUS_TOOL_RESULT", `${path}.callId`, msg("多个工具调用用了同一个 callId：{0}。", block.callId));
        }
      }
    });
  });
}

function validateMetadata(raw: Record<string, unknown>, diagnostics: DocumentDiagnostic[]): void {
  if (!isRecord(raw.metadata)) {
    addDiagnostic(diagnostics, "INVALID_METADATA", "metadata", "metadata 格式不对。");
    return;
  }
  validateKnownFields(raw.metadata, metadataFields, "metadata", diagnostics);
  for (const key of ["title", "subtitle", "locale"] as const) validateOptionalString(raw.metadata, key, "metadata", diagnostics);
  for (const key of ["createdAt", "updatedAt"] as const) {
    if (raw.metadata[key] !== undefined && !isDateTime(raw.metadata[key])) {
      addDiagnostic(diagnostics, "INVALID_DATE_TIME", `metadata.${key}`, msg("{0} 时间格式不对，例如 2026-09-20T12:00:00+08:00。", key));
    }
  }
  if (
    isDateTime(raw.metadata.createdAt) &&
    isDateTime(raw.metadata.updatedAt) &&
    Date.parse(raw.metadata.createdAt) > Date.parse(raw.metadata.updatedAt)
  ) {
    addDiagnostic(diagnostics, "INVALID_TIME_ORDER", "metadata.updatedAt", "updatedAt 不能早于 createdAt。");
  }
}

export function loadConversationDocument(raw: unknown): LoadedDocument {
  const diagnostics: DocumentDiagnostic[] = [];
  if (!isRecord(raw)) {
    return {
      status: "invalid",
      title: "读不了这份文档",
      diagnostics: [{ code: "INVALID_DOCUMENT", path: "$", message: "内容不是一份文档。" }],
      raw,
    };
  }

  validateKnownFields(raw, documentFields, "$", diagnostics);
  if (raw.schemaVersion !== 1) {
    addDiagnostic(diagnostics, "UNSUPPORTED_SCHEMA_VERSION", "schemaVersion", msg("只支持 schemaVersion 1，这份是 {0}。", diagnosticValue(raw.schemaVersion)));
  }
  if (!isStableId(raw.id)) addDiagnostic(diagnostics, "MISSING_DOCUMENT_ID", "id", "文档缺少 id，或 id 格式不对。");
  validateMetadata(raw, diagnostics);

  if (!isRecord(raw.theme)) {
    addDiagnostic(diagnostics, "INVALID_THEME", "theme", "theme 格式不对。");
  } else {
    validateKnownFields(raw.theme, themeFields, "theme", diagnostics);
    if (!isStableId(raw.theme.id)) addDiagnostic(diagnostics, "INVALID_THEME", "theme.id", "theme 缺少 id。");
  }

  if (!isRecord(raw.canvas)) {
    addDiagnostic(diagnostics, "INVALID_CANVAS", "canvas", "canvas 格式不对。");
  } else {
    validateKnownFields(raw.canvas, canvasFields, "canvas", diagnostics);
    if (!(
      (raw.canvas.preset === "portrait" && raw.canvas.width === 480 && raw.canvas.scale === 3) ||
      (raw.canvas.preset === "wide" && raw.canvas.width === 720 && raw.canvas.scale === 2)
    )) {
      addDiagnostic(diagnostics, "INVALID_CANVAS", "canvas", "canvas 只能是竖版 480×3 或宽版 720×2。");
    }
  }

  const rawMessages = Array.isArray(raw.messages) ? raw.messages : [];
  const rawAssets = Array.isArray(raw.assets) ? raw.assets : [];
  if (!Array.isArray(raw.messages)) addDiagnostic(diagnostics, "INVALID_MESSAGE_LIST", "messages", "messages 应该是列表。");
  if (!Array.isArray(raw.assets)) addDiagnostic(diagnostics, "INVALID_ASSET_LIST", "assets", "assets 应该是列表。");

  rawMessages.forEach((message, index) => validateMessage(message, index, diagnostics));
  rawAssets.forEach((asset, index) => validateAsset(asset, index, diagnostics));
  validateUniqueIds(rawMessages.map((value, index) => ({ value, path: `messages[${index}]` })), "message", diagnostics);
  validateUniqueIds(rawAssets.map((value, index) => ({ value, path: `assets[${index}]` })), "asset", diagnostics);
  const rawBlocks = rawMessages.flatMap((message, messageIndex) =>
    isRecord(message) && Array.isArray(message.blocks)
      ? message.blocks.map((value, blockIndex) => ({ value, path: `messages[${messageIndex}].blocks[${blockIndex}]` }))
      : [],
  );
  validateUniqueIds(rawBlocks, "block", diagnostics);
  validateReferences(rawMessages, rawAssets, diagnostics);

  if (diagnostics.length > 0) {
    const title = isRecord(raw.metadata) && typeof raw.metadata.title === "string" ? raw.metadata.title : "读不了这份文档";
    return { status: "invalid", title, diagnostics, raw };
  }
  return { status: "valid", document: raw as unknown as ConversationDocument, diagnostics: [] };
}

export function migrateConversationDocumentV0(raw: unknown): LoadedDocument {
  if (!isRecord(raw) || raw.schemaVersion !== 0) {
    return {
      status: "invalid",
      title: "旧版文档升级失败",
      diagnostics: [{
        code: "MIGRATION_VERSION_MISMATCH",
        path: "schemaVersion",
        ...diagnosticMessage(msg("只能升级 schemaVersion 0 的文档，这份是 {0}。", isRecord(raw) ? diagnosticValue(raw.schemaVersion) : msg("无法识别"))),
      }],
      raw,
    };
  }

  try {
    const migrated = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>;
    migrated.schemaVersion = 1;
    return loadConversationDocument(migrated);
  } catch {
    return {
      status: "invalid",
      title: "旧版文档升级失败",
      diagnostics: [{ code: "MIGRATION_CLONE_FAILED", path: "$", message: "旧版文档不是有效的 JSON。" }],
      raw,
    };
  }
}

export function serializeConversationDocument(document: ConversationDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function restoreConversationDocument(serialized: string): LoadedDocument {
  try {
    return loadConversationDocument(JSON.parse(serialized) as unknown);
  } catch {
    return {
      status: "invalid",
      title: "读不了这份文档",
      diagnostics: [{ code: "INVALID_JSON", path: "$", message: "不是有效的 JSON。" }],
      raw: serialized,
    };
  }
}

export const loadFixture = loadConversationDocument;
