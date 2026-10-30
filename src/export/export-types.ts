import { LocalizedError, translator, type LocalizedText } from "../i18n/messages";

export const PNG_MIME_TYPE = "image/png";
export const PNG_EXPORT_SCALE = 3;
export const EXPORT_READINESS_TIMEOUT_MS = 15_000;
export const EXPORT_RENDER_TIMEOUT_MS = 30_000;
export const MAX_OUTPUT_SIDE_PX = 32_767;
export const MAX_ESTIMATED_RGBA_BYTES = 256 * 1024 * 1024;
export const PRODUCTION_MAX_OUTPUT_HEIGHT_PX = 24_000;
export const PRODUCTION_MAX_ESTIMATED_RGBA_BYTES = 128 * 1024 * 1024;

export type ExportStage = "preparing" | "rendering";
export type ExportSessionStage = "preparing" | "planning" | "awaiting-choice" | "rendering" | "restoring";

export type ExportErrorCode =
  | "target-invalid"
  | "horizontal-overflow"
  | "resources-timeout"
  | "image-decode-failed"
  | "font-load-failed"
  | "output-too-large"
  | "single-block-too-large"
  | "render-failed"
  | "empty-blob"
  | "invalid-png"
  | "size-mismatch"
  | "download-failed"
  | "cancelled";

export class PngExportError extends LocalizedError {
  readonly code: ExportErrorCode;
  readonly recommendation: string;
  readonly recommendationText: LocalizedText;

  constructor(code: ExportErrorCode, message: LocalizedText, recommendation: LocalizedText, options?: ErrorOptions) {
    super(message, options);
    this.name = "PngExportError";
    this.code = code;
    this.recommendationText = recommendation;
    this.recommendation = translator("zh-CN")(recommendation);
  }
}

export interface ExportMetrics {
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly estimatedRgbaBytes: number;
  readonly imageCount: number;
  readonly codeBlockCount: number;
  readonly mathCount: number;
}

export interface PngExportResult {
  readonly blob: Blob;
  readonly metrics: ExportMetrics;
  readonly durationMs: number;
}

export type ExportCanvasPreset = "portrait" | "wide";
export type ExportFoldStrategy = "block" | "preview" | "collapsed" | "expanded";

export interface PngExportSettings {
  readonly fileName: string;
  readonly preset: ExportCanvasPreset;
  readonly width: 480 | 720;
  readonly scale: 1 | 2 | 3;
  readonly foldStrategy: ExportFoldStrategy;
}

export interface MultiPartPlanChoiceRequest {
  readonly currentScale: 1 | 2 | 3;
  readonly partCount: number;
  readonly suggestedScale?: 1 | 2;
}

export type MultiPartPlanChoice =
  | { readonly kind: "continue" }
  | { readonly kind: "use-scale"; readonly scale: 1 | 2 }
  | { readonly kind: "cancel" };

export type ExportDiagnosticSeverity = "info" | "warning" | "error";

export interface ExportDiagnostic {
  readonly code: string;
  readonly severity: ExportDiagnosticSeverity;
  readonly message: string;
  readonly messageText?: LocalizedText;
  readonly recommendation?: LocalizedText;
  readonly messageId?: string;
  readonly blockId?: string;
}

export interface ExportContentMetrics {
  readonly messageCount: number;
  readonly blockCount: number;
  readonly tableCount: number;
  readonly unsupportedCount: number;
  readonly missingAssetCount: number;
  readonly formulaFallbackCount: number;
  readonly formulaScaledCount: number;
}

export interface ExportSessionPartResult extends PngExportResult {
  readonly fileName: string;
  readonly index: number;
  readonly total: number;
  readonly messageIds: readonly string[];
  readonly blockIds: readonly string[];
}

export interface PngExportSessionResult {
  readonly parts: readonly ExportSessionPartResult[];
  readonly diagnostics: readonly ExportDiagnostic[];
  readonly contentMetrics: ExportContentMetrics;
  readonly durationMs: number;
  readonly effectiveSettings: PngExportSettings;
}
