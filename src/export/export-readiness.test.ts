import { afterEach, describe, expect, it, vi } from "vitest";
import { PngExportError } from "./export-types";
import {
  calculateExportMetrics,
  preflightExportTarget,
  waitForExportReadiness,
  waitForExportResources,
  waitForLayoutFrames,
} from "./export-readiness";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function createTarget({
  width = 480,
  height = 1_000,
  clientWidth = width,
  scrollWidth = width,
}: {
  width?: number;
  height?: number;
  clientWidth?: number;
  scrollWidth?: number;
} = {}) {
  const element = document.createElement("section");
  Object.defineProperties(element, {
    offsetWidth: { configurable: true, value: width },
    offsetHeight: { configurable: true, value: height },
    clientWidth: { configurable: true, value: clientWidth },
    scrollWidth: { configurable: true, value: scrollWidth },
  });
  return element;
}

const resourceChecks = [
  ["PNG capture", (target: HTMLElement, timeoutMs: number, signal?: AbortSignal) => (
    waitForExportReadiness(target, { timeoutMs, signal })
  )],
  ["segmentation measurement", waitForExportResources],
] as const;

describe("export readiness", () => {
  it("calculates deterministic 3x output dimensions from the logical canvas", () => {
    const target = createTarget({ height: 2_400 });

    expect(calculateExportMetrics(target)).toMatchObject({
      cssWidth: 480,
      cssHeight: 2_400,
      pixelWidth: 1_440,
      pixelHeight: 7_200,
      estimatedRgbaBytes: 41_472_000,
    });
  });

  it("rejects horizontal overflow before rendering", () => {
    const target = createTarget({ clientWidth: 478, scrollWidth: 520 });

    expect(() => preflightExportTarget(target)).toThrowError(PngExportError);
    expect(() => preflightExportTarget(target)).toThrow("部分内容超出画布边界");
  });

  it("rejects output that exceeds the fixed safety boundary", () => {
    const target = createTarget({ height: 11_000 });

    expect(() => preflightExportTarget(target)).toThrow("像素，太大了");
  });

  it("uses the conservative production budget before the browser hard limit", () => {
    const target = createTarget({ height: 8_001 });
    expect(() => preflightExportTarget(target)).toThrow("像素，太大了");
  });

  it.each(resourceChecks)("waits for code and math before %s", async (_name, wait) => {
    vi.useFakeTimers();
    const target = createTarget();
    const code = document.createElement("figure");
    const math = document.createElement("span");
    code.className = "code-block";
    code.dataset.highlightState = "loading";
    math.className = "katex";
    math.dataset.mathIndex = "0";
    target.append(code, math);

    let settled = false;
    const ready = wait(target, 100).then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(false);
    code.dataset.highlightState = "ready";
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(false);
    math.dataset.mathOverflow = "fit";

    await ready;
    expect(calculateExportMetrics(target)).toMatchObject({ codeBlockCount: 1, mathCount: 1 });
  });

  it.each(resourceChecks)("reports image decoding failures before %s", async (_name, wait) => {
    const target = createTarget();
    const image = document.createElement("img");
    image.alt = "测试图片";
    image.decode = async () => {
      throw new Error("decode failed");
    };
    target.append(image);

    await expect(wait(target, 100)).rejects.toMatchObject({
      code: "image-decode-failed",
      recommendation: "换掉或删掉这张图片后再试。",
    });
  });

  it.each(resourceChecks)("times out when resources never become ready for %s", async (_name, wait) => {
    const target = createTarget();
    const code = document.createElement("figure");
    code.className = "code-block";
    code.dataset.highlightState = "loading";
    target.append(code);

    await expect(wait(target, 5)).rejects.toMatchObject({
      code: "resources-timeout",
    });
  });

  it.each(resourceChecks)("cancels resource preparation for %s", async (_name, wait) => {
    const target = createTarget();
    const code = document.createElement("figure");
    code.className = "code-block";
    code.dataset.highlightState = "loading";
    target.append(code);
    const controller = new AbortController();

    const ready = wait(target, 10_000, controller.signal);
    controller.abort();

    await expect(ready).rejects.toMatchObject({ code: "cancelled" });
  });

  it("allows an oversized canvas to be measured for segmentation but rejects it before PNG capture", async () => {
    const target = createTarget({ height: 11_000 });

    await expect(waitForExportResources(target)).resolves.toBeUndefined();
    await expect(waitForExportReadiness(target)).rejects.toMatchObject({ code: "output-too-large" });
  });

  it("checks the output size again after images finish loading", async () => {
    const target = createTarget();
    const image = document.createElement("img");
    Object.defineProperty(image, "naturalWidth", { value: 10 });
    image.decode = async () => {
      Object.defineProperty(target, "offsetHeight", { value: 11_000 });
    };
    target.append(image);

    await expect(waitForExportReadiness(target)).rejects.toMatchObject({ code: "output-too-large" });
  });

  it("falls back when the browser suspends animation frames", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
    vi.stubGlobal("cancelAnimationFrame", vi.fn());

    const ready = waitForLayoutFrames();
    await vi.advanceTimersByTimeAsync(500);

    await expect(ready).resolves.toBeUndefined();
  });
});
