import { message as msg } from "../i18n/messages";
import { waitForCanvasFonts } from "./export-fonts";
import {
  EXPORT_READINESS_TIMEOUT_MS,
  MAX_ESTIMATED_RGBA_BYTES,
  MAX_OUTPUT_SIDE_PX,
  PNG_EXPORT_SCALE,
  PRODUCTION_MAX_ESTIMATED_RGBA_BYTES,
  PRODUCTION_MAX_OUTPUT_HEIGHT_PX,
  PngExportError,
  type ExportMetrics,
} from "./export-types";

interface ReadinessOptions {
  readonly scale?: number;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

function getLogicalSize(element: HTMLElement) {
  const cssWidth = Math.ceil(element.offsetWidth);
  const cssHeight = Math.ceil(element.offsetHeight);

  if (cssWidth <= 0 || cssHeight <= 0) {
    throw new PngExportError(
      "target-invalid",
      "还没有可以导出的内容。",
      "等页面显示完再试。",
    );
  }

  return { cssWidth, cssHeight };
}

export function calculateExportMetrics(
  element: HTMLElement,
  scale = PNG_EXPORT_SCALE,
): ExportMetrics {
  const { cssWidth, cssHeight } = getLogicalSize(element);
  const pixelWidth = Math.floor(cssWidth * scale);
  const pixelHeight = Math.floor(cssHeight * scale);

  return {
    cssWidth,
    cssHeight,
    pixelWidth,
    pixelHeight,
    estimatedRgbaBytes: pixelWidth * pixelHeight * 4,
    imageCount: element.querySelectorAll("img").length,
    codeBlockCount: element.querySelectorAll(".code-block[data-highlight-state]").length,
    mathCount: element.querySelectorAll(".katex[data-math-index]").length,
  };
}

export function preflightExportTarget(
  element: HTMLElement,
  scale = PNG_EXPORT_SCALE,
): ExportMetrics {
  const metrics = calculateExportMetrics(element, scale);
  const horizontalOverflow = element.scrollWidth - element.clientWidth;

  if (horizontalOverflow > 1) {
    throw new PngExportError(
      "horizontal-overflow",
      "部分内容超出画布边界。",
      "请检查代码、表格、公式或长链接。",
    );
  }

  if (
    metrics.pixelWidth > MAX_OUTPUT_SIDE_PX
    || metrics.pixelHeight > MAX_OUTPUT_SIDE_PX
    || metrics.estimatedRgbaBytes > MAX_ESTIMATED_RGBA_BYTES
    || metrics.pixelHeight > PRODUCTION_MAX_OUTPUT_HEIGHT_PX
    || metrics.estimatedRgbaBytes > PRODUCTION_MAX_ESTIMATED_RGBA_BYTES
  ) {
    throw new PngExportError(
      "output-too-large",
      msg("图片会有 {0} × {1} 像素，太大了。", metrics.pixelWidth, metrics.pixelHeight),
      "请缩短内容，或降低清晰度后再试。",
    );
  }

  return metrics;
}

async function waitForImages(element: HTMLElement) {
  const images = Array.from(element.querySelectorAll<HTMLImageElement>("img"));

  await Promise.all(images.map(async (image) => {
    try {
      if (typeof image.decode === "function") {
        await image.decode();
      } else if (!image.complete || image.naturalWidth <= 0) {
        await new Promise<void>((resolve, reject) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => reject(new Error("图片加载失败。")), {
            once: true,
          });
        });
      }

      if (image.complete && image.naturalWidth <= 0) {
        throw new Error("图片是空的。");
      }
    } catch (error) {
      throw new PngExportError(
        "image-decode-failed",
        msg("图片打不开：{0}", image.alt || image.currentSrc || image.src || "未命名图片"),
        "换掉或删掉这张图片后再试。",
        { cause: error },
      );
    }
  }));
}

function resourcesAreReady(element: HTMLElement) {
  const codeBlocks = element.querySelectorAll<HTMLElement>(".code-block[data-highlight-state]");
  const mathElements = element.querySelectorAll<HTMLElement>(".katex[data-math-index]");

  const codeReady = Array.from(codeBlocks).every(
    (block) => ["ready", "fallback"].includes(block.dataset.highlightState ?? ""),
  );
  const mathReady = Array.from(mathElements).every(
    (math) => Boolean(math.dataset.mathOverflow),
  );

  return codeReady && mathReady;
}

function waitForRenderedResources(element: HTMLElement, signal: AbortSignal) {
  if (resourcesAreReady(element)) return Promise.resolve();

  return new Promise<void>((resolve) => {
    const finish = () => {
      observer.disconnect();
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const observer = new MutationObserver(() => {
      if (!resourcesAreReady(element)) return;
      finish();
    });

    signal.addEventListener("abort", finish, { once: true });
    observer.observe(element, {
      attributes: true,
      attributeFilter: ["data-highlight-state", "data-math-overflow"],
      subtree: true,
    });
  });
}

export function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      window.clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      controller.abort();
    };
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      complete();
    };
    const abort = () => {
      finish(() => reject(new PngExportError(
        "cancelled",
        "已取消 PNG 导出。",
        "预览已恢复。",
      )));
    };
    const timeout = window.setTimeout(() => {
      finish(() => {
        controller.abort();
        reject(new PngExportError(
          "resources-timeout",
          msg("等了 {0} 秒，字体、图片或公式还没加载完。", Math.ceil(timeoutMs / 1000)),
          "请稍后再试。",
        ));
      });
    }, timeoutMs);

    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => run(controller.signal)).then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

export async function waitForExportReadiness(
  element: HTMLElement,
  options: ReadinessOptions = {},
): Promise<ExportMetrics> {
  const scale = options.scale ?? PNG_EXPORT_SCALE;
  const timeoutMs = options.timeoutMs ?? EXPORT_READINESS_TIMEOUT_MS;

  preflightExportTarget(element, scale);

  await waitForExportResources(element, timeoutMs, options.signal);

  return preflightExportTarget(element, scale);
}

export async function waitForExportResources(
  element: HTMLElement,
  timeoutMs = EXPORT_READINESS_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<void> {
  getLogicalSize(element);
  await withTimeout(
    (signal) => Promise.all([
      waitForImages(element),
      waitForRenderedResources(element, signal),
    ]).then(() => waitForCanvasFonts(element)),
    timeoutMs,
    signal,
  );
}

export function waitForLayoutFrames(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    let firstFrame = 0;
    let secondFrame = 0;
    let fallbackTimer = 0;
    let settled = false;
    const cleanup = () => {
      cancelAnimationFrame(firstFrame);
      cancelAnimationFrame(secondFrame);
      window.clearTimeout(fallbackTimer);
      signal?.removeEventListener("abort", abort);
    };
    const complete = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const abort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new PngExportError(
        "cancelled",
        "已取消 PNG 导出。",
        "预览已恢复。",
      ));
    };
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });
    firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(complete);
    });
    // Safari and background tabs may suspend rAF indefinitely. A bounded fallback
    // prevents export and preview restoration from hanging while preserving the
    // preferred two-frame path whenever the browser is actively painting.
    fallbackTimer = window.setTimeout(complete, 500);
  });
}
