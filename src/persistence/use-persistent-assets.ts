import { useCallback, useEffect, useRef, useState } from "react";
import type { ConversationAsset, ConversationDocument } from "../data/conversation-types";
import { resolveFixtureAsset } from "../data/fixtures";
import type { AssetSourceResolver } from "../renderer/ConversationCanvas";
import type { ProjectStore } from "./project-store";

export function usePersistentAssets(store: ProjectStore, document: ConversationDocument) {
  const objectUrls = useRef(new Map<string, string>());
  const loadingKeys = useRef(new Map<string, number>());
  const generation = useRef(0);
  const mounted = useRef(true);
  const [, setRevision] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);

  const setObjectUrl = useCallback((storageKey: string, blob: Blob, requestGeneration: number) => {
    const next = URL.createObjectURL(blob);
    if (!mounted.current || generation.current !== requestGeneration) {
      URL.revokeObjectURL(next);
      return;
    }

    const existing = objectUrls.current.get(storageKey);
    if (existing) URL.revokeObjectURL(existing);
    objectUrls.current.set(storageKey, next);
    setRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      loadingKeys.current.clear();
      objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
      objectUrls.current.clear();
    };
  }, []);

  useEffect(() => {
    const requestGeneration = generation.current + 1;
    generation.current = requestGeneration;
    loadingKeys.current.clear();

    const currentKeys = new Set(
      document.assets.flatMap((asset) => (
        asset.source.kind === "local" ? [asset.source.storageKey] : []
      )),
    );
    objectUrls.current.forEach((url, key) => {
      if (currentKeys.has(key)) return;
      URL.revokeObjectURL(url);
      objectUrls.current.delete(key);
    });

    document.assets.forEach((asset) => {
      if (asset.source.kind !== "local") return;
      const key = asset.source.storageKey;
      if (objectUrls.current.has(key) || loadingKeys.current.get(key) === requestGeneration) return;
      loadingKeys.current.set(key, requestGeneration);
      void Promise.resolve()
        .then(() => store.getAsset(key))
        .then((record) => {
          if (record) setObjectUrl(key, record.blob, requestGeneration);
        })
        .catch(() => undefined)
        .finally(() => {
          if (loadingKeys.current.get(key) === requestGeneration) {
            loadingKeys.current.delete(key);
          }
        });
    });

    return () => {
      if (generation.current === requestGeneration) generation.current += 1;
      loadingKeys.current.forEach((keyGeneration, key) => {
        if (keyGeneration === requestGeneration) loadingKeys.current.delete(key);
      });
    };
  }, [document.assets, reloadToken, setObjectUrl, store]);

  const register = useCallback(async (storageKey: string, file: File) => {
    const requestGeneration = generation.current;
    const savedAt = new Date().toISOString();
    await store.putAsset({
      storageKey,
      blob: file,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      byteSize: file.size,
      savedAt,
    });
    setObjectUrl(storageKey, file, requestGeneration);
  }, [setObjectUrl, store]);

  const unregister = useCallback(async (storageKey: string) => {
    const existing = objectUrls.current.get(storageKey);
    if (existing) {
      URL.revokeObjectURL(existing);
      objectUrls.current.delete(storageKey);
      if (mounted.current) setRevision((value) => value + 1);
    }
    await store.deleteAsset(storageKey);
  }, [store]);

  const resolveAssetSource = useCallback<AssetSourceResolver>((asset: ConversationAsset) => {
    if (asset.source.kind === "local") return objectUrls.current.get(asset.source.storageKey);
    return resolveFixtureAsset(asset);
  }, []);

  const resolveAssetBlob = useCallback(async (asset: ConversationAsset): Promise<Blob | undefined> => {
    if (asset.source.kind === "local") return (await store.getAsset(asset.source.storageKey))?.blob;
    const source = resolveFixtureAsset(asset);
    if (!source) return undefined;
    try {
      const response = await fetch(source);
      if (!response.ok) return undefined;
      return await response.blob();
    } catch {
      return undefined;
    }
  }, [store]);

  const reload = useCallback(() => {
    generation.current += 1;
    objectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.current.clear();
    loadingKeys.current.clear();
    setRevision((value) => value + 1);
    setReloadToken((value) => value + 1);
  }, []);

  return { register, unregister, resolveAssetSource, resolveAssetBlob, reload };
}
