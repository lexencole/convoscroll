import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConversationAsset, ConversationDocument } from "../data/conversation-types";
import { getFixture } from "../data/fixtures";
import { assertCanAddLocalAsset, updateDocumentMetadata } from "../editor/document-operations";
import { MemoryProjectStore } from "./project-store";
import {
  useProjectAutosave,
  useProjectBootstrap,
  useProjectDepartureProtection,
  type AutosaveStatus,
} from "./use-local-project";

function basicDocument() {
  const fixture = getFixture("basic");
  if (fixture.status !== "valid") throw new Error("Basic fixture must be valid");
  return fixture.document;
}

function localAsset(
  id: string,
  storageKey: string,
  byteSize: number,
): ConversationAsset {
  return {
    id,
    kind: "file",
    fileName: `${id}.bin`,
    mimeType: "application/octet-stream",
    byteSize,
    source: { kind: "local", storageKey },
  };
}

function documentWithReferencedAssets(
  referencedAssets: readonly ConversationAsset[],
  unreferencedAssets: readonly ConversationAsset[] = [],
): ConversationDocument {
  const document = basicDocument();
  return {
    ...document,
    assets: [...referencedAssets, ...unreferencedAssets],
    messages: document.messages.map((message, index) => index === 0 ? {
      ...message,
      blocks: [
        ...message.blocks,
        ...referencedAssets.map((asset, assetIndex) => ({
          id: `block-bootstrap-${assetIndex}`,
          type: "file" as const,
          assetId: asset.id,
        })),
      ],
    } : message),
  };
}

afterEach(() => vi.useRealTimers());

