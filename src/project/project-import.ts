import { message as msg, diagnosticMessage } from "../i18n/messages";
import { Inflate, strFromU8 } from "fflate";
import { loadConversationDocument } from "../data/document-loader";
import type { ConversationDocument } from "../data/conversation-types";
import type { StoredAssetRecord } from "../persistence/project-store";
import { migrateDocumentForImport } from "./migrations";
import {
  PROJECT_FORMAT_ID,
  PROJECT_LIMITS,
  PROJECT_PACKAGE_VERSION,
  ProjectFormatError,
  type PreparedProjectImport,
  type ProjectManifestAsset,
  type ProjectManifestV1,
  type ProjectWarning,
} from "./project-format";
import { sha256Hex } from "./project-export";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertKnownKeys(record: Record<string, unknown>, allowed: ReadonlySet<string>, path: string): void {
  const unknown = Object.keys(record).find((key) => !allowed.has(key));
  if (unknown) {
    throw new ProjectFormatError(
      msg("{0} 里有这个版本不认识的字段：{1}。", path, unknown),
      "UNKNOWN_MANIFEST_FIELD",
      `${path}.${unknown}`,
    );
  }
}

function parseJson(bytes: Uint8Array, path: string): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new ProjectFormatError(msg("{0} 不是有效的 JSON。", path), "INVALID_JSON", path);
  }
}

function assertSafePath(path: string): void {
  if (
    !path
    || path.includes("\0")
    || path.startsWith("/")
    || path.startsWith("\\")
    || path.includes("\\")
    || path.split("/").includes("..")
  ) {
    throw new ProjectFormatError(msg("项目文件里有不安全的路径：{0}", path), "UNSAFE_ARCHIVE_PATH", path);
  }
}

const ZIP_LOCAL_HEADER = 0x04034b50;
const ZIP_CENTRAL_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP64_U16_SENTINEL = 0xffff;
const ZIP64_U32_SENTINEL = 0xffffffff;
const INFLATE_INPUT_CHUNK_BYTES = 8 * 1024;
const INFLATE_YIELD_INTERVAL_BYTES = 1024 * 1024;

