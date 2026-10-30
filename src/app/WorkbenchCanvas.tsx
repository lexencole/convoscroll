import type { LocalizedText } from "../i18n/messages";
import { useCanvasText, useUiText } from "../i18n/LocaleContext";
import type { Dispatch, ReactNode, RefObject, SetStateAction } from "react";
import { flushSync } from "react-dom";
import type { CollapseState, ConversationMessage } from "../data/conversation-types";
import { collectToolCallIds, removeBlock, updateBlock } from "../editor/document-operations";
import type { useDocumentHistory } from "../editor/use-document-history";
import { InlineTitleEditor } from "../editor/inline/InlineTitleEditor";
import type { WorkbenchMenuAction } from "../editor/WorkbenchItemMenu";
import { InlineMarkdownEditor } from "../editor/inline/InlineMarkdownEditor";
import { editableContent } from "../editor/inline/inline-extensions";
import { toggleTaskInMarkdown } from "../editor/inline/markdown-adapter";
import { MarkdownBody } from "../renderer/MarkdownBody";
import type { SettingsSession, SettingsTarget } from "../editor/WorkbenchSettings";
import type { AssetTarget, MarkdownInsertion, SortTarget } from "../editor/workbench-operations";
import type { SlashBlockType } from "../editor/inline/slash-commands";
import type { usePointerSort } from "../editor/use-pointer-sort";
import type { usePersistentAssets } from "../persistence/use-persistent-assets";
import { ConversationCanvas } from "../renderer/ConversationCanvas";
import { CanvasEditingProvider } from "../renderer/CanvasEditingContext";
import { TraceDisplayProvider } from "../renderer/TraceDisplayContext";
import { InlineEditingProvider } from "../renderer/InlineEditingContext";
import type { ExportPresentation } from "../renderer/ExportPresentationContext";
import { PreviewStage } from "./PreviewStage";
import type { WorkbenchNoticeValue } from "./WorkbenchNotice";

