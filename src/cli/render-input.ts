import type { ConversationAsset, ConversationDocument } from "../data/conversation-types";
import { loadConversationDocument, migrateConversationDocumentV0 } from "../data/document-loader";
import { resolveFixtureAsset } from "../data/fixtures";
import type { EditorIdFactory } from "../editor/document-operations";
import { attachMarkdownFiles, prepareMarkdownSource, type ResolvedMarkdownFile } from "../project/markdown-import";
import { PROJECT_LIMITS, ProjectFormatError, type ProjectWarning } from "../project/project-format";
import { importProjectPackage } from "../project/project-import";

export type RenderInputKind = "markdown" | "json" | "project";

/** Reads the input and the files it references; the command line serves both from disk. */
export interface RenderInputReader {
  readInput(): Promise<Uint8Array>;
  /** Returns undefined when the referenced file does not exist. */
  readLocal(src: string): Promise<Uint8Array | undefined>;
}

export type ImageMeasurer = (blob: Blob) => Promise<{ readonly width: number; readonly height: number } | undefined>;

export interface RenderSource {
  readonly document: ConversationDocument;
  /** Local asset bytes keyed by `source.storageKey`; fixture assets resolve through the bundle. */
  readonly blobs: ReadonlyMap<string, Blob>;
  readonly warnings: readonly ProjectWarning[];
}

/** Ids follow source order so the same input always yields the same document. */
export function sequentialIds(): EditorIdFactory {
  let index = 0;
  return (kind) => `${kind}-${++index}`;
}

function decodeText(bytes: Uint8Array, fileName: string) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ProjectFormatError(`${fileName} 不是 UTF-8 编码的文本。`, "INPUT_NOT_UTF8", fileName);
  }
}

async function loadMarkdown(fileName: string, reader: RenderInputReader, measureImage: ImageMeasurer): Promise<RenderSource> {
  const prepared = prepareMarkdownSource(decodeText(await reader.readInput(), fileName), fileName, sequentialIds());
  const assetsById = new Map(prepared.document.assets.map((asset) => [asset.id, asset]));
  const files = new Map<string, ResolvedMarkdownFile>();
  const blobs = new Map<string, Blob>();

  for (const reference of prepared.references) {
    const bytes = await reader.readLocal(reference.src);
    if (!bytes) continue; // attachMarkdownFiles reports the missing file with its line.
    if (bytes.byteLength > PROJECT_LIMITS.singleAssetBytes) {
      files.set(reference.src, { byteSize: bytes.byteLength });
      continue;
    }
    const asset = assetsById.get(reference.assetId)!;
    const blob = new Blob([bytes as BlobPart], { type: asset.mimeType });
    const size = reference.kind === "image" ? await measureImage(blob) : undefined;
    if (reference.kind === "image" && !size) {
      throw new ProjectFormatError(`图片打不开：${reference.src}`, "UNREADABLE_CONVERSATION_MARKDOWN_IMAGE", `line:${reference.line}`);
    }
    files.set(reference.src, { byteSize: bytes.byteLength, ...size });
    if (asset.source.kind === "local") blobs.set(asset.source.storageKey, blob);
  }

  return { document: attachMarkdownFiles(prepared, files), blobs, warnings: [] };
}

async function loadJson(fileName: string, reader: RenderInputReader): Promise<RenderSource> {
  const bytes = await reader.readInput();
  if (bytes.byteLength > PROJECT_LIMITS.documentBytes) {
    throw new ProjectFormatError("文档 JSON 太大了。", "DOCUMENT_TOO_LARGE", fileName);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(decodeText(bytes, fileName));
  } catch (error) {
    if (error instanceof ProjectFormatError) throw error;
    throw new ProjectFormatError(`${fileName} 不是有效的 JSON。`, "INVALID_DOCUMENT_JSON", fileName);
  }
  const isV0 = typeof raw === "object" && raw !== null && (raw as { schemaVersion?: unknown }).schemaVersion === 0;
  const loaded = isV0 ? migrateConversationDocumentV0(raw) : loadConversationDocument(raw);
  if (loaded.status === "invalid") {
    const [diagnostic] = loaded.diagnostics;
    throw new ProjectFormatError(diagnostic.messageText ?? diagnostic.message, diagnostic.code, diagnostic.path);
  }
  // Browser-local assets have no bytes here; like the web they render as missing and
  // loadRenderSource reports each one as ASSET_UNAVAILABLE.
  return { document: loaded.document, blobs: new Map(), warnings: [] };
}

async function loadProject(fileName: string, reader: RenderInputReader): Promise<RenderSource> {
  const bytes = await reader.readInput();
  let index = 0;
  const prepared = await importProjectPackage(
    new File([bytes as BlobPart], fileName, { type: "application/zip" }),
    () => `import-${++index}`,
  );
  return {
    document: prepared.document,
    blobs: new Map(prepared.assets.map((asset) => [asset.storageKey, asset.blob])),
    warnings: prepared.warnings,
  };
}

/** Loads Conversation Markdown, document JSON or a `.convcanvas` package into one validated document. */
export async function loadRenderSource(
  kind: RenderInputKind,
  fileName: string,
  reader: RenderInputReader,
  measureImage: ImageMeasurer,
): Promise<RenderSource> {
  const source = kind === "markdown"
    ? await loadMarkdown(fileName, reader, measureImage)
    : kind === "json"
      ? await loadJson(fileName, reader)
      : await loadProject(fileName, reader);
  const unavailable = source.document.assets
    .filter((asset) => !resolveRenderAsset(asset, source.blobs))
    .map((asset): ProjectWarning => ({ code: "ASSET_UNAVAILABLE", message: `文件显示不了：${asset.fileName}`, path: `assets.${asset.id}` }));
  return { ...source, warnings: [...source.warnings, ...unavailable] };
}

/** True when the asset has bytes (local) or a bundled URL (fixture). */
function resolveRenderAsset(asset: ConversationAsset, blobs: ReadonlyMap<string, Blob>) {
  return asset.source.kind === "local" ? blobs.has(asset.source.storageKey) : Boolean(resolveFixtureAsset(asset));
}
