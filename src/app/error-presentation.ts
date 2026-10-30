import { message as msg, errorMessage, type LocalizedText } from "../i18n/messages";
import { ProjectFormatError } from "../project/project-format";

interface Diagnostic {
  readonly code: string;
  readonly message: string;
  readonly messageText?: LocalizedText;
  readonly subject?: "image" | "file";
  readonly path?: string;
}

// The validation layer keeps precise field names for files and CLI consumers.
// Interface summaries name the user's content; original diagnostics remain available below them.
const summaries: Readonly<Record<string, string>> = {
  INVALID_MESSAGE_ROLE: "消息角色无效",
  INVALID_CONVERSATION_MARKDOWN_ROLE: "消息角色无效",
  INVALID_MESSAGE_STATUS: "消息状态无效",
  INVALID_CONVERSATION_MARKDOWN_STATUS: "消息状态无效",
  INVALID_MARKDOWN_SOURCE: "正文内容缺失或格式不正确",
  INVALID_ASSET_METADATA: "附件信息不完整，请检查导入文件",
  INVALID_DISPLAY_STATE: "折叠状态无效",
  INVALID_EXPORT_STATE: "导出时的折叠状态无效",
  DOCUMENT_VERSION_TOO_NEW: "当前版本无法读取这份项目，请更新话卷后重试",
  UNSUPPORTED_SCHEMA_VERSION: "这份文档的格式版本不受支持",
};

export function readableDiagnostic(diagnostic: Diagnostic): LocalizedText {
  if (diagnostic.code === "MISSING_ASSET_ID") {
    return diagnostic.subject === "image" ? "图片缺少对应文件信息" : "附件缺少对应文件信息";
  }
  if (diagnostic.code === "INVALID_CONVERSATION_MARKDOWN_FIELD") {
    if (diagnostic.path?.endsWith(".displayState")) return "折叠状态无效";
    if (diagnostic.path?.endsWith(".exportState")) return "导出时的折叠状态无效";
  }
  return summaries[diagnostic.code] ?? diagnostic.messageText ?? diagnostic.message;
}

export function diagnosticDetails(diagnostic: Diagnostic): LocalizedText {
  const code = msg("错误代码：{0}", diagnostic.code);
  const detail = diagnostic.messageText ?? msg(diagnostic.message);
  return diagnostic.path ? msg("{0}\n{1}\n{2}", msg("位置：{0}", diagnostic.path), code, detail) : msg("{0}\n{1}", code, detail);
}

export function projectErrorPresentation(cause: unknown, fallback: LocalizedText): {
  readonly detail: LocalizedText;
  readonly technicalDetail?: LocalizedText;
} {
  if (cause instanceof ProjectFormatError) {
    return { detail: readableDiagnostic(cause), technicalDetail: diagnosticDetails(cause) };
  }
  return { detail: errorMessage(cause, fallback) };
}
