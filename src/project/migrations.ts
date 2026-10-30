import { canvasLocale } from "../i18n/locale";
import { message as msg, diagnosticMessage, translator } from "../i18n/messages";
import type { JsonValue } from "../data/conversation-types";
import type { ProjectWarning } from "./project-format";
import { ProjectFormatError } from "./project-format";

const knownBlockTypes = new Set([
  "markdown",
  "image",
  "file",
  "reasoning",
  "toolCall",
  "toolResult",
  "unsupported",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function migrateDocumentForImport(raw: unknown): {
  readonly document: unknown;
  readonly warnings: readonly ProjectWarning[];
} {
  if (!isRecord(raw)) return { document: raw, warnings: [] };
  if (typeof raw.schemaVersion === "number" && raw.schemaVersion > 1) {
    throw new ProjectFormatError(
      msg("这份文档来自更新的版本（schemaVersion {0}），请先升级话卷。", raw.schemaVersion),
      "DOCUMENT_VERSION_TOO_NEW",
      "document.schemaVersion",
    );
  }
  if (raw.schemaVersion !== 1 || !Array.isArray(raw.messages)) {
    return { document: raw, warnings: [] };
  }

  const warnings: ProjectWarning[] = [];
  const messages = raw.messages.map((message, messageIndex) => {
    if (!isRecord(message) || !Array.isArray(message.blocks)) return message;
    return {
      ...message,
      blocks: message.blocks.map((block, blockIndex) => {
        if (!isRecord(block) || typeof block.type !== "string" || knownBlockTypes.has(block.type)) {
          return block;
        }
        const path = `document.messages[${messageIndex}].blocks[${blockIndex}]`;
        warnings.push({
          code: "UNKNOWN_BLOCK_PRESERVED",
          path,
          ...diagnosticMessage(msg("不认识的内容块“{0}”，已原样保留。", block.type)),
        });
        return {
          id: typeof block.id === "string" && block.id.trim() ? block.id : `unsupported-${messageIndex}-${blockIndex}`,
          type: "unsupported",
          originalType: block.type,
          reason: translator(canvasLocale(isRecord(raw.metadata) && typeof raw.metadata.locale === "string" ? raw.metadata.locale : undefined))("这个版本还不支持这种内容。"),
          raw: block as JsonValue,
        };
      }),
    };
  });

  return { document: { ...raw, messages }, warnings };
}
