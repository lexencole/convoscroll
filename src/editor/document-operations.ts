import { canvasLocale, type Locale } from "../i18n/locale";
import { message as msg, translator } from "../i18n/messages";
import type {
  ContentBlock,
  ConversationAsset,
  ConversationDocument,
  ConversationMessage,
  JsonValue,
  MessageRole,
  ToolCallBlock,
} from "../data/conversation-types";
import { pruneUnreferencedAssets } from "../data/document-assets";
import {
  PROJECT_FORMAT_ID,
  PROJECT_LIMITS,
  PROJECT_PACKAGE_VERSION,
  ProjectFormatError,
} from "../project/project-format";
import { THEME_V1_ID } from "../theme/theme-v1";

export type EditorEntityKind = "asset" | "block" | "call" | "document" | "message";
export type EditorIdFactory = (kind: EditorEntityKind) => string;

const MANIFEST_HASH_PLACEHOLDER = "0".repeat(64);
const MANIFEST_ID_PLACEHOLDER = "a".repeat(128);

function estimateManifestBytes(
  assets: readonly ConversationAsset[],
  input: { readonly fileName: string; readonly mimeType?: string; readonly byteSize: number },
): number {
  const availableAssets = [...assets, {
    id: MANIFEST_ID_PLACEHOLDER,
    fileName: input.fileName,
    mimeType: input.mimeType || "application/octet-stream",
    byteSize: input.byteSize,
  }];
  const manifestShape = {
    format: PROJECT_FORMAT_ID,
    packageVersion: PROJECT_PACKAGE_VERSION,
    schemaVersion: 1,
    createdAt: "2000-01-01T00:00:00.000Z",
    appVersion: "0".repeat(32),
    documentPath: "document.json",
    documentByteSize: PROJECT_LIMITS.documentBytes,
    documentSha256: MANIFEST_HASH_PLACEHOLDER,
    assets: availableAssets.map((asset, index) => ({
      assetId: asset.id,
      storageKey: `asset:${asset.id}`,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      state: "available",
      path: `assets/${String(index).padStart(4, "0")}.bin`,
      byteSize: asset.byteSize,
      sha256: MANIFEST_HASH_PLACEHOLDER,
    })),
  };
  return new TextEncoder().encode(JSON.stringify(manifestShape, null, 2)).byteLength;
}

export function assertCanAddLocalAsset(
  document: ConversationDocument,
  input: { readonly fileName: string; readonly mimeType?: string; readonly byteSize: number },
): void {
  const referencedAssets = pruneUnreferencedAssets(document).assets;
  if (input.byteSize > PROJECT_LIMITS.singleAssetBytes) {
    throw new ProjectFormatError(
      msg("{0} 太大了，单个文件最多 {1} MB。", input.fileName, PROJECT_LIMITS.singleAssetBytes / 1024 / 1024),
      "ASSET_TOO_LARGE",
      input.fileName,
    );
  }
  if (referencedAssets.length + 3 > PROJECT_LIMITS.entryCount) {
    throw new ProjectFormatError(
      msg("一个项目最多 {0} 个文件。", PROJECT_LIMITS.entryCount - 2),
      "TOO_MANY_ENTRIES",
      "assets",
    );
  }
  const oversizedLocalAsset = referencedAssets.find((asset) => (
    asset.source.kind === "local"
    && asset.byteSize !== undefined
    && asset.byteSize > PROJECT_LIMITS.singleAssetBytes
  ));
  if (oversizedLocalAsset) {
    throw new ProjectFormatError(
      msg("已有的 {0} 太大了，请先删掉它。", oversizedLocalAsset.fileName),
      "ASSET_TOO_LARGE",
      "assets",
    );
  }
  const unknownSizeAsset = referencedAssets.find((asset) => asset.byteSize === undefined);
  if (unknownSizeAsset) {
    throw new ProjectFormatError(
      msg("已有的 {0} 不知道大小，加不了新文件。请先删掉它，或重新导入项目。", unknownSizeAsset.fileName),
      "UNKNOWN_ASSET_SIZE",
      "assets",
    );
  }
  const documentBytes = new TextEncoder().encode(JSON.stringify(document, null, 2)).byteLength;
  if (documentBytes > PROJECT_LIMITS.documentBytes) {
    throw new ProjectFormatError(
      msg("文字内容超过 {0} MB，加不了新文件。", PROJECT_LIMITS.documentBytes / 1024 / 1024),
      "DOCUMENT_TOO_LARGE",
      "document",
    );
  }
  if (estimateManifestBytes(referencedAssets, input) > PROJECT_LIMITS.manifestBytes) {
    throw new ProjectFormatError(
      msg("文件太多，加不了新文件。"),
      "MANIFEST_TOO_LARGE",
      "assets",
    );
  }
  const currentBytes = referencedAssets.reduce(
    (total, asset) => total + (asset.byteSize ?? 0),
    0,
  );
  if (currentBytes + input.byteSize > PROJECT_LIMITS.editorAssetBudgetBytes) {
    throw new ProjectFormatError(
      msg("所有文件加起来不能超过 {0} MB。", PROJECT_LIMITS.editorAssetBudgetBytes / 1024 / 1024),
      "EDITOR_ASSET_BUDGET_EXCEEDED",
      "assets",
    );
  }
}

