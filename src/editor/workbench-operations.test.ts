import { describe, expect, it } from "vitest";
import { getFixture } from "../data/fixtures";
import { loadConversationDocument } from "../data/document-loader";
import type { ConversationAsset } from "../data/conversation-types";
import { attachAsset, insertBlockAtMarkdown, reorderContent } from "./workbench-operations";
import { addBlock, copyBlockToMessage, createBlock, createEmptyDocument, createMessage } from "./document-operations";
import { createDocumentHistory, documentHistoryReducer } from "./document-history";

function documentWithMessages() { return { ...createEmptyDocument(), messages: [createMessage("user"), createMessage("assistant"), createMessage("user")] }; }
const asset: ConversationAsset = { id: "new-image", kind: "image", fileName: "avatar.png", byteSize: 30, mimeType: "image/png", source: { kind: "local", storageKey: "local:new-image" } };

describe("workbench transactions", () => {
  it("reorders messages in one reversible transaction without changing identities", () => {
    const doc = documentWithMessages(); const ids = doc.messages.map((item) => item.id);
    const state = documentHistoryReducer(createDocumentHistory(doc), { type: "commit", update: (current) => reorderContent(current, { messageId: ids[0] }) });
    expect(state.present.messages.map((item) => item.id)).toEqual([ids[1], ids[2], ids[0]]);
    expect(documentHistoryReducer(state, { type: "undo" }).present).toEqual(doc);
    expect(reorderContent(doc, { messageId: ids[0] }, { messageId: ids[0] })).toBe(doc);
  });
  it("moves blocks within and across messages, preserving exact Markdown", () => {
    const initial = documentWithMessages(); const m = initial.messages[0];
    const doc = addBlock(initial, m.id, { id: "second", type: "markdown", source: "##  原文\n\n" });
    const next = reorderContent(doc, { messageId: m.id, blockId: "second" }, { messageId: m.id, blockId: m.blocks[0].id });
    expect(next.messages[0].blocks[0]).toEqual({ id: "second", type: "markdown", source: "##  原文\n\n" });
    const moved = reorderContent(doc, { messageId: m.id, blockId: "second" }, { messageId: initial.messages[1].id, blockId: initial.messages[1].blocks[0].id });
    expect(moved.messages[1].blocks[0]).toBe(doc.messages[0].blocks[1]);
    expect(moved.messages[0].blocks).toEqual(m.blocks);
    expect(reorderContent(doc, { messageId: m.id }, { messageId: m.id, blockId: "second" })).toBe(doc);
  });
  it("transfers every Rich block without dropping assets, unknown payload, or call references; undo is atomic", () => {
    const fixture = getFixture("rich"); if (fixture.status !== "valid") throw new Error("fixture");
    const empty = { ...createMessage("user"), blocks: [] };
    const doc = { ...fixture.document, messages: [...fixture.document.messages, empty] };
    for (const message of fixture.document.messages) for (const block of message.blocks) {
      const state = documentHistoryReducer(createDocumentHistory(doc), { type: "commit", update: current => reorderContent(current, { messageId: message.id, blockId: block.id }, { messageId: empty.id }) });
      expect(state.present.messages.at(-1)!.blocks[0]).toBe(block);
      expect(state.present.messages.flatMap(item => item.blocks)).toHaveLength(doc.messages.flatMap(item => item.blocks).length);
      expect(state.present.assets).toBe(doc.assets);
      expect(loadConversationDocument(state.present).status).toBe("valid");
      const undone = documentHistoryReducer(state, { type: "undo" });
      expect(undone.present).toBe(doc);
      expect(documentHistoryReducer(undone, { type: "redo" }).present).toBe(state.present);
    }
  });
  it("copies all block types with fresh IDs and existing tool/asset copying rules", () => {
    const fixture = getFixture("rich"); if (fixture.status !== "valid") throw new Error("fixture");
    const empty = { ...createMessage("user"), blocks: [] };
    const doc = { ...fixture.document, messages: [...fixture.document.messages, empty] };
    for (const message of fixture.document.messages) for (const block of message.blocks) {
      const next = copyBlockToMessage(doc, message.id, block.id, empty.id).document;
      const copy = next.messages.at(-1)!.blocks[0];
      expect(copy.id).not.toBe(block.id);
      expect(next.assets).toBe(doc.assets);
      expect(next.messages.find(item => item.id === message.id)).toBe(message);
      if (block.type === "toolCall") expect(copy).toEqual({ ...block, id: copy.id, callId: expect.not.stringMatching(block.callId) });
      else expect(copy).toEqual({ ...block, id: copy.id });
      expect(loadConversationDocument(next).status).toBe("valid");
    }
  });
  it("keeps data unchanged for vanished sources, targets, and insertion anchors", () => {
    const doc = documentWithMessages(), source = { messageId: doc.messages[0].id, blockId: doc.messages[0].blocks[0].id };
    for (const target of [{ messageId: "gone" }, { messageId: doc.messages[1].id, blockId: "gone" }]) expect(reorderContent(doc, source, target)).toBe(doc);
    expect(reorderContent(doc, { ...source, blockId: "gone" }, { messageId: doc.messages[1].id })).toBe(doc);
    expect(copyBlockToMessage(doc, source.messageId, source.blockId, "gone").document).toBe(doc);
    expect(copyBlockToMessage(doc, source.messageId, "gone", doc.messages[1].id).document).toBe(doc);
  });
  it("keeps tool references and unknown payload when sorting Rich", () => {
    const fixture = getFixture("rich"); if (fixture.status !== "valid") throw new Error("fixture");
    const next = reorderContent(fixture.document, { messageId: fixture.document.messages[0].id });
    expect(loadConversationDocument(next).status).toBe("valid");
    expect(next.messages.at(-1)).toEqual(fixture.document.messages[0]);
    expect(next.assets).toBe(fixture.document.assets);
  });
  it("attaches and replaces an avatar without changing a shared image", () => {
    const doc = documentWithMessages(); const messageId = doc.messages[0].id;
    const first = attachAsset(doc, { messageId, kind: "image" }, asset);
    const shared = attachAsset({ ...first, messages: first.messages.map((item) => item.id === messageId ? { ...item, avatarAssetId: asset.id } : item) }, { messageId, kind: "avatar" }, { ...asset, id: "next-avatar", source: { kind: "local", storageKey: "local:next-avatar" } });
    expect(shared.assets.map((item) => item.id)).toEqual(["new-image", "next-avatar"]);
    expect(shared.messages[0].avatarAssetId).toBe("next-avatar");
    expect(shared.messages[0].blocks.at(-1)).toMatchObject({ assetId: "new-image" });
    expect(loadConversationDocument(shared).status).toBe("valid");
  });
  it("replaces only the targeted attachment and prunes its old reference", () => {
    const doc = documentWithMessages(); const messageId = doc.messages[0].id;
    const first = attachAsset(doc, { messageId, kind: "image" }, asset);
    const blockId = first.messages[0].blocks.at(-1)!.id;
    const next = attachAsset(first, { messageId, kind: "image", blockId }, { ...asset, id: "replacement", source: { kind: "local", storageKey: "local:replacement" } });
    expect(next.assets.map((item) => item.id)).toEqual(["replacement"]);
    expect(next.messages[0].blocks.at(-1)).toMatchObject({ id: blockId, assetId: "replacement", alt: "avatar.png" });
    expect(first.assets[0]).toEqual(asset);
  });
  it("rejects vanished targets, mismatched types, and oversized files", () => {
    const doc = documentWithMessages(); const messageId = doc.messages[0].id;
    expect(() => attachAsset(doc, { messageId: "gone", kind: "avatar" }, asset)).toThrow("这条消息已经删了");
    expect(() => attachAsset(doc, { messageId, kind: "file" }, asset)).toThrow("类型");
    expect(() => attachAsset(doc, { messageId, kind: "image", blockId: "gone" }, asset)).toThrow("这一块已经变了");
    expect(() => attachAsset(doc, { messageId, kind: "avatar" }, { ...asset, byteSize: 33 * 1024 * 1024 })).toThrow("太大了");
    expect(doc.assets).toEqual([]);
  });
  it.each([
    [undefined, "new.md"], ["", "new.md"], ["notes.md", "new.md"], ["我的笔记", "我的笔记"],
  ])("replaces a file with label %s atomically, preserving custom names and shared references", (label, expectedLabel) => {
    const doc = documentWithMessages();
    const original: ConversationAsset = { id: "notes", kind: "file", fileName: "notes.md", byteSize: 6, mimeType: "text/markdown", source: { kind: "local", storageKey: "local:notes" } };
    const first = attachAsset(doc, { messageId: doc.messages[0].id, kind: "file" }, original);
    const block = first.messages[0].blocks.at(-1)!;
    const shared = addBlock({ ...first, messages: first.messages.map((message, index) => index === 0
      ? { ...message, blocks: message.blocks.map((item) => item.id === block.id ? { ...item, label } : item) } : message) },
    doc.messages[1].id, { id: "shared-file", type: "file", assetId: original.id, label: original.fileName });
    const replacement = { ...original, id: "replacement", fileName: "new.md", source: { kind: "local" as const, storageKey: "local:replacement" } };
    const state = documentHistoryReducer(createDocumentHistory(shared), { type: "commit", update: (current) => attachAsset(current, { messageId: doc.messages[0].id, kind: "file", blockId: block.id }, replacement) });
    expect(state.present.messages[0].blocks.at(-1)).toMatchObject({ id: block.id, assetId: replacement.id, label: expectedLabel });
    expect(state.present.messages[1]).toBe(shared.messages[1]);
    expect(state.present.assets).toEqual([original, replacement]);
    expect(loadConversationDocument(state.present).status).toBe("valid");
    const undone = documentHistoryReducer(state, { type: "undo" });
    expect(undone.present).toBe(shared);
    expect(documentHistoryReducer(undone, { type: "redo" }).present).toBe(state.present);
  });
  it.each([["前段\n", "后段\n"], ["", "后段\n"], ["前段\n", ""], ["", ""]])("inserts at a slash paragraph with before=%s and after=%s in one reversible edit", (before, after) => {
    const original = documentWithMessages();
    const source = `${before}\n/reason\n\n${after}`;
    const document = { ...original, messages: original.messages.map((item, i) => i === 0 ? { ...item, blocks: [{ id: "source", type: "markdown" as const, source }] } : item) };
    const block = createBlock("reasoning");
    const state = documentHistoryReducer(createDocumentHistory(document), { type: "commit", update: (current) => insertBlockAtMarkdown(current, document.messages[0].id, { blockId: "source", source, before, after }, block) });
    const blocks = state.present.messages[0].blocks;
    expect(blocks).toHaveLength(before ? 3 : 2);
    expect(blocks[before ? 1 : 0]).toEqual(block);
    expect(blocks.at(-1)).toMatchObject({ type: "markdown", source: after });
    expect(blocks[before ? 0 : 1]).toMatchObject({ id: "source", source: before || after });
    expect(new Set(blocks.map(item => item.id)).size).toBe(blocks.length);
    expect(loadConversationDocument(state.present).status).toBe("valid");
    const undone = documentHistoryReducer(state, { type: "undo" });
    expect(undone.present).toBe(document);
    expect(documentHistoryReducer(undone, { type: "redo" }).present).toBe(state.present);
  });
  it("adds an attachment and consumes its command together, rejecting stale locations without changing the document", () => {
    const original = documentWithMessages();
    const message = original.messages[0], source = "/file";
    const document = { ...original, messages: [{ ...message, blocks: [{ id: "command", type: "markdown" as const, source }] }, ...original.messages.slice(1)] };
    const insertion = { blockId: "command", source, before: "", after: "" };
    const file: ConversationAsset = { ...asset, kind: "file", fileName: "资料.txt", mimeType: "text/plain" };
    const next = attachAsset(document, { messageId: message.id, kind: "file", insertion }, file);
    expect(next.assets).toEqual([file]);
    expect(next.messages[0].blocks).toEqual([
      expect.objectContaining({ type: "file", label: "资料.txt", assetId: file.id }),
      { id: "command", type: "markdown", source: "" },
    ]);
    for (const target of [{ ...insertion, blockId: "gone" }, { ...insertion, source: "/other" }]) {
      expect(() => attachAsset(document, { messageId: message.id, kind: "file", insertion: target }, file)).toThrow("插入位置已经变了");
    }
    expect(document.messages[0].blocks).toEqual([{ id: "command", type: "markdown", source }]);
    expect(document.assets).toEqual([]);
  });
});
