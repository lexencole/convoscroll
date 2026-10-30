import { useUiText, useUiLocale } from "../i18n/LocaleContext";
import { useState } from "react";
import { IndexedDbProjectStore } from "../persistence/indexeddb-project-store";
import { UnavailableProjectStore, type ProjectStore } from "../persistence/project-store";
import { useProjectBootstrap } from "../persistence/use-local-project";
import { downloadBlob } from "../export/download-png";
import { serializeRecoveryRecord } from "../data/recovery-json";
import { sample } from "./sample-document";
import { Workbench } from "./Workbench";
import "../styles/inline-editor.css";

const defaultStore: ProjectStore = typeof window !== "undefined" && window.indexedDB ? new IndexedDbProjectStore(window.indexedDB) : new UnavailableProjectStore();

export function App({ store = defaultStore, showDevelopmentTools = import.meta.env.DEV }: { store?: ProjectStore; showDevelopmentTools?: boolean }) {
  const t = useUiText();
  const { locale } = useUiLocale();
  const [fallback] = useState(() => sample("basic", locale));
  const bootstrap = useProjectBootstrap(store, fallback);
  const [recoveryError, setRecoveryError] = useState<string>();
  function downloadRecovery(record: unknown) {
    setRecoveryError(undefined);
    let serialized: string;
    try {
      serialized = serializeRecoveryRecord(record);
    } catch {
      setRecoveryError("下载失败，记录无法完整转换为 JSON；本地记录未改动，请保留浏览器数据以便恢复");
      return;
    }
    try {
      downloadBlob(new Blob([serialized], { type: "application/json" }), "convoscroll-recovery.json");
    } catch {
      setRecoveryError("下载失败，浏览器未能保存恢复文件，请重试；本地记录未改动");
    }
  }
  if (bootstrap.state.status === "loading") return <main className="app-shell" aria-busy="true">{t("正在恢复本地项目…")}</main>;
  if (bootstrap.state.status === "error") {
    const failed = bootstrap.state;
    return <main className="app-shell"><h1>{t("无法读取本地项目，请重试")}</h1><p role="alert">{t(failed.message)}</p><button onClick={bootstrap.retry}>{t("再试一次")}</button>
      {failed.raw ? <><button onClick={() => downloadRecovery(failed.raw)}>{t("下载原始记录（含对话）")}</button>
        <button onClick={() => void bootstrap.replaceWithFallback()}>{t("放弃原内容，从示例开始")}</button></> : null}
      {recoveryError ? <p role="alert">{t(recoveryError)}</p> : null}</main>;
  }
  return <Workbench key={`${bootstrap.state.source}:${bootstrap.state.savedAt ?? "fallback"}`} initialDocument={bootstrap.state.document} initialSavedAt={bootstrap.state.savedAt} store={store} showDevelopmentTools={showDevelopmentTools} />;
}
