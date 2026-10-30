import { describe, expect, it } from "vitest";
import { createEmptyDocument, addMessage } from "./document-operations";
import { inheritRecentIdentity, matchingIdentityIds, updateMessageInfo } from "./message-identity";
import { attachAsset } from "./workbench-operations";
import type { ConversationDocument, ConversationMessage } from "../data/conversation-types";

const assistant: ConversationMessage = { id: "a1", role: "assistant", displayName: "ChatGPT", model: "ChatGPT", blocks: [{ id: "b1", type: "markdown", source: "内容" }] };
const doc: ConversationDocument = { ...createEmptyDocument(), messages: [assistant,
  { ...assistant, id: "a2", blocks: [{ id: "b2", type: "markdown", source: "更多内容" }], status: "error", timestamp: "2026-09-20T00:00:00Z" },
  { ...assistant, id: "a3", displayName: "同伴", blocks: [] },
  { ...assistant, id: "a4", model: "GPT-4", blocks: [] },
  { ...assistant, id: "u1", role: "user", blocks: [] },
] };

describe("message identity", () => {
  it("matches explicit identity and ignores message-local status, timestamp and content", () => {
    expect(matchingIdentityIds(doc, "a1")).toEqual(["a1", "a2"]);
    expect(matchingIdentityIds(doc, "missing")).toEqual([]);
  });
  it("keeps avatar overrides and unknown source roles separate", () => {
    const document = { ...doc, messages: [assistant, { ...assistant, id: "a2", avatarAssetId: "avatar" },
      { ...assistant, id: "x1", role: "unknown" as const, sourceRole: "critic" }, { ...assistant, id: "x2", role: "unknown" as const, sourceRole: "reviewer" }] };
    expect(matchingIdentityIds(document, "a1")).toEqual(["a1"]);
    expect(matchingIdentityIds(document, "x1")).toEqual(["x1"]);
  });
  it("treats absent and empty optional identity fields equally without fuzzy matching", () => {
    const document = { ...doc, messages: [{ id: "u1", role: "user" as const, blocks: [] }, { id: "u2", role: "user" as const, displayName: "", model: "", blocks: [] }] };
    expect(matchingIdentityIds(document, "u1")).toEqual(["u1", "u2"]);
  });
  it("updates a frozen group atomically and follows default model names without changing unrelated data", () => {
    const ids = matchingIdentityIds(doc, "a1");
    const next = updateMessageInfo(doc, ids, { model: "Claude" });
    expect(next.messages.slice(0, 2).map((message) => [message.displayName, message.model])).toEqual([["Claude", "Claude"], ["Claude", "Claude"]]);
    expect(next.messages[1].status).toBe("error"); expect(next.messages[1].timestamp).toBe(doc.messages[1].timestamp);
    expect(next.messages[0].blocks).toBe(doc.messages[0].blocks);
    expect(next.messages[2]).toBe(doc.messages[2]);
    expect(updateMessageInfo(next, ids, { displayName: "讲述者" }).messages.slice(0, 2).every((message) => message.displayName === "讲述者")).toBe(true);
  });
  it("preserves custom names and avatars when changing models", () => {
    expect(updateMessageInfo(doc, ["a3"], { model: "Claude" }).messages[2].displayName).toBe("同伴");
    const document = { ...doc, messages: [{ ...assistant, avatarAssetId: "portrait" }] };
    expect(updateMessageInfo(document, ["a1"], { model: "Claude" }).messages[0].avatarAssetId).toBe("portrait");
  });
  it("makes an edited single message a separate identity on the next open", () => {
    const next = updateMessageInfo(doc, ["a1"], { displayName: "单条例外" });
    expect(matchingIdentityIds(next, "a1")).toEqual(["a1"]);
    expect(matchingIdentityIds(next, "a2")).toEqual(["a2"]);
  });
  it("does not create history for no-op changes or partially update missing targets", () => {
    expect(updateMessageInfo(doc, ["a1"], { model: "ChatGPT" })).toBe(doc);
    expect(() => updateMessageInfo(doc, ["a1", "missing"], { model: "Claude" })).toThrow("消息已经变了");
  });
  it("shares one avatar asset across all targets and rejects a missing target", () => {
    const asset = { id: "avatar", kind: "image" as const, fileName: "avatar.png", mimeType: "image/png", byteSize: 5, source: { kind: "local" as const, storageKey: "local:avatar" } };
    const next = attachAsset(doc, { kind: "avatar", messageId: "a1", avatarMessageIds: ["a1", "a2"] }, asset);
    expect(next.assets).toEqual([asset]); expect(next.messages.slice(0, 2).every((message) => message.avatarAssetId === "avatar")).toBe(true);
    expect(next.messages[2].avatarAssetId).toBeUndefined();
    expect(() => attachAsset(doc, { kind: "avatar", messageId: "a1", avatarMessageIds: ["a1", "missing"] }, asset)).toThrow("头像没有换");
  });
  it("inherits only identity from the most recent message of the same role", () => {
    const added = addMessage({ ...doc, messages: doc.messages.slice(0, 2) }, "assistant");
    const next = inheritRecentIdentity(added.document, added.messageId).messages.at(-1)!;
    expect(next).toMatchObject({ role: "assistant", displayName: "ChatGPT", model: "ChatGPT" });
    expect(next.timestamp).toBeUndefined(); expect(next.status).toBeUndefined();
    expect(next.blocks).toEqual(added.document.messages.at(-1)!.blocks);
  });
});
