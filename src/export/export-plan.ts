import { message as msg } from "../i18n/messages";
import type { ConversationDocument } from "../data/conversation-types";
import type { ExportMessageSlice } from "../renderer/ExportPresentationContext";
import {
  MAX_OUTPUT_SIDE_PX,
  PNG_EXPORT_SCALE,
  PRODUCTION_MAX_ESTIMATED_RGBA_BYTES,
  PRODUCTION_MAX_OUTPUT_HEIGHT_PX,
  PngExportError,
  type PngExportSettings,
} from "./export-types";

export interface MeasuredBlock {
  readonly id: string;
  readonly height: number;
  /** Actual spacing from the preceding block, including trace-stack grouping. */
  readonly gapBefore?: number;
}

export interface MeasuredMessage {
  readonly id: string;
  readonly height: number;
  readonly fixedHeight: number;
  readonly blockGap: number;
  readonly blocks: readonly MeasuredBlock[];
}

export interface MeasuredCanvas {
  readonly height: number;
  readonly headerHeight: number;
  readonly streamFixedHeight: number;
  readonly messageGap: number;
  readonly messages: readonly MeasuredMessage[];
}

export interface ExportPlanPart {
  readonly index: number;
  readonly estimatedCssHeight: number;
  readonly messages: readonly ExportMessageSlice[];
}

export interface SemanticExportPlan {
  readonly maxCssHeight: number;
  readonly parts: readonly ExportPlanPart[];
}

function cssNumber(style: CSSStyleDeclaration, property: string) {
  const parsed = Number.parseFloat(style.getPropertyValue(property));
  return Number.isFinite(parsed) ? parsed : 0;
}

function elementHeight(element: HTMLElement) {
  return Math.max(element.offsetHeight, element.getBoundingClientRect().height);
}

export function measureExportCanvas(
  element: HTMLElement,
  document: ConversationDocument,
): MeasuredCanvas {
  const header = element.querySelector<HTMLElement>(":scope > .canvas-header");
  const stream = element.querySelector<HTMLElement>(":scope > .conversation-stream");
  if (!header || !stream) {
    throw new PngExportError(
      "target-invalid",
      "页面还没显示完整。",
      "等页面显示完再试。",
    );
  }

  const streamStyle = getComputedStyle(stream);
  const streamFixedHeight = cssNumber(streamStyle, "padding-top") + cssNumber(streamStyle, "padding-bottom");
  const messageGap = cssNumber(streamStyle, "row-gap") || cssNumber(streamStyle, "gap");
  const messages: MeasuredMessage[] = [];
  const messageElements = new Map(
    Array.from(stream.querySelectorAll<HTMLElement>("[data-message-id]"))
      .map((candidate) => [candidate.dataset.messageId ?? "", candidate] as const),
  );

  for (const message of document.messages) {
    const messageElement = messageElements.get(message.id);
    if (!messageElement) continue;
    const blocksContainer = messageElement.querySelector<HTMLElement>(":scope > .message__blocks");
    const blockGap = blocksContainer
      ? cssNumber(getComputedStyle(blocksContainer), "row-gap") || cssNumber(getComputedStyle(blocksContainer), "gap")
      : 0;
    const blockElements = new Map(
      Array.from(messageElement.querySelectorAll<HTMLElement>("[data-block-id]"))
        .map((candidate) => [candidate.dataset.blockId ?? "", candidate] as const),
    );
    let previousBottom: number | undefined;
    const previewScale = messageElement.offsetWidth > 0
      ? messageElement.getBoundingClientRect().width / messageElement.offsetWidth : 1;
    const blocks = message.blocks.flatMap((block) => {
      const blockElement = blockElements.get(block.id);
      if (!blockElement) return [];
      const rect = blockElement.getBoundingClientRect();
      const gapBefore = previousBottom === undefined ? 0 : Math.max(0, (rect.top - previousBottom) / (previewScale || 1));
      previousBottom = rect.bottom;
      return [{ id: block.id, height: elementHeight(blockElement), gapBefore }];
    });
    const blockHeight = blocks.reduce((sum, block, index) => sum + block.height + (index > 0 ? block.gapBefore ?? blockGap : 0), 0);
    const height = elementHeight(messageElement);

    messages.push({
      id: message.id,
      height,
      fixedHeight: Math.max(0, height - blockHeight),
      blockGap,
      blocks,
    });
  }

  return {
    height: elementHeight(element),
    headerHeight: elementHeight(header),
    streamFixedHeight,
    messageGap,
    messages,
  };
}

