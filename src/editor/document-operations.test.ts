import { describe, expect, it } from "vitest";
import { pruneUnreferencedAssets } from "../data/document-assets";
import type { ConversationAsset } from "../data/conversation-types";
import { loadConversationDocument } from "../data/document-loader";
import { PROJECT_LIMITS } from "../project/project-format";
import { attachAsset } from "./workbench-operations";
import {
  addBlock,
  addMessage,
  assertCanAddLocalAsset,
  createBlock,
  createEmptyDocument,
  createMessage,
  duplicateBlock,
  duplicateMessage,
  removeBlock,
  removeMessage,
  updateJsonBlockValue,
  updateMessage,
  updateToolCallId,
  type EditorIdFactory,
} from "./document-operations";

function sequenceFactory(): EditorIdFactory {
  let sequence = 0;
  return (kind) => `${kind}-test-${sequence += 1}`;
}

describe("document operations", () => {
  it("starts new AI messages as Claude and new user messages as 我", () => {
    expect(createMessage("assistant", sequenceFactory())).toMatchObject({ displayName: "Claude", model: "Claude" });
    expect(createMessage("user", sequenceFactory())).toMatchObject({ displayName: "我" });
    expect(createMessage("user", sequenceFactory())).not.toHaveProperty("model");
  });

  it("creates a valid empty document and valid messages", () => {
    const ids = sequenceFactory();
    const empty = createEmptyDocument(ids);
    const result = addMessage(empty, "user", ids);

    expect(loadConversationDocument(empty).status).toBe("valid");
    expect(loadConversationDocument(result.document).status).toBe("valid");
    expect(result.document.messages[0].blocks[0].type).toBe("markdown");
  });

  it("remaps internal tool references when duplicating a message", () => {
    const ids = sequenceFactory();
    let document = addMessage(createEmptyDocument(ids), "assistant", ids).document;
    const messageId = document.messages[0].id;
    const call = createBlock("toolCall", { idFactory: ids });
    if (call.type !== "toolCall") throw new Error("Expected Tool Call");
    document = addBlock(document, messageId, call);
    document = addBlock(document, messageId, createBlock("toolResult", {
      idFactory: ids,
      callId: call.callId,
    }));

    const duplicated = duplicateMessage(document, messageId, ids).document;
    const copy = duplicated.messages[1];
    const copiedCall = copy.blocks.find((block) => block.type === "toolCall");
    const copiedResult = copy.blocks.find((block) => block.type === "toolResult");

    expect(copiedCall?.type).toBe("toolCall");
    expect(copiedResult?.type).toBe("toolResult");
    if (copiedCall?.type !== "toolCall" || copiedResult?.type !== "toolResult") return;
    expect(copiedCall.callId).not.toBe(call.callId);
    expect(copiedResult.callId).toBe(copiedCall.callId);
    expect(loadConversationDocument(duplicated).status).toBe("valid");
  });

  it("gives a duplicated Tool Call its own call id", () => {
    const ids = sequenceFactory();
    let document = addMessage(createEmptyDocument(ids), "assistant", ids).document;
    const messageId = document.messages[0].id;
    const call = createBlock("toolCall", { idFactory: ids });
    document = addBlock(document, messageId, call);

    const duplicated = duplicateBlock(document, messageId, call.id, ids).document;
    const calls = duplicated.messages[0].blocks.filter((block) => block.type === "toolCall");
    expect(calls).toHaveLength(2);
    expect(calls[0].callId).not.toBe(calls[1].callId);
    expect(loadConversationDocument(duplicated).status).toBe("valid");
  });

  it("cascades Tool Results when removing a Tool Call or its message", () => {
    const ids = sequenceFactory();
    let document = createEmptyDocument(ids);
    const assistant = addMessage(document, "assistant", ids);
    document = assistant.document;
    const tool = addMessage(document, "tool", ids);
    document = tool.document;
    const call = createBlock("toolCall", { idFactory: ids });
    if (call.type !== "toolCall") throw new Error("Expected Tool Call");
    document = addBlock(document, assistant.messageId, call);
    const result = createBlock("toolResult", { idFactory: ids, callId: call.callId });
    document = addBlock(document, tool.messageId, result);

    const withoutCall = removeBlock(document, assistant.messageId, call.id);
    expect(withoutCall.messages.flatMap((message) => message.blocks).some(
      (block) => block.type === "toolResult" && block.callId === call.callId,
    )).toBe(false);
    expect(loadConversationDocument(withoutCall).status).toBe("valid");

    const withoutMessage = removeMessage(document, assistant.messageId);
    expect(withoutMessage.messages.flatMap((message) => message.blocks).some(
      (block) => block.type === "toolResult" && block.callId === call.callId,
    )).toBe(false);
    expect(loadConversationDocument(withoutMessage).status).toBe("valid");
  });

  it("renames a Tool Call and all related results atomically", () => {
    const ids = sequenceFactory();
    let document = addMessage(createEmptyDocument(ids), "assistant", ids).document;
    const messageId = document.messages[0].id;
    const call = createBlock("toolCall", { idFactory: ids });
    if (call.type !== "toolCall") throw new Error("Expected Tool Call");
    document = addBlock(document, messageId, call);
    document = addBlock(document, messageId, createBlock("toolResult", {
      idFactory: ids,
      callId: call.callId,
    }));

    const renamed = updateToolCallId(document, messageId, call.id, "call-renamed");
    const related = renamed.messages[0].blocks.filter(
      (block) => block.type === "toolCall" || block.type === "toolResult",
    );
    expect(related.every((block) => block.callId === "call-renamed")).toBe(true);
    expect(loadConversationDocument(renamed).status).toBe("valid");
  });

  it("attaches a local asset and block without storing an object URL", () => {
    const ids = sequenceFactory();
    const message = addMessage(createEmptyDocument(ids), "user", ids);
    const asset: ConversationAsset = {
      id: "asset-preview",
      kind: "image",
      fileName: "preview.png",
      mimeType: "image/png",
      byteSize: 2048,
      width: 640,
      height: 360,
      source: { kind: "local", storageKey: "local:asset-preview" },
    };
    const result = attachAsset(message.document, { messageId: message.messageId, kind: "image" }, asset);

    expect(result.assets).toEqual([asset]);
    expect(result.messages[0].blocks.at(-1)).toMatchObject({ type: "image", assetId: asset.id });
    expect(JSON.stringify(result)).not.toContain("blob:");
    expect(loadConversationDocument(result).status).toBe("valid");
  });

  it("prunes an asset only after its final Block or avatar reference is removed", () => {
    const ids = sequenceFactory();
    const first = addMessage(createEmptyDocument(ids), "user", ids);
    const asset: ConversationAsset = {
      id: "asset-shared",
      kind: "image",
      fileName: "shared.png",
      mimeType: "image/png",
      byteSize: 1024,
      source: { kind: "local", storageKey: "local:asset-shared" },
    };
    const attached = attachAsset(first.document, { messageId: first.messageId, kind: "image" }, asset);
    const block = attached.messages[0].blocks.at(-1)!;
    if (block.type !== "image") throw new Error("Expected image block");

    const second = addMessage(attached, "assistant", ids);
    const secondBlock = { ...block, id: ids("block") };
    let document = addBlock(second.document, second.messageId, secondBlock);
    document = updateMessage(document, second.messageId, { avatarAssetId: asset.id });

    document = removeBlock(document, first.messageId, block.id);
    expect(document.assets.map((item) => item.id)).toEqual([asset.id]);

    document = removeBlock(document, second.messageId, secondBlock.id);
    expect(document.assets.map((item) => item.id)).toEqual([asset.id]);

    document = removeMessage(document, second.messageId);
    expect(document.assets).toEqual([]);
    expect(loadConversationDocument(document).status).toBe("valid");
  });

  it("does not append an orphan asset when the attachment target no longer exists", () => {
    const ids = sequenceFactory();
    const document = createEmptyDocument(ids);
    const asset: ConversationAsset = {
      id: "asset-late",
      kind: "file",
      fileName: "late.txt",
      mimeType: "text/plain",
      byteSize: 4,
      source: { kind: "local", storageKey: "local:asset-late" },
    };

    expect(() => attachAsset(document, { messageId: "message-already-removed", kind: "file" }, asset))
      .toThrow("这条消息已经删了");
    expect(document.assets).toEqual([]);
  });

  it("rejects a new attachment before the editable project exceeds package limits", () => {
    const ids = sequenceFactory();
    const message = addMessage(createEmptyDocument(ids), "user", ids);
    const fullAssetBytes = [
      PROJECT_LIMITS.singleAssetBytes,
      PROJECT_LIMITS.singleAssetBytes,
      PROJECT_LIMITS.editorAssetBudgetBytes - 2 * PROJECT_LIMITS.singleAssetBytes,
    ];
    const assetRecords = fullAssetBytes.map((byteSize, index) => ({
      id: `asset-existing-${index}`,
      kind: "file" as const,
      fileName: `existing-${index}.bin`,
      mimeType: "application/octet-stream",
      byteSize,
      source: { kind: "local" as const, storageKey: `local:existing-${index}` },
    }));
    const withReferencedAssets = (assets: typeof assetRecords) => ({
      ...message.document,
      assets,
      messages: message.document.messages.map((item) => ({
        ...item,
        blocks: [
          ...item.blocks,
          ...assets.map((asset, index) => ({
            id: `block-existing-${index}`,
            type: "file" as const,
            assetId: asset.id,
          })),
        ],
      })),
    });
    const nearByteLimit = withReferencedAssets(assetRecords.slice(0, 2));

    const atExactLimit = attachAsset(nearByteLimit, { messageId: message.messageId, kind: "file" }, {
      id: "asset-last-allowed",
      kind: "file",
      fileName: "last-allowed.bin",
      mimeType: "application/octet-stream",
      byteSize: fullAssetBytes[2],
      source: { kind: "local", storageKey: "local:asset-last-allowed" },
    });
    expect(atExactLimit.assets.reduce((total, asset) => total + (asset.byteSize ?? 0), 0))
      .toBe(PROJECT_LIMITS.editorAssetBudgetBytes);

    expect(() => assertCanAddLocalAsset(withReferencedAssets(assetRecords), {
      fileName: "one-too-large.bin",
      mimeType: "application/octet-stream",
      byteSize: 1,
    })).toThrow(/82 MB/);

    expect(
      PROJECT_LIMITS.editorAssetBudgetBytes
      + PROJECT_LIMITS.documentBytes
      + PROJECT_LIMITS.manifestBytes
      + PROJECT_LIMITS.packageOverheadReserveBytes,
    ).toBe(PROJECT_LIMITS.compressedBytes);

    const entryLimitAssets = Array.from({ length: PROJECT_LIMITS.entryCount - 2 }, (_, index) => ({
      id: `asset-${index}`,
      kind: "file" as const,
      fileName: `${index}.bin`,
      mimeType: "application/octet-stream",
      byteSize: 0,
      source: { kind: "local" as const, storageKey: `local:${index}` },
    }));
    const atEntryLimit = withReferencedAssets(entryLimitAssets);
    expect(() => assertCanAddLocalAsset(atEntryLimit, {
      fileName: "one-too-many.bin",
      mimeType: "application/octet-stream",
      byteSize: 1,
    })).toThrow(/510 个文件/);
  });

  it("does not undercount a legacy attachment whose byte size is unknown", () => {
    const ids = sequenceFactory();
    const message = addMessage(createEmptyDocument(ids), "user", ids);
    const legacyDocument = {
      ...message.document,
      assets: [{
        id: "asset-legacy-unknown-size",
        kind: "file" as const,
        fileName: "legacy.bin",
        mimeType: "application/octet-stream",
        source: { kind: "local" as const, storageKey: "local:legacy" },
      }],
      messages: message.document.messages.map((item) => ({
        ...item,
        blocks: [...item.blocks, {
          id: "block-legacy-unknown-size",
          type: "file" as const,
          assetId: "asset-legacy-unknown-size",
        }],
      })),
    };

    expect(() => assertCanAddLocalAsset(legacyDocument, {
      fileName: "new.bin",
      mimeType: "application/octet-stream",
      byteSize: 1,
    })).toThrow(/不知道大小/);
  });

  it("blocks new attachments while a referenced legacy local Blob exceeds the single-asset limit", () => {
    const ids = sequenceFactory();
    const message = addMessage(createEmptyDocument(ids), "user", ids);
    const legacyDocument = {
      ...message.document,
      assets: [{
        id: "asset-legacy-oversized",
        kind: "file" as const,
        fileName: "legacy-oversized.bin",
        mimeType: "application/octet-stream",
        byteSize: PROJECT_LIMITS.singleAssetBytes + 1,
        source: { kind: "local" as const, storageKey: "local:legacy-oversized" },
      }],
      messages: message.document.messages.map((item) => ({
        ...item,
        blocks: [...item.blocks, {
          id: "block-legacy-oversized",
          type: "file" as const,
          assetId: "asset-legacy-oversized",
        }],
      })),
    };

    expect(() => assertCanAddLocalAsset(legacyDocument, {
      fileName: "new.bin",
      mimeType: "application/octet-stream",
      byteSize: 1,
    })).toThrow(/请先删掉它/);
  });

  it("blocks new attachments when the current serialized document exceeds its planning headroom", () => {
    const ids = sequenceFactory();
    const message = addMessage(createEmptyDocument(ids), "user", ids);
    const largeSource = "\u0000".repeat(Math.ceil(PROJECT_LIMITS.documentBytes / 6));
    const largeDocument = {
      ...message.document,
      messages: message.document.messages.map((item) => ({
        ...item,
        blocks: [...item.blocks, {
          id: "block-large-document",
          type: "markdown" as const,
          source: largeSource,
        }],
      })),
    };

    let addError: unknown;
    try {
      assertCanAddLocalAsset(largeDocument, {
        fileName: "new.bin",
        mimeType: "application/octet-stream",
        byteSize: 1,
      });
    } catch (error: unknown) {
      addError = error;
    }
    expect(addError).toMatchObject({ code: "DOCUMENT_TOO_LARGE", path: "document" });
  });

  it("blocks new attachments when legacy attachment metadata would overflow the manifest headroom", () => {
    const ids = sequenceFactory();
    const message = addMessage(createEmptyDocument(ids), "user", ids);
    const paddedFileName = `${"x".repeat(6_000)}.bin`;
    const legacyAssets = Array.from({ length: 200 }, (_, index) => ({
      id: `asset-legacy-manifest-${index}`,
      kind: "file" as const,
      fileName: paddedFileName,
      mimeType: "application/octet-stream",
      byteSize: 1,
      source: { kind: "local" as const, storageKey: `local:legacy-manifest-${index}` },
    }));
    const legacyDocument = {
      ...message.document,
      assets: legacyAssets,
      messages: message.document.messages.map((item) => ({
        ...item,
        blocks: [
          ...item.blocks,
          ...legacyAssets.map((asset, index) => ({
            id: `block-legacy-manifest-${index}`,
            type: "file" as const,
            assetId: asset.id,
          })),
        ],
      })),
    };

    let addError: unknown;
    try {
      assertCanAddLocalAsset(legacyDocument, {
        fileName: "new.bin",
        mimeType: "application/octet-stream",
        byteSize: 1,
      });
    } catch (error: unknown) {
      addError = error;
    }
    expect(addError).toMatchObject({ code: "MANIFEST_TOO_LARGE", path: "assets" });
  });

  it("does not let invisible legacy orphan metadata consume the editor asset budget", () => {
    const ids = sequenceFactory();
    const message = addMessage(createEmptyDocument(ids), "user", ids);
    const legacyDocument = {
      ...message.document,
      assets: [{
        id: "asset-legacy-orphan",
        kind: "file" as const,
        fileName: "orphan.bin",
        mimeType: "application/octet-stream",
        byteSize: PROJECT_LIMITS.editorAssetBudgetBytes,
        source: { kind: "local" as const, storageKey: "local:orphan" },
      }],
    };

    expect(() => assertCanAddLocalAsset(legacyDocument, {
      fileName: "visible.bin",
      mimeType: "application/octet-stream",
      byteSize: 1,
    })).not.toThrow();
  });

  it("recognizes ID-keyed unsupported references without retaining unrelated private assets", () => {
    const ids = sequenceFactory();
    const message = addMessage(createEmptyDocument(ids), "assistant", ids);
    const keyedAsset = {
      id: "asset-wide-unsupported",
      kind: "file" as const,
      fileName: "future.bin",
      mimeType: "application/octet-stream",
      byteSize: 1,
      source: { kind: "local" as const, storageKey: "local:future" },
    };
    const indirectlyReferencedAsset = {
      ...keyedAsset,
      id: "asset-indirect-unsupported",
      fileName: "future-indirect.bin",
      source: { kind: "local" as const, storageKey: "local:future-indirect" },
    };
    const document = {
      ...message.document,
      assets: [keyedAsset, indirectlyReferencedAsset],
      messages: message.document.messages.map((item) => ({
        ...item,
        blocks: [{
          id: "block-wide-unsupported",
          type: "unsupported" as const,
          originalType: "future-wide-payload",
          raw: { attachments: { [keyedAsset.id]: { storageKey: "encoded-elsewhere" } } },
        }],
      })),
    };

    expect(pruneUnreferencedAssets(document).assets).toEqual([keyedAsset]);
  });

  it("does not treat a non-unique file name in unsupported data as an asset reference", () => {
    const ids = sequenceFactory();
    const message = addMessage(createEmptyDocument(ids), "user", ids);
    const firstAsset: ConversationAsset = {
      id: "asset-first-same-name",
      kind: "image",
      fileName: "IMG_0001.JPG",
      mimeType: "image/jpeg",
      byteSize: 4,
      source: { kind: "local", storageKey: "local:first-same-name" },
    };
    const first = attachAsset(message.document, { messageId: message.messageId, kind: "image" }, firstAsset);
    const second = attachAsset(first, { messageId: message.messageId, kind: "image" }, {
      ...firstAsset,
      id: "asset-second-same-name",
      source: { kind: "local", storageKey: "local:second-same-name" },
    });
    const secondBlock = second.messages[0].blocks.at(-1)!;
    const withUnsupported = addBlock(second, message.messageId, {
      id: "block-unsupported-file-name-only",
      type: "unsupported",
      originalType: "future-attachment-note",
      raw: { fileName: "IMG_0001.JPG" },
    });

    const removed = removeBlock(withUnsupported, message.messageId, secondBlock.id);

    expect(removed.assets).toEqual([firstAsset]);
  });

  it("deletes a known attachment when an unrelated custom unsupported block remains", () => {
    const ids = sequenceFactory();
    const message = addMessage(createEmptyDocument(ids), "user", ids);
    const attached = attachAsset(message.document, { messageId: message.messageId, kind: "image" }, {
      id: "asset-private",
      kind: "image",
      fileName: "private.png",
      mimeType: "image/png",
      byteSize: 4,
      source: { kind: "local", storageKey: "local:private" },
    });
    const block = attached.messages[0].blocks.at(-1)!;
    const unsupported = createBlock("unsupported", { idFactory: ids });
    const withUnsupported = addBlock(attached, message.messageId, unsupported);

    const removed = removeBlock(withUnsupported, message.messageId, block.id);

    expect(removed.messages[0].blocks).toContainEqual(unsupported);
    expect(removed.messages[0].blocks).not.toContainEqual(block);
    expect(removed.assets).toEqual([]);
  });

  it("prunes asset metadata when an unsupported edit removes its final stable reference", () => {
    const ids = sequenceFactory();
    const message = addMessage(createEmptyDocument(ids), "assistant", ids);
    const asset = {
      id: "asset-future-reference",
      kind: "file" as const,
      fileName: "private-future.bin",
      mimeType: "application/octet-stream",
      byteSize: 4,
      source: { kind: "local" as const, storageKey: "local:future-reference" },
    };
    const document = {
      ...message.document,
      assets: [asset],
      messages: message.document.messages.map((item) => ({
        ...item,
        blocks: [{
          id: "block-future-reference",
          type: "unsupported" as const,
          originalType: "future-attachment",
          raw: { assetId: asset.id },
        }],
      })),
    };

    const updated = updateJsonBlockValue(
      document,
      message.messageId,
      "block-future-reference",
      { note: "attachment removed" },
    );

    expect(updated.assets).toEqual([]);
    expect(updated.messages[0].blocks[0]).toMatchObject({
      type: "unsupported",
      raw: { note: "attachment removed" },
    });
  });

  it("rejects an attachment above the shared project asset limit", () => {
    const ids = sequenceFactory();
    const message = addMessage(createEmptyDocument(ids), "user", ids);

    expect(() => assertCanAddLocalAsset(message.document, {
      fileName: "too-large.bin",
      mimeType: "application/octet-stream",
      byteSize: PROJECT_LIMITS.singleAssetBytes + 1,
    })).toThrow(/太大了/);
  });
});
