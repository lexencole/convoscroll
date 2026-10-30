import { canvasLocale } from "../i18n/locale";
import { LocalizedError, type LocalizedText } from "../i18n/messages";
import { useUiText, useUiLocale, CanvasLocaleProvider } from "../i18n/LocaleContext";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { CollapseState, ContentBlock, ConversationDocument, ConversationMessage, MessageRole } from "../data/conversation-types";
import { loadConversationDocument } from "../data/document-loader";
import { addBlock, addMessage, collectToolCallIds, createBlock, createEmptyDocument, duplicateBlock, duplicateMessage, moveBlock, moveMessage, removeBlock, removeMessage, updateBlock, updateDocumentMetadata } from "../editor/document-operations";
import { useDocumentHistory } from "../editor/use-document-history";
import { contentBlockLabels, roleLabels } from "../editor/editor-labels";
import { WorkbenchSettings, type SettingsSession, type SettingsTarget } from "../editor/WorkbenchSettings";
import { insertBlockAtMarkdown, reorderContent, type MarkdownInsertion, type SortTarget } from "../editor/workbench-operations";
import type { SlashBlockType } from "../editor/inline/slash-commands";
import { usePointerSort } from "../editor/use-pointer-sort";
import { inheritRecentIdentity, updateMessageInfo, type MessageInfoPatch } from "../editor/message-identity";
import { useProjectAutosave, useProjectDepartureProtection } from "../persistence/use-local-project";
import { usePersistentAssets } from "../persistence/use-persistent-assets";
import type { ExportPresentation } from "../renderer/ExportPresentationContext";
import { AboutPrivacyDialog } from "./AboutPrivacyDialog";
import { BrandMark } from "./BrandMark";
import { MessageNavigator } from "./MessageNavigator";
import { DocumentMenu } from "./DocumentMenu";
import { ExportControl, type ExportControlHandle } from "./ExportControl";
import { Icon, type IconName } from "./Icon";
import { ProjectControls } from "./ProjectControls";
import { WorkbenchNotice, type WorkbenchNoticeValue } from "./WorkbenchNotice";
import { WorkbenchItemMenu, type WorkbenchMenuAction } from "../editor/WorkbenchItemMenu";
import { noticeText } from "./notice-text";
import { useEditBar } from "./use-edit-bar";

import type { ProjectStore } from "../persistence/project-store";
import { sample } from "./sample-document";
import { useWorkbenchAttachments } from "./use-workbench-attachments";
import { WorkbenchToolbar, editingHelp } from "./WorkbenchToolbar";
import { readableDiagnostic, diagnosticDetails } from "./error-presentation";
import { ErrorDetails } from "./ErrorDetails";
import { WorkbenchCanvas, type ActiveBlock } from "./WorkbenchCanvas";
import { BlockTransferDialog } from "./BlockTransferDialog";
import { copyBlockToMessage } from "../editor/document-operations";

