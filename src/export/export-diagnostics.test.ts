import { describe, expect, it } from "vitest";
import { analyzeExportCanvas, diagnosticReport } from "./export-diagnostics";
import type { ExportMetrics } from "./export-types";

const metrics: ExportMetrics = {
  cssWidth: 480,
  cssHeight: 1_000,
  pixelWidth: 1_440,
  pixelHeight: 3_000,
  estimatedRgbaBytes: 17_280_000,
  imageCount: 0,
  codeBlockCount: 0,
  mathCount: 1,
};

describe("export diagnostics", () => {
  it("reports warnings with stable IDs and excludes conversation text", () => {
    const canvas = document.createElement("section");
    const message = document.createElement("article");
    const block = document.createElement("div");
    const missing = document.createElement("div");
    const formula = document.createElement("span");
    message.dataset.messageId = "message-private";
    block.dataset.blockId = "block-private";
    block.dataset.blockType = "unsupported";
    block.textContent = "SECRET CONVERSATION BODY";
    missing.className = "asset-placeholder";
    formula.dataset.mathOverflow = "fallback";
    block.append(missing, formula);
    message.append(block);
    canvas.append(message);
    Object.defineProperties(canvas, {
      clientWidth: { configurable: true, value: 480 },
      scrollWidth: { configurable: true, value: 480 },
    });

    const analysis = analyzeExportCanvas(canvas, metrics, "Safari");
    expect(analysis.contentMetrics).toMatchObject({
      messageCount: 1,
      blockCount: 1,
      unsupportedCount: 1,
      missingAssetCount: 1,
      formulaFallbackCount: 1,
    });
    expect(analysis.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing-assets", messageId: "message-private", blockId: "block-private" }),
      expect.objectContaining({ code: "unsupported-blocks" }),
      expect.objectContaining({ code: "formula-overflow-treatment" }),
    ]));
    const report = diagnosticReport(analysis);
    expect(report).toContain("message-private");
    expect(report).not.toContain("SECRET CONVERSATION BODY");
  });
});
