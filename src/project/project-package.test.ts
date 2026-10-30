import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from "fflate";
import { describe, expect, it, vi } from "vitest";
import {
  addMessage,
  createEmptyDocument,
  removeBlock,
  type EditorIdFactory,
} from "../editor/document-operations";
import { attachAsset } from "../editor/workbench-operations";
import { APP_VERSION } from "../product-info";
import { exportProjectPackage, sha256Hex } from "./project-export";
import { importProjectPackage } from "./project-import";
import {
  MissingProjectAssetsError,
  PROJECT_FORMAT_ID,
  PROJECT_LIMITS,
  PROJECT_PACKAGE_VERSION,
} from "./project-format";

function idFactory(): EditorIdFactory {
  let index = 0;
  return (kind) => `${kind}-${++index}`;
}

function localAssetDocument() {
  const ids = idFactory();
  let document = createEmptyDocument(ids);
  const added = addMessage(document, "user", ids);
  document = added.document;
  return attachAsset(document, { messageId: added.messageId, kind: "file" }, {
    id: ids("asset"),
    kind: "file",
    fileName: "notes.txt",
    mimeType: "text/plain",
    byteSize: 5,
    source: { kind: "local", storageKey: "local:source" },
  });
}

function manyAssetDocument(count: number) {
  return assetDocument(Array.from({ length: count }, () => 1));
}

function assetDocument(byteSizes: readonly number[]) {
  const assets = byteSizes.map((byteSize, index) => ({
    id: `asset-many-${index}`,
    kind: "file" as const,
    fileName: `asset-${index}.bin`,
    mimeType: "application/octet-stream",
    byteSize,
    source: { kind: "local" as const, storageKey: `local:asset-many-${index}` },
  }));
  return {
    ...createEmptyDocument(() => "document-many-assets"),
    assets,
    messages: [{
      id: "message-many-assets",
      role: "user" as const,
      blocks: assets.map((asset, index) => ({
        id: `block-many-${index}`,
        type: "file" as const,
        assetId: asset.id,
      })),
    }],
  };
}

function deterministicBinary(length: number, seed: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(length));
  let state = seed >>> 0;
  for (let index = 0; index < bytes.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[index] = state & 0xff;
  }
  return bytes;
}

function namedBlob(blob: Blob, name = "roundtrip.convcanvas"): Blob & { readonly name: string } {
  Object.defineProperty(blob, "name", { configurable: true, value: name });
  return blob as Blob & { readonly name: string };
}

function archiveBlob(files: Zippable): Blob & { readonly name: string } {
  const bytes = zipSync(files);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return namedBlob(new Blob([copy.buffer]));
}

function patchZipEntryHeaders(
  archive: Uint8Array,
  entryName: string,
  patchLocal: (view: DataView, offset: number) => void,
  patchCentral: (view: DataView, offset: number) => void,
): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(new ArrayBuffer(archive.byteLength));
  copy.set(archive);
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
  let patchedLocal = false;
  let patchedCentral = false;

  for (let offset = 0; offset + 4 <= copy.byteLength; offset += 1) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x04034b50 && offset + 30 <= copy.byteLength) {
      const nameLength = view.getUint16(offset + 26, true);
      const nameStart = offset + 30;
      if (
        nameStart + nameLength <= copy.byteLength
        && strFromU8(copy.subarray(nameStart, nameStart + nameLength)) === entryName
      ) {
        patchLocal(view, offset);
        patchedLocal = true;
      }
    } else if (signature === 0x02014b50 && offset + 46 <= copy.byteLength) {
      const nameLength = view.getUint16(offset + 28, true);
      const nameStart = offset + 46;
      if (
        nameStart + nameLength <= copy.byteLength
        && strFromU8(copy.subarray(nameStart, nameStart + nameLength)) === entryName
      ) {
        patchCentral(view, offset);
        patchedCentral = true;
      }
    }
  }

  if (!patchedLocal || !patchedCentral) throw new Error(`Unable to patch ZIP entry ${entryName}`);
  return copy;
}

function forgeZipEntryUncompressedSize(
  archive: Uint8Array,
  entryName: string,
  forgedSize: number,
): Uint8Array<ArrayBuffer> {
  return patchZipEntryHeaders(
    archive,
    entryName,
    (view, offset) => view.setUint32(offset + 22, forgedSize, true),
    (view, offset) => view.setUint32(offset + 24, forgedSize, true),
  );
}

