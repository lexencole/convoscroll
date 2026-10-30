import { message as msg } from "../i18n/messages";
import type { Options as ModernScreenshotOptions } from "modern-screenshot";
import {
  EXPORT_RENDER_TIMEOUT_MS,
  PNG_EXPORT_SCALE,
  PNG_MIME_TYPE,
  PngExportError,
  type ExportStage,
  type PngExportResult,
} from "./export-types";
import { embedCanvasFonts } from "./export-fonts";
import { waitForExportReadiness, withTimeout } from "./export-readiness";

type DomToBlob = (
  node: Node,
  options?: ModernScreenshotOptions,
) => Promise<Blob>;

interface ExportCanvasOptions {
  readonly scale?: number;
  readonly signal?: AbortSignal;
  readonly readinessTimeoutMs?: number;
  readonly renderer?: DomToBlob;
  readonly onStage?: (stage: ExportStage) => void;
}

interface PngDimensions {
  readonly width: number;
  readonly height: number;
}

async function loadRenderer(): Promise<DomToBlob> {
  const module = await import("modern-screenshot");
  return module.domToBlob;
}

function getBackgroundColor(element: HTMLElement) {
  const color = getComputedStyle(element).backgroundColor;
  return color && color !== "rgba(0, 0, 0, 0)" ? color : "#ffffff";
}

export async function readPngDimensions(blob: Blob): Promise<PngDimensions> {
  const bytes = new Uint8Array(await blob.slice(0, 24).arrayBuffer());
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];

  if (bytes.length < 24 || !signature.every((byte, index) => bytes[index] === byte)) {
    throw new PngExportError(
      "invalid-png",
      "浏览器生成的图片有问题。",
      "刷新页面后再试。",
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
  };
}

export async function exportCanvasToPng(
  element: HTMLElement,
  options: ExportCanvasOptions = {},
): Promise<PngExportResult> {
  const startedAt = performance.now();
  const scale = options.scale ?? PNG_EXPORT_SCALE;

  options.onStage?.("preparing");
  const metrics = await waitForExportReadiness(element, {
    scale,
    timeoutMs: options.readinessTimeoutMs,
    signal: options.signal,
  });

  const fontCss = await withTimeout((signal) => embedCanvasFonts(element, signal), options.readinessTimeoutMs ?? EXPORT_RENDER_TIMEOUT_MS, options.signal);

  options.onStage?.("rendering");
  const renderer = options.renderer ?? await loadRenderer();

  let blob: Blob;
  try {
    blob = await renderer(element, {
      width: metrics.cssWidth,
      height: metrics.cssHeight,
      scale,
      type: PNG_MIME_TYPE,
      // PNGs are always full-bleed: the canvas color fills the whole image.
      backgroundColor: getBackgroundColor(element),
      timeout: EXPORT_RENDER_TIMEOUT_MS,
      font: fontCss ? { cssText: fontCss } : false,
    });
  } catch (error) {
    throw new PngExportError(
      "render-failed",
      "浏览器没能生成图片。",
      "可能是内存不够，试试降低清晰度。",
      { cause: error },
    );
  }

  if (blob.size === 0) {
    throw new PngExportError(
      "empty-blob",
      "浏览器生成了空文件。",
      "刷新页面后再试。",
    );
  }

  if (blob.type !== PNG_MIME_TYPE) {
    throw new PngExportError(
      "invalid-png",
      msg("浏览器生成的不是 PNG（{0}）。", blob.type || "未知格式"),
      "刷新页面后再试。",
    );
  }

  const dimensions = await readPngDimensions(blob);
  if (dimensions.width !== metrics.pixelWidth || dimensions.height !== metrics.pixelHeight) {
    throw new PngExportError(
      "size-mismatch",
      msg("图片尺寸不对：{0} × {1}，应该是 {2} × {3}。", dimensions.width, dimensions.height, metrics.pixelWidth, metrics.pixelHeight),
      "这次没有下载，请刷新后再试。",
    );
  }

  return {
    blob,
    metrics,
    durationMs: performance.now() - startedAt,
  };
}
