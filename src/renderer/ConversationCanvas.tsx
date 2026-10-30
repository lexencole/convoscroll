import { CanvasLocaleProvider } from "../i18n/LocaleContext";
import { canvasLocale } from "../i18n/locale";
import { translator } from "../i18n/messages";
import { forwardRef, useMemo } from "react";
import type {
  ConversationAsset,
  ConversationDocument,
  ToolCallBlock,
} from "../data/conversation-types";
import { resolveFixtureAsset } from "../data/fixtures";
import { resolveThemeStyle } from "../theme/theme-v1";
import type { ThemeStyle } from "../theme/theme-presets";
import {
  ExportPresentationProvider,
  type ExportPresentation,
} from "./ExportPresentationContext";
import { MessageRenderer } from "./MessageRenderer";
import { useCanvasEditing } from "./CanvasEditingContext";

export type AssetSourceResolver = (asset: ConversationAsset) => string | undefined;

interface ConversationCanvasProps {
  readonly document: ConversationDocument;
  readonly themeStyle?: ThemeStyle;
  readonly resolveAssetSource?: AssetSourceResolver;
  readonly exportPresentation?: ExportPresentation;
}

export const ConversationCanvas = forwardRef<HTMLElement, ConversationCanvasProps>(function ConversationCanvas(
  { document, themeStyle, resolveAssetSource = resolveFixtureAsset, exportPresentation },
  ref,
) {
  const locale = canvasLocale(document.metadata.locale);
  const t = translator(locale);
  const editing = useCanvasEditing();
  const assetsById = useMemo(
    () => new Map(document.assets.map((asset) => [asset.id, asset])),
    [document.assets],
  );
  const toolCallsById = useMemo(() => {
    const entries: [string, ToolCallBlock][] = [];
    for (const message of document.messages) {
      for (const block of message.blocks) {
        if (block.type === "toolCall") entries.push([block.callId, block]);
      }
    }
    return new Map(entries);
  }, [document.messages]);

  const part = exportPresentation?.part;
  const slicesByMessage = part
    ? new Map(part.messages.map((slice) => [slice.messageId, slice]))
    : undefined;
  const messages = slicesByMessage
    ? document.messages.filter((message) => slicesByMessage.has(message.id))
    : document.messages;
  const continuation = Boolean(part && part.index > 0);
  const width = exportPresentation?.width ?? document.canvas.width;

  return (
    <CanvasLocaleProvider value={locale}><ExportPresentationProvider value={exportPresentation}>
      <section
        ref={ref}
        lang={locale}
        className="conversation-canvas"
        style={{
          ...(themeStyle ?? resolveThemeStyle(document.theme.id)),
          width,
          boxShadow: exportPresentation ? "none" : undefined,
        }}
        data-testid="conversation-canvas"
        data-canvas-width={width}
        data-canvas-editing={editing ? "true" : undefined}
        data-theme-id={document.theme.id}
        data-export-active={exportPresentation ? "true" : undefined}
        data-export-part={part ? `${part.index + 1}/${part.total}` : undefined}
        aria-label={document.metadata.title ?? "Conversation preview"}
      >
        <header className={`canvas-header${continuation ? " canvas-header--continuation" : ""}`}>
          {editing?.documentTools}
          <h1>{editing?.documentTitle ?? document.metadata.title ?? t("未命名对话")}</h1>
          {!continuation && document.metadata.subtitle ? <p>{document.metadata.subtitle}</p> : null}
          {continuation && part ? <p>{t("续 · 第 {0} 部分，共 {1} 部分", part.index + 1, part.total)}</p> : null}
        </header>
        <div className="conversation-stream">
          {messages.map((message) => (
            <MessageRenderer
              key={message.id}
              message={message}
              slice={slicesByMessage?.get(message.id)}
              assetsById={assetsById}
              toolCallsById={toolCallsById}
              resolveAssetSource={resolveAssetSource}
            />
          ))}
        </div>
      </section>
    </ExportPresentationProvider></CanvasLocaleProvider>
  );
});
