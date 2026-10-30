import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { unzipSync } from "fflate";
import {
  buildPngBundleFileName,
  buildPngFileName,
  createPngDelivery,
  downloadBlob,
} from "./download-png";

describe("PNG download", () => {
  let clickedFileName = "";
  const createObjectUrl = vi.fn(() => "blob:phase-2");
  const revokeObjectUrl = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    clickedFileName = "";
    Object.defineProperties(URL, {
      createObjectURL: { configurable: true, value: createObjectUrl },
      revokeObjectURL: { configurable: true, value: revokeObjectUrl },
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function click(
      this: HTMLAnchorElement,
    ) {
      clickedFileName = this.download;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("keeps the title in the PNG file name", () => {
    expect(buildPngFileName(" Conversation: Rich / 3× ")).toBe("Conversation- Rich - 3×.png");
    expect(buildPngFileName("***")).toBe("conversation.png");
  });

  it("numbers semantic export parts with stable padding", () => {
    expect(buildPngFileName("长图排版测试", 0, 3)).toBe("长图排版测试-part-01-of-03.png");
    expect(buildPngFileName("Conversation.png", 11, 12)).toBe("Conversation-part-12-of-12.png");
  });

  it("keeps a single PNG direct and packages multiple PNGs into one ZIP", async () => {
    const first = new Blob(["first"], { type: "image/png" });
    const second = new Blob(["second"], { type: "image/png" });
    const direct = await createPngDelivery([{ blob: first, fileName: "test.png" }], "Test");
    expect(direct).toEqual({ kind: "png", blob: first, fileName: "test.png" });

    const bundled = await createPngDelivery([
      { blob: first, fileName: "test-part-01-of-02.png" },
      { blob: second, fileName: "test-part-02-of-02.png" },
    ], "Test.png");
    expect(bundled.kind).toBe("zip");
    expect(bundled.fileName).toBe("Test-parts.zip");
    expect(bundled.blob.type).toBe("application/zip");
    const files = unzipSync(new Uint8Array(await bundled.blob.arrayBuffer()));
    expect(Object.keys(files)).toEqual(["test-part-01-of-02.png", "test-part-02-of-02.png"]);
    expect(new TextDecoder().decode(files["test-part-01-of-02.png"])).toBe("first");
    expect(new TextDecoder().decode(files["test-part-02-of-02.png"])).toBe("second");
  });

  it("stops multipart packaging when cancellation happens during delivery", async () => {
    const controller = new AbortController();
    const first = new Blob(["first"], { type: "image/png" });
    const second = new Blob(["second"], { type: "image/png" });
    vi.spyOn(first, "arrayBuffer").mockImplementation(async () => {
      controller.abort();
      return new Uint8Array([1]).buffer;
    });

    await expect(createPngDelivery([
      { blob: first, fileName: "test-part-01-of-02.png" },
      { blob: second, fileName: "test-part-02-of-02.png" },
    ], "Test.png", controller.signal)).rejects.toMatchObject({ code: "cancelled" });
  });

  it("builds a deterministic multipart bundle name", () => {
    expect(buildPngBundleFileName(" Conversation Rich.png ")).toBe("Conversation Rich-parts.zip");
  });

  it("downloads through a temporary object URL and revokes it", () => {
    const blob = new Blob(["png"], { type: "image/png" });

    downloadBlob(blob, "Conversation Rich.png");

    expect(createObjectUrl).toHaveBeenCalledWith(blob);
    expect(clickedFileName).toBe("Conversation Rich.png");
    expect(document.querySelector("a[download]")).not.toBeInTheDocument();

    vi.runAllTimers();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:phase-2");
  });
});
