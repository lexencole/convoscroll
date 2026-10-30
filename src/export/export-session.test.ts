import { describe, expect, it, vi } from "vitest";
import type { ConversationDocument } from "../data/conversation-types";
import { PngExportError, type PngExportResult, type PngExportSettings } from "./export-types";
import { runPngExportSession } from "./export-session";

const documentModel: ConversationDocument = {
  schemaVersion: 1,
  id: "document-session",
  metadata: { title: "Session" },
  canvas: { preset: "portrait", width: 480, scale: 3 },
  theme: { id: "warm-editorial-v1" },
  assets: [],
  messages: [{
    id: "message-1",
    role: "assistant",
    blocks: [{ id: "block-1", type: "markdown", source: "hello" }],
  }],
};

const multiDocument: ConversationDocument = {
  ...documentModel,
  id: "document-session-multi",
  messages: [
    documentModel.messages[0],
    {
      id: "message-2",
      role: "user",
      blocks: [{ id: "block-2", type: "markdown", source: "world" }],
    },
  ],
};

const settings: PngExportSettings = {
  fileName: "Session",
  preset: "portrait",
  width: 480,
  scale: 3,
  foldStrategy: "block",
};

function defineSize(element: HTMLElement, width: number, height: number) {
  Object.defineProperties(element, {
    offsetWidth: { configurable: true, value: width },
    offsetHeight: { configurable: true, value: height },
    clientWidth: { configurable: true, value: width },
    scrollWidth: { configurable: true, value: width },
  });
  element.getBoundingClientRect = () => ({
    x: 0,
    y: 0,
    top: 0,
    right: width,
    bottom: height,
    left: 0,
    width,
    height,
    toJSON: () => ({}),
  });
}

function createCanvas() {
  const canvas = globalThis.document.createElement("section");
  const header = globalThis.document.createElement("header");
  const stream = globalThis.document.createElement("div");
  const message = globalThis.document.createElement("article");
  const blocks = globalThis.document.createElement("div");
  const block = globalThis.document.createElement("div");
  canvas.className = "conversation-canvas";
  header.className = "canvas-header";
  stream.className = "conversation-stream";
  stream.style.padding = "20px 0";
  stream.style.gap = "20px";
  message.className = "message";
  message.dataset.messageId = "message-1";
  blocks.className = "message__blocks";
  blocks.style.gap = "12px";
  block.dataset.blockId = "block-1";
  blocks.append(block);
  message.append(blocks);
  stream.append(message);
  canvas.append(header, stream);
  defineSize(canvas, 480, 680);
  defineSize(header, 480, 100);
  defineSize(stream, 480, 580);
  defineSize(message, 440, 500);
  defineSize(blocks, 440, 400);
  defineSize(block, 440, 400);
  globalThis.document.body.append(canvas);
  return canvas;
}

function createMultiCanvas() {
  const canvas = globalThis.document.createElement("section");
  const header = globalThis.document.createElement("header");
  const stream = globalThis.document.createElement("div");
  canvas.className = "conversation-canvas";
  header.className = "canvas-header";
  stream.className = "conversation-stream";
  stream.style.padding = "20px 0";
  stream.style.gap = "20px";

  multiDocument.messages.forEach((messageModel, index) => {
    const message = globalThis.document.createElement("article");
    const blocks = globalThis.document.createElement("div");
    const block = globalThis.document.createElement("div");
    message.dataset.messageId = messageModel.id;
    blocks.className = "message__blocks";
    blocks.style.gap = "12px";
    block.dataset.blockId = messageModel.blocks[0].id;
    blocks.append(block);
    message.append(blocks);
    stream.append(message);
    defineSize(message, 440, 4_200);
    defineSize(blocks, 440, 4_100);
    defineSize(block, 440, 4_000 + index);
  });

  canvas.append(header, stream);
  defineSize(canvas, 480, 9_000);
  defineSize(header, 480, 100);
  defineSize(stream, 480, 8_900);
  globalThis.document.body.append(canvas);
  return canvas;
}

function partResult(): PngExportResult {
  return {
    blob: new Blob(["png"], { type: "image/png" }),
    durationMs: 10,
    metrics: {
      cssWidth: 480,
      cssHeight: 680,
      pixelWidth: 1_440,
      pixelHeight: 2_040,
      estimatedRgbaBytes: 11_750_400,
      imageCount: 0,
      codeBlockCount: 0,
      mathCount: 0,
    },
  };
}

