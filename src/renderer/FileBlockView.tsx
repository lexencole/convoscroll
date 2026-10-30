import { useCanvasText } from "../i18n/LocaleContext";
import type { ConversationAsset, FileBlock } from "../data/conversation-types";

interface FileBlockViewProps {
  readonly block: FileBlock;
  readonly asset?: ConversationAsset;
}

const mimeLabels: Readonly<Record<string, string>> = {
  "application/json": "JSON",
  "application/pdf": "PDF",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOC",
  "application/zip": "ZIP",
  "text/csv": "CSV",
  "text/markdown": "MD",
  "text/plain": "TXT",
};

export function fileTypeLabel(asset: ConversationAsset): string {
  const known = Object.hasOwn(mimeLabels, asset.mimeType) ? mimeLabels[asset.mimeType] : undefined;
  if (known) return known;
  if (asset.mimeType.startsWith("image/")) return "IMG";
  const extension = asset.fileName.split(".").at(-1)?.toUpperCase();
  return extension && extension.length <= 5 ? extension : "FILE";
}

export function formatByteSize(byteSize?: number): string {
  if (byteSize === undefined) return "大小未知";
  if (byteSize < 1024) return `${byteSize} B`;
  if (byteSize < 1024 ** 2) return `${(byteSize / 1024).toFixed(byteSize < 10 * 1024 ? 1 : 0)} KB`;
  return `${(byteSize / 1024 ** 2).toFixed(byteSize < 10 * 1024 ** 2 ? 1 : 0)} MB`;
}

export function FileBlockView({ block, asset }: FileBlockViewProps) {
  const t = useCanvasText();
  if (!asset) {
    return (
      <div className="asset-placeholder asset-placeholder--file" role="note">
        <span className="asset-placeholder__icon" aria-hidden="true">FILE</span>
        <span>
          <strong>{block.label ?? t("文件找不到")}</strong>
          <small>{t("找不到文件：{0}", block.assetId)}</small>
        </span>
      </div>
    );
  }

  return (
    <article className="file-card" aria-label={t("文件：{0}", block.label ?? asset.fileName)}>
      <span className="file-card__icon" aria-hidden="true">{fileTypeLabel(asset)}</span>
      <span className="file-card__text">
        <strong>{block.label ?? asset.fileName}</strong>
        {block.label ? <span className="file-card__name">{asset.fileName}</span> : null}
        <small>{asset.mimeType} · {t(formatByteSize(asset.byteSize))}</small>
      </span>
    </article>
  );
}
