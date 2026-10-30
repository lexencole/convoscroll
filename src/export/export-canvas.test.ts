import { describe, expect, it, vi } from "vitest";
import { exportCanvasToPng, readPngDimensions } from "./export-canvas";
import { PNG_MIME_TYPE } from "./export-types";

function createTarget(width = 480, height = 1_000) {
  const element = document.createElement("section");
  element.style.backgroundColor = "rgb(251, 250, 247)";
  Object.defineProperties(element, {
    offsetWidth: { configurable: true, value: width },
    offsetHeight: { configurable: true, value: height },
    clientWidth: { configurable: true, value: width },
    scrollWidth: { configurable: true, value: width },
  });
  document.body.append(element);
  return element;
}

function createPngBlob(width: number, height: number) {
  const bytes = new Uint8Array(32);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return new Blob([bytes], { type: PNG_MIME_TYPE });
}

describe("canvas PNG export", () => {
  it("passes the logical size explicitly and validates the resulting PNG", async () => {
    const target = createTarget(480, 1_000);
    const renderer = vi.fn(async () => createPngBlob(1_440, 3_000));
    const onStage = vi.fn();

    const result = await exportCanvasToPng(target, { renderer, onStage });

    expect(renderer).toHaveBeenCalledWith(target, expect.objectContaining({
      width: 480,
      height: 1_000,
      scale: 3,
      type: PNG_MIME_TYPE,
      backgroundColor: "rgb(251, 250, 247)",
    }));
    expect(onStage.mock.calls).toEqual([["preparing"], ["rendering"]]);
    expect(result.metrics.pixelWidth).toBe(1_440);
    expect(result.metrics.pixelHeight).toBe(3_000);
    await expect(readPngDimensions(result.blob)).resolves.toEqual({ width: 1_440, height: 3_000 });
  });

  it("rejects a file whose PNG dimensions differ from the export contract", async () => {
    const target = createTarget();
    const renderer = vi.fn(async () => createPngBlob(720, 1_500));

    await expect(exportCanvasToPng(target, { renderer })).rejects.toMatchObject({
      code: "size-mismatch",
    });
  });

  it("wraps renderer failures with a stable error code", async () => {
    const target = createTarget();
    const renderer = vi.fn(async () => {
      throw new Error("canvas allocation failed");
    });

    await expect(exportCanvasToPng(target, { renderer })).rejects.toMatchObject({
      code: "render-failed",
    });
  });

  it("rejects an empty PNG Blob", async () => {
    const target = createTarget();
    const renderer = vi.fn(async () => new Blob([], { type: PNG_MIME_TYPE }));

    await expect(exportCanvasToPng(target, { renderer })).rejects.toMatchObject({
      code: "empty-blob",
    });
  });

  it("rejects non-PNG output", async () => {
    await expect(readPngDimensions(new Blob(["not png"]))).rejects.toMatchObject({
      code: "invalid-png",
    });
  });

  it("rejects a valid PNG signature with the wrong MIME type", async () => {
    const target = createTarget();
    const png = createPngBlob(1_440, 3_000);
    const renderer = vi.fn(async () => new Blob([await png.arrayBuffer()], { type: "image/webp" }));

    await expect(exportCanvasToPng(target, { renderer })).rejects.toMatchObject({
      code: "invalid-png",
    });
  });
});