export interface ActiveBlock { id: string; focus: { x: number; y: number } | true | "end" }
interface Props {
  canvas: RefObject<HTMLElement | null>;
  history: ReturnType<typeof useDocumentHistory>; assets: ReturnType<typeof usePersistentAssets>;
  editingActive: boolean; blocked: boolean; applying: boolean; settings?: SettingsSession;
  exportOpen: boolean; presentation?: ExportPresentation; sort: ReturnType<typeof usePointerSort>;
  active?: ActiveBlock; setActive: Dispatch<SetStateAction<ActiveBlock | undefined>>;
  toolbar: HTMLDivElement | null; setBusyId: Dispatch<SetStateAction<string | undefined>>;
  setFeedback: (message: LocalizedText, tone?: WorkbenchNoticeValue["tone"]) => void;
  upload: (file: File, target: AssetTarget) => void; restore: (redo?: boolean) => void;
  insertFromSlash: (messageId: string, type: SlashBlockType, insertion: MarkdownInsertion, trigger: HTMLElement) => void;
  openSettings: (target: SettingsTarget, trigger?: HTMLElement) => void;
  saveTraceDisplay: (blockId: string, displayState: CollapseState) => void;
  messageTools: (message: ConversationMessage) => ReactNode; messageFooter: (message: ConversationMessage) => ReactNode;
  titleDisabled: boolean; changeTitle: (value: string, group: string) => void;
  itemActions: (target: SortTarget, index: number, total: number) => WorkbenchMenuAction[];
  tools: (target: SortTarget, index: number, total: number) => ReactNode;
}
export function WorkbenchCanvas({ canvas, history, assets, editingActive, blocked, applying, settings, exportOpen, presentation,
  sort, active, setActive, toolbar, setBusyId, setFeedback, upload, restore, insertFromSlash, openSettings, saveTraceDisplay, messageTools, messageFooter, tools, itemActions, titleDisabled, changeTitle }: Props) {
  const t = useUiText();
  const canvasText = useCanvasText();
  return (
    <CanvasEditingProvider value={editingActive ? { messageTools, messageFooter,
      dropEdge: (id) => sort.marker?.id === id ? sort.marker.edge as "before" | "after" : undefined,
      documentTools: null,
      documentTitle: <InlineTitleEditor value={history.document.metadata.title ?? canvasText("未命名对话")} disabled={titleDisabled}
        onActivate={() => setActive(undefined)} onChange={changeTitle} onBusy={(value) => setBusyId((previous) => value ? "document-title" : previous === "document-title" ? undefined : previous)}
        onUndo={() => restore()} onRedo={() => restore(true)} />,
      editIdentity: (message, trigger) => openSettings({ type: "message", messageId: message.id }, trigger) } : undefined}>
      <InlineEditingProvider value={editingActive ? (block, rendered) => {
        const message = history.document.messages.find((item) => item.blocks.some((entry) => entry.id === block.id))!;
        const isTrace = block.type === "reasoning" || block.type === "toolCall" || block.type === "toolResult";
        // Attachments have no focusable content; a tap focuses the wrapper to reveal its actions.
        return <div className={`workbench-block${isTrace ? " workbench-block--trace" : ""}`} tabIndex={block.type === "image" || block.type === "file" ? -1 : undefined}
          onPointerDown={(event) => {
            // Choosing an attachment or trace makes its message current (the toolbar adds to it); dragging does not.
            if (block.type !== "markdown" && !blocked && !sort.dragging && active?.id !== block.id && !(event.target as Element).closest(".workbench-block-tools")) setActive({ id: block.id, focus: true });
          }}
          data-current={active?.id === block.id ? "" : undefined} data-workbench-block={block.id} data-owner-message={message.id} data-drop-edge={sort.marker?.id === block.id ? sort.marker.edge : undefined}
          onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
          onDropCapture={(event) => { const file = event.dataTransfer.files[0]; if (!file) return; event.preventDefault(); event.stopPropagation(); upload(file, { messageId: message.id, kind: file.type.startsWith("image/") ? "image" : "file" }); }}>
          <div className="workbench-block-tools">{tools({ messageId: message.id, blockId: block.id }, message.blocks.indexOf(block), message.blocks.length)}</div>
          {block.type === "markdown" && active?.id === block.id ? <InlineMarkdownEditor key={block.id} source={block.source} label={t("直接编辑消息正文：{0}", history.document.messages.indexOf(message) + 1)} initialFocus={active.focus}
            blockActions={itemActions({ messageId: message.id, blockId: block.id }, message.blocks.indexOf(block), message.blocks.length)}
            toolbarHost={toolbar} active enabled={!applying && !settings && !sort.dragging} onActivate={() => undefined}
            hasToolCall={collectToolCallIds(history.document).length > 0}
            onInsertBlock={(type, insertion, trigger) => insertFromSlash(message.id, type, { ...insertion, blockId: block.id }, trigger)}
            onChange={(source, group) => history.commit((document) => updateBlock(document, message.id, block.id, (item) => item.type === "markdown" ? { ...item, source } : item), group)}
            onEmptyBackspace={() => {
              if (blocked || sort.dragging || block.source.trim()) return false;
              const previous = message.blocks[message.blocks.indexOf(block) - 1];
              if (previous?.type !== "markdown") return false;
              try { editableContent(previous.source); } catch { return false; }
              // Commit and mount the previous editor in the input event so focus
              // moves directly between editable areas, including on touch devices.
              flushSync(() => {
                history.commit((document) => removeBlock(document, message.id, block.id));
                setActive({ id: previous.id, focus: "end" });
              });
              return true;
            }}
            onBusy={(value) => setBusyId((previous) => value ? block.id : previous === block.id ? undefined : previous)} onUndo={() => restore()} onRedo={() => restore(true)}
            onPasteImage={(file) => upload(file, { messageId: message.id, kind: "image" })} onNotice={(text, tone) => setFeedback(text, tone)} />
            : block.type === "markdown" ? <div className="workbench-editable" role="button" tabIndex={blocked ? -1 : 0} aria-label={t("编辑消息正文：{0}", history.document.messages.indexOf(message) + 1)}
              onClick={(event) => { if (!blocked && !sort.dragging && !(event.target as Element).closest("a,button")) setActive({ id: block.id, focus: { x: event.clientX, y: event.clientY } }); }}
              onKeyDown={(event) => { if (event.target === event.currentTarget && !blocked && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); setActive({ id: block.id, focus: true }); } }}>{block.source ? <MarkdownBody source={block.source}
                onTaskToggle={blocked || sort.dragging ? undefined : (index) => history.commit((document) => updateBlock(document, message.id, block.id,
                  (item) => item.type === "markdown" ? { ...item, source: toggleTaskInMarkdown(item.source, index) } : item))} />
                : <p className="workbench-placeholder">{t("点击输入消息…")}</p>}</div> : rendered}
        </div>;
      } : undefined}>
        <TraceDisplayProvider value={exportOpen || presentation ? undefined : saveTraceDisplay}>
        <PreviewStage canvasWidth={presentation?.width ?? history.document.canvas.width} className="inline-canvas-stage"><ConversationCanvas ref={canvas} document={history.document} resolveAssetSource={assets.resolveAssetSource} exportPresentation={presentation} /></PreviewStage>
        </TraceDisplayProvider>
      </InlineEditingProvider>
    </CanvasEditingProvider>
  );
}
