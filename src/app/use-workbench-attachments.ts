import { errorMessage } from "../i18n/messages";
import { LocalizedError, type LocalizedText } from "../i18n/messages";
import { readableDiagnostic } from "./error-presentation";
import { useRef, type ChangeEvent, type RefObject } from "react";
import { flushSync } from "react-dom";
import type { ConversationAsset, ConversationDocument } from "../data/conversation-types";
import { loadConversationDocument } from "../data/document-loader";
import { createEditorId } from "../editor/document-operations";
import { readImageDimensions } from "../editor/read-image-dimensions";
import { removeImageLocation } from "../editor/remove-image-location";
import { attachAsset, type AssetTarget } from "../editor/workbench-operations";
import type { useDocumentHistory } from "../editor/use-document-history";
import type { usePersistentAssets } from "../persistence/use-persistent-assets";
import type { WorkbenchNoticeValue } from "./WorkbenchNotice";

export function useWorkbenchAttachments({ current, epoch, mounted, assets, history, blocked, setApplying, setFeedback }: {
  current: RefObject<ConversationDocument>; epoch: RefObject<number>; mounted: RefObject<boolean>;
  assets: ReturnType<typeof usePersistentAssets>; history: ReturnType<typeof useDocumentHistory>;
  blocked: boolean; setApplying: (value: boolean) => void;
  setFeedback: (message: LocalizedText, tone?: WorkbenchNoticeValue["tone"]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const uploadTarget = useRef<{ target: AssetTarget; epoch: number } | undefined>(undefined);
  async function attachFile(picked: File, target: AssetTarget) {
    const base = current.current;
    const generation = epoch.current;
    const isCurrent = () => mounted.current && generation === epoch.current && current.current === base;
    let storageKey: string | undefined;
    let committed = false;
    setApplying(true);
    try {
      if (target.kind !== "file" && !picked.type.startsWith("image/")) throw new Error("请选择图片文件。");
      // Photos lose their GPS data; files attached as files stay byte-for-byte.
      const file = target.kind === "file" ? picked : await removeImageLocation(picked);
      const id = createEditorId("asset");
      storageKey = `local:${id}`;
      const asset: ConversationAsset = { id, kind: target.kind === "file" ? "file" : "image", fileName: file.name, mimeType: file.type || "application/octet-stream", byteSize: file.size, source: { kind: "local", storageKey } };
      // Validate the resulting resource budget before asking the browser to decode.
      let candidate = attachAsset(base, target, asset);
      const dimensions = target.kind === "file" ? {} : await readImageDimensions(file);
      if (!isCurrent()) throw new Error("位置变了，文件没有加进去。");
      candidate = { ...candidate, assets: candidate.assets.map((item) => item.id === id ? { ...item, ...dimensions } : item) };
      const validated = loadConversationDocument(candidate);
      if (validated.status !== "valid") throw new LocalizedError(readableDiagnostic(validated.diagnostics[0]));
      await assets.register(storageKey, file);
      if (!isCurrent()) throw new Error("保存时内容变了，没有做任何改动。");
      flushSync(() => history.commit((document) => document === base && generation === epoch.current ? candidate : document));
      committed = current.current.assets.some((item) => item.id === id);
      if (!committed) throw new Error("文件没能保存，内容没有改动。");
      epoch.current++;
    } finally {
      try { if (storageKey && !committed) await assets.unregister(storageKey); }
      finally { if (mounted.current) setApplying(false); }
    }
  }
  function upload(file: File, target: AssetTarget) {
    if (blocked) return;
    void attachFile(file, target).catch((cause) => setFeedback(errorMessage(cause, "文件没能保存，内容没有改动。"), "alert"));
  }
  function chooseFile(target: AssetTarget) {
    if (blocked) return;
    uploadTarget.current = { target, epoch: epoch.current };
    if (input.current) { input.current.accept = target.kind === "file" ? "" : "image/*"; input.current.click(); }
  }
  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
      const file = event.target.files?.[0]; event.target.value = "";
      const pending = uploadTarget.current; uploadTarget.current = undefined;
      if (!file || !pending) return;
      if (pending.epoch !== epoch.current) { setFeedback("选择文件期间，当前内容已更新。文件未添加，请重新选择添加位置和文件。", "alert"); return; }
      upload(file, pending.target);

  }
  return { input, attachFile, upload, chooseFile, onFileChange };
}
