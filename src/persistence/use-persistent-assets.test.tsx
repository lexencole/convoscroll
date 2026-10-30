import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationAsset, ConversationDocument } from "../data/conversation-types";
import { getFixture } from "../data/fixtures";
import type { ProjectStore, StoredAssetRecord } from "./project-store";
import { usePersistentAssets } from "./use-persistent-assets";

const asset: ConversationAsset = {
  id: "asset-local",
  kind: "image",
  fileName: "local.png",
  mimeType: "image/png",
  byteSize: 5,
  source: { kind: "local", storageKey: "local:asset-local" },
};

function basicDocument(): ConversationDocument {
  const fixture = getFixture("basic");
  if (fixture.status !== "valid") throw new Error("Basic fixture must be valid");
  return fixture.document;
}

function documentWithAssets(
  assets: readonly ConversationAsset[],
  id = "document-with-assets",
): ConversationDocument {
  return { ...basicDocument(), id, assets };
}

function storedAsset(blob: Blob): StoredAssetRecord {
  return {
    storageKey: "local:asset-local",
    blob,
    fileName: "local.png",
    mimeType: "image/png",
    byteSize: blob.size,
    savedAt: "2026-08-30T00:00:00.000Z",
  };
}

function mockStore(
  getAsset: ProjectStore["getAsset"],
): ProjectStore {
  return {
    loadCurrentProject: vi.fn(async () => undefined),
    saveDocument: vi.fn(async () => undefined),
    putAsset: vi.fn(async () => undefined),
    getAsset,
    deleteAsset: vi.fn(async () => undefined),
    replaceProject: vi.fn(async () => undefined),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

let createObjectUrl: ReturnType<typeof vi.fn<(blob: Blob) => string>>;
let revokeObjectUrl: ReturnType<typeof vi.fn<(url: string) => void>>;
let originalCreateObjectUrl: PropertyDescriptor | undefined;
let originalRevokeObjectUrl: PropertyDescriptor | undefined;

beforeEach(() => {
  originalCreateObjectUrl = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  originalRevokeObjectUrl = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  let sequence = 0;
  createObjectUrl = vi.fn(() => `blob:test-${++sequence}`);
  revokeObjectUrl = vi.fn();
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createObjectUrl });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeObjectUrl });
});

afterEach(() => {
  if (originalCreateObjectUrl) {
    Object.defineProperty(URL, "createObjectURL", originalCreateObjectUrl);
  } else {
    Reflect.deleteProperty(URL, "createObjectURL");
  }
  if (originalRevokeObjectUrl) {
    Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectUrl);
  } else {
    Reflect.deleteProperty(URL, "revokeObjectURL");
  }
});

