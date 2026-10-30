import type { ConversationAsset, ConversationDocument, JsonValue } from "./conversation-types";

function assetReferenceTokens(asset: ConversationAsset): readonly string[] {
  return [
    asset.id,
    `asset:${asset.id}`,
  ];
}

function collectUnsupportedAssetIds(
  raw: JsonValue,
  assetsByToken: ReadonlyMap<string, ReadonlySet<string>>,
  referenced: Set<string>,
) {
  const pending: JsonValue[] = [raw];
  const collectToken = (token: string) => {
    assetsByToken.get(token)?.forEach((assetId) => referenced.add(assetId));
  };

  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === "string") {
      collectToken(value);
    } else if (Array.isArray(value)) {
      for (const item of value) pending.push(item);
    } else if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) {
        collectToken(key);
        pending.push(item);
      }
    }
  }
}

function collectUnsupportedTokens(raw: JsonValue, tokens: Set<string>) {
  const pending: JsonValue[] = [raw];
  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === "string") {
      tokens.add(value);
    } else if (Array.isArray(value)) {
      for (const item of value) pending.push(item);
    } else if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) {
        tokens.add(key);
        pending.push(item);
      }
    }
  }
}

export function findAmbiguousUnsupportedAssetReferences(
  document: ConversationDocument,
): readonly string[] {
  const assetIdsByToken = new Map<string, Set<string>>();
  document.assets.forEach((asset) => {
    assetReferenceTokens(asset).forEach((token) => {
      const ids = assetIdsByToken.get(token) ?? new Set<string>();
      ids.add(asset.id);
      assetIdsByToken.set(token, ids);
    });
  });

  const unsupportedTokens = new Set<string>();
  document.messages.forEach((message) => message.blocks.forEach((block) => {
    if (block.type === "unsupported") collectUnsupportedTokens(block.raw, unsupportedTokens);
  }));

  return [...unsupportedTokens]
    .filter((token) => (assetIdsByToken.get(token)?.size ?? 0) > 1)
    .sort();
}

export function collectReferencedAssetIds(
  document: ConversationDocument,
): ReadonlySet<string> {
  const referenced = new Set<string>();
  const assetsByToken = new Map<string, Set<string>>();
  document.assets.forEach((asset) => {
    assetReferenceTokens(asset).forEach((token) => {
      const ids = assetsByToken.get(token) ?? new Set<string>();
      ids.add(asset.id);
      assetsByToken.set(token, ids);
    });
  });

  document.messages.forEach((message) => {
    if (message.avatarAssetId) referenced.add(message.avatarAssetId);
    message.blocks.forEach((block) => {
      if (block.type === "image" || block.type === "file") {
        referenced.add(block.assetId);
      } else if (block.type === "unsupported") {
        // Unknown Blocks commonly use ID-keyed maps as well as string values.
        // Only stable Asset IDs and their canonical package keys are portable
        // references. Opaque file names, local storage keys and fixture paths
        // must not retain another deleted private asset or be rewritten.
        collectUnsupportedAssetIds(block.raw, assetsByToken, referenced);
      }
    });
  });

  return referenced;
}

export function pruneUnreferencedAssets(
  document: ConversationDocument,
): ConversationDocument {
  const referenced = collectReferencedAssetIds(document);
  const assets = document.assets.filter((asset) => referenced.has(asset.id));
  return assets.length === document.assets.length ? document : { ...document, assets };
}