interface SafeZipEntry {
  readonly name: string;
  readonly compression: 0 | 8;
  readonly crc32: number;
  readonly compressedSize: number;
  readonly originalSize: number;
  readonly dataStart: number;
  readonly dataEnd: number;
  readonly localHeaderOffset: number;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0
        ? (0xedb88320 ^ (value >>> 1))
        : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function invalidArchive(message: import("../i18n/messages").LocalizedText, path?: string): ProjectFormatError {
  return new ProjectFormatError(message, "INVALID_ARCHIVE", path);
}

function readZipU16(view: DataView, offset: number): number {
  if (offset < 0 || offset + 2 > view.byteLength) throw invalidArchive("项目文件已损坏。");
  return view.getUint16(offset, true);
}

function readZipU32(view: DataView, offset: number): number {
  if (offset < 0 || offset + 4 > view.byteLength) throw invalidArchive("项目文件已损坏。");
  return view.getUint32(offset, true);
}

function decodeZipName(bytes: Uint8Array, utf8: boolean): string {
  try {
    return strFromU8(bytes, !utf8);
  } catch {
    throw invalidArchive("项目文件已损坏。");
  }
}

function parseSafeZipEntries(bytes: Uint8Array): readonly SafeZipEntry[] {
  if (bytes.byteLength < 22) throw invalidArchive("项目文件已损坏。");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimumEndOffset = Math.max(0, bytes.byteLength - 65_557);
  let endOffset = -1;
  for (let offset = bytes.byteLength - 22; offset >= minimumEndOffset; offset -= 1) {
    if (
      readZipU32(view, offset) === ZIP_END_OF_CENTRAL_DIRECTORY
      && offset + 22 + readZipU16(view, offset + 20) === bytes.byteLength
    ) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw invalidArchive("项目文件已损坏。");

  const diskNumber = readZipU16(view, endOffset + 4);
  const centralDisk = readZipU16(view, endOffset + 6);
  const entriesOnDisk = readZipU16(view, endOffset + 8);
  const entryCount = readZipU16(view, endOffset + 10);
  const centralSize = readZipU32(view, endOffset + 12);
  const centralOffset = readZipU32(view, endOffset + 16);
  const commentLength = readZipU16(view, endOffset + 20);
  if (endOffset + 22 + commentLength !== bytes.byteLength) {
    throw invalidArchive("项目文件已损坏。");
  }
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    throw invalidArchive("不是话卷导出的项目文件，请用话卷重新导出。");
  }
  if (
    entryCount === ZIP64_U16_SENTINEL
    || centralSize === ZIP64_U32_SENTINEL
    || centralOffset === ZIP64_U32_SENTINEL
  ) {
    throw invalidArchive("不是话卷导出的项目文件，请用话卷重新导出。");
  }
  if (entryCount > PROJECT_LIMITS.entryCount) {
    throw new ProjectFormatError("项目里的文件太多了。", "TOO_MANY_ENTRIES");
  }
  if (centralOffset + centralSize !== endOffset) {
    throw invalidArchive("项目文件已损坏。");
  }

  const entries: SafeZipEntry[] = [];
  const seenNames = new Set<string>();
  let claimedExpandedBytes = 0;
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (readZipU32(view, cursor) !== ZIP_CENTRAL_HEADER) {
      throw invalidArchive("项目文件已损坏。");
    }
    const flags = readZipU16(view, cursor + 8);
    const compression = readZipU16(view, cursor + 10);
    const crc32 = readZipU32(view, cursor + 16);
    const compressedSize = readZipU32(view, cursor + 20);
    const originalSize = readZipU32(view, cursor + 24);
    const fileNameLength = readZipU16(view, cursor + 28);
    const extraLength = readZipU16(view, cursor + 30);
    const fileCommentLength = readZipU16(view, cursor + 32);
    const startDisk = readZipU16(view, cursor + 34);
    const localHeaderOffset = readZipU32(view, cursor + 42);
    const nextCursor = cursor + 46 + fileNameLength + extraLength + fileCommentLength;
    if (nextCursor > centralOffset + centralSize) {
      throw invalidArchive("项目文件已损坏。");
    }
    if (
      compressedSize === ZIP64_U32_SENTINEL
      || originalSize === ZIP64_U32_SENTINEL
      || localHeaderOffset === ZIP64_U32_SENTINEL
      || startDisk !== 0
    ) {
      throw invalidArchive("不是话卷导出的项目文件，请用话卷重新导出。");
    }
    if ((flags & 0x0001) !== 0 || (flags & 0x0040) !== 0) {
      throw invalidArchive("项目文件加了密码，打不开。");
    }
    if ((flags & 0x0008) !== 0) {
      throw invalidArchive("不是话卷导出的项目文件，请用话卷重新导出。");
    }
    if (compression !== 0 && compression !== 8) {
      throw invalidArchive("不是话卷导出的项目文件，请用话卷重新导出。");
    }
    const nameStart = cursor + 46;
    const name = decodeZipName(
      bytes.subarray(nameStart, nameStart + fileNameLength),
      (flags & 0x0800) !== 0,
    );
    assertSafePath(name);
    if (seenNames.has(name)) {
      throw new ProjectFormatError("项目文件已损坏。", "DUPLICATE_ARCHIVE_PATH", name);
    }
    seenNames.add(name);
    claimedExpandedBytes += originalSize;
    if (
      !name.endsWith("/")
      && name !== "manifest.json"
      && name !== "document.json"
      && originalSize > PROJECT_LIMITS.singleAssetBytes
    ) {
      throw new ProjectFormatError(msg("{0} 太大了。", name), "ASSET_TOO_LARGE", name);
    }
    if (claimedExpandedBytes > PROJECT_LIMITS.expandedBytes) {
      throw new ProjectFormatError("项目解压后太大了。", "PROJECT_EXPANDED_TOO_LARGE");
    }
    if (name.endsWith("/") && (compressedSize !== 0 || originalSize !== 0)) {
      throw invalidArchive("项目文件已损坏。", name);
    }

    if (readZipU32(view, localHeaderOffset) !== ZIP_LOCAL_HEADER) {
      throw invalidArchive("项目文件已损坏。", name);
    }
    const localFlags = readZipU16(view, localHeaderOffset + 6);
    const localCompression = readZipU16(view, localHeaderOffset + 8);
    const localCrc32 = readZipU32(view, localHeaderOffset + 14);
    const localCompressedSize = readZipU32(view, localHeaderOffset + 18);
    const localOriginalSize = readZipU32(view, localHeaderOffset + 22);
    const localNameLength = readZipU16(view, localHeaderOffset + 26);
    const localExtraLength = readZipU16(view, localHeaderOffset + 28);
    const localNameStart = localHeaderOffset + 30;
    const dataStart = localNameStart + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > centralOffset) {
      throw invalidArchive("项目文件已损坏。", name);
    }
    const localName = decodeZipName(
      bytes.subarray(localNameStart, localNameStart + localNameLength),
      (localFlags & 0x0800) !== 0,
    );
    if (localName !== name || localFlags !== flags || localCompression !== compression) {
      throw invalidArchive("项目文件已损坏。", name);
    }
    if (
      localCrc32 !== crc32
      || localCompressedSize !== compressedSize
      || localOriginalSize !== originalSize
    ) {
      throw invalidArchive("项目文件已损坏。", name);
    }
    if (compression === 0 && compressedSize !== originalSize) {
      throw invalidArchive("项目文件已损坏。", name);
    }
    if (compression === 8 && compressedSize === 0) {
      throw invalidArchive("项目文件已损坏。", name);
    }

