import { zip, type AsyncZippable } from "fflate";
import { PngExportError } from "./export-types";
import { safeFileBaseName } from "./file-name";

export const PNG_BUNDLE_MIME_TYPE = "application/zip";

export interface PngDelivery {
  readonly kind: "png" | "zip";
  readonly blob: Blob;
  readonly fileName: string;
}

export function buildPngFileName(value: string, index = 0, total = 1) {
  const base = safeFileBaseName(value.trim().replace(/\.png$/i, "")) || "conversation";
  if (total <= 1) return `${base}.png`;
  const digits = Math.max(2, String(total).length);
  return `${base}-part-${String(index + 1).padStart(digits, "0")}-of-${String(total).padStart(digits, "0")}.png`;
}

export function buildPngBundleFileName(value: string) {
  const base = safeFileBaseName(value.trim().replace(/(?:-parts)?\.(?:png|zip)$/i, "")) || "conversation";
  return `${base}-parts.zip`;
}

function zipAsync(files: AsyncZippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(files, { level: 0 }, (error, archive) => {
      if (error) reject(error);
      else resolve(archive);
    });
  });
}

function throwIfCancelled(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  throw new PngExportError("cancelled", "已取消 PNG 导出。", "预览已恢复。");
}

export async function createPngDelivery(
  parts: readonly { readonly blob: Blob; readonly fileName: string }[],
  baseName: string,
  signal?: AbortSignal,
): Promise<PngDelivery> {
  throwIfCancelled(signal);
  if (parts.length === 0) {
    throw new PngExportError(
      "empty-blob",
      "没有生成图片。",
      "请再导出一次。",
    );
  }
  if (parts.length === 1) {
    return { kind: "png", blob: parts[0].blob, fileName: parts[0].fileName };
  }

  const files: AsyncZippable = {};
  for (const part of parts) {
    files[part.fileName] = new Uint8Array(await part.blob.arrayBuffer());
    throwIfCancelled(signal);
  }
  const archive = await zipAsync(files);
  throwIfCancelled(signal);
  const copy = new Uint8Array(archive.byteLength);
  copy.set(archive);
  return {
    kind: "zip",
    blob: new Blob([copy.buffer], { type: PNG_BUNDLE_MIME_TYPE }),
    fileName: buildPngBundleFileName(baseName),
  };
}

export function downloadBlob(blob: Blob, fileName: string) {
  let objectUrl: string | undefined;

  try {
    objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl as string), 1_000);
  } catch (error) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    throw new PngExportError(
      "download-failed",
      "图片已生成，但浏览器没有下载。",
      "允许浏览器下载后再试。",
      { cause: error },
    );
  }
}