function forgeZipEntryCrc32(
  archive: Uint8Array,
  entryName: string,
  forgedCrc32: number,
): Uint8Array<ArrayBuffer> {
  return patchZipEntryHeaders(
    archive,
    entryName,
    (view, offset) => view.setUint32(offset + 14, forgedCrc32, true),
    (view, offset) => view.setUint32(offset + 16, forgedCrc32, true),
  );
}

function addZipEntryFlags(
  archive: Uint8Array,
  entryName: string,
  addedFlags: number,
): Uint8Array<ArrayBuffer> {
  return patchZipEntryHeaders(
    archive,
    entryName,
    (view, offset) => view.setUint16(offset + 6, view.getUint16(offset + 6, true) | addedFlags, true),
    (view, offset) => view.setUint16(offset + 8, view.getUint16(offset + 8, true) | addedFlags, true),
  );
}

async function updateDocumentAndManifest(
  blob: Blob,
  update: (document: Record<string, unknown>) => void,
): Promise<Blob & { readonly name: string }> {
  const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  const document = JSON.parse(strFromU8(files["document.json"])) as Record<string, unknown>;
  update(document);
  const documentBytes = strToU8(JSON.stringify(document, null, 2));
  files["document.json"] = documentBytes;
  const manifest = JSON.parse(strFromU8(files["manifest.json"])) as Record<string, unknown>;
  manifest.documentByteSize = documentBytes.byteLength;
  manifest.documentSha256 = await sha256Hex(documentBytes);
  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  return archiveBlob(files);
}

