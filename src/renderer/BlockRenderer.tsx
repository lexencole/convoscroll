import type {
  ContentBlock,
  ConversationAsset,
  ToolCallBlock,
} from "../data/conversation-types";
import { FileBlockView } from "./FileBlockView";
import { ImageBlockView } from "./ImageBlockView";
import { MarkdownBody } from "./MarkdownBody";
import { TraceBlockView } from "./TraceBlockView";
import { UnsupportedBlockView } from "./UnsupportedBlockView";
import type { AssetSourceResolver } from "./ConversationCanvas";
import { useInlineEditing } from "./InlineEditingContext";

interface BlockRendererProps {
  readonly block: ContentBlock;
  readonly assetsById: ReadonlyMap<string, ConversationAsset>;
  readonly toolCallsById: ReadonlyMap<string, ToolCallBlock>;
  readonly resolveAssetSource: AssetSourceResolver;
}

export function BlockRenderer({
  block,
  assetsById,
  toolCallsById,
  resolveAssetSource,
}: BlockRendererProps) {
  const renderEditing = useInlineEditing();
  let content;

  switch (block.type) {
    case "markdown":
      content = <MarkdownBody source={block.source} />;
      break;
    case "image":
      content = (
        <ImageBlockView
          block={block}
          asset={assetsById.get(block.assetId)}
          resolveAssetSource={resolveAssetSource}
        />
      );
      break;
    case "file":
      content = <FileBlockView block={block} asset={assetsById.get(block.assetId)} />;
      break;
    case "reasoning":
      content = <TraceBlockView block={block} />;
      break;
    case "toolCall":
      content = <TraceBlockView block={block} />;
      break;
    case "toolResult":
      content = (
        <TraceBlockView
          block={block}
          relatedToolName={toolCallsById.get(block.callId)?.toolName}
        />
      );
      break;
    case "unsupported":
      content = <UnsupportedBlockView block={block} />;
      break;
  }

  return (
    <div className="content-block" data-block-id={block.id} data-block-type={block.type}>
      {renderEditing ? renderEditing(block, content) : content}
    </div>
  );
}
