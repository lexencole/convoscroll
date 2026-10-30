import type { ConversationDocument, ConversationMessage } from "../data/conversation-types";
import { pruneUnreferencedAssets } from "../data/document-assets";
import { resolveModelBrand } from "../models/model-brand";

const identityKeys = ["role", "sourceRole", "displayName", "model", "avatarAssetId"] as const;
export type MessageInfoPatch = Partial<Pick<ConversationMessage, typeof identityKeys[number] | "timestamp" | "status">>;
const defaultNames = ["ChatGPT", "OpenAI", "Claude", "Gemini", "DeepSeek", "Kimi", "GLM", "Grok"];

/** Match only explicit identity values. Freeze the returned IDs for the editing session. */
export function matchingIdentityIds(document: ConversationDocument, messageId: string): readonly string[] {
  const source = document.messages.find((message) => message.id === messageId);
  if (!source) return [];
  return document.messages.filter((message) => identityKeys.every((key) => (message[key] || "") === (source[key] || ""))).map((message) => message.id);
}

export function updateMessageInfo(document: ConversationDocument, messageIds: readonly string[], patch: MessageInfoPatch): ConversationDocument {
  const ids = new Set(messageIds);
  if (!ids.size || [...ids].some((id) => !document.messages.some((message) => message.id === id))) throw new Error("消息已经变了，请重新打开身份设置。");
  let changed = false;
  const messages = document.messages.map((message) => {
    if (!ids.has(message.id)) return message;
    const update = { ...patch };
    if ("model" in patch && !("displayName" in patch)) {
      const name = message.displayName;
      const followsModel = !name || name === "Assistant" || name === "AI 助手" || name === message.model
        || (defaultNames.includes(name) && Boolean(resolveModelBrand(message.model)) && resolveModelBrand(name) === resolveModelBrand(message.model));
      if (followsModel) update.displayName = patch.model || "AI 助手";
    }
    if (Object.keys(update).every((key) => message[key as keyof MessageInfoPatch] === update[key as keyof MessageInfoPatch])) return message;
    changed = true;
    return { ...message, ...update };
  });
  if (!changed) return document;
  const candidate = { ...document, messages };
  return "avatarAssetId" in patch ? pruneUnreferencedAssets(candidate) : candidate;
}

/** New messages reuse identity, never the previous message's body, timestamp or status. */
export function inheritRecentIdentity(document: ConversationDocument, messageId: string): ConversationDocument {
  const added = document.messages.find((message) => message.id === messageId);
  const previous = added && [...document.messages].reverse().find((message) => message.id !== messageId && message.role === added.role);
  if (!previous) return document;
  return updateMessageInfo(document, [messageId], {
    role: previous.role, sourceRole: previous.sourceRole, displayName: previous.displayName,
    model: previous.model, avatarAssetId: previous.avatarAssetId,
  });
}
