import { errorMessage } from "../i18n/messages";
import { LocalizedError, type LocalizedText } from "../i18n/messages";
import { useUiText } from "../i18n/LocaleContext";
import { readableDiagnostic } from "../app/error-presentation";
import { useEffect, useId, useRef, useState } from "react";
import type { ConversationDocument, ConversationMessage } from "../data/conversation-types";
import { loadConversationDocument } from "../data/document-loader";
import { SelectField } from "../app/SelectField";
import { Icon, IconButton } from "../app/Icon";
import { ModelBrandIcon } from "../models/ModelBrandIcon";
import { MessageAvatar } from "../renderer/MessageRenderer";
import type { AssetSourceResolver } from "../renderer/ConversationCanvas";
import { messageStatusLabels, roleLabels } from "./editor-labels";
import { createEditorId } from "./document-operations";
import { matchingIdentityIds, updateMessageInfo, type MessageInfoPatch } from "./message-identity";
import { noticeText } from "../app/notice-text";
import { MessageTimestampFields } from "./MessageTimestampFields";
import { messageTimestampValue, type MessageTimestampDraft } from "./message-timestamp";

export interface IdentityControls {
  readonly document: ConversationDocument;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly onChange: (ids: readonly string[], patch: MessageInfoPatch, group: string) => void;
  readonly onAvatar: (ids: readonly string[], file: File) => Promise<void>;
  readonly onUndo: (redo?: boolean) => void;
}

const presetModels = ["Claude", "ChatGPT", "Gemini", "DeepSeek", "Kimi", "GLM", "Grok"];

