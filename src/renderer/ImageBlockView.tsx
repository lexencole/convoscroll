import { useCanvasText } from "../i18n/LocaleContext";
import { useEffect, useState } from "react";
import type { ConversationAsset, ImageBlock } from "../data/conversation-types";
import type { AssetSourceResolver } from "./ConversationCanvas";

interface ImageBlockViewProps {
  readonly block: ImageBlock;
  readonly asset?: ConversationAsset;
  readonly resolveAssetSource: AssetSourceResolver;
}

export function ImageBlockView({ block, asset, resolveAssetSource }: ImageBlockViewProps) {
  const t = useCanvasText();
  const [failed, setFailed] = useState(false);
  const source = asset ? resolveAssetSource(asset) : undefined;

  useEffect(() => setFailed(false), [asset?.id, source]);

  if (!asset || !source || failed) {
    const reason = !asset
      ? t("找不到图片：{0}", block.assetId)
      : failed
        ? t("图片打不开")
        : t("读不到这张图片");
    return (
      <div className="asset-placeholder asset-placeholder--image" role="note">
        <span className="asset-placeholder__icon" aria-hidden="true">▧</span>
        <span>
          <strong>{asset?.fileName ?? t("图片找不到")}</strong>
          <small>{reason}</small>
          {block.caption ? <em>{block.caption}</em> : null}
        </span>
      </div>
    );
  }

  return (
    <figure className={`image-block image-block--${block.width ?? "full"}`}>
      <img
        src={source}
        alt={block.alt ?? asset.fileName}
        width={asset.width}
        height={asset.height}
        onError={() => setFailed(true)}
      />
      {block.caption ? <figcaption>{block.caption}</figcaption> : null}
    </figure>
  );
}
