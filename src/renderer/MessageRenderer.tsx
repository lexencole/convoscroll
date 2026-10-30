import { useCanvasText, useUiText } from "../i18n/LocaleContext";
import { useEffect, useState } from "react";
import type {
  ContentBlock,
  ConversationAsset,
  ConversationMessage,
  MessageRole,
  MessageStatus,
  ToolCallBlock,
} from "../data/conversation-types";
import { ModelBrandIcon } from "../models/ModelBrandIcon";
import { resolveModelBrand } from "../models/model-brand";
import { BlockRenderer } from "./BlockRenderer";
import { useCanvasEditing } from "./CanvasEditingContext";
import type { AssetSourceResolver } from "./ConversationCanvas";
import type { ExportMessageSlice } from "./ExportPresentationContext";

interface MessageRendererProps {
  readonly message: ConversationMessage;
  readonly assetsById: ReadonlyMap<string, ConversationAsset>;
  readonly toolCallsById: ReadonlyMap<string, ToolCallBlock>;
  readonly resolveAssetSource: AssetSourceResolver;
  readonly slice?: ExportMessageSlice;
}

const roleLabels: Record<MessageRole, string> = {
  assistant: "AI 助手",
  developer: "开发者",
  system: "系统",
  tool: "工具",
  unknown: "其他",
  user: "用户",
};

function avatarLabel(message: ConversationMessage, fallback: string): string {
  const value = message.displayName ?? fallback;
  return value.trim().slice(0, 1).toUpperCase();
}

/** Shown beside the name, in the order the settings list them (editor-labels). */
export const messageStatusLabels: Record<MessageStatus, string> = {
  complete: "已完成",
  streaming: "生成中",
  error: "失败",
  cancelled: "已取消",
};

function formatTimestamp(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (!Number.isFinite(parsed.getTime())) return timestamp;
  return `${parsed.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function isTraceBlock(block: ContentBlock): boolean {
  return block.type === "reasoning" || block.type === "toolCall" || block.type === "toolResult";
}

export function MessageAvatar({ message, asset, resolveAssetSource }: {
  readonly message: ConversationMessage;
  readonly asset?: ConversationAsset;
  readonly resolveAssetSource: AssetSourceResolver;
}) {
  const t = useCanvasText();
  const [failed, setFailed] = useState(false);
  const source = asset?.kind === "image" ? resolveAssetSource(asset) : undefined;
  const modelBrand = message.role === "assistant" ? resolveModelBrand(message.model) : undefined;

  useEffect(() => setFailed(false), [asset?.id, source]);

  return (
    <span className={`message__avatar${source && !failed ? " message__avatar--image" : modelBrand ? " message__avatar--brand" : ""}`} aria-hidden="true">
      {source && !failed ? (
        <img src={source} alt="" onError={() => setFailed(true)} />
      ) : modelBrand ? (
        <ModelBrandIcon model={message.model} />
      ) : avatarLabel(message, t(roleLabels[message.role]))}
    </span>
  );
}

export function MessageRenderer({
  message,
  assetsById,
  toolCallsById,
  resolveAssetSource,
  slice,
}: MessageRendererProps) {
  const t = useCanvasText();
  const editing = useCanvasEditing();
  const ui = useUiText();
  const displayName = message.displayName ?? t(roleLabels[message.role]);
  const modelLabel = message.model?.trim();
  const showModel = Boolean(modelLabel && modelLabel.toLowerCase() !== displayName.trim().toLowerCase());
  const avatarAsset = message.avatarAssetId ? assetsById.get(message.avatarAssetId) : undefined;
  const renderedBlocks = [];
  const visibleBlockIds = slice?.blockIds ? new Set(slice.blockIds) : undefined;
  const blocks = visibleBlockIds
    ? message.blocks.filter((block) => visibleBlockIds.has(block.id))
    : message.blocks;

  for (let index = 0; index < blocks.length;) {
    const block = blocks[index];

    if (!isTraceBlock(block)) {
      renderedBlocks.push(
        <BlockRenderer
          key={block.id}
          block={block}
          assetsById={assetsById}
          toolCallsById={toolCallsById}
          resolveAssetSource={resolveAssetSource}
        />,
      );
      index += 1;
      continue;
    }

    const traceBlocks: ContentBlock[] = [];
    while (index < blocks.length && isTraceBlock(blocks[index])) {
      traceBlocks.push(blocks[index]);
      index += 1;
    }
    renderedBlocks.push(
      <div className="trace-stack" role="group" aria-label={t("思考和工具记录")} key={`trace-${traceBlocks[0].id}`}>
        {traceBlocks.map((traceBlock) => (
          <BlockRenderer
            key={traceBlock.id}
            block={traceBlock}
            assetsById={assetsById}
            toolCallsById={toolCallsById}
            resolveAssetSource={resolveAssetSource}
          />
        ))}
      </div>,
    );
  }

  const header = <header className="message__header"
        role={editing ? "button" : undefined} tabIndex={editing ? 0 : undefined}
        aria-label={editing ? ui("设置身份：{0}", displayName) : undefined}
        onClick={editing ? (event) => editing.editIdentity(message, event.currentTarget) : undefined}
        onKeyDown={editing ? (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); editing.editIdentity(message, event.currentTarget); } } : undefined}>
        <MessageAvatar
          message={message}
          asset={avatarAsset}
          resolveAssetSource={resolveAssetSource}
        />
        <span className="message__identity">
          <strong>{displayName}</strong>
          <small>
            {t(roleLabels[message.role])}
            {message.sourceRole ? ` · ${message.sourceRole}` : ""}
          </small>
        </span>
        {showModel || message.timestamp || message.status ? (
          <span className="message__header-meta">
            {showModel ? <span className="message__model">{message.model}</span> : null}
            {message.timestamp ? <time dateTime={message.timestamp}>{formatTimestamp(message.timestamp)}</time> : null}
            {message.status ? (
              <span className={`message__status message__status--${message.status}`}>
                {t(messageStatusLabels[message.status])}
              </span>
            ) : null}
          </span>
        ) : null}
        {slice?.continuedFromPrevious || slice?.continuesToNext ? (
          <span className="message__continuation">
            {slice.continuedFromPrevious ? t("续") : t("下页继续")}
          </span>
        ) : null}
      </header>;
  return (
    <article className={`message message--${message.role}`} data-message-id={message.id} data-drop-edge={editing?.dropEdge(message.id)}>
      {editing ? <div className="workbench-message-heading">{header}{editing.messageTools(message)}</div> : header}
      <div className="message__blocks">{renderedBlocks}</div>
      {editing?.messageFooter(message)}
    </article>
  );
}