export function MessageIdentityFields({ base, messageId, controls, resolveAssetSource, onBusyChange, onClose }: {
  base: ConversationDocument; messageId: string; controls: IdentityControls;
  resolveAssetSource: AssetSourceResolver;
  onBusyChange: (busy: boolean) => void; onClose: () => void;
}) {
  const t = useUiText();
  const [matchingIds] = useState(() => matchingIdentityIds(base, messageId));
  const [scope, setScope] = useState<"all" | "one">("all");
  const [sessionId] = useState(() => createEditorId("message"));
  const scopeRevision = useRef(0);
  const [inputDraft, setInputDraft] = useState<{ key: keyof MessageInfoPatch; value: string }>();
  const [timestampDraft, setTimestampDraft] = useState<MessageTimestampDraft>();
  const [timestampRevision, setTimestampRevision] = useState(0);
  const composing = useRef(false);
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [failedFile, setFailedFile] = useState<File>();
  const [error, setError] = useState<LocalizedText>("");
  const [invalid, setInvalid] = useState(false);
  const [edited, setEdited] = useState(false);
  const [more, setMore] = useState(false);
  const [customModel, setCustomModel] = useState(false);
  const [scopeHelp, setScopeHelp] = useState(false);
  const moreId = useId();
  const helpId = useId();
  const modelInput = useRef<HTMLInputElement>(null);
  const filePicker = useRef<HTMLInputElement>(null);
  const message = controls.document.messages.find((item) => item.id === messageId)!;
  const ids = scope === "all" ? matchingIds : [messageId];
  const busy = savingAvatar || Boolean(inputDraft && composing.current) || invalid;
  const canUndo = controls.canUndo && controls.document !== base;
  const canRedo = controls.canRedo && edited;
  useEffect(() => { onBusyChange(busy); return () => onBusyChange(false); }, [busy, onBusyChange]);

  function change(patch: MessageInfoPatch, field: string, local = false) {
    const targets = local ? [messageId] : ids;
    try {
      const candidate = updateMessageInfo(controls.document, targets, patch);
      const loaded = loadConversationDocument(candidate);
      if (loaded.status !== "valid") throw new LocalizedError(readableDiagnostic(loaded.diagnostics[0]));
      controls.onChange(targets, patch, `${sessionId}:${scopeRevision.current}:${local ? "local" : scope}:${field}`);
      if (candidate !== controls.document) setEdited(true);
      setError(""); setInvalid(false); setInputDraft(undefined);
      return true;
    } catch (cause) { setError(errorMessage(cause, "身份没能修改，内容没有改动。")); setInvalid(true); }
    return false;
  }
  function updateTimestamp(draft: MessageTimestampDraft, isComposing = false) {
    composing.current = isComposing;
    setTimestampDraft(draft); setInputDraft({ key: "timestamp", value: "" });
    if (isComposing) return;
    try {
      const timestamp = messageTimestampValue(draft, message.timestamp);
      if (change({ timestamp }, "timestamp", true)) setTimestampDraft(undefined);
    } catch (cause) { setError(errorMessage(cause, "请检查日期和时间")); setInvalid(true); }
  }
  function restoreDraft() {
    setInputDraft(undefined); setTimestampDraft(undefined); setTimestampRevision((value) => value + 1); setInvalid(false); setError("");
  }
  function clearTimestamp() {
    scopeRevision.current++;
    if (change({ timestamp: undefined }, "timestamp", true)) restoreDraft();
    scopeRevision.current++;
  }
  function textField(label: string, key: "displayName" | "model" | "sourceRole", placeholder?: string) {
    const value = inputDraft?.key === key ? inputDraft.value : message[key] ?? "";
    const update = (text: string) => {
      setInputDraft({ key, value: text });
      if (!composing.current) change({ [key]: text }, key);
    };
    return <label className="editor-field">{t(label)}<input ref={key === "model" ? modelInput : undefined} value={value} placeholder={placeholder ? t(placeholder) : undefined} aria-invalid={invalid && inputDraft?.key === key || undefined}
      disabled={Boolean((invalid || composing.current) && inputDraft?.key !== key)}
      onChange={(event) => update(event.target.value)}
      onCompositionStart={(event) => { composing.current = true; setInputDraft({ key, value: event.currentTarget.value }); }}
      onCompositionEnd={(event) => { composing.current = false; update(event.currentTarget.value); }} /></label>;
  }
  async function avatar(file: File) {
    if (savingAvatar || composing.current || invalid) return;
    setSavingAvatar(true); setError(""); setFailedFile(undefined);
    try { await controls.onAvatar(ids, file); setEdited(true); }
    catch (cause) { setFailedFile(file); setError(errorMessage(cause, "头像更换失败，已保留原头像。")); }
    finally { setSavingAvatar(false); }
  }
  const asset = controls.document.assets.find((item) => item.id === message.avatarAssetId);
  const showModelInput = customModel || Boolean(message.model && !presetModels.includes(message.model));
  const modelFields = <div className="identity-model-fields">
    <label className="editor-field identity-value-row"><span>{t("模型")}</span><SelectField ariaLabel={t("常用模型")} restoreFocusOnSelect={false} value={message.model ? presetModels.includes(message.model) ? message.model : "custom" : "none"}
      disabled={busy} options={[
        ...presetModels.map((value) => ({ value, label: value, icon: <ModelBrandIcon model={value} /> })),
        { value: "custom", label: message.model && !presetModels.includes(message.model) ? message.model : t("自定义模型…"), icon: <Icon name="settings" /> },
        { value: "none", label: t("不标注模型"), icon: <Icon name="close" /> },
      ]} onChange={(model) => {
        if (model === "custom") { setCustomModel(true); window.requestAnimationFrame(() => modelInput.current?.focus()); }
        else { setCustomModel(false); change({ model: model === "none" ? "" : model }, "model"); }
      }} /></label>
    {showModelInput ? <div className="identity-custom-model">{textField("模型名称", "model")}</div> : null}
  </div>;
  const errorReason = noticeText(t(error));
  const timestampValidation = inputDraft?.key === "timestamp";
  const validation = error || invalid ? <div className="identity-validation">
    {error ? <p role="alert" className="inline-notice"><span>{errorReason}</span></p> : null}
    {invalid ? <button type="button" className="workbench-restore" onClick={restoreDraft}>{t("恢复原值")}</button> : null}
  </div> : null;
  // Only values that are rarely set; the role is visible as soon as the section opens.
  const moreSummary = [message.status ? t(messageStatusLabels[message.status]) : "", message.timestamp ? t("已设时间") : "", message.role !== "assistant" && message.model ? message.model : ""].filter(Boolean).join(" · ");
  return <div className="workbench-identity-fields" onKeyDown={(event) => {
    if (event.defaultPrevented || event.nativeEvent.isComposing || composing.current || busy) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey ? canRedo : canUndo) controls.onUndo(event.shiftKey);
    }
  }}>
    <fieldset className="workbench-settings-fields" disabled={savingAvatar}>
      <div className="identity-profile">
        <MessageAvatar message={message} asset={asset} resolveAssetSource={resolveAssetSource} />
        <button type="button" className="identity-avatar-button" disabled={busy} onClick={() => filePicker.current?.click()}>{t("更换头像")}</button>
        <input ref={filePicker} hidden type="file" accept="image/*" aria-label={t("选择头像")} disabled={busy}
          onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void avatar(file); }} />
      </div>
      {textField("显示名称", "displayName", roleLabels[message.role])}
      {message.avatarAssetId ? <div className="identity-avatar-note"><small>{asset?.fileName ?? t("本地头像")}</small><button type="button" disabled={busy} onClick={() => change({ avatarAssetId: undefined }, "avatar")}>{t("移除头像")}</button></div> : null}
      {message.role === "assistant" ? modelFields : null}
      <div className="identity-scope">
        <div><span>{t("将同步 {0} 条同身份消息", ids.length)}</span><IconButton icon="info" className="identity-scope-help" label={t("同步范围说明")} aria-expanded={scopeHelp} aria-controls={helpId} onClick={() => setScopeHelp(!scopeHelp)} /></div>
        <label><input type="checkbox" checked={scope === "one"} disabled={busy} onChange={(event) => { scopeRevision.current++; setScope(event.target.checked ? "one" : "all"); }} />{t("只改这一条")}</label>
        {scopeHelp ? <p id={helpId} className="identity-help">{t("按打开面板时的角色、名称、模型和头像匹配；切换范围只影响之后的修改")}</p> : null}
      </div>
      <div className="identity-more">
        <button type="button" className="identity-more-toggle" aria-expanded={more} aria-controls={moreId} disabled={busy} onClick={() => setMore(!more)}>
          <span>{t("更多设置")}</span>{!more && moreSummary ? <small>{moreSummary}</small> : null}<Icon name="chevron-right" />
        </button>
        {more ? <div id={moreId} className="identity-more-fields">
          <div className="identity-property-rows">
            <label className="editor-field identity-value-row"><span>{t("角色")}</span><SelectField ariaLabel={t("角色")} value={message.role} disabled={busy}
              options={Object.entries(roleLabels).map(([value, label]) => ({ value: value as ConversationMessage["role"], label: t(label) }))}
              onChange={(role) => change({ role, sourceRole: role === "unknown" ? message.sourceRole || "custom" : undefined }, "role")} /></label>
            <label className="editor-field identity-value-row"><span>{t("消息状态")}</span><SelectField ariaLabel={t("消息状态")} value={message.status ?? ""} disabled={busy}
              options={[{ value: "", label: t("未设置") }, ...Object.entries(messageStatusLabels).map(([value, label]) => ({ value, label: t(label) }))]}
              onChange={(status) => change({ status: status ? status as ConversationMessage["status"] : undefined }, "status", true)} /></label>
          </div>
          {message.role === "unknown" ? textField("原始角色名", "sourceRole") : null}
          {message.role !== "assistant" ? modelFields : null}
          <div className="identity-message-properties">
            <MessageTimestampFields value={message.timestamp} draft={timestampDraft} revision={timestampRevision}
              validation={timestampValidation ? validation : undefined}
              disabled={savingAvatar || Boolean((invalid || composing.current) && inputDraft?.key !== "timestamp")}
              invalid={invalid && inputDraft?.key === "timestamp"} onChange={updateTimestamp} onClear={clearTimestamp} />
          </div>
        </div> : null}
      </div>
    </fieldset>
    {timestampValidation ? null : validation}
    {failedFile ? <div className="workbench-attachment-settings"><small>{t("头像更换失败，已保留原头像")}</small><button type="button" disabled={busy} onClick={() => void avatar(failedFile)}>{t("再试一次")}</button></div> : null}
    <footer><div className="workbench-save-note">{savingAvatar ? t("正在保存头像…") : invalid ? t("请改正输入") : t("自动保存")}</div>
      <IconButton icon="undo" label={t("撤销")} disabled={busy || !canUndo} onClick={() => controls.onUndo()} />
      <IconButton icon="redo" label={t("重做")} disabled={busy || !canRedo} onClick={() => controls.onUndo(true)} />
      <button type="button" className="workbench-primary" disabled={busy} onClick={onClose}><Icon name="check" />{t("完成")}</button></footer>
  </div>;
}
