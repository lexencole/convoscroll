import { message as msg, errorMessage, type LocalizedText } from "../i18n/messages";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ConversationDocument, DocumentDiagnostic } from "../data/conversation-types";
import { collectReferencedAssetIds } from "../data/document-assets";
import { diagnosticValue, loadConversationDocument } from "../data/document-loader";
import {
  LOCAL_PROJECT_STORAGE_VERSION,
  type ProjectStore,
  type StoredAssetRecord,
  type StoredProjectRecord,
} from "./project-store";

export type ProjectBootstrapState =
  | { readonly status: "loading" }
  | {
      readonly status: "ready";
      readonly document: ConversationDocument;
      readonly savedAt?: string;
      readonly source: "fallback" | "stored";
    }
  | {
      readonly status: "error";
      readonly message: LocalizedText;
      readonly diagnostics: readonly DocumentDiagnostic[];
      readonly raw?: StoredProjectRecord;
    };

async function normalizeReferencedLocalAssetByteSizes(
  document: ConversationDocument,
  store: Pick<ProjectStore, "getAsset">,
  isCancelled: () => boolean,
): Promise<ConversationDocument> {
  const referencedAssetIds = collectReferencedAssetIds(document);
  const actualByteSizes = new Map<string, number | undefined>();
  const sizesByStorageKey = new Map<string, number | undefined>();

  for (const asset of document.assets) {
    if (!referencedAssetIds.has(asset.id) || asset.source.kind !== "local") continue;
    if (isCancelled()) return document;

    const { storageKey } = asset.source;
    if (!sizesByStorageKey.has(storageKey)) {
      const storedAsset = await store.getAsset(storageKey);
      if (isCancelled()) return document;
      sizesByStorageKey.set(storageKey, storedAsset?.blob.size);
    }
    actualByteSizes.set(asset.id, sizesByStorageKey.get(storageKey));
  }

  let changed = false;
  const assets = document.assets.map((asset) => {
    if (!actualByteSizes.has(asset.id)) return asset;
    const actualByteSize = actualByteSizes.get(asset.id);
    if (asset.byteSize === actualByteSize) return asset;

    changed = true;
    if (actualByteSize === undefined) {
      const normalized = { ...asset };
      delete normalized.byteSize;
      return normalized;
    }
    return { ...asset, byteSize: actualByteSize };
  });

  return changed ? { ...document, assets } : document;
}

export function useProjectBootstrap(
  store: ProjectStore,
  fallbackDocument: ConversationDocument,
): {
  readonly state: ProjectBootstrapState;
  readonly retry: () => void;
  readonly replaceWithFallback: () => Promise<void>;
} {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ProjectBootstrapState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    void store.loadCurrentProject().then(async (record) => {
      if (cancelled) return;
      if (!record) {
        setState({ status: "ready", document: fallbackDocument, source: "fallback" });
        return;
      }
      if (record.storageVersion !== LOCAL_PROJECT_STORAGE_VERSION) {
        setState({
          status: "error",
          message: msg("保存的内容来自不支持的版本（{0}）。", diagnosticValue(record.storageVersion)),
          diagnostics: [],
          raw: record,
        });
        return;
      }
      const loaded = loadConversationDocument(record.document);
      if (loaded.status === "invalid") {
        setState({
          status: "error",
          message: "保存的内容损坏了，没有被覆盖。",
          diagnostics: loaded.diagnostics,
          raw: record,
        });
        return;
      }
      const document = await normalizeReferencedLocalAssetByteSizes(
        loaded.document,
        store,
        () => cancelled,
      );
      if (cancelled) return;
      setState({
        status: "ready",
        document,
        savedAt: record.savedAt,
        source: "stored",
      });
    }).catch((error: unknown) => {
      if (cancelled) return;
      setState({
        status: "error",
        message: errorMessage(error, "读不到保存的内容。"),
        diagnostics: [],
      });
    });
    return () => { cancelled = true; };
  }, [attempt, fallbackDocument, store]);

  const replaceWithFallback = useCallback(async () => {
    const savedAt = new Date().toISOString();
    try {
      await store.replaceProject(fallbackDocument, [], savedAt);
      setState({ status: "ready", document: fallbackDocument, savedAt, source: "stored" });
    } catch (error: unknown) {
      setState((current) => current.status === "error" ? {
        ...current,
        message: msg("没能换成示例：{0}", errorMessage(error, msg("保存失败。"))),
      } : current);
    }
  }, [fallbackDocument, store]);

  return {
    state,
    retry: () => setAttempt((value) => value + 1),
    replaceWithFallback,
  };
}

export type AutosaveStatus =
  | { readonly kind: "saved"; readonly savedAt?: string }
  | { readonly kind: "unsaved" }
  | { readonly kind: "saving" }
  | { readonly kind: "error"; readonly message: LocalizedText };

