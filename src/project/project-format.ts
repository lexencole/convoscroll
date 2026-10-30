import { LocalizedError, message as msg, type LocalizedText } from "../i18n/messages";
import type { ConversationDocument } from "../data/conversation-types";
import type { StoredAssetRecord } from "../persistence/project-store";
import type { ConversationMarkdownVersion } from "./markdown-import";

export const PROJECT_FORMAT_ID = "conversation-canvas-project";
export const PROJECT_PACKAGE_VERSION = 1 as const;
export const PROJECT_EXTENSION = ".convcanvas";
export const PROJECT_MIME_TYPE = "application/vnd.convcanvas+zip";

const MEBIBYTE = 1024 * 1024;
const PROJECT_COMPRESSED_BYTES = 100 * MEBIBYTE;
const PROJECT_DOCUMENT_BYTES = 16 * MEBIBYTE;
const PROJECT_MANIFEST_BYTES = MEBIBYTE;
const PROJECT_PACKAGE_OVERHEAD_RESERVE_BYTES = MEBIBYTE;

export const PROJECT_LIMITS = {
  compressedBytes: PROJECT_COMPRESSED_BYTES,
  expandedBytes: 160 * MEBIBYTE,
  singleAssetBytes: 32 * MEBIBYTE,
  documentBytes: PROJECT_DOCUMENT_BYTES,
  manifestBytes: PROJECT_MANIFEST_BYTES,
  markdownBytes: 8 * MEBIBYTE,
  entryCount: 512,
  packageOverheadReserveBytes: PROJECT_PACKAGE_OVERHEAD_RESERVE_BYTES,
  // New editor additions use an 82 MiB conservative planning budget: 82 MiB
  // binaries + 16 MiB current-document headroom + 1 MiB manifest headroom
  // + 1 MiB added metadata/DEFLATE/ZIP reserve = 100 MiB. The 16/1 MiB values
  // are not v1 per-entry limits; final import/export keep the wider
  // compressed/expanded rules so older or text-heavy v1 packages still load.
  editorAssetBudgetBytes:
    PROJECT_COMPRESSED_BYTES
    - PROJECT_DOCUMENT_BYTES
    - PROJECT_MANIFEST_BYTES
    - PROJECT_PACKAGE_OVERHEAD_RESERVE_BYTES,
} as const;

export interface ProjectManifestAsset {
  readonly assetId: string;
  readonly storageKey: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly state: "available" | "missing";
  readonly path?: string;
  readonly byteSize?: number;
  readonly sha256?: string;
}

export interface ProjectManifestV1 {
  readonly format: typeof PROJECT_FORMAT_ID;
  readonly packageVersion: typeof PROJECT_PACKAGE_VERSION;
  readonly schemaVersion: 1;
  readonly createdAt: string;
  readonly appVersion: string;
  readonly documentPath: "document.json";
  readonly documentByteSize: number;
  readonly documentSha256: string;
  readonly assets: readonly ProjectManifestAsset[];
}

export interface ProjectWarning {
  readonly code: string;
  readonly message: string;
  readonly messageText?: LocalizedText;
  readonly path?: string;
}

export interface PreparedProjectImport {
  readonly kind: "project";
  readonly fileName: string;
  readonly document: ConversationDocument;
  readonly assets: readonly StoredAssetRecord[];
  readonly warnings: readonly ProjectWarning[];
  readonly summary: {
    readonly title: string;
    readonly messageCount: number;
    readonly blockCount: number;
    readonly assetCount: number;
    readonly availableAssetBytes: number;
  };
}

export interface PreparedMarkdownImport {
  readonly kind: "markdown";
  readonly markdownKind: "plain" | "conversation";
  readonly markdownVersion?: ConversationMarkdownVersion;
  readonly fileName: string;
  readonly document: ConversationDocument;
  readonly assets: readonly [];
  readonly warnings: readonly ProjectWarning[];
  readonly summary: PreparedProjectImport["summary"];
}

export type PreparedImport = PreparedProjectImport | PreparedMarkdownImport;

export class ProjectFormatError extends LocalizedError {
  constructor(
    message: LocalizedText,
    readonly code: string,
    readonly path?: string,
    readonly subject?: "image" | "file",
  ) {
    super(message);
    this.name = "ProjectFormatError";
  }
}

export class MissingProjectAssetsError extends ProjectFormatError {
  constructor(readonly fileNames: readonly string[]) {
    super(msg("有 {0} 个资产无法读取。", fileNames.length), "MISSING_PROJECT_ASSETS", "assets");
    this.name = "MissingProjectAssetsError";
  }
}