export function Workbench({ initialDocument, initialSavedAt, store, showDevelopmentTools }: { initialDocument: ConversationDocument; initialSavedAt?: string; store: ProjectStore; showDevelopmentTools: boolean }) {
  const t = useUiText();
  const { locale, setLocale } = useUiLocale();
  const history = useDocumentHistory(initialDocument);
  const current = useRef(history.document); current.current = history.document;
  const epoch = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; }; }, []);
  const autosave = useProjectAutosave({ document: history.document, dirty: history.dirty, initialSavedAt, store, markSaved: history.markSaved });
  const assets = usePersistentAssets(store, history.document);
  const canvas = useRef<HTMLElement>(null);
  const exportControls = useRef<ExportControlHandle>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 8);
    update(); window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);
  const [editing, setEditing] = useState(true);
  const [active, setActive] = useState<ActiveBlock>();
  const [busyId, setBusyId] = useState<string>();
  const [applying, setApplying] = useState(false);
  const [settings, setSettings] = useState<SettingsSession>();
  const [transfer, setTransfer] = useState<{ source: SortTarget; copy: boolean; trigger: HTMLElement; error?: string }>();
  const [settingsPending, setSettingsPending] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [presentation, setPresentation] = useState<ExportPresentation>();
  const [toolbar, setToolbar] = useState<HTMLDivElement | null>(null);
  const [bar, setBar] = useState<HTMLDivElement | null>(null);
  useEditBar(bar);
  const [feedback, setNotice] = useState<WorkbenchNoticeValue>();
  const noticeId = useRef(0);
  function setFeedback(message: LocalizedText, tone: WorkbenchNoticeValue["tone"] = "status") {
    setNotice({ id: ++noticeId.current, message, tone });
  }
  const locked = Boolean(busyId) || applying;
  const editingActive = editing && !exportOpen && !presentation;
  const blocked = locked || Boolean(settings) || Boolean(transfer) || exportOpen || aboutOpen;
  const sort = usePointerSort((source, before) => {
    epoch.current++;
    history.commit((document) => reorderContent(document, source, before));
    // Moving a focused node blurs it; return focus so keyboard shortcuts keep working.
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>(source.blockId
      ? `[data-workbench-block="${CSS.escape(source.blockId)}"] .workbench-drag`
      : `[data-message-id="${CSS.escape(source.messageId)}"] .workbench-message-tools .workbench-drag`)?.focus({ preventScroll: true }));
  }, blocked || !editingActive);
  useProjectDepartureProtection({ dirty: history.dirty || locked || settingsPending, status: locked || settingsPending ? { kind: "unsaved" } : autosave.status });

  const { input, attachFile, upload, chooseFile, onFileChange } = useWorkbenchAttachments({
    current, epoch, mounted, assets, history, blocked, setApplying, setFeedback,
  });

  function changeTitle(value: string, group: string) {
    if (applying || settings || sort.dragging) return;
    epoch.current++;
    history.commit((document) => document.metadata.title === value ? document : updateDocumentMetadata(document, { title: value }), group);
  }

  function changeIdentity(ids: readonly string[], patch: MessageInfoPatch, group: string) {
    if (locked || sort.dragging || settings?.target.type !== "message") return;
    const next = updateMessageInfo(current.current, ids, patch);
    const loaded = loadConversationDocument(next);
    if (loaded.status !== "valid") throw new LocalizedError(readableDiagnostic(loaded.diagnostics[0]));
    if (next === current.current) return;
    epoch.current++;
    flushSync(() => history.commit(() => next, group));
  }
  /** Block and document settings save as they change, like the identity panel. */
  function changeSettings(next: ConversationDocument, group: string, previous: ConversationDocument) {
    if (!settings || settings.target.type === "message") return;
    if (locked || sort.dragging || current.current !== previous) throw new Error("内容正在变化，这次修改没有保存，请再改一次。");
    const loaded = loadConversationDocument(next);
    if (loaded.status !== "valid") throw new LocalizedError(readableDiagnostic(loaded.diagnostics[0]));
    epoch.current++;
    flushSync(() => history.commit(() => next, group));
  }
  /** Undo inside a settings panel stops at the state the panel opened with. */
  function restoreSettings(redo = false) {
    if (locked || settingsPending || (!redo && current.current === settings?.base)) return;
    epoch.current++; if (redo) history.redo(); else history.undo();
  }

  function openSettings(target: SettingsTarget, trigger?: HTMLElement) {
    if (blocked || sort.dragging) return;
    setSettings({ target, base: current.current, trigger });
  }
  function commit(update: (document: ConversationDocument) => ConversationDocument) {
    if (blocked || sort.dragging) return;
    epoch.current++; history.commit(update);
  }
  /** The arrow on a thinking or tool card saves its state, so the preview, a reload and the export agree. */
  function saveTraceDisplay(blockId: string, displayState: CollapseState) {
    const message = current.current.messages.find((item) => item.blocks.some((block) => block.id === blockId));
    if (message) commit((document) => updateBlock(document, message.id, blockId, (item) => "displayState" in item ? { ...item, displayState } : item));
  }
  function restore(redo = false) {
    if (blocked || sort.dragging) return;
    epoch.current++; if (redo) history.redo(); else history.undo();
  }
  function replaceSample(key: "empty" | "story" | "basic" | "rich" | "long") {
    commit(() => key === "empty" ? createEmptyDocument(undefined, locale) : sample(key, locale)); setActive(undefined);
  }

  function newMessage(role: MessageRole) {
    if (blocked) return;
    const added = addMessage(current.current, role);
    commit(() => inheritRecentIdentity(added.document, added.messageId));
    setActive({ id: added.document.messages.at(-1)!.blocks[0].id, focus: true });
    window.requestAnimationFrame(() => {
      [...(canvas.current?.querySelectorAll<HTMLElement>('[data-message-id]') ?? [])].find((item) => item.dataset.messageId === added.messageId)?.scrollIntoView({ block: "center" });
    });
  }
  function deleteMessage(messageId: string) {
    if (blocked || sort.dragging || !editingActive) return;
    const message = [...(canvas.current?.querySelectorAll<HTMLElement>('[data-message-id]') ?? [])]
      .find((item) => item.dataset.messageId === messageId);
    const neighbour = (message?.nextElementSibling ?? message?.previousElementSibling)
      ?.querySelector<HTMLElement>('.message__header[role="button"]');
    const wasActive = current.current.messages.find((item) => item.id === messageId)?.blocks.some((block) => block.id === active?.id);
    commit((document) => removeMessage(document, messageId));
    if (wasActive) setActive(undefined);
    window.requestAnimationFrame(() => {
      (neighbour?.isConnected ? neighbour : document.querySelector<HTMLElement>('.workbench-add-message button'))?.focus({ preventScroll: true });
    });
  }
  function newBlock(messageId: string, type: Exclude<ContentBlock["type"], "image" | "file">, trigger: HTMLElement) {
    if (blocked) return;
    const callId = collectToolCallIds(current.current).at(-1);
    if (type === "toolResult" && !callId) { setFeedback("请先添加工具调用。", "alert"); return; }
    const block = createBlock(type, { callId, locale: current.current.metadata.locale });
    const next = addBlock(current.current, messageId, block);
    flushSync(() => commit(() => next));
    if (type === "markdown") setActive({ id: block.id, focus: true });
    else setSettings({ target: { type: "block", messageId, blockId: block.id }, base: current.current, trigger });
  }
  function insertFromSlash(messageId: string, type: SlashBlockType, insertion: MarkdownInsertion, trigger: HTMLElement) {
    if (blocked || sort.dragging) return;
    if (type === "image" || type === "file") { chooseFile({ messageId, kind: type, insertion }); return; }
    const callId = collectToolCallIds(current.current).at(-1);
    if (type === "toolResult" && !callId) throw new Error("请先添加工具调用。");
    const block = createBlock(type, { callId, locale: current.current.metadata.locale });
    const next = insertBlockAtMarkdown(current.current, messageId, insertion, block);
    const loaded = loadConversationDocument(next);
    if (loaded.status !== "valid") throw new LocalizedError(readableDiagnostic(loaded.diagnostics[0]));
    flushSync(() => commit(() => next));
    setSettings({ target: { type: "block", messageId, blockId: block.id }, base: current.current, trigger });
  }
  function itemActions(target: SortTarget, index: number, total: number): WorkbenchMenuAction[] {
    const isBlock = Boolean(target.blockId);
    const label = t(isBlock ? "内容块" : "消息");
    const block = isBlock ? history.document.messages.find((message) => message.id === target.messageId)?.blocks.find((block) => block.id === target.blockId) : undefined;
    const message = history.document.messages.find((item) => item.id === target.messageId);
    return [
      ...(!isBlock && message ? addActions(message) : []),
      { label: block ? block.type === "markdown" ? t("Markdown 源码") : t("{0}设置", t(contentBlockLabels[block.type])) : t("编辑身份"), icon: block?.type === "markdown" ? "code" : "settings", group: "edit", opensSettings: true,
        run: (trigger) => openSettings(block ? { type: "block", messageId: target.messageId, blockId: block.id } : { type: "message", messageId: target.messageId }, trigger) },
      { label: t("复制{0}", label), icon: "copy", group: "edit", run: () => commit((document) => isBlock ? duplicateBlock(document, target.messageId, target.blockId!).document : duplicateMessage(document, target.messageId).document) },
      ...(isBlock ? ([false, true].map((copy): WorkbenchMenuAction => ({ label: copy ? t("复制到…") : t("移动到…"), icon: copy ? "copy" : "arrow-down", group: "transfer", opensSettings: true,
        disabled: history.document.messages.length < 2,
        run: (trigger) => { if (!blocked && !sort.dragging) { setActive(undefined); setTransfer({ source: target, copy, trigger }); } },
      }))) : []),
      { label: t("上移{0}", label), icon: "arrow-up", group: "order", disabled: index === 0, run: () => commit((document) => isBlock ? moveBlock(document, target.messageId, target.blockId!, -1) : moveMessage(document, target.messageId, -1)) },
      { label: t("下移{0}", label), icon: "arrow-down", group: "order", disabled: index === total - 1, run: () => commit((document) => isBlock ? moveBlock(document, target.messageId, target.blockId!, 1) : moveMessage(document, target.messageId, 1)) },
      { label: t("删除{0}", label), icon: "trash", group: "danger", shortcut: isBlock ? undefined : /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘⇧⌫" : "Ctrl⇧⌫", run: () => {
        if (!isBlock) { deleteMessage(target.messageId); return; }
        commit((document) => removeBlock(document, target.messageId, target.blockId!));
      } },
    ];
  }
  function tools(target: SortTarget, index: number, total: number) {
    const isBlock = Boolean(target.blockId);
    const label = t(isBlock ? "内容块" : "消息");
    const block = isBlock ? history.document.messages.find((message) => message.id === target.messageId)?.blocks.find((block) => block.id === target.blockId) : undefined;
    return <div className="workbench-item-tools" data-ui-only="true">
      <button type="button" className="workbench-drag" aria-label={t("拖动{0}", label)} title={t("拖动排序；也可使用旁边菜单上移 / 下移")} disabled={blocked}
        onPointerDown={(event) => sort.start(event, target)}
        onKeyDown={(event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault(); const direction = event.key === "ArrowUp" ? -1 : 1;
          commit((document) => isBlock ? moveBlock(document, target.messageId, target.blockId!, direction) : moveMessage(document, target.messageId, direction));
        }}><Icon name="grip" /></button>
      <WorkbenchItemMenu label={t("{0}操作", label)} title={block ? t(contentBlockLabels[block.type]) : t("消息 {0}", index + 1)} disabled={blocked} messageId={target.messageId}
        actions={itemActions(target, index, total)} />
    </div>;
  }
  function messageTools(message: ConversationMessage) {
    return <div className="workbench-message-tools" data-current={message.id === activeMessage?.id ? "" : undefined}>
      {tools({ messageId: message.id }, history.document.messages.indexOf(message), history.document.messages.length)}
    </div>;
  }
  function addActions(message: ConversationMessage): WorkbenchMenuAction[] {
    const block = (type: Exclude<ContentBlock["type"], "image" | "file">, label: string, icon: IconName, group: string, disabled = false): WorkbenchMenuAction =>
      ({ label: t(label), icon, group, disabled, opensSettings: true, run: (trigger) => newBlock(message.id, type, trigger) });
    const file = (kind: "image" | "file", label: string, icon: IconName): WorkbenchMenuAction =>
      ({ label: t(label), icon, group: "content", opensSettings: true, run: () => chooseFile({ messageId: message.id, kind }) });
    return [block("markdown", "正文", "text", "content"), file("image", "图片", "image"), file("file", "文件", "paperclip"),
      block("reasoning", contentBlockLabels.reasoning, "spark", "trace"), block("toolCall", contentBlockLabels.toolCall, "tool", "trace"),
      block("toolResult", contentBlockLabels.toolResult, "output", "trace", !collectToolCallIds(history.document).length)];
  }
  /** Content is added through the message menu; an emptied message also offers it in place. */
  function messageFooter(message: ConversationMessage) {
    if (message.blocks.length) return null;
    return <div className="workbench-add-block">
      <WorkbenchItemMenu className="workbench-add-trigger" icon="plus" text={t("添加内容")} label={t("添加内容")} title={t("添加到这条消息")} align="start" disabled={blocked} messageId={message.id}
        actions={addActions(message)} />
    </div>;
  }
  function finishTransfer(destinationId?: string) {
    if (!transfer || locked) return;
    const { source, copy, trigger } = transfer;
    let blockId = source.blockId!;
    if (destinationId) {
      const result = copy ? copyBlockToMessage(current.current, source.messageId, blockId, destinationId)
        : { document: reorderContent(current.current, source, { messageId: destinationId }), blockId };
      const loaded = loadConversationDocument(result.document);
      if (loaded.status !== "valid") { setTransfer({ ...transfer, error: noticeText(t(readableDiagnostic(loaded.diagnostics[0]))) }); return; }
      epoch.current++; history.commit(() => result.document);
      blockId = result.blockId ?? blockId;
    }
    setTransfer(undefined);
    window.requestAnimationFrame(() => {
      const block = document.querySelector<HTMLElement>(`[data-workbench-block="${CSS.escape(blockId)}"]`);
      if (destinationId) block?.scrollIntoView({ block: "center", behavior: "instant" });
      const focus = destinationId || !trigger.isConnected ? block?.querySelector<HTMLElement>(".workbench-menu-trigger") : trigger;
      focus?.focus({ preventScroll: true });
    });
  }
  const activeMessage = history.document.messages.find((message) => message.blocks.some((block) => block.id === active?.id));
  const activeMarkdown = activeMessage?.blocks.find((block) => block.id === active?.id)?.type === "markdown";
  const saveState = autosave.status.kind === "error" ? "error" : locked || settingsPending || history.dirty ? "pending" : "saved";

  return <CanvasLocaleProvider value={canvasLocale(history.document.metadata.locale)}><main className="workbench" onKeyDownCapture={(event) => {
    if (event.defaultPrevented || event.repeat || event.nativeEvent.isComposing || blocked || sort.dragging || !editingActive) return;
    if (event.key !== "Backspace" || !event.shiftKey || !(event.metaKey || event.ctrlKey) || event.altKey) return;
    const owner = (event.target as Element).closest<HTMLElement>('[data-message-id], [data-owner-message]');
    const messageId = owner?.dataset.messageId ?? owner?.dataset.ownerMessage;
    if (!messageId || !current.current.messages.some((message) => message.id === messageId)) return;
    event.preventDefault(); event.stopPropagation(); deleteMessage(messageId);
  }} onPointerDown={(event) => {
    // Clicking the empty workspace ends inline editing, returning the toolbar to the document.
    if (active && !blocked && !sort.dragging && (event.target as Element).matches(".workbench, .inline-canvas-stage")) setActive(undefined);
  }} onKeyDown={(event) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || blocked || sort.dragging) return;
    const target = event.target as Element;
    const taskToggle = target.closest(".inline-task-toggle");
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && (key === "z" || (taskToggle && key === "y"))
      && (taskToggle || !target.closest('input,textarea,[contenteditable="true"]'))) {
      event.preventDefault(); restore(event.shiftKey || key === "y");
    }
  }}>
    <div className="workbench-chrome">
    <header className="inline-app-header" data-scrolled={scrolled || undefined}>
          <DocumentMenu triggerRef={menuTrigger} disabled={blocked || sort.dragging} trigger={<><BrandMark /><strong>{t("话卷")}</strong><Icon name="chevron-down" /></>}>{(close) => <>
            <button role="menuitem" tabIndex={-1} onClick={() => { replaceSample("empty"); close(); }}><Icon name="plus" />{t("新建空白")}</button>
            <div className="document-menu__group" role="group" aria-label={t("示例")}>
              <button role="menuitem" tabIndex={-1} onClick={() => { replaceSample("basic"); close(); }}><Icon name="document" />{t("载入简洁示例")}</button>
              <button role="menuitem" tabIndex={-1} onClick={() => { replaceSample("story"); close(); }}><Icon name="document" />{t("载入故事示例")}</button>
            </div>
            {showDevelopmentTools ? <div className="document-menu__group" role="group" aria-label={t("开发工具")}><button role="menuitem" tabIndex={-1} onClick={() => { replaceSample("rich"); close(); }}><Icon name="code" />{t("测试：所有内容类型")}</button><button role="menuitem" tabIndex={-1} onClick={() => { replaceSample("long"); close(); }}><Icon name="code" />{t("测试：超长对话")}</button></div> : null}
            <div className="document-menu__group" role="group" aria-label={t("项目文件")}>
            <ProjectControls document={history.document} resolveAssetBlob={assets.resolveAssetBlob} menuItem onMenuAction={close} dialogFocusSuspended={exportOpen || aboutOpen || Boolean(settings)}
              replaceProject={async (document, records) => { epoch.current++; setApplying(true); try { return await autosave.replaceProject(document, records); } finally { setApplying(false); } }}
              onImported={(document) => { history.replace(document); setActive(undefined); assets.reload(); }} />
            </div>
            <div className="document-menu__group" role="group" aria-label={t("设置")}>
              <button role="menuitem" tabIndex={-1} onClick={() => { close(); openSettings({ type: "document" }, menuTrigger.current ?? undefined); }}><Icon name="text" />{t("标题和说明")}</button>
              <button role="menuitem" tabIndex={-1} onClick={() => { close(); exportControls.current?.openSettings(menuTrigger.current ?? undefined); }}><Icon name="settings" />{t("导出设置")}</button>
            </div>
            {saveState !== "saved" ? <div className="document-menu__save" role="status"><Icon name={saveState === "error" ? "error" : "sync"} />{saveState === "error" ? t("保存失败") : t("保存中…")}</div> : null}
            <div className="document-menu__group" role="group" aria-label={t("语言")}><button role="menuitem" tabIndex={-1} onClick={() => { setLocale(locale === "en" ? "zh-CN" : "en"); close(); }}><Icon name="text" />{t("语言")} · {locale === "en" ? "简体中文" : "English"}</button></div>
            <div className="document-menu__group"><button role="menuitem" tabIndex={-1} onClick={() => { close(); window.requestAnimationFrame(() => setAboutOpen(true)); }}><Icon name="info" />{t("关于")}</button></div>
          </>}</DocumentMenu>
      <span className="inline-save-status" role="status" data-state={saveState}><Icon name={saveState === "error" ? "error" : saveState === "pending" ? "sync" : "check"} /><span className="inline-save-status__label">{autosave.status.kind === "error" ? t("保存失败") : locked || settingsPending ? t("正在编辑…") : history.dirty ? t("保存中…") : t("保存在本机")}</span></span>
      <div className="inline-app-actions">
        <button type="button" className="workbench-mode" disabled={blocked || sort.dragging} aria-label={editing ? t("预览") : t("编辑")} title={editing ? t("看导出效果") : t("继续编辑")} onClick={() => { setEditing(!editing); setActive(undefined); }}><Icon name={editing ? "eye" : "edit"} /></button>
        <ExportControl canvasRef={canvas} document={history.document} applyPresentation={setPresentation} onOpenChange={setExportOpen} controlsRef={exportControls} directExport compact
          disabledReason={locked || settings || transfer || sort.dragging ? settings?.target.type === "message" ? t("请先关闭身份设置。") : t("请先结束当前编辑。") : undefined} />
      </div>
    </header>
    <WorkbenchToolbar hostRef={setToolbar} barRef={setBar} active={activeMarkdown} hidden={!editingActive || Boolean(settings) || Boolean(transfer) || aboutOpen}
      blocked={blocked || sort.dragging} canUndo={history.canUndo} canRedo={history.canRedo} onUndo={() => restore()} onRedo={() => restore(true)} onHelp={() => setFeedback(editingHelp)} />
    </div>
    {autosave.status.kind === "error" ? <div className="workbench-feedback" role="alert"><span>{noticeText(t(autosave.status.message))}</span><button onClick={autosave.retry}>{t("重试保存")}</button></div> : null}
    {history.diagnostic ? <div className="workbench-feedback workbench-feedback--diagnostic" role="alert"><span>{noticeText(t(readableDiagnostic(history.diagnostic)))}</span><ErrorDetails text={diagnosticDetails(history.diagnostic)} /></div> : null}
    {feedback && !history.diagnostic ? <WorkbenchNotice key={feedback.id} notice={feedback} onDismiss={() => setNotice(undefined)} /> : null}
    <MessageNavigator document={history.document} canvas={canvas} disabled={blocked || sort.dragging || Boolean(presentation)} />
    <WorkbenchCanvas canvas={canvas} history={history} assets={assets} editingActive={editingActive} blocked={blocked}
      applying={applying} settings={settings} exportOpen={exportOpen} presentation={presentation} sort={sort}
      active={active} setActive={setActive} toolbar={toolbar} setBusyId={setBusyId} setFeedback={setFeedback}
      upload={upload} restore={restore} insertFromSlash={insertFromSlash} openSettings={openSettings} saveTraceDisplay={saveTraceDisplay}
      messageTools={messageTools} messageFooter={messageFooter} tools={tools} itemActions={itemActions} changeTitle={changeTitle}
      titleDisabled={applying || Boolean(settings) || Boolean(transfer) || sort.dragging || exportOpen || aboutOpen || Boolean(busyId && busyId !== "document-title")} />
    {editingActive ? <footer className="workbench-add-message" role="group" aria-label={t("添加消息")}>
      {(["user", "assistant"] as const).map((role) => <button key={role} type="button"
        disabled={blocked || sort.dragging} onClick={() => newMessage(role)}><Icon name="plus" /><span>{role === "user" ? t("用户消息") : t("AI 回复")}</span></button>)}
      <WorkbenchItemMenu label={t("添加其他角色消息")} title={t("其他角色")} disabled={blocked || sort.dragging}
        actions={(["system", "developer", "tool", "unknown"] as const).map((role) => ({ label: t("{0}消息", t(roleLabels[role])), icon: "plus", group: "role", opensSettings: true, run: () => newMessage(role) }))} />
    </footer> : null}
    <input ref={input} type="file" className="visually-hidden" aria-label={t("添加本地附件")} tabIndex={-1} onChange={onFileChange} />
    {settings ? <WorkbenchSettings session={settings} resolveAssetSource={assets.resolveAssetSource} identity={{ document: history.document, canUndo: history.canUndo, canRedo: history.canRedo,
      onChange: changeIdentity, onUndo: restoreSettings,
      onAvatar: (ids, file) => attachFile(file, { kind: "avatar", messageId: settings.target.type === "message" ? settings.target.messageId : ids[0], avatarMessageIds: ids }) }}
      onPendingChange={setSettingsPending} onChange={changeSettings} onAttach={attachFile} onClose={() => setSettings(undefined)} /> : null}
    <AboutPrivacyDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
    {transfer ? <BlockTransferDialog conversation={history.document} sourceId={transfer.source.messageId} copy={transfer.copy} error={transfer.error} onChoose={finishTransfer} onClose={() => finishTransfer()} /> : null}
  </main></CanvasLocaleProvider>;
}