    entries.push({
      name,
      compression,
      crc32,
      compressedSize,
      originalSize,
      dataStart,
      dataEnd,
      localHeaderOffset,
    });
    cursor = nextCursor;
  }
  if (cursor !== centralOffset + centralSize) {
    throw invalidArchive("项目文件已损坏。");
  }

  const ranges = [...entries]
    .sort((left, right) => left.localHeaderOffset - right.localHeaderOffset);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index].localHeaderOffset < ranges[index - 1].dataEnd) {
      throw invalidArchive("项目文件已损坏。");
    }
  }
  return entries;
}

function updateCrc32(current: number, chunk: Uint8Array): number {
  let crc = current;
  for (let index = 0; index < chunk.length; index += 1) {
    crc = CRC32_TABLE[(crc ^ chunk[index]) & 0xff] ^ (crc >>> 8);
  }
  return crc >>> 0;
}

function yieldToImportEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

interface ExtractionBudget {
  expandedBytes: number;
}

async function extractZipEntrySafely(
  bytes: Uint8Array,
  entry: SafeZipEntry,
  budget: ExtractionBudget,
): Promise<Uint8Array<ArrayBuffer>> {
  let output: Uint8Array<ArrayBuffer>;
  try {
    output = new Uint8Array(entry.originalSize);
  } catch {
    throw new ProjectFormatError(
      "浏览器内存不够，打不开这个项目。",
      "ARCHIVE_ALLOCATION_FAILED",
      entry.name,
    );
  }
  let entryBytes = 0;
  let crc32 = 0xffffffff;
  let outputBytesSinceYield = 0;
  let compressedBytesSinceYield = 0;
  const acceptChunk = (chunk: Uint8Array) => {
    if (chunk.byteLength === 0) return;
    const nextEntryBytes = entryBytes + chunk.byteLength;
    const nextExpandedBytes = budget.expandedBytes + chunk.byteLength;
    if (nextEntryBytes > entry.originalSize) {
      throw new ProjectFormatError(
        "项目文件已损坏。",
        "ARCHIVE_SIZE_MISMATCH",
        entry.name,
      );
    }
    if (
      !entry.name.endsWith("/")
      && entry.name !== "manifest.json"
      && entry.name !== "document.json"
      && nextEntryBytes > PROJECT_LIMITS.singleAssetBytes
    ) {
      throw new ProjectFormatError(
        msg("{0} 太大了。", entry.name),
        "ASSET_TOO_LARGE",
        entry.name,
      );
    }
    if (nextExpandedBytes > PROJECT_LIMITS.expandedBytes) {
      throw new ProjectFormatError(
        "项目解压后太大了。",
        "PROJECT_EXPANDED_TOO_LARGE",
      );
    }
    crc32 = updateCrc32(crc32, chunk);
    output.set(chunk, entryBytes);
    entryBytes = nextEntryBytes;
    budget.expandedBytes = nextExpandedBytes;
    outputBytesSinceYield += chunk.byteLength;
  };

  try {
    if (entry.compression === 0) {
      for (let offset = entry.dataStart; offset < entry.dataEnd; offset += INFLATE_YIELD_INTERVAL_BYTES) {
        const end = Math.min(offset + INFLATE_YIELD_INTERVAL_BYTES, entry.dataEnd);
        acceptChunk(bytes.subarray(offset, end));
        if (end !== entry.dataEnd) {
          outputBytesSinceYield = 0;
          await yieldToImportEventLoop();
        }
      }
    } else {
      const inflate = new Inflate((chunk) => acceptChunk(chunk));
      for (let offset = entry.dataStart; offset < entry.dataEnd; offset += INFLATE_INPUT_CHUNK_BYTES) {
        const end = Math.min(offset + INFLATE_INPUT_CHUNK_BYTES, entry.dataEnd);
        inflate.push(bytes.subarray(offset, end), end === entry.dataEnd);
        compressedBytesSinceYield += end - offset;
        if (
          (outputBytesSinceYield >= INFLATE_YIELD_INTERVAL_BYTES
            || compressedBytesSinceYield >= INFLATE_YIELD_INTERVAL_BYTES)
          && end !== entry.dataEnd
        ) {
          outputBytesSinceYield = 0;
          compressedBytesSinceYield = 0;
          await yieldToImportEventLoop();
        }
      }
    }
  } catch (error) {
    if (error instanceof ProjectFormatError) throw error;
    throw invalidArchive("项目文件已损坏。", entry.name);
  }

  if (entryBytes !== entry.originalSize) {
    throw new ProjectFormatError(
      "项目文件已损坏。",
      "ARCHIVE_SIZE_MISMATCH",
      entry.name,
    );
  }
  if (((crc32 ^ 0xffffffff) >>> 0) !== entry.crc32) {
    throw new ProjectFormatError(
      "项目文件已损坏。",
      "ARCHIVE_CRC_MISMATCH",
      entry.name,
    );
  }
  return output;
}

