import { message as msg, diagnosticMessage } from "../i18n/messages";
import { strToU8, zip, type AsyncZippable } from "fflate";
import type { ConversationAsset, ConversationDocument } from "../data/conversation-types";
import {
  findAmbiguousUnsupportedAssetReferences,
  pruneUnreferencedAssets,
} from "../data/document-assets";
import { safeFileBaseName } from "../export/file-name";
import { APP_VERSION } from "../product-info";
import {
  MissingProjectAssetsError,
  PROJECT_EXTENSION,
  PROJECT_FORMAT_ID,
  PROJECT_MIME_TYPE,
  PROJECT_PACKAGE_VERSION,
  PROJECT_LIMITS,
  ProjectFormatError,
  type ProjectManifestAsset,
  type ProjectManifestV1,
  type ProjectWarning,
} from "./project-format";

export interface ExportedProjectPackage {
  readonly blob: Blob;
  readonly fileName: string;
  readonly manifest: ProjectManifestV1;
  readonly warnings: readonly ProjectWarning[];
}

function zipAsync(files: AsyncZippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, { level: 6 }, (error, archive) => {
      if (error) reject(error);
      else resolve(archive);
    });
  });
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

function safeProjectName(title?: string): string {
  return `${safeFileBaseName(title ?? "") || "conversation-project"}${PROJECT_EXTENSION}`;
}

function packageStorageKey(asset: ConversationAsset): string {
  return `asset:${asset.id}`;
}

export async function exportProjectPackage({
  document,
  resolveAssetBlob,
  allowMissingAssets = false,
  now = () => new Date(),
}: {
  readonly document: ConversationDocument;
  readonly resolveAssetBlob: (asset: ConversationAsset) => Promise<Blob | undefined>;
  readonly allowMissingAssets?: boolean;
  readonly now?: () => Date;
}): Promise<ExportedProjectPackage> {
  const ambiguousReferences = findAmbiguousUnsupportedAssetReferences(document);
  if (ambiguousReferences.length > 0) {
    throw new ProjectFormatError(
      "有一段暂不支持的内容同时引用了多个文件，没法安全导出。请修改或删掉这段内容。",
      "AMBIGUOUS_ASSET_REFERENCE",
      "document.messages",
    );
  }
  const exportDocument = pruneUnreferencedAssets(document);
  const files: AsyncZippable = {};
  const manifestAssets: ProjectManifestAsset[] = [];
  const warnings: ProjectWarning[] = [];
  const missing: string[] = [];
  const availableByteSizes = new Map<string, number>();
  let availableAssetEntries = 0;

  for (const [index, asset] of exportDocument.assets.entries()) {
    const blob = await resolveAssetBlob(asset);
    const storageKey = packageStorageKey(asset);
    if (!blob) {
      missing.push(asset.fileName);
      warnings.push({
        code: "MISSING_ASSET_EXPORTED",
        path: `assets[${index}]`,
        ...diagnosticMessage(msg("{0} 读不到，会标记为缺失。", asset.fileName)),
      });
      manifestAssets.push({
        assetId: asset.id,
        storageKey,
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        state: "missing",
      });
      continue;
    }
    if (availableAssetEntries + 3 > PROJECT_LIMITS.entryCount) {
      throw new ProjectFormatError(
        msg("项目里的文件超过 {0} 个。", PROJECT_LIMITS.entryCount),
        "TOO_MANY_ENTRIES",
        `assets[${index}]`,
      );
    }
    availableAssetEntries += 1;
    if (blob.size > PROJECT_LIMITS.singleAssetBytes) {
      throw new ProjectFormatError(
        msg("{0} 太大了。", asset.fileName),
        "ASSET_TOO_LARGE",
        `assets[${index}]`,
      );
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.byteLength > PROJECT_LIMITS.singleAssetBytes) {
      throw new ProjectFormatError(
        msg("{0} 太大了。", asset.fileName),
        "ASSET_TOO_LARGE",
        `assets[${index}]`,
      );
    }
    const path = `assets/${String(index).padStart(4, "0")}.bin`;
    files[path] = bytes;
    availableByteSizes.set(asset.id, bytes.byteLength);
    manifestAssets.push({
      assetId: asset.id,
      storageKey,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      state: "available",
      path,
      byteSize: bytes.byteLength,
      sha256: await sha256Hex(bytes),
    });
  }

  if (missing.length > 0 && !allowMissingAssets) throw new MissingProjectAssetsError(missing);

  const packagedDocument: ConversationDocument = {
    ...exportDocument,
    assets: exportDocument.assets.map((asset) => ({
      ...asset,
      ...(availableByteSizes.has(asset.id)
        ? { byteSize: availableByteSizes.get(asset.id) }
        : {}),
      source: { kind: "local", storageKey: packageStorageKey(asset) },
    })),
  };
  const documentBytes = strToU8(JSON.stringify(packagedDocument, null, 2));
  const manifest: ProjectManifestV1 = {
    format: PROJECT_FORMAT_ID,
    packageVersion: PROJECT_PACKAGE_VERSION,
    schemaVersion: 1,
    createdAt: now().toISOString(),
    appVersion: APP_VERSION,
    documentPath: "document.json",
    documentByteSize: documentBytes.byteLength,
    documentSha256: await sha256Hex(documentBytes),
    assets: manifestAssets,
  };
  const manifestBytes = strToU8(JSON.stringify(manifest, null, 2));
  const expandedBytes = Object.values(files).reduce(
    (total, entry) => total + (entry instanceof Uint8Array ? entry.byteLength : 0),
    documentBytes.byteLength + manifestBytes.byteLength,
  );
  if (expandedBytes > PROJECT_LIMITS.expandedBytes) {
    throw new ProjectFormatError(
      "项目解压后太大了。",
      "PROJECT_EXPANDED_TOO_LARGE",
    );
  }
  files[manifest.documentPath] = documentBytes;
  files["manifest.json"] = manifestBytes;
  const archive = await zipAsync(files);
  if (archive.byteLength > PROJECT_LIMITS.compressedBytes) {
    throw new ProjectFormatError(
      msg("项目文件超过 {0} MB，请减少附件后重新导出。", PROJECT_LIMITS.compressedBytes / 1024 / 1024),
      "PROJECT_COMPRESSED_TOO_LARGE",
    );
  }
  const archiveCopy = new Uint8Array(archive.byteLength);
  archiveCopy.set(archive);

  return {
    blob: new Blob([archiveCopy.buffer], { type: PROJECT_MIME_TYPE }),
    fileName: safeProjectName(exportDocument.metadata.title),
    manifest,
    warnings,
  };
}
