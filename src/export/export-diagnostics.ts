import { message as msg, diagnosticMessage } from "../i18n/messages";
import type {
  ExportContentMetrics,
  ExportDiagnostic,
  ExportMetrics,
} from "./export-types";

export interface ExportAnalysis {
  readonly metrics: ExportMetrics;
  readonly contentMetrics: ExportContentMetrics;
  readonly diagnostics: readonly ExportDiagnostic[];
}

function ownerIds(element: Element) {
  const block = element.closest<HTMLElement>("[data-block-id]");
  const message = element.closest<HTMLElement>("[data-message-id]");
  return {
    blockId: block?.dataset.blockId,
    messageId: message?.dataset.messageId,
  };
}

function browserLabel(userAgent: string) {
  if (/Safari/i.test(userAgent) && !/Chrome|Chromium|CriOS/i.test(userAgent)) return "Safari";
  if (/Chrome|Chromium|CriOS/i.test(userAgent)) return "Chrome/Chromium";
  return "其他浏览器";
}

export function analyzeExportCanvas(
  element: HTMLElement,
  metrics: ExportMetrics,
  userAgent = navigator.userAgent,
): ExportAnalysis {
  const diagnostics: ExportDiagnostic[] = [];
  const unsupported = element.querySelectorAll('[data-block-type="unsupported"]');
  const missingAssets = element.querySelectorAll(".asset-placeholder");
  const formulaFallbacks = element.querySelectorAll('[data-math-overflow="fallback"]');
  const formulaScaled = element.querySelectorAll('[data-math-overflow="scaled"]');
  const tables = Array.from(element.querySelectorAll<HTMLElement>(".table-wrap"));

  if (element.scrollWidth - element.clientWidth > 1) {
    const candidates = Array.from(element.querySelectorAll<HTMLElement>("[data-block-id]"));
    const culprit = candidates.find((candidate) => candidate.scrollWidth - candidate.clientWidth > 1);
    diagnostics.push({
      code: "horizontal-overflow",
      severity: "error",
      message: "部分内容超出画布边界。",
      recommendation: "检查代码、表格、公式或长链接。",
      ...ownerIds(culprit ?? element),
    });
  }

  if (missingAssets.length > 0) {
    const first = missingAssets[0];
    diagnostics.push({
      code: "missing-assets",
      severity: "warning",
      ...diagnosticMessage(msg("有 {0} 个图片或文件找不到，图里会显示“缺失”。", missingAssets.length)),
      recommendation: "需要的话，先把这些文件补上。",
      ...ownerIds(first),
    });
  }

  if (unsupported.length > 0) {
    diagnostics.push({
      code: "unsupported-blocks",
      severity: "warning",
      ...diagnosticMessage(msg("有 {0} 段暂不支持的内容，图里会显示“暂不支持”。", unsupported.length)),
      recommendation: "不想显示的话，先删掉它们。",
      ...ownerIds(unsupported[0]),
    });
  }

  if (formulaFallbacks.length > 0 || formulaScaled.length > 0) {
    const first = formulaFallbacks[0] ?? formulaScaled[0];
    diagnostics.push({
      code: "formula-overflow-treatment",
      severity: "warning",
      ...diagnosticMessage(msg("有 {0} 个公式被缩小，{1} 个公式太宽，改为显示原文。", formulaScaled.length, formulaFallbacks.length)),
      recommendation: "请检查公式是否清晰。",
      ...ownerIds(first),
    });
  }

  const wideTables = tables.filter((table) => table.scrollWidth - table.clientWidth > 1);
  if (wideTables.length > 0) {
    diagnostics.push({
      code: "wide-table",
      severity: "warning",
      ...diagnosticMessage(msg("有 {0} 个表格比较宽，已自动换行。", wideTables.length)),
      recommendation: "表格内容较密，可切换为宽版导出。",
      ...ownerIds(wideTables[0]),
    });
  }

  diagnostics.push({
    code: "browser-profile",
    severity: "info",
    ...diagnosticMessage(msg("{0} · {1} × {2}px · 约占内存 {3} MB", browserLabel(userAgent), metrics.pixelWidth, metrics.pixelHeight, (metrics.estimatedRgbaBytes / 1024 / 1024).toFixed(1))),
  });

  return {
    metrics,
    contentMetrics: {
      messageCount: element.querySelectorAll("[data-message-id]").length,
      blockCount: element.querySelectorAll("[data-block-id]").length,
      tableCount: tables.length,
      unsupportedCount: unsupported.length,
      missingAssetCount: missingAssets.length,
      formulaFallbackCount: formulaFallbacks.length,
      formulaScaledCount: formulaScaled.length,
    },
    diagnostics,
  };
}

export function diagnosticReport(analysis: ExportAnalysis) {
  const payload = {
    metrics: analysis.metrics,
    contentMetrics: analysis.contentMetrics,
    diagnostics: analysis.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
      messageId: diagnostic.messageId,
      blockId: diagnostic.blockId,
    })),
  };
  return JSON.stringify(payload, null, 2);
}
