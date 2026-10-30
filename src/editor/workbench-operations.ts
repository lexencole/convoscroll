import type { ContentBlock, ConversationAsset, ConversationDocument } from "../data/conversation-types";
import { pruneUnreferencedAssets } from "../data/document-assets";
import { addBlock, assertCanAddLocalAsset, createEditorId, updateBlock, updateMessage } from "./document-operations";

export interface AssetTarget {
  readonly messageId: string;
  readonly kind: "avatar" | "image" | "file";
  readonly blockId?: string;
  readonly avatarMessageIds?: readonly string[];
  readonly insertion?: MarkdownInsertion;
}

export interface MarkdownInsertion {
  readonly blockId: string;
  readonly source: string;
  readonly before: string;
  readonly after: string;
}

/** Insert at a command paragraph, keeping its surrounding text and a place to continue typing. */
export function insertBlockAtMarkdown(document: ConversationDocument, messageId: string, insertion: MarkdownInsertion, block: ContentBlock): ConversationDocument {
  const message = document.messages.find((item) => item.id === messageId);
  const previous = message?.blocks.find((item) => item.id === insertion.blockId);
  if (!message || previous?.type !== "markdown" || previous.source !== insertion.source) throw new Error("插入位置已经变了，请重新输入 / 添加内容。");
  const before = insertion.before ? [{ ...previous, source: insertion.before }] : [];
  const after = { ...previous, id: before.length ? createEditorId("block") : previous.id, source: insertion.after };
  return updateMessage(document, message.id, {
    blocks: message.blocks.flatMap((entry) => entry.id === previous.id ? [...before, block, after] : [entry]),
  });
}

/** Replace a reference, never the shared asset. Retained Blobs make Undo possible. */
export function attachAsset(document: ConversationDocument, target: AssetTarget, asset: ConversationAsset): ConversationDocument {
  const message = document.messages.find((item) => item.id === target.messageId);
  if (!message) throw new Error("这条消息已经删了，文件没有加进去。");
  const kind = target.kind === "avatar" ? "image" : target.kind;
  if (asset.kind !== kind) throw new Error("文件类型不对。");
  const oldBlock = target.blockId ? message.blocks.find((item) => item.id === target.blockId) : undefined;
  if (target.blockId && (!oldBlock || oldBlock.type !== kind)) throw new Error("这一块已经变了，文件没有换。");
  let candidate: ConversationDocument = { ...document, assets: [...document.assets, asset] };
  if (target.kind === "avatar") {
    const ids = new Set(target.avatarMessageIds ?? [message.id]);
    if (!ids.has(message.id) || [...ids].some((id) => !document.messages.some((item) => item.id === id))) throw new Error("身份已经变了，头像没有换。");
    candidate = { ...candidate, messages: candidate.messages.map((item) => ids.has(item.id) ? { ...item, avatarAssetId: asset.id } : item) };
  }
  else if (target.blockId) candidate = updateBlock(candidate, message.id, target.blockId, (block) => {
    if (block.type !== kind) return block;
    if (block.type === "file") {
      const previousFileName = document.assets.find((item) => item.id === block.assetId)?.fileName;
      const label = !block.label || block.label === previousFileName ? asset.fileName : block.label;
      return { ...block, assetId: asset.id, label };
    }
    return { ...block, assetId: asset.id };
  });
  else {
    const block: ContentBlock = kind === "image"
    ? { id: createEditorId("block"), type: "image", assetId: asset.id, alt: asset.fileName, width: "full" }
    : { id: createEditorId("block"), type: "file", assetId: asset.id, label: asset.fileName };
    candidate = target.insertion ? insertBlockAtMarkdown(candidate, message.id, target.insertion, block) : addBlock(candidate, message.id, block);
  }
  candidate = pruneUnreferencedAssets(candidate);
  // Budget the resulting references; the resource being replaced counts only if
  // another block/avatar/opaque stable reference still needs it.
  assertCanAddLocalAsset({ ...candidate, assets: candidate.assets.filter((item) => item.id !== asset.id) }, {
    fileName: asset.fileName, mimeType: asset.mimeType, byteSize: asset.byteSize ?? 0,
  });
  return candidate;
}

function reorder<T extends { readonly id: string }>(items: readonly T[], id: string, beforeId?: string): readonly T[] {
  const source = items.find((item) => item.id === id);
  if (!source || id === beforeId || (beforeId && !items.some((item) => item.id === beforeId))) return items;
  const rest = items.filter((item) => item.id !== id);
  rest.splice(beforeId ? rest.findIndex((item) => item.id === beforeId) : rest.length, 0, source);
  return rest.every((item, index) => item === items[index]) ? items : rest;
}

export interface SortTarget { readonly messageId: string; readonly blockId?: string }

export function reorderContent(document: ConversationDocument, source: SortTarget, before?: SortTarget): ConversationDocument {
  if (source.blockId) {
    const message = document.messages.find((item) => item.id === source.messageId);
    if (!message) return document;
    if (before && before.messageId !== source.messageId) {
      const destination = document.messages.find((item) => item.id === before.messageId);
      const block = message.blocks.find((item) => item.id === source.blockId);
      if (!destination || !block || (before.blockId && !destination.blocks.some((item) => item.id === before.blockId))) return document;
      const blocks = [...destination.blocks];
      blocks.splice(before.blockId ? blocks.findIndex((item) => item.id === before.blockId) : blocks.length, 0, block);
      // Transfer atomically: removal would cascade into tool results and assets.
      return { ...document, messages: document.messages.map((item) => item === message
        ? { ...item, blocks: item.blocks.filter((entry) => entry !== block) }
        : item === destination ? { ...item, blocks } : item) };
    }
    const blocks = reorder(message.blocks, source.blockId, before?.blockId);
    return blocks === message.blocks ? document : updateMessage(document, message.id, { blocks });
  }
  if (before?.blockId) return document;
  const messages = reorder(document.messages, source.messageId, before?.messageId);
  return messages === document.messages ? document : { ...document, messages };
}
