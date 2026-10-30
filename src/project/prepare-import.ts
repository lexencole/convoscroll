import type { Locale } from "../i18n/locale";
import { message as msg } from "../i18n/messages";
import {
  PROJECT_EXTENSION,
  PROJECT_LIMITS,
  ProjectFormatError,
  type PreparedImport,
} from "./project-format";
import { importMarkdown } from "./markdown-import";
import { importProjectPackage } from "./project-import";

export async function prepareImportFile(file: File, locale: Locale = "zh-CN"): Promise<PreparedImport> {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(PROJECT_EXTENSION)) {
    return importProjectPackage(file);
  }

  const isExplicitMarkdown = lowerName.endsWith(".md")
    || file.type === "text/markdown"
    || file.type === "text/plain";
  if (isExplicitMarkdown) {
    if (file.size > PROJECT_LIMITS.markdownBytes) {
      throw new ProjectFormatError(
        msg("Markdown 文件超过 {0} MB，请缩小文件后重新导入。", PROJECT_LIMITS.markdownBytes / 1024 / 1024),
        "MARKDOWN_TOO_LARGE",
        file.name,
      );
    }
    const bytes = await file.arrayBuffer();
    let source: string;
    try {
      source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new ProjectFormatError("文件不是有效的 UTF-8 文本，请另存为 UTF-8 后重新导入。", "INPUT_NOT_UTF8", file.name);
    }
    return importMarkdown(source, file.name, undefined, locale);
  }

  // A ZIP signature is only a fallback for extensionless or generically typed
  // project packages. Explicit Markdown must never be reclassified from its
  // first two content bytes (valid prose can begin with the ASCII text "PK").
  const prefix = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  const looksLikeZip = prefix[0] === 0x50 && prefix[1] === 0x4b;
  if (looksLikeZip) return importProjectPackage(file);

  throw new ProjectFormatError(
    "只支持 .convcanvas 项目文件和 .md Markdown。",
    "UNSUPPORTED_IMPORT_FORMAT",
    file.name,
  );
}
