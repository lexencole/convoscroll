import { translator, type Translator } from "../i18n/messages";
import type { Locale } from "../i18n/locale";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { RootContent } from "mdast";
import type { ContentBlock, ConversationDocument } from "../data/conversation-types";
import { roleLabels } from "../editor/editor-labels";

const parser = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const excerpts = { "zh-CN": new WeakMap<ContentBlock, string>(), en: new WeakMap<ContentBlock, string>() };
const compact = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 160);
function plainText(node: RootContent, t: Translator): string {
  if (node.type === "html" || node.type === "definition") return "";
  if (node.type === "image" || node.type === "imageReference") return node.alt || t("图片");
  if ("value" in node) return node.value;
  if ("children" in node) return node.children.map((child) => plainText(child, t)).join(["paragraph", "heading", "link", "strong", "emphasis", "delete"].includes(node.type) ? "" : " ");
  return "";
}
function markdownExcerpt(block: ContentBlock & { source: string }, locale: Locale) {
  const cache = excerpts[locale];
  let text = cache.get(block);
  if (text === undefined) {
    // A short local projection: never render HTML or fetch linked resources.
    text = compact(parser.parse(block.source.slice(0, 4096)).children.map((child) => plainText(child, translator(locale))).join(" "));
    cache.set(block, text);
  }
  return text;
}
export function messageNavigationEntries(document: ConversationDocument, locale: Locale = "zh-CN") {
  const t = translator(locale);
  const assets = new Map(document.assets.map((asset) => [asset.id, asset.fileName]));
  return document.messages.map((message, index) => {
    const parts: string[] = [];
    for (const block of message.blocks) {
      switch (block.type) {
        case "markdown": parts.push(markdownExcerpt(block, locale)); break;
        case "image": parts.push(t("图片 · {0}", block.caption || block.alt || assets.get(block.assetId) || t("附件缺失"))); break;
        case "file": parts.push(t("文件 · {0}", block.label || assets.get(block.assetId) || t("附件缺失"))); break;
        case "reasoning": parts.push(t("思考过程 · {0}", block.summary || block.title || markdownExcerpt(block, locale) || t("无摘要"))); break;
        case "toolCall": parts.push(t("工具调用 · {0}{1}", block.toolName, block.summary ? ` · ${block.summary}` : "")); break;
        case "toolResult": parts.push(t("工具结果{0}", block.summary ? ` · ${block.summary}` : "")); break;
        case "unsupported": parts.push(t("暂不支持的内容 · {0}", block.originalType)); break;
      }
      if (parts.join(" ").length >= 160) break;
    }
    return { id: message.id, index, name: message.displayName?.trim() || t(roleLabels[message.role]), role: t(roleLabels[message.role]), summary: compact(parts.join(" ")) || t("空消息") };
  });
}
