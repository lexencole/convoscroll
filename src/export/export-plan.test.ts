import { describe, expect, it } from "vitest";
import type { ConversationDocument } from "../data/conversation-types";
import {
  calculateSafeCssHeight,
  createSemanticExportPlan,
  type MeasuredCanvas,
} from "./export-plan";
import type { PngExportSettings } from "./export-types";

const settings: PngExportSettings = {
  fileName: "test",
  preset: "portrait",
  width: 480,
  scale: 3,
  foldStrategy: "block",
};

function createDocument(blocksByMessage: readonly (readonly string[])[]): ConversationDocument {
  return {
    schemaVersion: 1,
    id: "document-plan",
    metadata: { title: "Plan" },
    canvas: { preset: "portrait", width: 480, scale: 3 },
    theme: { id: "warm-editorial-v1" },
    assets: [],
    messages: blocksByMessage.map((blockIds, messageIndex) => ({
      id: `message-${messageIndex + 1}`,
      role: "assistant",
      blocks: blockIds.map((id) => ({ id, type: "markdown", source: id })),
    })),
  };
}

function measurement(
  messageHeights: readonly { readonly height: number; readonly blocks: readonly number[] }[],
  canvasHeight?: number,
): MeasuredCanvas {
  return {
    height: canvasHeight ?? 100 + messageHeights.reduce((sum, message) => sum + message.height, 0),
    headerHeight: 60,
    streamFixedHeight: 40,
    messageGap: 20,
    messages: messageHeights.map((message, messageIndex) => ({
      id: `message-${messageIndex + 1}`,
      height: message.height,
      fixedHeight: 100,
      blockGap: 12,
      blocks: message.blocks.map((height, blockIndex) => ({
        id: `block-${messageIndex + 1}-${blockIndex + 1}`,
        height,
      })),
    })),
  };
}

describe("semantic export plan", () => {
  it("keeps a safe conversation in one complete part", () => {
    const document = createDocument([["block-1-1"], ["block-2-1"]]);
    const result = createSemanticExportPlan(document, measurement([
      { height: 900, blocks: [800] },
      { height: 1_100, blocks: [1_000] },
    ], 2_120), settings);

    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]?.messages.map((message) => message.messageId)).toEqual([
      "message-1", "message-2",
    ]);
  });

  it("splits only between complete messages when each message is safe", () => {
    const maxHeight = calculateSafeCssHeight(480, 3);
    const document = createDocument([["block-1-1"], ["block-2-1"], ["block-3-1"]]);
    const result = createSemanticExportPlan(document, measurement([
      { height: 3_700, blocks: [3_600] },
      { height: 3_700, blocks: [3_600] },
      { height: 3_700, blocks: [3_600] },
    ], maxHeight + 2_000), settings);

    expect(result.parts).toHaveLength(2);
    expect(result.parts[0]?.messages).toHaveLength(2);
    expect(result.parts[1]?.messages).toEqual([{ messageId: "message-3" }]);
  });

  it("uses complete block boundaries for one extreme message", () => {
    const document = createDocument([[
      "block-1-1", "block-1-2", "block-1-3",
    ]]);
    const result = createSemanticExportPlan(document, measurement([
      { height: 10_900, blocks: [3_500, 3_500, 3_500] },
    ], 11_000), settings);

    expect(result.parts).toHaveLength(2);
    expect(result.parts[0]?.messages[0]).toMatchObject({
      blockIds: ["block-1-1", "block-1-2"],
      continuesToNext: true,
    });
    expect(result.parts[1]?.messages[0]).toMatchObject({
      blockIds: ["block-1-3"],
      continuedFromPrevious: true,
    });
  });

  it("uses trace-stack spacing when packing adjacent blocks", () => {
    const document = createDocument([["block-1-1", "block-1-2", "block-1-3"]]);
    const measured = measurement([{ height: 8_000, blocks: [3_779, 3_779, 200] }], 8_100);
    const plan = createSemanticExportPlan(document, {
      ...measured,
      messages: measured.messages.map((message) => ({
        ...message, blocks: message.blocks.map((block, index) => ({ ...block, gapBefore: index > 0 ? 8 : 0 })),
      })),
    }, settings);
    expect(plan.parts).toHaveLength(2);
    expect(plan.parts[0].messages[0].blockIds).toEqual(["block-1-1", "block-1-2"]);
    expect(plan.parts[0].estimatedCssHeight).toBe(7_766);
  });

  it("blocks export when a single block cannot fit", () => {
    const document = createDocument([["block-1-1"]]);
    expect(() => createSemanticExportPlan(document, measurement([
      { height: 9_000, blocks: [8_900] },
    ], 9_100), settings)).toThrow("第 1 条消息中的第 1 块内容过长，无法自动分段");
  });

  it("locates oversized content by document order when an earlier message is not measured", () => {
    const document = createDocument([["block-1-1"], ["block-2-1", "block-2-2"]]);
    const measured = measurement([
      { height: 200, blocks: [100] },
      { height: 9_300, blocks: [100, 9_000] },
    ], 9_600);
    expect(() => createSemanticExportPlan(document, {
      ...measured, messages: measured.messages.slice(1),
    }, settings)).toThrow("第 2 条消息中的第 2 块内容过长，无法自动分段");
  });
});