let fallbackSequence = 0;

export const createEditorId: EditorIdFactory = (kind) => {
  const suffix = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${(fallbackSequence += 1).toString(36)}`;
  return `${kind}-${suffix}`;
};

export function createEmptyDocument(idFactory: EditorIdFactory = createEditorId, locale: Locale = "zh-CN"): ConversationDocument {
  return {
    schemaVersion: 1,
    id: idFactory("document"),
    metadata: {
      title: translator(locale)("未命名对话"),
      subtitle: "",
      locale,
    },
    canvas: { preset: "portrait", width: 480, scale: 3 },
    theme: { id: THEME_V1_ID },
    messages: [],
    assets: [],
  };
}

export function createBlock(
  type: Exclude<ContentBlock["type"], "file" | "image">,
  options: { readonly callId?: string; readonly idFactory?: EditorIdFactory; readonly locale?: string } = {},
): ContentBlock {
  const idFactory = options.idFactory ?? createEditorId;
  const id = idFactory("block");
  const t = translator(canvasLocale(options.locale));

  switch (type) {
    case "markdown":
      return { id, type, source: "" };
    case "reasoning":
      return {
        id,
        type,
        title: t("思考过程"),
        summary: "",
        source: "",
        status: "neutral",
        displayState: "collapsed",
        exportState: "current",
      };
    case "toolCall":
      return {
        id,
        type,
        callId: idFactory("call"),
        toolName: "tool_name",
        summary: "",
        input: {},
        status: "neutral",
        displayState: "collapsed",
        exportState: "current",
      };
    case "toolResult":
      if (!options.callId) throw new Error("Tool Result requires an existing callId.");
      return {
        id,
        type,
        callId: options.callId,
        summary: "",
        output: {},
        status: "success",
        displayState: "collapsed",
        exportState: "current",
      };
    case "unsupported":
      return {
        id,
        type,
        originalType: "custom",
        reason: t("暂不支持这种内容"),
        raw: {},
      };
  }
}

/** New AI messages start as Claude until the writer picks another model. */
export const DEFAULT_ASSISTANT_MODEL = "Claude";

export function createMessage(
  role: MessageRole = "user",
  idFactory: EditorIdFactory = createEditorId,
  locale: Locale = "zh-CN",
): ConversationMessage {
  const defaults: Partial<Record<MessageRole, string>> = {
    assistant: DEFAULT_ASSISTANT_MODEL,
    developer: "开发者",
    system: "系统",
    tool: "工具",
    user: "我",
  };

  return {
    id: idFactory("message"),
    role,
    ...(role === "unknown" ? { sourceRole: "custom" } : {}),
    displayName: translator(locale)(defaults[role] ?? "其他"),
    ...(role === "assistant" ? { model: DEFAULT_ASSISTANT_MODEL } : {}),
    blocks: [createBlock("markdown", { idFactory })],
  };
}

function updateMessageAt(
  document: ConversationDocument,
  messageId: string,
  update: (message: ConversationMessage) => ConversationMessage,
): ConversationDocument {
  return {
    ...document,
    messages: document.messages.map((message) => message.id === messageId ? update(message) : message),
  };
}

export function updateDocumentMetadata(
  document: ConversationDocument,
  patch: Partial<ConversationDocument["metadata"]>,
): ConversationDocument {
  return { ...document, metadata: { ...document.metadata, ...patch } };
}

export function updateMessage(
  document: ConversationDocument,
  messageId: string,
  patch: Partial<ConversationMessage>,
): ConversationDocument {
  return updateMessageAt(document, messageId, (message) => ({ ...message, ...patch, id: message.id }));
}

export function addMessage(
  document: ConversationDocument,
  role: MessageRole = "user",
  idFactory: EditorIdFactory = createEditorId,
): { readonly document: ConversationDocument; readonly messageId: string } {
  const message = createMessage(role, idFactory, canvasLocale(document.metadata.locale));
  return {
    document: { ...document, messages: [...document.messages, message] },
    messageId: message.id,
  };
}

function moveItem<T>(items: readonly T[], index: number, direction: -1 | 1): readonly T[] {
  const target = index + direction;
  if (index < 0 || target < 0 || target >= items.length) return items;
  const next = [...items];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function moveMessage(
  document: ConversationDocument,
  messageId: string,
  direction: -1 | 1,
): ConversationDocument {
  const index = document.messages.findIndex((message) => message.id === messageId);
  const messages = moveItem(document.messages, index, direction);
  return messages === document.messages ? document : { ...document, messages };
}

function cloneBlock(
  block: ContentBlock,
  idFactory: EditorIdFactory,
  callIdMap?: ReadonlyMap<string, string>,
): ContentBlock {
  const id = idFactory("block");
  if (block.type === "toolCall") {
    return {
      ...block,
      id,
      callId: callIdMap?.get(block.callId) ?? idFactory("call"),
    };
  }
  if (block.type === "toolResult") {
    return { ...block, id, callId: callIdMap?.get(block.callId) ?? block.callId };
  }
  return { ...block, id };
}

export function duplicateMessage(
  document: ConversationDocument,
  messageId: string,
  idFactory: EditorIdFactory = createEditorId,
): { readonly document: ConversationDocument; readonly messageId?: string } {
  const index = document.messages.findIndex((message) => message.id === messageId);
  if (index < 0) return { document };

  const source = document.messages[index];
  const callIdMap = new Map<string, string>();
  source.blocks.forEach((block) => {
    if (block.type === "toolCall") callIdMap.set(block.callId, idFactory("call"));
  });
  const copy: ConversationMessage = {
    ...source,
    id: idFactory("message"),
    blocks: source.blocks.map((block) => cloneBlock(block, idFactory, callIdMap)),
  };
  const messages = [...document.messages];
  messages.splice(index + 1, 0, copy);
  return { document: { ...document, messages }, messageId: copy.id };
}

function toolCallIdsInMessage(message: ConversationMessage): ReadonlySet<string> {
  return new Set(
    message.blocks
      .filter((block): block is ToolCallBlock => block.type === "toolCall")
      .map((block) => block.callId),
  );
}

function removeToolResults(
  messages: readonly ConversationMessage[],
  callIds: ReadonlySet<string>,
): readonly ConversationMessage[] {
  if (callIds.size === 0) return messages;
  return messages.map((message) => ({
    ...message,
    blocks: message.blocks.filter(
      (block) => block.type !== "toolResult" || !callIds.has(block.callId),
    ),
  }));
}

export function removeMessage(
  document: ConversationDocument,
  messageId: string,
): ConversationDocument {
  const target = document.messages.find((message) => message.id === messageId);
  if (!target) return document;
  const remaining = document.messages.filter((message) => message.id !== messageId);
  return pruneUnreferencedAssets({
    ...document,
    messages: removeToolResults(remaining, toolCallIdsInMessage(target)),
  });
}

export function updateBlock(
  document: ConversationDocument,
  messageId: string,
  blockId: string,
  update: (block: ContentBlock) => ContentBlock,
): ConversationDocument {
  return updateMessageAt(document, messageId, (message) => ({
    ...message,
    blocks: message.blocks.map((block) => block.id === blockId ? update(block) : block),
  }));
}

export function addBlock(
  document: ConversationDocument,
  messageId: string,
  block: ContentBlock,
): ConversationDocument {
  return updateMessageAt(document, messageId, (message) => ({
    ...message,
    blocks: [...message.blocks, block],
  }));
}

export function moveBlock(
  document: ConversationDocument,
  messageId: string,
  blockId: string,
  direction: -1 | 1,
): ConversationDocument {
  return updateMessageAt(document, messageId, (message) => {
    const index = message.blocks.findIndex((block) => block.id === blockId);
    const blocks = moveItem(message.blocks, index, direction);
    return blocks === message.blocks ? message : { ...message, blocks };
  });
}

export function duplicateBlock(
  document: ConversationDocument,
  messageId: string,
  blockId: string,
  idFactory: EditorIdFactory = createEditorId,
): { readonly document: ConversationDocument; readonly blockId?: string } {
  let createdBlockId: string | undefined;
  const next = updateMessageAt(document, messageId, (message) => {
    const index = message.blocks.findIndex((block) => block.id === blockId);
    if (index < 0) return message;
    const copy = cloneBlock(message.blocks[index], idFactory);
    createdBlockId = copy.id;
    const blocks = [...message.blocks];
    blocks.splice(index + 1, 0, copy);
    return { ...message, blocks };
  });
  return { document: next, blockId: createdBlockId };
}

/** Append a copy using the same identity/reference rules as duplicateBlock. */
export function copyBlockToMessage(
  document: ConversationDocument,
  messageId: string,
  blockId: string,
  destinationId: string,
  idFactory: EditorIdFactory = createEditorId,
): { readonly document: ConversationDocument; readonly blockId?: string } {
  const block = document.messages.find((item) => item.id === messageId)?.blocks.find((item) => item.id === blockId);
  if (!block || !document.messages.some((item) => item.id === destinationId)) return { document };
  const copy = cloneBlock(block, idFactory);
  return { document: addBlock(document, destinationId, copy), blockId: copy.id };
}

export function removeBlock(
  document: ConversationDocument,
  messageId: string,
  blockId: string,
): ConversationDocument {
  const message = document.messages.find((item) => item.id === messageId);
  const block = message?.blocks.find((item) => item.id === blockId);
  if (!message || !block) return document;

  let messages: readonly ConversationMessage[] = document.messages.map((item) => item.id === messageId
    ? { ...item, blocks: item.blocks.filter((candidate) => candidate.id !== blockId) }
    : item);
  if (block.type === "toolCall") messages = removeToolResults(messages, new Set([block.callId]));
  return pruneUnreferencedAssets({ ...document, messages });
}

export function updateToolCallId(
  document: ConversationDocument,
  messageId: string,
  blockId: string,
  nextCallId: string,
): ConversationDocument {
  const trimmed = nextCallId.trim();
  if (!trimmed) return document;
  const target = document.messages
    .find((message) => message.id === messageId)
    ?.blocks.find((block): block is ToolCallBlock => block.id === blockId && block.type === "toolCall");
  if (!target || target.callId === trimmed) return document;
  const duplicate = document.messages.some((message) => message.blocks.some(
    (block) => block.type === "toolCall" && block.id !== blockId && block.callId === trimmed,
  ));
  if (duplicate) return document;

  return {
    ...document,
    messages: document.messages.map((message) => ({
      ...message,
      blocks: message.blocks.map((block) => {
        if (block.id === blockId && block.type === "toolCall") return { ...block, callId: trimmed };
        if (block.type === "toolResult" && block.callId === target.callId) return { ...block, callId: trimmed };
        return block;
      }),
    })),
  };
}

export function collectToolCallIds(document: ConversationDocument): readonly string[] {
  return document.messages.flatMap((message) => message.blocks.flatMap(
    (block) => block.type === "toolCall" ? [block.callId] : [],
  ));
}

export function updateJsonBlockValue(
  document: ConversationDocument,
  messageId: string,
  blockId: string,
  value: JsonValue,
): ConversationDocument {
  const updated = updateBlock(document, messageId, blockId, (block) => {
    if (block.type === "toolCall") return { ...block, input: value };
    if (block.type === "toolResult") return { ...block, output: value };
    if (block.type === "unsupported") return { ...block, raw: value };
    return block;
  });

  const updatedBlock = updated.messages
    .find((message) => message.id === messageId)
    ?.blocks.find((block) => block.id === blockId);
  return updatedBlock?.type === "unsupported"
    ? pruneUnreferencedAssets(updated)
    : updated;
}