function parseManifest(raw: unknown): ProjectManifestV1 {
  if (!isRecord(raw)) throw new ProjectFormatError("项目文件已损坏。", "INVALID_MANIFEST", "manifest.json");
  assertKnownKeys(raw, new Set([
    "format",
    "packageVersion",
    "schemaVersion",
    "createdAt",
    "appVersion",
    "documentPath",
    "documentByteSize",
    "documentSha256",
    "assets",
  ]), "manifest.json");
  if (raw.format !== PROJECT_FORMAT_ID) {
    throw new ProjectFormatError("这不是话卷的项目文件。", "INVALID_PROJECT_FORMAT", "manifest.json.format");
  }
  if (typeof raw.packageVersion === "number" && raw.packageVersion > PROJECT_PACKAGE_VERSION) {
    throw new ProjectFormatError(
      "这个项目文件来自更新的版本，请先升级话卷。",
      "PACKAGE_VERSION_TOO_NEW",
      "manifest.json.packageVersion",
    );
  }
  if (raw.packageVersion !== PROJECT_PACKAGE_VERSION || raw.schemaVersion !== 1 || raw.documentPath !== "document.json") {
    throw new ProjectFormatError("项目文件已损坏。", "INVALID_MANIFEST_VERSION", "manifest.json");
  }
  if (
    typeof raw.createdAt !== "string" ||
    typeof raw.appVersion !== "string" ||
    typeof raw.documentByteSize !== "number" ||
    typeof raw.documentSha256 !== "string" ||
    !Array.isArray(raw.assets)
  ) {
    throw new ProjectFormatError("项目文件已损坏。", "INVALID_MANIFEST_FIELDS", "manifest.json");
  }
  const assets = raw.assets.map((asset, index) => parseManifestAsset(asset, index));
  const availablePaths = new Set<string>();
  for (const [index, asset] of assets.entries()) {
    if (!asset.path) continue;
    if (availablePaths.has(asset.path)) {
      throw new ProjectFormatError(
        "项目文件已损坏。",
        "DUPLICATE_ASSET_PATH",
        `manifest.json.assets[${index}].path`,
      );
    }
    availablePaths.add(asset.path);
  }
  return { ...raw, assets } as unknown as ProjectManifestV1;
}