describe("PNG export session", () => {
  it("reserves continuation heading height before selecting block boundaries", async () => {
    const document = {
      ...multiDocument,
      messages: [multiDocument.messages[0], {
        ...multiDocument.messages[1],
        blocks: [...multiDocument.messages[1].blocks, { id: "block-3", type: "markdown" as const, source: "tail" }],
      }],
    };
    const canvas = createMultiCanvas();
    const header = canvas.querySelector<HTMLElement>(".canvas-header")!;
    const messages = canvas.querySelectorAll<HTMLElement>("[data-message-id]");
    defineSize(canvas, 480, 8_000);
    defineSize(messages[0], 440, 200);
    defineSize(messages[0].querySelector<HTMLElement>("[data-block-id]")!, 440, 100);
    defineSize(messages[1], 440, 7_612);
    const firstBlock = messages[1].querySelector<HTMLElement>("[data-block-id]")!;
    defineSize(firstBlock, 440, 7_000);
    const tail = globalThis.document.createElement("div");
    tail.dataset.blockId = "block-3";
    firstBlock.parentElement!.append(tail);
    defineSize(tail, 440, 500);
    const exportPart = vi.fn(async () => partResult());
    const result = await runPngExportSession({
      document, canvas, settings, exportPart,
      applyPresentation(presentation) {
        defineSize(header, 480, presentation?.part && presentation.part.index > 0 ? 150 : 100);
      },
    });
    expect(result.parts.map((part) => part.blockIds)).toEqual([["block-1"], ["block-2"], ["block-3"]]);
    expect(exportPart).toHaveBeenCalledTimes(3);
    expect(header.offsetHeight).toBe(100);
  });

  it("applies derived presentation, exports and restores preview", async () => {
    const canvas = createCanvas();
    const applyPresentation = vi.fn();
    const exportPart = vi.fn(async () => partResult());

    const result = await runPngExportSession({
      document: documentModel,
      canvas,
      settings,
      applyPresentation,
      exportPart,
    });

    expect(result.parts[0]).toMatchObject({
      fileName: "Session.png",
      messageIds: ["message-1"],
      blockIds: ["block-1"],
    });
    expect(applyPresentation.mock.calls[0]?.[0]).toMatchObject({ width: 480, foldStrategy: "block" });
    expect(applyPresentation.mock.calls.at(-1)?.[0]).toBeUndefined();
    expect(exportPart).toHaveBeenCalledWith(canvas, { scale: 3 });
  });

  it("restores preview when part rendering fails", async () => {
    const applyPresentation = vi.fn();
    await expect(runPngExportSession({
      document: documentModel,
      canvas: createCanvas(),
      settings,
      applyPresentation,
      exportPart: vi.fn(async () => {
        throw new PngExportError("render-failed", "failed", "retry");
      }),
    })).rejects.toMatchObject({ code: "render-failed" });
    expect(applyPresentation.mock.calls.at(-1)?.[0]).toBeUndefined();
  });

  it("offers the highest lower scale that keeps a long export in one PNG", async () => {
    const applyPresentation = vi.fn();
    const exportPart = vi.fn(async () => partResult());
    const onMultiPartPlan = vi.fn(async () => ({ kind: "use-scale", scale: 2 } as const));

    const result = await runPngExportSession({
      document: multiDocument,
      canvas: createMultiCanvas(),
      settings,
      applyPresentation,
      exportPart,
      onMultiPartPlan,
    });

    expect(onMultiPartPlan).toHaveBeenCalledWith({ currentScale: 3, partCount: 2, suggestedScale: 2 });
    expect(result.parts).toHaveLength(1);
    expect(result.effectiveSettings.scale).toBe(2);
    expect(exportPart).toHaveBeenCalledTimes(1);
    expect(exportPart).toHaveBeenCalledWith(expect.any(HTMLElement), { scale: 2 });
    expect(applyPresentation.mock.calls.at(-1)?.[0]).toBeUndefined();
  });

  it("keeps semantic parts when the current scale is explicitly preserved", async () => {
    const exportPart = vi.fn(async () => partResult());
    const result = await runPngExportSession({
      document: multiDocument,
      canvas: createMultiCanvas(),
      settings,
      applyPresentation: vi.fn(),
      exportPart,
      onMultiPartPlan: vi.fn(async () => ({ kind: "continue" } as const)),
    });

    expect(result.parts).toHaveLength(2);
    expect(result.parts.map((part) => part.fileName)).toEqual([
      "Session-part-01-of-02.png",
      "Session-part-02-of-02.png",
    ]);
    expect(result.effectiveSettings.scale).toBe(3);
    expect(exportPart).toHaveBeenCalledTimes(2);
  });

  it("restores preview when cancellation happens before export", async () => {
    const controller = new AbortController();
    controller.abort();
    const applyPresentation = vi.fn();
    await expect(runPngExportSession({
      document: documentModel,
      canvas: createCanvas(),
      settings,
      applyPresentation,
      signal: controller.signal,
    })).rejects.toMatchObject({ code: "cancelled" });
    expect(applyPresentation.mock.calls.at(-1)?.[0]).toBeUndefined();
  });

  it("stops after a rendered part when cancellation happens mid-render", async () => {
    const controller = new AbortController();
    const applyPresentation = vi.fn();
    let finishPart: ((result: PngExportResult) => void) | undefined;
    const exportPart = vi.fn(() => new Promise<PngExportResult>((resolve) => {
      finishPart = resolve;
    }));
    const session = runPngExportSession({
      document: multiDocument,
      canvas: createMultiCanvas(),
      settings,
      applyPresentation,
      exportPart,
      signal: controller.signal,
      onMultiPartPlan: vi.fn(async () => ({ kind: "continue" } as const)),
    });
    const cancelled = expect(session).rejects.toMatchObject({ code: "cancelled" });

    await vi.waitFor(() => expect(exportPart).toHaveBeenCalledTimes(1));
    controller.abort();
    finishPart?.(partResult());

    await cancelled;
    expect(exportPart).toHaveBeenCalledTimes(1);
    expect(applyPresentation.mock.calls.at(-1)?.[0]).toBeUndefined();
  });
});