describe("usePersistentAssets", () => {
  it("catches rejected reads and retries them after reload", async () => {
    const blob = new Blob(["retry"], { type: "image/png" });
    const getAsset = vi.fn<ProjectStore["getAsset"]>()
      .mockRejectedValueOnce(new Error("IndexedDB read failed"))
      .mockResolvedValueOnce(storedAsset(blob));
    const store = mockStore(getAsset);
    const { result } = renderHook(() => usePersistentAssets(
      store,
      documentWithAssets([asset]),
    ));

    await waitFor(() => expect(getAsset).toHaveBeenCalledTimes(1));
    expect(result.current.resolveAssetSource(asset)).toBeUndefined();

    act(() => result.current.reload());

    await waitFor(() => expect(result.current.resolveAssetSource(asset)).toBe("blob:test-1"));
    expect(getAsset).toHaveBeenCalledTimes(2);
  });

  it("keeps a new generation URL when an older read resolves late", async () => {
    const oldBlob = new Blob(["old"], { type: "image/png" });
    const newBlob = new Blob(["new"], { type: "image/png" });
    const oldRead = deferred<StoredAssetRecord | undefined>();
    const getAsset = vi.fn<ProjectStore["getAsset"]>()
      .mockImplementationOnce(() => oldRead.promise)
      .mockResolvedValueOnce(storedAsset(newBlob));
    createObjectUrl.mockImplementation((blob) => (
      blob === oldBlob ? "blob:old" : "blob:new"
    ));
    const store = mockStore(getAsset);
    const hook = renderHook(
      ({ document }) => usePersistentAssets(store, document),
      { initialProps: { document: documentWithAssets([asset], "old-project") } },
    );
    await waitFor(() => expect(getAsset).toHaveBeenCalledTimes(1));

    hook.rerender({ document: documentWithAssets([asset], "new-project") });
    await waitFor(() => expect(hook.result.current.resolveAssetSource(asset)).toBe("blob:new"));

    await act(async () => {
      oldRead.resolve(storedAsset(oldBlob));
      await oldRead.promise;
    });

    await waitFor(() => expect(revokeObjectUrl).toHaveBeenCalledWith("blob:old"));
    expect(hook.result.current.resolveAssetSource(asset)).toBe("blob:new");
    expect(revokeObjectUrl).not.toHaveBeenCalledWith("blob:new");
  });

  it("revokes replaced, expired, and unmounted active URLs", async () => {
    const loadedBlob = new Blob(["loaded"], { type: "image/png" });
    const reloadedBlob = new Blob(["reloaded"], { type: "image/png" });
    const replacement = new File(["replacement"], "replacement.png", { type: "image/png" });
    const getAsset = vi.fn<ProjectStore["getAsset"]>()
      .mockResolvedValueOnce(storedAsset(loadedBlob))
      .mockResolvedValueOnce(storedAsset(reloadedBlob));
    createObjectUrl.mockImplementation((blob) => {
      if (blob === loadedBlob) return "blob:loaded";
      if (blob === replacement) return "blob:replacement";
      return "blob:reloaded";
    });
    const store = mockStore(getAsset);
    const hook = renderHook(
      ({ document }) => usePersistentAssets(store, document),
      { initialProps: { document: documentWithAssets([asset]) } },
    );
    await waitFor(() => expect(hook.result.current.resolveAssetSource(asset)).toBe("blob:loaded"));

    await act(async () => hook.result.current.register("local:asset-local", replacement));
    expect(hook.result.current.resolveAssetSource(asset)).toBe("blob:replacement");
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:loaded");

    hook.rerender({ document: documentWithAssets([], "without-assets") });
    await waitFor(() => expect(revokeObjectUrl).toHaveBeenCalledWith("blob:replacement"));
    expect(hook.result.current.resolveAssetSource(asset)).toBeUndefined();

    hook.rerender({ document: documentWithAssets([asset], "assets-restored") });
    await waitFor(() => expect(hook.result.current.resolveAssetSource(asset)).toBe("blob:reloaded"));
    hook.unmount();
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:reloaded");
  });

  it("removes a registered Blob and its Object URL when an upload is rolled back", async () => {
    const replacement = new File(["temporary"], "temporary.png", { type: "image/png" });
    const store = mockStore(vi.fn(async () => undefined));
    const hook = renderHook(() => usePersistentAssets(store, documentWithAssets([])));

    await act(async () => hook.result.current.register("local:temporary", replacement));
    expect(createObjectUrl).toHaveBeenCalledWith(replacement);

    await act(async () => hook.result.current.unregister("local:temporary"));

    expect(store.deleteAsset).toHaveBeenCalledWith("local:temporary");
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:test-1");
  });

  it("revokes a URL created by a read that resolves after unmount", async () => {
    const blob = new Blob(["late"], { type: "image/png" });
    const read = deferred<StoredAssetRecord | undefined>();
    const store = mockStore(vi.fn(() => read.promise));
    const hook = renderHook(() => usePersistentAssets(store, documentWithAssets([asset])));
    hook.unmount();

    await act(async () => {
      read.resolve(storedAsset(blob));
      await read.promise;
    });

    await waitFor(() => expect(createObjectUrl).toHaveBeenCalledWith(blob));
    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:test-1");
  });
});