function parseManifestAsset(raw: unknown, index: number): ProjectManifestAsset {
  const path = `manifest.json.assets[${index}]`;
  if (!isRecord(raw)) throw new ProjectFormatError("项目文件已损坏。", "INVALID_MANIFEST_ASSET", path);
  assertKnownKeys(raw, new Set([
    "assetId",
    "storageKey",
    "fileName",
    "mimeType",
    "state",
    "path",
    "byteSize",
    "sha256",
  ]), path);
  if (
    typeof raw.assetId !== "string" || !raw.assetId ||
    typeof raw.storageKey !== "string" || !raw.storageKey ||
    typeof raw.fileName !== "string" || !raw.fileName ||
    typeof raw.mimeType !== "string" || !raw.mimeType ||
    (raw.state !== "available" && raw.state !== "missing")
  ) {
    throw new ProjectFormatError("项目文件已损坏。", "INVALID_MANIFEST_ASSET", path);
  }
  if (raw.state === "available") {
    if (typeof raw.path !== "string" || typeof raw.byteSize !== "number" || typeof raw.sha256 !== "string") {
      throw new ProjectFormatError("项目文件已损坏。", "INVALID_MANIFEST_ASSET", path);
    }
    assertSafePath(raw.path);
    if (!raw.path.startsWith("assets/") || raw.path.endsWith("/")) {
      throw new ProjectFormatError("项目文件已损坏。", "INVALID_ASSET_PATH", `${path}.path`);
    }
  } else if (raw.path !== undefined || raw.byteSize !== undefined || raw.sha256 !== undefined) {
    throw new ProjectFormatError(
      "项目文件已损坏。",
      "INVALID_MANIFEST_ASSET",
      path,
    );
  }
  return raw as unknown as ProjectManifestAsset;
}

function remapDocumentAssets(
  document: ConversationDocument,
  keyMap: ReadonlyMap<string, string>,
  availableByteSizes: ReadonlyMap<string, number>,
): ConversationDocument {
  return {
    ...document,
    assets: document.assets.map((asset) => {
      const storageKey = keyMap.get(asset.id);
      const byteSize = availableByteSizes.get(asset.id);
      if (!storageKey) return asset;
      const normalized = {
        ...asset,
        source: { kind: "local" as const, storageKey },
      };
      if (byteSize === undefined) {
        delete normalized.byteSize;
        return normalized;
      }
      return { ...normalized, byteSize };
    }),
  };
}