describe("local project lifecycle", () => {
  it("keeps the original record when its version cannot be coerced or its JSON is too deep", async () => {
    const fallback = basicDocument();
    const deepDocument = {
      ...fallback,
      messages: [{ ...fallback.messages[0], blocks: [{
        id: "deep", type: "unsupported", originalType: "opaque",
        raw: JSON.parse("[".repeat(8000) + "0" + "]".repeat(8000)),
      }] }],
    };
    for (const record of [
      { key: "current", storageVersion: { toString: null, valueOf: null }, document: fallback },
      { key: "current", storageVersion: 1, document: deepDocument },
    ]) {
      const store = new MemoryProjectStore();
      Object.defineProperty(store, "loadCurrentProject", { value: async () => record });
      const save = vi.spyOn(store, "saveDocument");
      const replace = vi.spyOn(store, "replaceProject");
      const hook = renderHook(() => useProjectBootstrap(store, fallback));
      await waitFor(() => expect(hook.result.current.state.status).toBe("error"));
      const state = hook.result.current.state;
      if (state.status !== "error") throw new Error("Expected recoverable error");
      expect(state.raw).toBe(record);
      expect(() => JSON.stringify({ message: state.message, diagnostics: state.diagnostics })).not.toThrow();
      expect(save).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
      hook.unmount();
    }
  });

  it("uses the fallback only when no stored project exists", async () => {
    const store = new MemoryProjectStore();
    const fallback = basicDocument();
    const { result } = renderHook(() => useProjectBootstrap(store, fallback));

    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(result.current.state).toMatchObject({ source: "fallback", document: fallback });
  });

  it("restores a valid stored document and reports a corrupt one without overwriting it", async () => {
    const validStore = new MemoryProjectStore();
    const fallback = basicDocument();
    const stored = updateDocumentMetadata(basicDocument(), { title: "已恢复" });
    await validStore.saveDocument(stored, "2026-08-27T01:00:00.000Z");
    const valid = renderHook(() => useProjectBootstrap(validStore, fallback));
    await waitFor(() => expect(valid.result.current.state.status).toBe("ready"));
    expect(valid.result.current.state).toMatchObject({ source: "stored", document: stored });
    valid.unmount();

    const corruptStore = new MemoryProjectStore();
    await corruptStore.saveDocument(basicDocument(), "2026-08-27T01:00:00.000Z");
    const record = await corruptStore.loadCurrentProject();
    if (!record) throw new Error("Expected record");
    Object.defineProperty(corruptStore, "loadCurrentProject", {
      value: async () => ({ ...record, document: { schemaVersion: 1 } }),
    });
    const corrupt = renderHook(() => useProjectBootstrap(corruptStore, fallback));
    await waitFor(() => expect(corrupt.result.current.state.status).toBe("error"));
    expect(corrupt.result.current.state).toMatchObject({ status: "error", raw: expect.any(Object) });
  });

  it("normalizes referenced local asset metadata from Blob.size before becoming ready", async () => {
    const store = new MemoryProjectStore();
    const referencedLocal = localAsset("asset-bootstrap-local", "local:bootstrap", 1);
    const emptyLocal = localAsset("asset-bootstrap-empty", "local:empty", 9);
    const referencedFixture: ConversationAsset = {
      id: "asset-bootstrap-fixture",
      kind: "file",
      fileName: "fixture.bin",
      mimeType: "application/octet-stream",
      byteSize: 23,
      source: { kind: "fixture", path: "fixtures/assets/fixture.bin" },
    };
    const unreferencedLocal = localAsset("asset-bootstrap-orphan", "local:orphan", 7);
    const stored = documentWithReferencedAssets(
      [referencedLocal, emptyLocal, referencedFixture],
      [unreferencedLocal],
    );
    const blob = new Blob(["actual blob bytes"], { type: "application/octet-stream" });
    await store.saveDocument(stored, "2026-08-30T01:00:00.000Z");
    await store.putAsset({
      storageKey: "local:bootstrap",
      blob,
      fileName: referencedLocal.fileName,
      mimeType: referencedLocal.mimeType,
      byteSize: 2,
      savedAt: "2026-08-30T01:00:00.000Z",
    });
    await store.putAsset({
      storageKey: "local:empty",
      blob: new Blob(),
      fileName: emptyLocal.fileName,
      mimeType: emptyLocal.mimeType,
      byteSize: 99,
      savedAt: "2026-08-30T01:00:00.000Z",
    });
    const saveDocument = vi.spyOn(store, "saveDocument");
    const putAsset = vi.spyOn(store, "putAsset");
    const replaceProject = vi.spyOn(store, "replaceProject");
    const getAsset = vi.spyOn(store, "getAsset");

    const hook = renderHook(() => useProjectBootstrap(store, basicDocument()));

    await waitFor(() => expect(hook.result.current.state.status).toBe("ready"));
    const state = hook.result.current.state;
    if (state.status !== "ready") throw new Error("Expected ready state");
    expect(state.document.assets).toEqual([
      { ...referencedLocal, byteSize: blob.size },
      { ...emptyLocal, byteSize: 0 },
      referencedFixture,
      unreferencedLocal,
    ]);
    expect(getAsset.mock.calls).toEqual([["local:bootstrap"], ["local:empty"]]);
    expect(saveDocument).not.toHaveBeenCalled();
    expect(putAsset).not.toHaveBeenCalled();
    expect(replaceProject).not.toHaveBeenCalled();
    expect((await store.loadCurrentProject())?.document).toEqual(stored);
  });

  it("marks a referenced local asset with a missing Blob as unknown and blocks new attachments", async () => {
    const store = new MemoryProjectStore();
    const referencedLocal = localAsset("asset-bootstrap-missing", "local:missing", 4);
    const stored = documentWithReferencedAssets([referencedLocal]);
    await store.saveDocument(stored, "2026-08-30T01:00:00.000Z");
    const saveDocument = vi.spyOn(store, "saveDocument");
    const putAsset = vi.spyOn(store, "putAsset");
    const replaceProject = vi.spyOn(store, "replaceProject");

    const hook = renderHook(() => useProjectBootstrap(store, basicDocument()));

    await waitFor(() => expect(hook.result.current.state.status).toBe("ready"));
    const state = hook.result.current.state;
    if (state.status !== "ready") throw new Error("Expected ready state");
    expect(state.document.assets[0]).not.toHaveProperty("byteSize");
    let addError: unknown;
    try {
      assertCanAddLocalAsset(state.document, { fileName: "next.bin", byteSize: 1 });
    } catch (error: unknown) {
      addError = error;
    }
    expect(addError).toMatchObject({ code: "UNKNOWN_ASSET_SIZE", path: "assets" });
    expect(saveDocument).not.toHaveBeenCalled();
    expect(putAsset).not.toHaveBeenCalled();
    expect(replaceProject).not.toHaveBeenCalled();
    expect((await store.loadCurrentProject())?.document).toEqual(stored);
  });

  it("reads referenced local assets sequentially before exposing ready state", async () => {
    const store = new MemoryProjectStore();
    const first = localAsset("asset-bootstrap-first", "local:first", 1);
    const second = localAsset("asset-bootstrap-second", "local:second", 1);
    await store.saveDocument(
      documentWithReferencedAssets([first, second]),
      "2026-08-30T01:00:00.000Z",
    );
    let releaseFirst: (() => void) | undefined;
    const getAsset = vi.spyOn(store, "getAsset")
      .mockImplementationOnce(() => new Promise((resolve) => {
        releaseFirst = () => resolve({
          storageKey: "local:first",
          blob: new Blob(["first"]),
          fileName: first.fileName,
          mimeType: first.mimeType,
          byteSize: 1,
          savedAt: "2026-08-30T01:00:00.000Z",
        });
      }))
      .mockResolvedValueOnce({
        storageKey: "local:second",
        blob: new Blob(["second"]),
        fileName: second.fileName,
        mimeType: second.mimeType,
        byteSize: 1,
        savedAt: "2026-08-30T01:00:00.000Z",
      });

    const hook = renderHook(() => useProjectBootstrap(store, basicDocument()));

    await waitFor(() => expect(getAsset).toHaveBeenCalledTimes(1));
    expect(hook.result.current.state.status).toBe("loading");
    await act(async () => {
      releaseFirst?.();
      await Promise.resolve();
    });
    await waitFor(() => expect(hook.result.current.state.status).toBe("ready"));
    expect(getAsset.mock.calls).toEqual([["local:first"], ["local:second"]]);
  });

  it("surfaces a referenced local asset read failure instead of treating it as missing", async () => {
    const store = new MemoryProjectStore();
    await store.saveDocument(
      documentWithReferencedAssets([
        localAsset("asset-bootstrap-read-error", "local:read-error", 1),
      ]),
      "2026-08-30T01:00:00.000Z",
    );
    vi.spyOn(store, "getAsset").mockRejectedValueOnce(new Error("asset read failed"));

    const hook = renderHook(() => useProjectBootstrap(store, basicDocument()));

    await waitFor(() => expect(hook.result.current.state.status).toBe("error"));
    expect(hook.result.current.state).toEqual({
      status: "error",
      message: "asset read failed",
      diagnostics: [],
    });
  });

  it("keeps a corrupt-project recovery failure inside the recovery screen", async () => {
    class RecoveryFailingStore extends MemoryProjectStore {
      override async replaceProject(): Promise<void> {
        throw new Error("quota full");
      }
    }
    const store = new RecoveryFailingStore();
    await store.saveDocument(basicDocument(), "2026-08-27T01:00:00.000Z");
    const record = await store.loadCurrentProject();
    if (!record) throw new Error("Expected record");
    Object.defineProperty(store, "loadCurrentProject", {
      value: async () => ({ ...record, document: { schemaVersion: 1 } }),
    });
    const fallback = basicDocument();
    const hook = renderHook(() => useProjectBootstrap(store, fallback));
    await waitFor(() => expect(hook.result.current.state.status).toBe("error"));

    await act(async () => {
      await hook.result.current.replaceWithFallback();
    });

    expect(hook.result.current.state).toMatchObject({
      status: "error",
      message: { key: "没能换成示例：{0}", values: ["quota full"] },
      raw: expect.any(Object),
    });
  });

  it("debounces a valid document save and marks exactly that revision as saved", async () => {
    vi.useFakeTimers();
    const store = new MemoryProjectStore();
    const markSaved = vi.fn();
    const document = updateDocumentMetadata(basicDocument(), { title: "自动保存" });
    const { result } = renderHook(() => useProjectAutosave({
      document,
      dirty: true,
      store,
      markSaved,
      delayMs: 20,
    }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(markSaved).toHaveBeenCalledWith(document);
    expect(result.current.status.kind).toBe("saved");
    expect((await store.loadCurrentProject())?.document).toEqual(document);
  });

  it("keeps the document unsaved and exposes retry when persistence fails", async () => {
    vi.useFakeTimers();
    const store = new MemoryProjectStore();
    const failure = vi.spyOn(store, "saveDocument").mockRejectedValueOnce(new Error("quota full"));
    const document = updateDocumentMetadata(basicDocument(), { title: "失败" });
    const markSaved = vi.fn();
    const { result } = renderHook(() => useProjectAutosave({
      document,
      dirty: true,
      store,
      markSaved,
      delayMs: 10,
    }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(result.current.status).toEqual({ kind: "error", message: "quota full" });

    failure.mockRestore();
    act(() => result.current.retry());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(result.current.status.kind).toBe("saved");
  });

  it("returns to the persisted baseline after a failed edit is undone and releases departure protection", async () => {
    vi.useFakeTimers();
    const initialSavedAt = "2026-08-30T01:00:00.000Z";
    const store = new MemoryProjectStore();
    const baseline = updateDocumentMetadata(basicDocument(), { title: "已持久化 B" });
    const edited = updateDocumentMetadata(baseline, { title: "保存失败 A" });
    const markSaved = vi.fn();
    await store.saveDocument(baseline, initialSavedAt);
    vi.spyOn(store, "saveDocument").mockRejectedValueOnce(new Error("quota full"));

    const hook = renderHook(({ document, dirty }) => {
      const autosave = useProjectAutosave({
        document,
        dirty,
        initialSavedAt,
        store,
        markSaved,
        delayMs: 10,
      });
      useProjectDepartureProtection({ dirty, status: autosave.status });
      return autosave;
    }, { initialProps: { document: baseline, dirty: false } });

    hook.rerender({ document: edited, dirty: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(hook.result.current.status).toEqual({ kind: "error", message: "quota full" });
    const failedDeparture = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(failedDeparture);
    expect(failedDeparture.defaultPrevented).toBe(true);

    hook.rerender({ document: baseline, dirty: false });
    expect(hook.result.current.status).toEqual({
      kind: "saved",
      savedAt: initialSavedAt,
    });
    const restoredDeparture = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(restoredDeparture);

    expect(restoredDeparture.defaultPrevented).toBe(false);
    expect(markSaved).not.toHaveBeenCalled();
    expect((await store.loadCurrentProject())?.document).toEqual(baseline);
  });

  it("restores the previous saved status when project replacement fails without local edits", async () => {
    const initialSavedAt = "2026-08-30T01:00:00.000Z";
    const store = new MemoryProjectStore();
    const saveDocument = vi.spyOn(store, "saveDocument");
    vi.spyOn(store, "replaceProject").mockRejectedValueOnce(new Error("quota full"));
    const document = basicDocument();
    const replacement = updateDocumentMetadata(document, { title: "未导入项目" });
    const hook = renderHook(() => useProjectAutosave({
      document,
      dirty: false,
      initialSavedAt,
      store,
      markSaved: vi.fn(),
      delayMs: 10,
    }));

    await act(async () => {
      await expect(hook.result.current.replaceProject(replacement, []))
        .rejects.toThrow("quota full");
    });

    expect(hook.result.current.status).toEqual({ kind: "saved", savedAt: initialSavedAt });
    expect(saveDocument).not.toHaveBeenCalled();
  });

  it("returns to unsaved and retries the current document when project replacement fails", async () => {
    vi.useFakeTimers();
    const store = new MemoryProjectStore();
    vi.spyOn(store, "replaceProject").mockRejectedValueOnce(new Error("quota full"));
    const document = updateDocumentMetadata(basicDocument(), { title: "待保存修改" });
    const replacement = updateDocumentMetadata(document, { title: "未导入项目" });
    const markSaved = vi.fn();
    const hook = renderHook(() => useProjectAutosave({
      document,
      dirty: true,
      store,
      markSaved,
      delayMs: 10,
    }));

    await act(async () => {
      await expect(hook.result.current.replaceProject(replacement, []))
        .rejects.toThrow("quota full");
    });
    expect(hook.result.current.status).toEqual({ kind: "unsaved" });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(hook.result.current.status.kind).toBe("saved");
    expect(markSaved).toHaveBeenCalledWith(document);
    expect((await store.loadCurrentProject())?.document).toEqual(document);
  });

  it("serializes writes and never marks an older revision as the saved baseline", async () => {
    vi.useFakeTimers();
    let releaseFirst: (() => void) | undefined;
    class DeferredStore extends MemoryProjectStore {
      readonly savedTitles: string[] = [];

      override async saveDocument(document: ReturnType<typeof basicDocument>, savedAt: string): Promise<void> {
        this.savedTitles.push(document.metadata.title ?? "");
        if (this.savedTitles.length === 1) {
          await new Promise<void>((resolve) => { releaseFirst = resolve; });
        }
        await super.saveDocument(document, savedAt);
      }
    }
    const store = new DeferredStore();
    const first = updateDocumentMetadata(basicDocument(), { title: "旧版本" });
    const second = updateDocumentMetadata(first, { title: "新版本" });
    const markSaved = vi.fn();
    const hook = renderHook(({ document }) => useProjectAutosave({
      document,
      dirty: true,
      store,
      markSaved,
      delayMs: 10,
    }), { initialProps: { document: first } });

    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(store.savedTitles).toEqual(["旧版本"]);
    hook.rerender({ document: second });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(store.savedTitles).toEqual(["旧版本"]);

    await act(async () => {
      releaseFirst?.();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(store.savedTitles).toEqual(["旧版本", "新版本"]);
    expect(markSaved).toHaveBeenCalledTimes(1);
    expect(markSaved).toHaveBeenCalledWith(second);
    expect((await store.loadCurrentProject())?.document).toEqual(second);
  });

  it("writes the latest Undo state after an older save has already started", async () => {
    vi.useFakeTimers();
    let releaseFirst: (() => void) | undefined;
    class DeferredStore extends MemoryProjectStore {
      readonly savedTitles: string[] = [];
      private resolveSecondSave: (() => void) | undefined;
      readonly secondSave = new Promise<void>((resolve) => { this.resolveSecondSave = resolve; });

      override async saveDocument(document: ReturnType<typeof basicDocument>, savedAt: string): Promise<void> {
        this.savedTitles.push(document.metadata.title ?? "");
        if (this.savedTitles.length === 1) {
          await new Promise<void>((resolve) => { releaseFirst = resolve; });
        }
        await super.saveDocument(document, savedAt);
        if (this.savedTitles.length === 2) this.resolveSecondSave?.();
      }
    }
    const store = new DeferredStore();
    const baseline = updateDocumentMetadata(basicDocument(), { title: "已保存基线" });
    const edited = updateDocumentMetadata(baseline, { title: "待撤销修改" });
    const markSaved = vi.fn();
    const hook = renderHook(({ document, dirty }) => useProjectAutosave({
      document,
      dirty,
      store,
      markSaved,
      delayMs: 10,
    }), { initialProps: { document: edited, dirty: true } });

    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(store.savedTitles).toEqual(["待撤销修改"]);

    hook.rerender({ document: baseline, dirty: false });
    await act(async () => {
      releaseFirst?.();
      await store.secondSave;
    });

    expect(store.savedTitles).toEqual(["待撤销修改", "已保存基线"]);
    expect((await store.loadCurrentProject())?.document).toEqual(baseline);
    expect(markSaved).toHaveBeenCalledWith(baseline);
  });

  it("finishes a queued Undo correction after unmount so reload restores the latest state", async () => {
    let releaseEditedSave: (() => void) | undefined;
    class DeferredStore extends MemoryProjectStore {
      readonly savedTitles: string[] = [];
      private resolveCorrection: (() => void) | undefined;
      readonly correctionSaved = new Promise<void>((resolve) => {
        this.resolveCorrection = resolve;
      });

      async seed(document: ReturnType<typeof basicDocument>): Promise<void> {
        await super.saveDocument(document, "2026-08-30T01:00:00.000Z");
      }

      override async saveDocument(document: ReturnType<typeof basicDocument>, savedAt: string): Promise<void> {
        this.savedTitles.push(document.metadata.title ?? "");
        if (this.savedTitles.length === 1) {
          await new Promise<void>((resolve) => { releaseEditedSave = resolve; });
        }
        await super.saveDocument(document, savedAt);
        if (this.savedTitles.length === 2) this.resolveCorrection?.();
      }
    }
    const store = new DeferredStore();
    const baseline = updateDocumentMetadata(basicDocument(), { title: "已持久化 B" });
    const edited = updateDocumentMetadata(baseline, { title: "在途编辑 A" });
    const markSaved = vi.fn();
    await store.seed(baseline);

    const hook = renderHook(({ document, dirty }) => useProjectAutosave({
      document,
      dirty,
      initialSavedAt: "2026-08-30T01:00:00.000Z",
      store,
      markSaved,
      delayMs: 0,
    }), { initialProps: { document: baseline, dirty: false } });

    hook.rerender({ document: edited, dirty: true });
    await waitFor(() => expect(store.savedTitles).toEqual(["在途编辑 A"]));

    hook.rerender({ document: baseline, dirty: false });
    hook.unmount();
    await act(async () => {
      releaseEditedSave?.();
      await store.correctionSaved;
    });

    expect(store.savedTitles).toEqual(["在途编辑 A", "已持久化 B"]);
    expect((await store.loadCurrentProject())?.document).toEqual(baseline);
  });

  it.each<{
    name: string;
    dirty: boolean;
    status: AutosaveStatus;
    shouldPrevent: boolean;
  }>([
    { name: "clean saved state", dirty: false, status: { kind: "saved" }, shouldPrevent: false },
    { name: "dirty revision before status catches up", dirty: true, status: { kind: "saved" }, shouldPrevent: true },
    { name: "debounced unsaved state", dirty: false, status: { kind: "unsaved" }, shouldPrevent: true },
    { name: "save or corrective write in progress", dirty: false, status: { kind: "saving" }, shouldPrevent: true },
    { name: "failed persistence", dirty: false, status: { kind: "error", message: "quota" }, shouldPrevent: true },
  ])("protects departure for $name: $shouldPrevent", ({ dirty, status, shouldPrevent }) => {
    const hook = renderHook(({ nextDirty, nextStatus }) => useProjectDepartureProtection({
      dirty: nextDirty,
      status: nextStatus,
    }), { initialProps: { nextDirty: dirty, nextStatus: status } });
    const event = new Event("beforeunload", { cancelable: true });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(shouldPrevent);
    hook.unmount();
  });

  it("lets an imported replacement win over an in-flight and a queued autosave", async () => {
    vi.useFakeTimers();
    let releaseFirst: (() => void) | undefined;
    class DeferredStore extends MemoryProjectStore {
      readonly savedTitles: string[] = [];
      readonly replacementTitles: string[] = [];

      override async saveDocument(document: ReturnType<typeof basicDocument>, savedAt: string): Promise<void> {
        this.savedTitles.push(document.metadata.title ?? "");
        if (this.savedTitles.length === 1) {
          await new Promise<void>((resolve) => { releaseFirst = resolve; });
        }
        await super.saveDocument(document, savedAt);
      }

      override async replaceProject(
        document: ReturnType<typeof basicDocument>,
        assets: Parameters<MemoryProjectStore["replaceProject"]>[1],
        savedAt: string,
      ): Promise<void> {
        this.replacementTitles.push(document.metadata.title ?? "");
        await super.replaceProject(document, assets, savedAt);
      }
    }
    const store = new DeferredStore();
    const first = updateDocumentMetadata(basicDocument(), { title: "在途旧保存" });
    const queued = updateDocumentMetadata(first, { title: "排队旧保存" });
    const editedDuringImport = updateDocumentMetadata(first, { title: "导入期间的编辑" });
    const imported = updateDocumentMetadata(first, { title: "导入项目" });
    const markSaved = vi.fn();
    const hook = renderHook(({ document }) => useProjectAutosave({
      document,
      dirty: true,
      store,
      markSaved,
      delayMs: 10,
    }), { initialProps: { document: first } });

    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    hook.rerender({ document: queued });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });

    let replacement: Promise<string> | undefined;
    act(() => {
      replacement = hook.result.current.replaceProject(imported, []);
    });
    hook.rerender({ document: editedDuringImport });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    await act(async () => {
      releaseFirst?.();
      await replacement;
    });

    expect(store.savedTitles).toEqual(["在途旧保存"]);
    expect(store.replacementTitles).toEqual(["导入项目"]);
    expect((await store.loadCurrentProject())?.document).toEqual(imported);
    expect(hook.result.current.status.kind).toBe("saved");
  });
});