describe(".convcanvas project package", () => {
  it.each(["manifest.json", "document.json"])("rejects malformed UTF-8 in %s even with matching checksums", async (path) => {
    const document = createEmptyDocument(idFactory());
    const exported = await exportProjectPackage({ document, resolveAssetBlob: async () => undefined });
    const files = unzipSync(new Uint8Array(await exported.blob.arrayBuffer()));
    const invalidTitle = new Uint8Array([0x22, 0x61, 0xc3, 0x28, 0x62, 0x22]);
    const object = JSON.parse(strFromU8(files[path])) as Record<string, unknown>;
    if (path === "document.json") (object.metadata as Record<string, unknown>).title = "ENCODING_PROBE";
    else object.appVersion = "ENCODING_PROBE";
    const [before, after] = JSON.stringify(object).split('"ENCODING_PROBE"');
    const prefix = strToU8(before); const suffix = strToU8(after);
    const bytes = new Uint8Array(prefix.length + invalidTitle.length + suffix.length);
    bytes.set(prefix); bytes.set(invalidTitle, prefix.length); bytes.set(suffix, prefix.length + invalidTitle.length);
    files[path] = bytes;
    if (path === "document.json") {
      const manifest = JSON.parse(strFromU8(files["manifest.json"]));
      manifest.documentByteSize = bytes.byteLength;
      manifest.documentSha256 = await sha256Hex(bytes);
      files["manifest.json"] = strToU8(JSON.stringify(manifest));
    }
    await expect(importProjectPackage(archiveBlob(files))).rejects.toMatchObject({ code: "INVALID_JSON", path });
  });

  it("reports a bounded diagnostic for deeply nested opaque data in a verified package", async () => {
    const exported = await exportProjectPackage({ document: createEmptyDocument(idFactory()), resolveAssetBlob: async () => undefined });
    const file = await updateDocumentAndManifest(exported.blob, (document) => {
      document.messages = [{ id: "message-deep", role: "assistant", blocks: [{
        id: "block-deep", type: "unsupported", originalType: "future",
        raw: JSON.parse("[".repeat(256) + "0" + "]".repeat(256)),
      }] }];
    });
    await expect(importProjectPackage(file)).rejects.toMatchObject({ code: "JSON_DEPTH_EXCEEDED", path: "document.messages[0].blocks[0].raw" });
  });

  it("round-trips a document and original binary asset", async () => {
    const document = localAssetDocument();
    const exported = await exportProjectPackage({
      document,
      resolveAssetBlob: async () => new Blob(["hello"], { type: "text/plain" }),
      now: () => new Date("2026-08-27T00:00:00.000Z"),
    });
    const imported = await importProjectPackage(namedBlob(exported.blob), () => "import-1");

    expect(exported.fileName).toMatch(/\.convcanvas$/);
    expect(exported.manifest.appVersion).toBe(APP_VERSION);
    expect(imported.document.messages).toEqual(document.messages);
    expect(imported.document.assets[0].source).toEqual({
      kind: "local",
      storageKey: expect.stringMatching(/^local:asset-\d+:import-1$/),
    });
    expect(imported.assets).toHaveLength(1);
    expect(imported.assets[0].blob.size).toBe(5);
    expect(imported.summary.availableAssetBytes).toBe(5);
  });

  it("round-trips multiple incompressible assets without relying on compression savings", async () => {
    const byteSizes = [64 * 1024, 65 * 1024, 66 * 1024];
    const document = assetDocument(byteSizes);
    const blobs = new Map(document.assets.map((asset, index) => [
      asset.id,
      new Blob([deterministicBinary(byteSizes[index], index + 1)], {
        type: "application/octet-stream",
      }),
    ]));

    const exported = await exportProjectPackage({
      document,
      resolveAssetBlob: async (asset) => blobs.get(asset.id),
    });
    const imported = await importProjectPackage(namedBlob(exported.blob), () => "binary-roundtrip");
    const sourceBytes = byteSizes.reduce((total, byteSize) => total + byteSize, 0);

    expect(exported.blob.size).toBeGreaterThan(sourceBytes);
    expect(imported.assets.map((asset) => asset.byteSize)).toEqual(byteSizes);
    expect(imported.summary.availableAssetBytes).toBe(sourceBytes);
  });

  it("stops forged ZIP inflation as soon as actual output exceeds its declared size", async () => {
    const base = assetDocument([1]);
    const asset = base.assets[0];
    const document = {
      ...base,
      assets: [{
        ...asset,
        source: { kind: "local" as const, storageKey: `asset:${asset.id}` },
      }],
    };
    const documentBytes = strToU8(JSON.stringify(document, null, 2));
    const actualAssetBytes = new Uint8Array(PROJECT_LIMITS.singleAssetBytes + 1);
    actualAssetBytes[0] = 7;
    const claimedAssetBytes = actualAssetBytes.subarray(0, 1);
    const manifest = {
      format: PROJECT_FORMAT_ID,
      packageVersion: PROJECT_PACKAGE_VERSION,
      schemaVersion: 1,
      createdAt: "2026-08-30T00:00:00.000Z",
      appVersion: APP_VERSION,
      documentPath: "document.json",
      documentByteSize: documentBytes.byteLength,
      documentSha256: await sha256Hex(documentBytes),
      assets: [{
        assetId: asset.id,
        storageKey: `asset:${asset.id}`,
        fileName: asset.fileName,
        mimeType: asset.mimeType,
        state: "available",
        path: "assets/0000.bin",
        byteSize: 1,
        sha256: await sha256Hex(claimedAssetBytes),
      }],
    };
    const archive = zipSync({
      "manifest.json": strToU8(JSON.stringify(manifest, null, 2)),
      "document.json": documentBytes,
      "assets/0000.bin": actualAssetBytes,
    });
    const forged = forgeZipEntryUncompressedSize(archive, "assets/0000.bin", 1);

    await expect(importProjectPackage(namedBlob(new Blob([forged])))).rejects.toMatchObject({
      code: "ARCHIVE_SIZE_MISMATCH",
      path: "assets/0000.bin",
    });
  });

  it("round-trips a legacy v1 document beyond the editor document headroom", async () => {
    const source = "\u0000".repeat(Math.ceil(PROJECT_LIMITS.documentBytes / 6));
    const document = {
      ...createEmptyDocument(() => "document-large-text"),
      messages: [{
        id: "message-large-text",
        role: "assistant" as const,
        blocks: [{
          id: "block-large-text",
          type: "markdown" as const,
          source,
        }],
      }],
    };

    const exported = await exportProjectPackage({
      document,
      resolveAssetBlob: async () => undefined,
    });
    const files = unzipSync(new Uint8Array(await exported.blob.arrayBuffer()));
    expect(files["document.json"].byteLength).toBeGreaterThan(PROJECT_LIMITS.documentBytes);

    const imported = await importProjectPackage(namedBlob(exported.blob), () => "large-text");
    const block = imported.document.messages[0]?.blocks[0];
    expect(block?.type).toBe("markdown");
    expect(block?.type === "markdown" ? block.source.length : 0).toBe(source.length);
  });

  it("round-trips a legacy v1 manifest beyond the editor manifest headroom", async () => {
    const maxAssets = PROJECT_LIMITS.entryCount - 2;
    const fileNamePadding = "x".repeat(
      Math.ceil(PROJECT_LIMITS.manifestBytes / maxAssets) + 100,
    );
    const base = manyAssetDocument(maxAssets);
    const document = {
      ...base,
      assets: base.assets.map((asset, index) => ({
        ...asset,
        fileName: `${index}-${fileNamePadding}.bin`,
      })),
    };

    const exported = await exportProjectPackage({
      document,
      resolveAssetBlob: async () => undefined,
      allowMissingAssets: true,
    });
    const files = unzipSync(new Uint8Array(await exported.blob.arrayBuffer()));
    expect(files["manifest.json"].byteLength).toBeGreaterThan(PROJECT_LIMITS.manifestBytes);

    const imported = await importProjectPackage(namedBlob(exported.blob), () => "large-manifest");
    expect(imported.document.assets).toHaveLength(maxAssets);
  });

  it("does not package an attachment after its final visible reference is deleted", async () => {
    const document = localAssetDocument();
    const block = document.messages[0].blocks.find((candidate) => candidate.type === "file");
    if (!block) throw new Error("Expected file block");
    const withoutAttachment = removeBlock(document, document.messages[0].id, block.id);
    const resolveAssetBlob = vi.fn(async () => new Blob(["private"]));

    const exported = await exportProjectPackage({ document: withoutAttachment, resolveAssetBlob });
    const files = unzipSync(new Uint8Array(await exported.blob.arrayBuffer()));

    expect(withoutAttachment.assets).toEqual([]);
    expect(exported.manifest.assets).toEqual([]);
    expect(Object.keys(files).filter((path) => path.startsWith("assets/"))).toEqual([]);
    expect(resolveAssetBlob).not.toHaveBeenCalled();
  });

  it("defensively excludes an unreferenced legacy asset from project export", async () => {
    const referenced = localAssetDocument();
    const legacyOrphan = { ...referenced, messages: [] };
    const resolveAssetBlob = vi.fn(async () => new Blob(["private"]));

    const exported = await exportProjectPackage({
      document: legacyOrphan,
      resolveAssetBlob,
    });
    const files = unzipSync(new Uint8Array(await exported.blob.arrayBuffer()));
    const packagedDocument = JSON.parse(strFromU8(files["document.json"])) as {
      assets: unknown[];
    };

    expect(exported.manifest.assets).toEqual([]);
    expect(packagedDocument.assets).toEqual([]);
    expect(Object.keys(files).filter((path) => path.startsWith("assets/"))).toEqual([]);
    expect(resolveAssetBlob).not.toHaveBeenCalled();
  });

  it("rejects an ambiguous unsupported asset token instead of packaging a deleted private asset", async () => {
    const document = {
      ...createEmptyDocument(() => "document-ambiguous-assets"),
      assets: [
        {
          id: "x",
          kind: "file" as const,
          fileName: "first.bin",
          mimeType: "application/octet-stream",
          byteSize: 1,
          source: { kind: "local" as const, storageKey: "local:first" },
        },
        {
          id: "asset:x",
          kind: "file" as const,
          fileName: "private-deleted.bin",
          mimeType: "application/octet-stream",
          byteSize: 1,
          source: { kind: "local" as const, storageKey: "local:private-deleted" },
        },
      ],
      messages: [{
        id: "message-ambiguous-assets",
        role: "assistant" as const,
        blocks: [{
          id: "block-ambiguous-assets",
          type: "unsupported" as const,
          originalType: "future-attachment",
          raw: { attachment: "asset:x" },
        }],
      }],
    };
    const resolveAssetBlob = vi.fn(async () => new Blob(["private"]));

    await expect(exportProjectPackage({ document, resolveAssetBlob })).rejects.toMatchObject({
      code: "AMBIGUOUS_ASSET_REFERENCE",
      path: "document.messages",
    });
    expect(resolveAssetBlob).not.toHaveBeenCalled();
  });

  it("rejects a changed asset before it can replace the current project", async () => {
    const exported = await exportProjectPackage({
      document: localAssetDocument(),
      resolveAssetBlob: async () => new Blob(["hello"], { type: "text/plain" }),
    });
    const files = unzipSync(new Uint8Array(await exported.blob.arrayBuffer()));
    const assetPath = Object.keys(files).find((path) => path.startsWith("assets/"));
    if (!assetPath) throw new Error("Expected packaged asset");
    files[assetPath][0] ^= 0xff;

    await expect(importProjectPackage(archiveBlob(files))).rejects.toMatchObject({
      code: "ASSET_HASH_MISMATCH",
    });
  });

  it("normalizes stale document byte metadata from the verified package entry", async () => {
    const exported = await exportProjectPackage({
      document: localAssetDocument(),
      resolveAssetBlob: async () => new Blob(["hello"], { type: "text/plain" }),
    });
    const changed = await updateDocumentAndManifest(exported.blob, (document) => {
      const assets = document.assets as Array<Record<string, unknown>>;
      assets[0].byteSize = 1;
    });

    const imported = await importProjectPackage(changed, () => "normalized-stale-import");
    expect(imported.document.assets[0].byteSize).toBe(5);
    expect(imported.assets[0].byteSize).toBe(5);
  });

  it("still rejects manifest byte metadata that disagrees with its binary entry", async () => {
    const exported = await exportProjectPackage({
      document: localAssetDocument(),
      resolveAssetBlob: async () => new Blob(["hello"], { type: "text/plain" }),
    });
    const files = unzipSync(new Uint8Array(await exported.blob.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(files["manifest.json"])) as {
      assets: Array<Record<string, unknown>>;
    };
    manifest.assets[0].byteSize = 4;
    files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));

    await expect(importProjectPackage(archiveBlob(files))).rejects.toMatchObject({
      code: "ASSET_SIZE_MISMATCH",
    });
  });

  it("restores missing optional byte metadata from the verified package entry", async () => {
    const exported = await exportProjectPackage({
      document: localAssetDocument(),
      resolveAssetBlob: async () => new Blob(["hello"], { type: "text/plain" }),
    });
    const changed = await updateDocumentAndManifest(exported.blob, (document) => {
      const assets = document.assets as Array<Record<string, unknown>>;
      delete assets[0].byteSize;
    });

    const imported = await importProjectPackage(changed, () => "normalized");
    expect(imported.document.assets[0].byteSize).toBe(5);
  });

  it("normalizes stale asset byte metadata before export so its own package remains importable", async () => {
    const document = localAssetDocument();
    const staleDocument = {
      ...document,
      assets: document.assets.map((asset) => ({ ...asset, byteSize: 1 })),
    };

    const exported = await exportProjectPackage({
      document: staleDocument,
      resolveAssetBlob: async () => new Blob(["hello"], { type: "text/plain" }),
    });
    const files = unzipSync(new Uint8Array(await exported.blob.arrayBuffer()));
    const packagedDocument = JSON.parse(strFromU8(files["document.json"])) as {
      assets: Array<{ byteSize?: number }>;
    };

    expect(packagedDocument.assets[0].byteSize).toBe(5);
    await expect(importProjectPackage(namedBlob(exported.blob), () => "normalized-stale"))
      .resolves.toMatchObject({ document: { assets: [{ byteSize: 5 }] } });
  });

  it("preserves an unknown future block as UnsupportedBlock", async () => {
    const exported = await exportProjectPackage({
      document: localAssetDocument(),
      resolveAssetBlob: async () => new Blob(["hello"], { type: "text/plain" }),
    });
    const changed = await updateDocumentAndManifest(exported.blob, (document) => {
      const messages = document.messages as Array<{ blocks: Array<Record<string, unknown>> }>;
      const assets = document.assets as Array<{ id: string }>;
      messages[0].blocks = [{
        id: messages[0].blocks[0].id,
        type: "futureChart",
        points: [1, 2, 3],
        attachment: { assetId: assets[0].id },
      }];
    });
    const imported = await importProjectPackage(changed, () => "unknown");
    const block = imported.document.messages[0].blocks[0];

    expect(block.type).toBe("unsupported");
    expect(block.type === "unsupported" ? block.originalType : undefined).toBe("futureChart");
    expect(imported.warnings[0]?.code).toBe("UNKNOWN_BLOCK_PRESERVED");

    const reExported = await exportProjectPackage({
      document: imported.document,
      resolveAssetBlob: async () => new Blob(["hello"], { type: "text/plain" }),
    });
    expect(reExported.manifest.assets).toHaveLength(1);
    const roundTripped = await importProjectPackage(reExported.blob, () => "again");
    expect(roundTripped.document.assets).toHaveLength(1);
    expect(roundTripped.document.messages[0].blocks[0]).toMatchObject({
      type: "unsupported",
      originalType: "futureChart",
    });
  });

  it("keeps an unknown block asset referenced only by its canonical package storage key", async () => {
    const exported = await exportProjectPackage({
      document: localAssetDocument(),
      resolveAssetBlob: async () => new Blob(["hello"], { type: "text/plain" }),
    });
    const changed = await updateDocumentAndManifest(exported.blob, (document) => {
      const messages = document.messages as Array<{ blocks: Array<Record<string, unknown>> }>;
      const assets = document.assets as Array<{ id: string }>;
      messages[0].blocks = [{
        id: messages[0].blocks[0].id,
        type: "futureAttachment",
        storage: { [`asset:${assets[0].id}`]: true },
      }];
    });

    const imported = await importProjectPackage(changed, () => "canonical-reference");
    const reExported = await exportProjectPackage({
      document: imported.document,
      resolveAssetBlob: async () => imported.assets[0]?.blob,
    });

    expect(imported.document.assets).toHaveLength(1);
    expect(reExported.manifest.assets).toHaveLength(1);
  });

  it("keeps opaque unknown storage-key text unchanged without retaining a private asset", async () => {
    const source = localAssetDocument();
    const asset = source.assets[0];
    if (asset.source.kind !== "local") throw new Error("Expected a local asset");
    const localStorageKey = asset.source.storageKey;
    const document = {
      ...source,
      messages: source.messages.map((message) => ({
        ...message,
        blocks: [{
          id: "block-future-local-reference",
          type: "unsupported" as const,
          originalType: "futureAttachment",
          raw: { opaque: localStorageKey },
        }],
      })),
    };

    const resolveAssetBlob = vi.fn(async () => new Blob(["hello"], { type: "text/plain" }));
    const exported = await exportProjectPackage({
      document,
      resolveAssetBlob,
    });
    const packagedFiles = unzipSync(new Uint8Array(await exported.blob.arrayBuffer()));
    const packagedDocument = JSON.parse(strFromU8(packagedFiles["document.json"])) as {
      assets: unknown[];
      messages: Array<{ blocks: Array<{ raw: { opaque: string } }> }>;
    };
    const imported = await importProjectPackage(namedBlob(exported.blob), () => "opaque-local-text");

    expect(packagedDocument.messages[0].blocks[0].raw.opaque).toBe(localStorageKey);
    expect(packagedDocument.assets).toEqual([]);
    expect(exported.manifest.assets).toEqual([]);
    expect(imported.document.messages[0].blocks[0]).toMatchObject({
      type: "unsupported",
      raw: { opaque: localStorageKey },
    });
    expect(resolveAssetBlob).not.toHaveBeenCalled();
  });

  it("blocks a package version newer than the reader", async () => {
    const exported = await exportProjectPackage({
      document: localAssetDocument(),
      resolveAssetBlob: async () => new Blob(["hello"]),
    });
    const files = unzipSync(new Uint8Array(await exported.blob.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(files["manifest.json"])) as Record<string, unknown>;
    manifest.packageVersion = 2;
    files["manifest.json"] = strToU8(JSON.stringify(manifest));

    await expect(importProjectPackage(archiveBlob(files))).rejects.toMatchObject({
      code: "PACKAGE_VERSION_TOO_NEW",
    });
  });

  it("rejects unsafe archive paths", async () => {
    const exported = await exportProjectPackage({
      document: localAssetDocument(),
      resolveAssetBlob: async () => new Blob(["hello"]),
    });
    const files = unzipSync(new Uint8Array(await exported.blob.arrayBuffer()));
    files["../escape.txt"] = strToU8("escape");

    await expect(importProjectPackage(archiveBlob(files))).rejects.toMatchObject({
      code: "UNSAFE_ARCHIVE_PATH",
    });
  });

  it("rejects undeclared entries before attempting to extract their payload", async () => {
    const exported = await exportProjectPackage({
      document: localAssetDocument(),
      resolveAssetBlob: async () => new Blob(["hello"]),
    });
    const files = unzipSync(new Uint8Array(await exported.blob.arrayBuffer()));
    files["undeclared.bin"] = strToU8("payload with a deliberately forged CRC");
    const archive = zipSync(files);
    const forged = forgeZipEntryCrc32(archive, "undeclared.bin", 0);

    await expect(importProjectPackage(namedBlob(new Blob([forged])))).rejects.toMatchObject({
      code: "UNDECLARED_ARCHIVE_ENTRY",
      path: "undeclared.bin",
    });
  });

  it("rejects undeclared empty directories but accepts declared parent directories", async () => {
    const exported = await exportProjectPackage({
      document: localAssetDocument(),
      resolveAssetBlob: async () => new Blob(["hello"]),
    });
    const files: Zippable = {
      ...unzipSync(new Uint8Array(await exported.blob.arrayBuffer())),
      "assets/": [new Uint8Array(), { level: 0 }],
    };

    await expect(importProjectPackage(archiveBlob(files))).resolves.toMatchObject({
      document: { assets: [{ fileName: "notes.txt" }] },
    });

    files["unrelated/"] = [new Uint8Array(), { level: 0 }];
    await expect(importProjectPackage(archiveBlob(files))).rejects.toMatchObject({
      code: "UNDECLARED_ARCHIVE_ENTRY",
      path: "unrelated/",
    });
  });

  it("rejects a declared entry whose actual CRC-32 differs from its ZIP headers", async () => {
    const exported = await exportProjectPackage({
      document: localAssetDocument(),
      resolveAssetBlob: async () => new Blob(["hello"]),
    });
    const files = unzipSync(new Uint8Array(await exported.blob.arrayBuffer()));
    const assetPath = Object.keys(files).find((path) => path.startsWith("assets/"));
    if (!assetPath) throw new Error("Expected packaged asset");
    const archive = new Uint8Array(await exported.blob.arrayBuffer());
    const forged = forgeZipEntryCrc32(archive, assetPath, 0);

    await expect(importProjectPackage(namedBlob(new Blob([forged])))).rejects.toMatchObject({
      code: "ARCHIVE_CRC_MISMATCH",
      path: assetPath,
    });
  });

  it("rejects data-descriptor ZIP entries that cannot be preflighted safely", async () => {
    const exported = await exportProjectPackage({
      document: localAssetDocument(),
      resolveAssetBlob: async () => new Blob(["hello"]),
    });
    const archive = new Uint8Array(await exported.blob.arrayBuffer());
    const forged = addZipEntryFlags(archive, "document.json", 0x0008);

    await expect(importProjectPackage(namedBlob(new Blob([forged])))).rejects.toMatchObject({
      code: "INVALID_ARCHIVE",
    });
  });

  it("rejects repeated binary paths", async () => {
    const exported = await exportProjectPackage({
      document: localAssetDocument(),
      resolveAssetBlob: async () => new Blob(["hello"]),
    });
    const duplicatePathFiles = unzipSync(new Uint8Array(await exported.blob.arrayBuffer()));
    const duplicatePathManifest = JSON.parse(strFromU8(duplicatePathFiles["manifest.json"])) as {
      assets: Array<Record<string, unknown>>;
    };
    duplicatePathManifest.assets.push({
      ...duplicatePathManifest.assets[0],
      assetId: "asset-duplicate-path",
      storageKey: "asset:duplicate-path",
    });
    duplicatePathFiles["manifest.json"] = strToU8(JSON.stringify(duplicatePathManifest));
    await expect(importProjectPackage(archiveBlob(duplicatePathFiles))).rejects.toMatchObject({
      code: "DUPLICATE_ASSET_PATH",
    });
  });

  it("rejects manifest fields that the current reader cannot preserve", async () => {
    const exported = await exportProjectPackage({
      document: localAssetDocument(),
      resolveAssetBlob: async () => new Blob(["hello"]),
    });
    const files = unzipSync(new Uint8Array(await exported.blob.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(files["manifest.json"])) as Record<string, unknown>;
    manifest.futurePolicy = { preserve: true };
    files["manifest.json"] = strToU8(JSON.stringify(manifest));

    await expect(importProjectPackage(archiveBlob(files))).rejects.toMatchObject({
      code: "UNKNOWN_MANIFEST_FIELD",
      path: "manifest.json.futurePolicy",
    });
  });

  it("rejects a compressed package above the centralized size limit before reading it", async () => {
    const oversized = namedBlob(new Blob(["small"]));
    Object.defineProperty(oversized, "size", { value: 100 * 1024 * 1024 + 1 });

    await expect(importProjectPackage(oversized)).rejects.toMatchObject({
      code: "PROJECT_COMPRESSED_TOO_LARGE",
    });
  });

  it("requires an explicit decision before exporting missing assets", async () => {
    const document = localAssetDocument();
    await expect(exportProjectPackage({
      document,
      resolveAssetBlob: async () => undefined,
    })).rejects.toBeInstanceOf(MissingProjectAssetsError);

    const exported = await exportProjectPackage({
      document,
      resolveAssetBlob: async () => undefined,
      allowMissingAssets: true,
    });
    const imported = await importProjectPackage(namedBlob(exported.blob), () => "missing");
    expect(imported.assets).toHaveLength(0);
    expect(imported.document.assets[0]).not.toHaveProperty("byteSize");
    expect(imported.warnings.map((warning) => warning.code)).toContain("MISSING_ASSET_IMPORTED");
  });

  it("rejects an oversized asset before producing a package that cannot be re-imported", async () => {
    const oversized = new Blob(["small"], { type: "text/plain" });
    Object.defineProperty(oversized, "size", {
      configurable: true,
      value: PROJECT_LIMITS.singleAssetBytes + 1,
    });

    await expect(exportProjectPackage({
      document: localAssetDocument(),
      resolveAssetBlob: async () => oversized,
    })).rejects.toMatchObject({ code: "ASSET_TOO_LARGE" });
  });

  it("rejects available binaries that would exceed the physical ZIP entry limit", async () => {
    await expect(exportProjectPackage({
      document: manyAssetDocument(PROJECT_LIMITS.entryCount - 1),
      resolveAssetBlob: async () => new Blob(),
    })).rejects.toMatchObject({ code: "TOO_MANY_ENTRIES" });
  });

  it("round-trips more missing logical assets than the physical ZIP entry limit", async () => {
    const logicalAssetCount = PROJECT_LIMITS.entryCount + 5;
    const exported = await exportProjectPackage({
      document: manyAssetDocument(logicalAssetCount),
      resolveAssetBlob: async () => undefined,
      allowMissingAssets: true,
    });
    const files = unzipSync(new Uint8Array(await exported.blob.arrayBuffer()));
    let importedId = 0;
    const imported = await importProjectPackage(
      namedBlob(exported.blob),
      () => `boundary-${importedId += 1}`,
    );

    expect(Object.keys(files)).toEqual(expect.arrayContaining(["document.json", "manifest.json"]));
    expect(Object.keys(files)).toHaveLength(2);
    expect(imported.document.assets).toHaveLength(logicalAssetCount);
    expect(imported.assets).toHaveLength(0);
    expect(imported.warnings.filter((warning) => warning.code === "MISSING_ASSET_IMPORTED"))
      .toHaveLength(logicalAssetCount);
  });

  it("requires declared binary assets to stay under the assets directory", async () => {
    const exported = await exportProjectPackage({
      document: localAssetDocument(),
      resolveAssetBlob: async () => new Blob(["hello"], { type: "text/plain" }),
    });
    const files = unzipSync(new Uint8Array(await exported.blob.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(files["manifest.json"])) as {
      assets: Array<Record<string, unknown>>;
    };
    const originalPath = String(manifest.assets[0].path);
    files["outside-assets.bin"] = files[originalPath];
    delete files[originalPath];
    manifest.assets[0].path = "outside-assets.bin";
    files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));

    await expect(importProjectPackage(archiveBlob(files))).rejects.toMatchObject({
      code: "INVALID_ASSET_PATH",
      path: "manifest.json.assets[0].path",
    });
  });

  it("does not let a missing asset whitelist an ignored binary path", async () => {
    const exported = await exportProjectPackage({
      document: localAssetDocument(),
      resolveAssetBlob: async () => undefined,
      allowMissingAssets: true,
    });
    const files = unzipSync(new Uint8Array(await exported.blob.arrayBuffer()));
    const manifest = JSON.parse(strFromU8(files["manifest.json"])) as {
      assets: Array<Record<string, unknown>>;
    };
    manifest.assets[0].path = "assets/hidden.bin";
    manifest.assets[0].byteSize = 6;
    manifest.assets[0].sha256 = "not-used";
    files["assets/hidden.bin"] = strToU8("hidden");
    files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));

    await expect(importProjectPackage(archiveBlob(files))).rejects.toMatchObject({
      code: "INVALID_MANIFEST_ASSET",
      path: "manifest.json.assets[0]",
    });
  });
});
