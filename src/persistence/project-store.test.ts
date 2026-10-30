import { describe, expect, it } from "vitest";
import { createEmptyDocument } from "../editor/document-operations";
import { MemoryProjectStore, UnavailableProjectStore } from "./project-store";

describe("MemoryProjectStore", () => {
  it("saves a document and binary asset without leaking mutable references", async () => {
    const store = new MemoryProjectStore();
    const document = createEmptyDocument(() => "document-local");
    const asset = {
      storageKey: "local:asset-1",
      blob: new Blob(["hello"], { type: "text/plain" }),
      fileName: "hello.txt",
      mimeType: "text/plain",
      byteSize: 5,
      savedAt: "2026-08-27T00:00:00.000Z",
    } as const;

    await store.putAsset(asset);
    await store.saveDocument(document, "2026-08-27T00:00:00.000Z");

    expect((await store.loadCurrentProject())?.document).toEqual(document);
    const restored = await store.getAsset(asset.storageKey);
    expect(restored?.blob.size).toBe(5);
    expect(restored?.blob.type).toBe("text/plain");

    await store.deleteAsset(asset.storageKey);
    expect(await store.getAsset(asset.storageKey)).toBeUndefined();
  });

  it("atomically replaces the current document and asset set", async () => {
    const store = new MemoryProjectStore();
    const first = createEmptyDocument(() => "document-first");
    const second = createEmptyDocument(() => "document-second");
    await store.putAsset({
      storageKey: "local:old",
      blob: new Blob(["old"]),
      fileName: "old.bin",
      mimeType: "application/octet-stream",
      byteSize: 3,
      savedAt: "2026-08-27T00:00:00.000Z",
    });

    await store.replaceProject(second, [{
      storageKey: "local:new",
      blob: new Blob(["new"]),
      fileName: "new.bin",
      mimeType: "application/octet-stream",
      byteSize: 3,
      savedAt: "2026-08-27T00:00:01.000Z",
    }], "2026-08-27T00:00:01.000Z");

    expect((await store.loadCurrentProject())?.document).toEqual(second);
    expect(await store.getAsset("local:old")).toBeUndefined();
    expect((await store.getAsset("local:new"))?.blob.size).toBe(3);
    expect(first.id).not.toBe(second.id);
  });
});

describe("UnavailableProjectStore", () => {
  it("reports that durable local storage is unavailable instead of silently using memory", async () => {
    const store = new UnavailableProjectStore();

    await expect(store.loadCurrentProject()).rejects.toThrow("当前浏览器无法保存本地项目");
    await expect(store.saveDocument(createEmptyDocument(), "2026-08-27T00:00:00.000Z"))
      .rejects.toThrow("当前浏览器无法保存本地项目");
  });
});
