import { useUiText } from "../i18n/LocaleContext";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { SelectField } from "../app/SelectField";
import { canvasLocale } from "../i18n/locale";
import { Icon, IconButton } from "../app/Icon";
import { useModalIsolation } from "../app/use-modal-isolation";
import { BlockEditor } from "./BlockEditor";
import { updateDocumentMetadata } from "./document-operations";
import { roleLabels } from "./editor-labels";
import { MessageIdentityFields } from "./MessageIdentityFields";
import { noticeText } from "../app/notice-text";
import type { WorkbenchSettingsProps } from "./settings-types";
import { useSettingsDraft } from "./use-settings-draft";
import { useSettingsPosition } from "./use-settings-position";
export type { SettingsTarget, SettingsSession } from "./settings-types";

export function WorkbenchSettings({ session, identity, resolveAssetSource, onPendingChange, onChange, onAttach, onClose }: WorkbenchSettingsProps) {
  const t = useUiText();
  const { draft, form, target, message, block, asset, attachmentTarget, title, busy,
    canUndo, canRedo, composing, composingRef, attaching, failedFile, attachError, error, invalid,
    revision, setIdentityBusy, edit, restore, undo, attach, startComposition, endComposition,
  } = useSettingsDraft({ session, identity, onChange, onAttach });
  const panel = useRef<HTMLElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  useModalIsolation(true, panel, { lockScroll: false });
  useEffect(() => { onPendingChange(busy); return () => onPendingChange(false); }, [busy, onPendingChange]);
  useEffect(() => { if (attaching) panel.current?.focus(); }, [attaching]);
  const position = useSettingsPosition(session, panel, busy);
  function close() { if (!busy) onClose(); }
  function field(label: string, key: "title" | "subtitle", options?: { multiline?: boolean }) {
    const value = draft.metadata[key] ?? "";
    const update = (text: string) => edit((document) => updateDocumentMetadata(document, { [key]: text }), `document:${key}`);
    return <label className="editor-field">{t(label)}{options?.multiline
      ? <textarea value={value} rows={3} onChange={(event) => update(event.target.value)} />
      : <input value={value} onChange={(event) => update(event.target.value)} />}</label>;
  }
  const what = t(block?.type === "image" ? "图片" : "文件");

  return createPortal(<section ref={panel} tabIndex={-1} className="workbench-settings" style={position} role="dialog" aria-modal="true" aria-label={t(title)}
    onKeyDown={(event) => {
      if (event.defaultPrevented || composing || event.nativeEvent.isComposing) return;
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key === "Tab") {
        if (attaching) { event.preventDefault(); return; }
        const controls = [...(panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),summary,[tabindex="0"]') ?? [])]
          .filter((item) => !item.closest('[hidden]') && !item.matches(':disabled')
            && (!item.closest('details:not([open])') || item.matches('details:not([open]) > summary')));
        if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus(); }
        else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
      }
    }}>
    <header><div>{target.type === "block" && message ? <small>{t(roleLabels[message.role])} · {message.displayName ?? t("未命名")}</small> : null}<h2>{t(title)}</h2></div><IconButton icon="close" label={t("关闭设置")} disabled={busy} onClick={close} /></header>
    <div className="workbench-settings__scroll">
    {target.type === "message" ? <MessageIdentityFields base={session.base} messageId={target.messageId} controls={identity} resolveAssetSource={resolveAssetSource} onBusyChange={setIdentityBusy} onClose={close} /> :
    <form ref={form} onSubmit={(event) => event.preventDefault()}
      onCompositionStart={startComposition}
      onCompositionEnd={endComposition}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || composingRef.current) return;
        // The panel's history replaces the field's own undo, so the canvas and the fields stay in step.
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); undo(event.shiftKey); }
      }}>
      <fieldset disabled={attaching} className="workbench-settings-fields">
        {target.type === "document" ? <>
          {field("标题", "title")}
          {field("说明", "subtitle", { multiline: true })}
          <div className="editor-field"><label htmlFor="canvas-language">{t("成图语言")}</label>
            <SelectField id="canvas-language" value={draft.metadata.locale ?? "zh-CN"} options={[
              { value: "zh-CN", label: "简体中文" }, { value: "en", label: "English" },
              ...((draft.metadata.locale && !["zh-CN", "en"].includes(draft.metadata.locale)) ? [{ value: draft.metadata.locale, label: canvasLocale(draft.metadata.locale) === "en" ? `English (${draft.metadata.locale})` : t("中文（兼容原设置：{0}）", draft.metadata.locale) }] : []),
            ]} onChange={(locale) => edit((document) => updateDocumentMetadata(document, { locale }), "document:locale")} />
            <small>{t("仅改变成图标签，正文和名字保持原样")}</small>
          </div>
        </> : null}
        {block && message ? <BlockEditor key={revision} settingsOnly document={draft} messageId={message.id} block={block} index={message.blocks.findIndex((item) => item.id === block.id)} total={message.blocks.length}
          selected={false} onSelect={() => undefined} commit={(update, key) => edit(update, key ?? "block")} /> : null}
        {attachmentTarget ? <div className="workbench-attachment-settings">
          <span>{t("文件")}</span>
          <small>{attaching ? t("正在换{0}…", what) : asset ? `${asset.fileName} · ${asset.mimeType} · ${asset.byteSize ?? t("未知")} B` : t("还没有文件")}</small>
          <button type="button" disabled={busy} onClick={() => filePicker.current?.click()}>{t("替换文件")}</button>
          <input ref={filePicker} hidden type="file" aria-label={t("替换文件")} accept={attachmentTarget.kind === "file" ? undefined : "image/*"}
            onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void attach(file); }} />
          {failedFile ? <><small>{t("没换成 {0}，还是原来的{1}。", failedFile.name, what)}</small><button type="button" disabled={busy} onClick={() => void attach(failedFile)}>{t("再试一次")}</button></> : null}
        </div> : null}
      </fieldset>
      {error || attachError ? <p role="alert" className="inline-notice">{noticeText(t(error || attachError || ""))}</p> : null}
      {error || invalid ? <button type="button" className="workbench-restore" onClick={restore}>{t("恢复原值")}</button> : null}
      <footer><div className="workbench-save-note">{attaching ? t("正在保存{0}…", what) : error || invalid ? t("请改正或恢复原值") : t("自动保存")}</div>
        <IconButton icon="undo" label={t("撤销")} disabled={busy || !canUndo} onClick={() => undo()} />
        <IconButton icon="redo" label={t("重做")} disabled={busy || !canRedo} onClick={() => undo(true)} />
        <button type="button" className="workbench-primary" disabled={busy} onClick={close}><Icon name="check" />{t("完成")}</button></footer>
    </form>}
    </div>
  </section>, document.body);
}
