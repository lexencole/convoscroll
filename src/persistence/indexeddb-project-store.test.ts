import { describe, expect, it, vi } from "vitest";
import type { ConversationDocument } from "../data/conversation-types";
import { IndexedDbProjectStore } from "./indexeddb-project-store";
import type { StoredAssetRecord } from "./project-store";

type Row = Record<string, unknown>;

/**
 * Just enough IndexedDB for the store. `rejectBlobs` behaves like Safari's private windows:
 * a put holding a Blob fails and aborts the transaction with an UnknownError.
 */
function fakeIndexedDb({ rejectBlobs = false, failure }: { rejectBlobs?: boolean; failure?: DOMException } = {}) {
  const tables = new Map<string, Map<string, Row>>([["projects", new Map()], ["assets", new Map()]]);
  const request = <T,>(result?: T) => {
    const value = { result, error: null, onsuccess: null as null | (() => void), onerror: null };
    queueMicrotask(() => value.onsuccess?.());
    return value;
  };
  const database = {
    objectStoreNames: { contains: () => true },
    close: vi.fn(),
    transaction: () => {
      let error: DOMException | undefined;
      const writes: Array<() => void> = [];
      const transaction = {
        error: null as DOMException | null,
        oncomplete: null as null | (() => void),
        onerror: null as null | ((event: { target: { error: DOMException } }) => void),
        onabort: null as null | (() => void),
        objectStore: (name: string) => {
          const table = tables.get(name)!;
          return {
            put: (row: Row) => {
              if (failure) error = failure;
              else if (rejectBlobs && Object.values(row).some((value) => value instanceof Blob)) {
                error = new DOMException("Error preparing Blob/File data to be stored in object store", "UnknownError");
              } else writes.push(() => table.set(String(row.key ?? row.storageKey), row));
              return request();
            },
            get: (key: string) => request(table.get(key)),
            delete: (key: string) => { writes.push(() => table.delete(key)); return request(); },
            clear: () => { writes.push(() => table.clear()); return request(); },
          };
        },
      };
      setTimeout(() => {
        if (!error) {
          writes.forEach((write) => write());
          transaction.oncomplete?.();
          return;
        }
        transaction.onerror?.({ target: { error } });
        transaction.error = error;
        transaction.onabort?.();
      });
      return transaction;
    },
  };
  const indexedDb = {
    open: () => {
      const opening = { result: database, error: null, onsuccess: null as null | (() => void), onupgradeneeded: null, onerror: null, onblocked: null };
      setTimeout(() => opening.onsuccess?.());
      return opening;
    },
  } as unknown as IDBFactory;
  return { indexedDb, tables };
}

const document = { schemaVersion: 1, id: "doc-test", messages: [], assets: [] } as unknown as ConversationDocument;

function asset(text: string, type = "text/plain"): StoredAssetRecord {
  const blob = new Blob([text], { type });
  return { storageKey: `key-${text}`, blob, fileName: `${text}.txt`, mimeType: type, byteSize: blob.size, savedAt: "2026-10-12T00:00:00.000Z" };
}

describe("IndexedDbProjectStore", () => {
  it("closes a connection that succeeds after an open request was already rejected as blocked", async () => {
    const close = vi.fn();
    const transaction = vi.fn();
    const database = { close, transaction } as unknown as IDBDatabase;
    const request = {
      error: null,
      onblocked: null,
      onerror: null,
      onsuccess: null,
      onupgradeneeded: null,
      result: database,
    } as unknown as IDBOpenDBRequest;
    const indexedDb = {
      open: vi.fn(() => request),
    } as unknown as IDBFactory;
    const store = new IndexedDbProjectStore(indexedDb, "late-success-test");

    const loading = store.loadCurrentProject();
    const rejection = expect(loading).rejects.toThrow("正在被其他页面占用");
    request.onblocked?.call(request, new Event("blocked") as IDBVersionChangeEvent);
    await rejection;

    request.onsuccess?.call(request, new Event("success"));

    expect(close).toHaveBeenCalledTimes(1);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("stores attachments as bytes, so a browser that cannot store Blobs still imports them", async () => {
    const { indexedDb, tables } = fakeIndexedDb({ rejectBlobs: true });
    const store = new IndexedDbProjectStore(indexedDb, "bytes-test");

    await store.replaceProject(document, [asset("海边", "text/markdown")], "2026-10-12T00:00:00.000Z");
    await store.putAsset(asset("贝壳"));

    const row = tables.get("assets")!.get("key-海边")!;
    expect(row.blob).toBeUndefined();
    expect(row.bytes).toBeInstanceOf(ArrayBuffer);
    const restored = await store.getAsset("key-海边");
    expect(restored?.blob.type).toBe("text/markdown");
    expect(await restored?.blob.text()).toBe("海边");
    expect(await (await store.getAsset("key-贝壳"))?.blob.text()).toBe("贝壳");
  });

  it("still reads attachments saved as Blobs before the change", async () => {
    const { indexedDb, tables } = fakeIndexedDb();
    const old = asset("旧图");
    tables.get("assets")!.set(old.storageKey, { ...old });
    const store = new IndexedDbProjectStore(indexedDb, "old-row-test");
    expect(await (await store.getAsset(old.storageKey))?.blob.text()).toBe("旧图");
  });

  it("explains a failed save in words instead of the browser's error", async () => {
    const full = new IndexedDbProjectStore(fakeIndexedDb({ failure: new DOMException("quota", "QuotaExceededError") }).indexedDb, "quota-test");
    await expect(full.replaceProject(document, [asset("大图")], "2026-10-12T00:00:00.000Z")).rejects.toThrow("本机存储空间不够，请先导出项目备份，再重新导入以清理旧附件；也可释放设备空间后重试。");
    const broken = new IndexedDbProjectStore(fakeIndexedDb({ failure: new DOMException("boom", "UnknownError") }).indexedDb, "unknown-test");
    const failed = broken.saveDocument(document, "2026-10-12T00:00:00.000Z");
    await expect(failed).rejects.toThrow("保存失败，请重试；刷新或关闭页面可能丢失未保存的修改。");
    await expect(failed).rejects.toHaveProperty("cause.name", "UnknownError");
  });
});