export function calculateSafeCssHeight(
  width: number,
  scale = PNG_EXPORT_SCALE,
): number {
  const bySide = Math.floor(Math.min(MAX_OUTPUT_SIDE_PX, PRODUCTION_MAX_OUTPUT_HEIGHT_PX) / scale);
  const bytesPerCssRow = width * scale * scale * 4;
  const byMemory = Math.floor(PRODUCTION_MAX_ESTIMATED_RGBA_BYTES / bytesPerCssRow);
  return Math.max(1, Math.min(bySide, byMemory));
}

function blockGroupHeight(message: MeasuredMessage, blocks: readonly MeasuredBlock[]) {
  return message.fixedHeight
    + blocks.reduce((sum, block, index) => sum + block.height + (index > 0 ? block.gapBefore ?? message.blockGap : 0), 0);
}

export function createSemanticExportPlan(
  document: ConversationDocument,
  measurement: MeasuredCanvas,
  settings: PngExportSettings,
): SemanticExportPlan {
  const maxCssHeight = calculateSafeCssHeight(settings.width, settings.scale);
  const baseHeight = measurement.headerHeight + measurement.streamFixedHeight;
  const availableMessageHeight = maxCssHeight - baseHeight;
  if (availableMessageHeight <= 0) {
    throw new PngExportError(
      "output-too-large",
      "标题部分太长，一张图放不下。",
      "请缩短标题或说明，或降低清晰度。",
    );
  }

  const measuredById = new Map(measurement.messages.map((message) => [message.id, message]));
  const allMessages = document.messages.flatMap((message, index) => {
    const measured = measuredById.get(message.id);
    return measured ? [{ message, measured, number: index + 1 }] : [];
  });

  if (measurement.height <= maxCssHeight) {
    return {
      maxCssHeight,
      parts: [{
        index: 0,
        estimatedCssHeight: measurement.height,
        messages: allMessages.map(({ message }) => ({ messageId: message.id })),
      }],
    };
  }

  const draftParts: { height: number; messages: ExportMessageSlice[] }[] = [];
  let current = { height: baseHeight, messages: [] as ExportMessageSlice[] };

  const flush = () => {
    if (current.messages.length === 0) return;
    draftParts.push(current);
    current = { height: baseHeight, messages: [] };
  };

  for (const { message, measured, number } of allMessages) {
    const gap = current.messages.length > 0 ? measurement.messageGap : 0;
    if (measured.height <= availableMessageHeight) {
      if (current.height + gap + measured.height > maxCssHeight) flush();
      const nextGap = current.messages.length > 0 ? measurement.messageGap : 0;
      current.messages.push({ messageId: message.id });
      current.height += nextGap + measured.height;
      continue;
    }

    flush();
    if (measured.blocks.length === 0) {
      throw new PngExportError(
        "single-block-too-large",
        msg("第 {0} 条消息过长，无法自动分段。", number),
        "请缩短内容或降低清晰度。",
      );
    }

    const groups: MeasuredBlock[][] = [];
    let group: MeasuredBlock[] = [];
    for (const block of measured.blocks) {
      const candidate = [...group, block];
      if (blockGroupHeight(measured, candidate) <= availableMessageHeight) {
        group = candidate;
        continue;
      }
      if (group.length === 0) {
        throw new PngExportError(
          "single-block-too-large",
          msg("第 {0} 条消息中的第 {1} 块内容过长，无法自动分段。", number, message.blocks.findIndex((item) => item.id === block.id) + 1),
          "请缩短内容或降低清晰度。",
        );
      }
      groups.push(group);
      group = [block];
      if (blockGroupHeight(measured, group) > availableMessageHeight) {
        throw new PngExportError(
          "single-block-too-large",
          msg("第 {0} 条消息中的第 {1} 块内容过长，无法自动分段。", number, message.blocks.findIndex((item) => item.id === block.id) + 1),
          "请缩短内容或降低清晰度。",
        );
      }
    }
    if (group.length > 0) groups.push(group);

    groups.forEach((blocks, index) => {
      draftParts.push({
        height: baseHeight + blockGroupHeight(measured, blocks),
        messages: [{
          messageId: message.id,
          blockIds: blocks.map((block) => block.id),
          continuedFromPrevious: index > 0,
          continuesToNext: index < groups.length - 1,
        }],
      });
    });
  }
  flush();

  return {
    maxCssHeight,
    parts: draftParts.map((part, index) => ({
      index,
      estimatedCssHeight: part.height,
      messages: part.messages,
    })),
  };
}