export function useProjectDepartureProtection({
  dirty,
  status,
}: {
  readonly dirty: boolean;
  readonly status: AutosaveStatus;
}) {
  const shouldProtect = dirty || status.kind !== "saved";

  useEffect(() => {
    if (!shouldProtect) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [shouldProtect]);
}

export function useProjectAutosave({
  document,
  dirty,
  initialSavedAt,
  store,
  markSaved,
  delayMs = 400,
}: {
  readonly document: ConversationDocument;
  readonly dirty: boolean;
  readonly initialSavedAt?: string;
  readonly store: ProjectStore;
  readonly markSaved: (document: ConversationDocument) => void;
  readonly delayMs?: number;
}): {
  readonly status: AutosaveStatus;
  readonly retry: () => void;
  readonly replaceProject: (
    document: ConversationDocument,
    assets: readonly StoredAssetRecord[],
  ) => Promise<string>;
} {
  const [status, setStatus] = useState<AutosaveStatus>({ kind: "saved", savedAt: initialSavedAt });
  const [retryToken, setRetryToken] = useState(0);
  const latestDocument = useRef(document);
  const latestDirty = useRef(dirty);
  const observedDocument = useRef(document);
  const lastWrittenDocument = useRef(document);
  const lastSavedAt = useRef(initialSavedAt);
  const mutationQueue = useRef<Promise<void>>(Promise.resolve());
  const pendingMutationCount = useRef(0);
  const generation = useRef(0);
  const correctionNeeded = useRef(false);
  const replacementPending = useRef(false);
  const mounted = useRef(true);

  if (observedDocument.current !== document) {
    observedDocument.current = document;
    latestDocument.current = document;
    generation.current += 1;
    correctionNeeded.current = correctionNeeded.current || pendingMutationCount.current > 0;
  } else {
    latestDocument.current = document;
  }
  latestDirty.current = dirty;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const appendMutation = useCallback(<Result,>(operation: () => Promise<Result>): Promise<Result> => {
    pendingMutationCount.current += 1;
    const result = mutationQueue.current.then(operation);
    mutationQueue.current = result.then(() => undefined, () => undefined);
    return result.finally(() => {
      pendingMutationCount.current -= 1;
    });
  }, []);

  const enqueueSave = useCallback((target: ConversationDocument, targetGeneration: number) => {
    if (mounted.current && generation.current === targetGeneration && !replacementPending.current) {
      setStatus({ kind: "saving" });
    }

    void appendMutation(async () => {
      if (generation.current !== targetGeneration || replacementPending.current) {
        return undefined;
      }
      const savedAt = new Date().toISOString();
      await store.saveDocument(target, savedAt);
      lastWrittenDocument.current = target;
      lastSavedAt.current = savedAt;
      return savedAt;
    }).then((savedAt) => {
      if (
        !savedAt
        || !mounted.current
        || generation.current !== targetGeneration
        || latestDocument.current !== target
        || replacementPending.current
      ) return;
      markSaved(target);
      setStatus({ kind: "saved", savedAt });
    }).catch((error: unknown) => {
      if (
        !mounted.current
        || generation.current !== targetGeneration
        || latestDocument.current !== target
        || replacementPending.current
      ) return;
      setStatus({
        kind: "error",
        message: errorMessage(error, "保存失败。"),
      });
    });
  }, [appendMutation, markSaved, store]);

  useEffect(() => {
    const targetGeneration = generation.current;
    if (!dirty) {
      if (
        !replacementPending.current
        && (correctionNeeded.current || lastWrittenDocument.current !== document)
      ) {
        correctionNeeded.current = false;
        enqueueSave(document, targetGeneration);
      } else if (
        !replacementPending.current
        && pendingMutationCount.current === 0
      ) {
        setStatus((current) => current.kind === "saved"
          ? current
          : { kind: "saved", savedAt: lastSavedAt.current });
      }
      return;
    }
    setStatus((current) => current.kind === "saving" ? current : { kind: "unsaved" });
    const target = document;
    const timeout = window.setTimeout(() => {
      enqueueSave(target, targetGeneration);
    }, delayMs);
    return () => window.clearTimeout(timeout);
  }, [delayMs, dirty, document, enqueueSave, retryToken]);

  const replaceProject = useCallback(async (
    replacement: ConversationDocument,
    assets: readonly StoredAssetRecord[],
  ): Promise<string> => {
    replacementPending.current = true;
    generation.current += 1;
    if (mounted.current) setStatus({ kind: "saving" });

    try {
      const savedAt = new Date().toISOString();
      await appendMutation(async () => {
        await store.replaceProject(replacement, assets, savedAt);
      });

      // The replacement becomes the coordinator's latest revision before the caller
      // updates React history. This invalidates saves queued while the transaction ran.
      generation.current += 1;
      observedDocument.current = replacement;
      latestDocument.current = replacement;
      lastWrittenDocument.current = replacement;
      lastSavedAt.current = savedAt;
      correctionNeeded.current = false;
      replacementPending.current = false;
      if (mounted.current) setStatus({ kind: "saved", savedAt });
      return savedAt;
    } catch (error) {
      replacementPending.current = false;
      generation.current += 1;
      const needsCorrection = latestDirty.current
        || lastWrittenDocument.current !== latestDocument.current;
      correctionNeeded.current = needsCorrection;
      if (mounted.current) {
        setStatus(needsCorrection
          ? { kind: "unsaved" }
          : { kind: "saved", savedAt: lastSavedAt.current });
        if (needsCorrection) {
          setRetryToken((value) => value + 1);
        }
      }
      throw error;
    }
  }, [appendMutation, store]);

  return {
    status,
    retry: () => setRetryToken((value) => value + 1),
    replaceProject,
  };
}