export async function importProjectPackage(
  file: Blob & { readonly name?: string },
  idFactory: () => string = () => crypto.randomUUID(),
  now: () => Date = () => new Date(),
): Promise<PreparedProjectImport> {
  if (file.size > PROJECT_LIMITS.compressedBytes) {
    throw new ProjectFormatError(msg("项目文件超过 {0} MB，请缩小文件后重新导入。", PROJECT_LIMITS.compressedBytes / 1024 / 1024), "PROJECT_COMPRESSED_TOO_LARGE");
  }
  const archiveBytes = new Uint8Array(await file.arrayBuffer());
  const zipEntries = parseSafeZipEntries(archiveBytes);
  const zipEntryByName = new Map(zipEntries.map((entry) => [entry.name, entry]));
  const extractionBudget: ExtractionBudget = { expandedBytes: 0 };
  const manifestEntry = zipEntryByName.get("manifest.json");
  if (!manifestEntry) {
    throw new ProjectFormatError("这不是话卷的项目文件。", "MISSING_MANIFEST", "manifest.json");
  }
  const manifestBytes = await extractZipEntrySafely(
    archiveBytes,
    manifestEntry,
    extractionBudget,
  );
  const manifest = parseManifest(parseJson(manifestBytes, "manifest.json"));
  const allowedPaths = new Set(["manifest.json", manifest.documentPath]);
  manifest.assets.forEach((asset) => {
    if (asset.path) allowedPaths.add(asset.path);
  });
  const allowedDirectoryPaths = new Set<string>();
  allowedPaths.forEach((path) => {
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      allowedDirectoryPaths.add(`${segments.slice(0, index).join("/")}/`);
    }
  });
  const extraPath = zipEntries.find(
    (entry) => entry.name.endsWith("/")
      ? !allowedDirectoryPaths.has(entry.name)
      : !allowedPaths.has(entry.name),
  )?.name;
  if (extraPath) {
    throw new ProjectFormatError("项目文件已损坏。", "UNDECLARED_ARCHIVE_ENTRY", extraPath);
  }
  const documentEntry = zipEntryByName.get(manifest.documentPath);
  if (!documentEntry) {
    throw new ProjectFormatError("项目文件已损坏。", "MISSING_DOCUMENT", manifest.documentPath);
  }
  const documentBytes = await extractZipEntrySafely(
    archiveBytes,
    documentEntry,
    extractionBudget,
  );
  if (documentBytes.byteLength !== manifest.documentByteSize) {
    throw new ProjectFormatError("项目文件已损坏。", "DOCUMENT_SIZE_MISMATCH", manifest.documentPath);
  }
  if (await sha256Hex(documentBytes) !== manifest.documentSha256) {
    throw new ProjectFormatError("项目文件已损坏。", "DOCUMENT_HASH_MISMATCH", manifest.documentPath);
  }

  const migrated = migrateDocumentForImport(parseJson(documentBytes, manifest.documentPath));
  const loaded = loadConversationDocument(migrated.document);
  if (loaded.status === "invalid") {
    const first = loaded.diagnostics[0];
    throw new ProjectFormatError(first.messageText ?? first.message, first.code, `document.${first.path}`, first.subject);
  }

  const warnings: ProjectWarning[] = [...migrated.warnings];
  const storedAssets: StoredAssetRecord[] = [];
  const keyMap = new Map<string, string>();
  const availableByteSizes = new Map<string, number>();
  const manifestById = new Map(manifest.assets.map((asset) => [asset.assetId, asset]));
  let availableAssetBytes = 0;

  for (const [index, asset] of loaded.document.assets.entries()) {
    const entry = manifestById.get(asset.id);
    if (!entry) {
      throw new ProjectFormatError("项目文件已损坏。", "MISSING_ASSET_MANIFEST", `document.assets[${index}]`);
    }
    if (entry.storageKey !== (asset.source.kind === "local" ? asset.source.storageKey : undefined)) {
      throw new ProjectFormatError("项目文件已损坏。", "ASSET_STORAGE_KEY_MISMATCH", `document.assets[${index}]`);
    }
    if (entry.fileName !== asset.fileName || entry.mimeType !== asset.mimeType) {
      throw new ProjectFormatError("项目文件已损坏。", "ASSET_METADATA_MISMATCH", `document.assets[${index}]`);
    }
    const storageKey = `local:${asset.id}:${idFactory()}`;
    keyMap.set(asset.id, storageKey);
    if (entry.state === "missing") {
      warnings.push({
        code: "MISSING_ASSET_IMPORTED",
        path: `document.assets[${index}]`,
        ...diagnosticMessage(msg("{0} 在项目里已经缺失。", entry.fileName)),
      });
      continue;
    }
    const zipEntry = entry.path ? zipEntryByName.get(entry.path) : undefined;
    if (!zipEntry) throw new ProjectFormatError(msg("项目文件里少了 {0}。", entry.fileName), "MISSING_ASSET_FILE", entry.path);
    const bytes = await extractZipEntrySafely(archiveBytes, zipEntry, extractionBudget);
    if (bytes.byteLength !== entry.byteSize) {
      throw new ProjectFormatError(msg("{0} 已损坏。", entry.fileName), "ASSET_SIZE_MISMATCH", entry.path);
    }
    if (await sha256Hex(bytes) !== entry.sha256) {
      throw new ProjectFormatError(msg("{0} 已损坏。", entry.fileName), "ASSET_HASH_MISMATCH", entry.path);
    }
    availableAssetBytes += bytes.byteLength;
    availableByteSizes.set(asset.id, bytes.byteLength);
    storedAssets.push({
      storageKey,
      blob: new Blob([bytes], { type: entry.mimeType }),
      fileName: entry.fileName,
      mimeType: entry.mimeType,
      byteSize: bytes.byteLength,
      savedAt: now().toISOString(),
    });
  }

  if (manifest.assets.length !== loaded.document.assets.length) {
    throw new ProjectFormatError("项目文件已损坏。", "EXTRA_MANIFEST_ASSET", "manifest.json.assets");
  }

  const document = remapDocumentAssets(loaded.document, keyMap, availableByteSizes);
  return {
    kind: "project",
    fileName: file.name || "project.convcanvas",
    document,
    assets: storedAssets,
    warnings,
    summary: {
      title: document.metadata.title || "未命名对话",
      messageCount: document.messages.length,
      blockCount: document.messages.reduce((total, message) => total + message.blocks.length, 0),
      assetCount: document.assets.length,
      availableAssetBytes,
    },
  };
}
