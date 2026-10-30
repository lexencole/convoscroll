import { message as msg, diagnosticMessage } from "../i18n/messages";
import type { ConversationDocument } from "../data/conversation-types";
import type { ExportPresentation } from "../renderer/ExportPresentationContext";
import { buildPngFileName } from "./download-png";
import { exportCanvasToPng } from "./export-canvas";
import { analyzeExportCanvas } from "./export-diagnostics";
import { calculateSafeCssHeight, createSemanticExportPlan, measureExportCanvas } from "./export-plan";
import {
  calculateExportMetrics,
  waitForExportResources,
  waitForLayoutFrames,
} from "./export-readiness";
import {
  PngExportError,
  type ExportDiagnostic,
  type MultiPartPlanChoice,
  type MultiPartPlanChoiceRequest,
  type ExportSessionStage,
  type PngExportResult,
  type PngExportSessionResult,
  type PngExportSettings,
} from "./export-types";

type ExportPartFunction = typeof exportCanvasToPng;

interface ExportSessionOptions {
  readonly document: ConversationDocument;
  readonly canvas: HTMLElement;
  readonly settings: PngExportSettings;
  readonly applyPresentation: (presentation: ExportPresentation | undefined) => void;
  readonly exportPart?: ExportPartFunction;
  readonly signal?: AbortSignal;
  readonly onStage?: (stage: ExportSessionStage, part?: { readonly index: number; readonly total: number }) => void;
  readonly onMultiPartPlan?: (request: MultiPartPlanChoiceRequest) => Promise<MultiPartPlanChoice>;
}

function throwIfCancelled(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  throw new PngExportError("cancelled", "已取消 PNG 导出。", "预览已恢复。");
}

function allBlockIds(
  document: ConversationDocument,
  slices: readonly { readonly messageId: string; readonly blockIds?: readonly string[] }[],
) {
  return slices.flatMap((slice) => {
    if (slice.blockIds) return slice.blockIds;
    return document.messages.find((message) => message.id === slice.messageId)?.blocks.map((block) => block.id) ?? [];
  });
}

export async function runPngExportSession({
  document,
  canvas,
  settings,
  applyPresentation,
  exportPart = exportCanvasToPng,
  signal,
  onStage,
  onMultiPartPlan,
}: ExportSessionOptions): Promise<PngExportSessionResult> {
  const startedAt = performance.now();
  const basePresentation: ExportPresentation = {
    width: settings.width,
    foldStrategy: settings.foldStrategy,
  };

  try {
    throwIfCancelled(signal);
    onStage?.("preparing");
    applyPresentation(basePresentation);
    await waitForLayoutFrames(signal);
    await waitForExportResources(canvas, undefined, signal);

    throwIfCancelled(signal);
    onStage?.("planning");
    let measurement = measureExportCanvas(canvas, document);
    if (measurement.height > calculateSafeCssHeight(settings.width, settings.scale)) {
      // Measure the same canvas with the real continuation heading and both message
      // markers. Their wrapping can add height that the complete preview lacks.
      // Keep the complete height for the lower-scale, single-image decision.
      const maximumPartCount = Math.max(2, document.messages.reduce((count, message) => count + Math.max(1, message.blocks.length), 0));
      for (const continuedFromPrevious of [false, true]) {
        throwIfCancelled(signal);
        applyPresentation({
          ...basePresentation,
          part: {
            index: maximumPartCount - 1,
            total: maximumPartCount,
            messages: document.messages.map((message) => ({
              messageId: message.id,
              continuedFromPrevious,
              continuesToNext: true,
            })),
          },
        });
        await waitForLayoutFrames(signal);
        await waitForExportResources(canvas, undefined, signal);
        const continued = measureExportCanvas(canvas, document);
        const continuedById = new Map(continued.messages.map((message) => [message.id, message]));
        measurement = {
          ...measurement,
          headerHeight: Math.max(measurement.headerHeight, continued.headerHeight),
          messages: measurement.messages.map((message) => {
            const next = continuedById.get(message.id);
            return next ? { ...message, height: Math.max(message.height, next.height), fixedHeight: Math.max(message.fixedHeight, next.fixedHeight) } : message;
          }),
        };
      }
      applyPresentation(basePresentation);
      await waitForLayoutFrames(signal);
      await waitForExportResources(canvas, undefined, signal);
    }
    let effectiveSettings = settings;
    let plan = createSemanticExportPlan(document, measurement, effectiveSettings);

    if (plan.parts.length > 1 && onMultiPartPlan) {
      let suggestedScale: 1 | 2 | undefined;
      for (let scale = settings.scale - 1; scale >= 1; scale -= 1) {
        const candidateScale = scale as 1 | 2;
        const candidatePlan = createSemanticExportPlan(document, measurement, {
          ...settings,
          scale: candidateScale,
        });
        if (candidatePlan.parts.length === 1) {
          suggestedScale = candidateScale;
          break;
        }
      }

      onStage?.("awaiting-choice");
      const choice = await onMultiPartPlan({
        currentScale: settings.scale,
        partCount: plan.parts.length,
        suggestedScale,
      });
      throwIfCancelled(signal);
      if (choice.kind === "cancel") {
        throw new PngExportError("cancelled", "已取消 PNG 导出。", "预览已恢复。");
      }
      if (choice.kind === "use-scale") {
        if (choice.scale !== suggestedScale) {
          throw new PngExportError(
            "target-invalid",
            "当前导出选项已失效。",
            "请重新选择导出方式。",
          );
        }
        effectiveSettings = { ...settings, scale: choice.scale };
        plan = createSemanticExportPlan(document, measurement, effectiveSettings);
      }
    }

    const wholeMetrics = calculateExportMetrics(canvas, effectiveSettings.scale);
    const analysis = analyzeExportCanvas(canvas, wholeMetrics);
    const blocking = analysis.diagnostics.find((diagnostic) => diagnostic.severity === "error");
    if (blocking) {
      throw new PngExportError(
        blocking.code === "horizontal-overflow" ? "horizontal-overflow" : "target-invalid",
        blocking.messageText ?? blocking.message,
        blocking.recommendation ?? "改好上面的问题后再试。",
      );
    }
    const diagnostics: ExportDiagnostic[] = [...analysis.diagnostics];
    if (plan.parts.length > 1) {
      diagnostics.push({
        code: "semantic-segmentation",
        severity: "warning",
        ...diagnosticMessage(msg("会拆成 {0} 张图。", plan.parts.length)),
        recommendation: "不会从一条消息、代码块或公式中间切开。",
      });
    }

    const results = [];
    for (const part of plan.parts) {
      throwIfCancelled(signal);
      onStage?.("rendering", { index: part.index, total: plan.parts.length });
      applyPresentation({
        ...basePresentation,
        part: {
          index: part.index,
          total: plan.parts.length,
          messages: part.messages,
        },
      });
      await waitForLayoutFrames(signal);
      const result: PngExportResult = await exportPart(canvas, {
        scale: effectiveSettings.scale,
        signal,
      });
      throwIfCancelled(signal);
      results.push({
        ...result,
        fileName: buildPngFileName(settings.fileName, part.index, plan.parts.length),
        index: part.index,
        total: plan.parts.length,
        messageIds: part.messages.map((message) => message.messageId),
        blockIds: allBlockIds(document, part.messages),
      });
    }

    return {
      parts: results,
      diagnostics,
      contentMetrics: analysis.contentMetrics,
      durationMs: performance.now() - startedAt,
      effectiveSettings,
    };
  } finally {
    onStage?.("restoring");
    applyPresentation(undefined);
    await waitForLayoutFrames().catch(() => undefined);
  }
}
