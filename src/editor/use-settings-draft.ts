import { errorMessage, message as msg, type LocalizedText } from "../i18n/messages";
import { useEffect, useRef, useState } from "react";
import type { ConversationDocument } from "../data/conversation-types";
import { contentBlockLabels } from "./editor-labels";
import type { AssetTarget } from "./workbench-operations";
import type { WorkbenchSettingsProps } from "./settings-types";

// Each opening starts its own undo steps, even for a field edited in the previous opening.
let openings = 0;

/** Keeps unsaved composition and invalid field values separate from the canonical document. */
export function useSettingsDraft({ session, identity, onChange, onAttach }: Pick<WorkbenchSettingsProps, "session" | "identity" | "onChange" | "onAttach">) {
  const live = identity.document;
  // Field values follow the live document, except while an input method composes or a value cannot be saved yet.
  const [draft, setDraft] = useState(live);
  const draftRef = useRef(live);
  const saved = useRef(live);
  const group = useRef("");
  const [sessionId] = useState(() => `settings-${++openings}`);
  const [revision, setRevision] = useState(0);
  const composingRef = useRef(false);
  const [composing, setComposing] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<LocalizedText>("");
  const [edited, setEdited] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [failedFile, setFailedFile] = useState<File>();
  const [attachError, setAttachError] = useState<LocalizedText>("");
  const [identityBusy, setIdentityBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const { target } = session;
  const message = target.type !== "document" ? (target.type === "message" ? live : draft).messages.find((item) => item.id === target.messageId) : undefined;
  const block = target.type === "block" ? message?.blocks.find((item) => item.id === target.blockId) : undefined;
  const assetId = block && "assetId" in block ? block.assetId : undefined;
  const asset = draft.assets.find((item) => item.id === assetId);
  const attachmentTarget: AssetTarget | undefined = message && (block?.type === "image" || block?.type === "file")
    ? { messageId: message.id, kind: block.type, blockId: block.id } : undefined;
  const title = target.type === "document" ? "标题和说明" : target.type === "message" ? "名字与模型" : block ? msg("{0}设置", msg(contentBlockLabels[block.type])) : "内容设置";
  const busy = target.type === "message" ? identityBusy : composing || invalid || Boolean(error) || attaching;
  const canUndo = identity.canUndo && live !== session.base;
  const canRedo = identity.canRedo && edited;

  // Undo and redo replace the live document; the fields follow unless a value is still being typed.
  useEffect(() => {
    if (live === saved.current || composingRef.current) return;
    saved.current = draftRef.current = live;
    setDraft(live); setError("");
  }, [live]);
  // JSON, call IDs and durations mark themselves invalid and are not written until corrected.
  useEffect(() => {
    const root = form.current;
    if (!root) return;
    const check = () => setInvalid(Boolean(root.querySelector('[aria-invalid="true"]')));
    const observer = new MutationObserver(check);
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-invalid"] });
    check();
    return () => observer.disconnect();
  }, []);

  function save(next: ConversationDocument) {
    const previous = saved.current;
    if (next === previous) return;
    saved.current = next;
    try { onChange(next, group.current, previous); setEdited(true); setError(""); }
    catch (cause) { saved.current = previous; setError(errorMessage(cause, "设置没能保存，内容没有改动。")); }
  }
  function edit(update: (document: ConversationDocument) => ConversationDocument, field: string) {
    const next = update(draftRef.current);
    draftRef.current = next; setDraft(next);
    group.current = `${sessionId}:${field}`;
    if (!composingRef.current) save(next);
  }
  function restore() {
    draftRef.current = saved.current; setDraft(saved.current);
    setRevision((value) => value + 1); setError("");
  }
  function undo(redo = false) { if (!busy && (redo ? canRedo : canUndo)) identity.onUndo(redo); }
  async function attach(file: File) {
    if (busy || !attachmentTarget) return;
    setAttaching(true); setAttachError(""); setFailedFile(undefined);
    try { await onAttach(file, attachmentTarget); setEdited(true); }
    catch (cause) { setFailedFile(file); setAttachError(errorMessage(cause, "文件没能保存，还是原来的文件。")); }
    finally { setAttaching(false); }
  }

  function startComposition() { composingRef.current = true; setComposing(true); }
  function endComposition() { composingRef.current = false; setComposing(false); save(draftRef.current); }
  return { live, draft, form, target, message, block, asset, attachmentTarget, title, busy,
    canUndo, canRedo, composing, composingRef, attaching, failedFile, attachError, error, invalid,
    revision, setIdentityBusy, edit, restore, undo, attach, startComposition, endComposition };
}
