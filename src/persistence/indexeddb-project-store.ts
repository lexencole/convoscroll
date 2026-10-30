import type { ConversationDocument } from "../data/conversation-types";
import { LocalizedError, message as msg } from "../i18n/messages";
import {
  createStoredProjectRecord,
  type ProjectStore,
  type StoredAssetRecord,
  type StoredProjectRecord,
} from "./project-store";

export const LOCAL_PROJECT_DB_NAME = "conversation-canvas";
export const LOCAL_PROJECT_DB_VERSION = 1;

const PROJECT_STORE = "projects";
const ASSET_STORE = "assets";

/**
 * An attachment as IndexedDB holds it. The bytes are stored instead of the Blob: Safari's
 * private windows cannot store a Blob or File in IndexedDB, but can store an ArrayBuffer.
 * Rows written before this change still hold `blob`.
 */
type StoredAssetRow = Omit<StoredAssetRecord, "blob"> & {
  readonly bytes?: ArrayBuffer;
  readonly blob?: Blob;
};

type StorageAction = "read" | "write";

/** Turns a storage failure into a message the page can show; the browser's error stays as the cause. */
function storageError(cause: unknown, action: StorageAction): Error {
  const quota = cause instanceof DOMException && cause.name === "QuotaExceededError";
  const message = quota
    ? "本机存储空间不够，请先导出项目备份，再重新导入以清理旧附件；也可释放设备空间后重试。"
    : action === "read"
      ? "浏览器没能读出本机保存的内容，刷新页面后再试。"
      : "保存失败，请重试；刷新或关闭页面可能丢失未保存的修改。";
  return new LocalizedError(msg(message), { cause });
}

async function toRow({ blob, ...asset }: StoredAssetRecord): Promise<StoredAssetRow> {
  return { ...asset, bytes: await blob.arrayBuffer() };
}

function fromRow({ bytes, blob, ...asset }: StoredAssetRow): StoredAssetRecord {
  return { ...asset, blob: blob ?? new Blob(bytes ? [bytes] : [], { type: asset.mimeType }) };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(storageError(request.error, "read"));
  });
}

function transactionComplete(transaction: IDBTransaction, action: StorageAction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    // A failed request reports its own error here first; the abort that follows has the same one.
    transaction.onerror = (event) => reject(storageError((event.target as IDBRequest | null)?.error ?? transaction.error, action));
    transaction.onabort = () => reject(storageError(transaction.error, action));
  });
}

function openDatabase(indexedDb: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDb.open(name, LOCAL_PROJECT_DB_VERSION);
    let settled = false;
    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(PROJECT_STORE)) {
        database.createObjectStore(PROJECT_STORE, { keyPath: "key" });
      }
      if (!database.objectStoreNames.contains(ASSET_STORE)) {
        database.createObjectStore(ASSET_STORE, { keyPath: "storageKey" });
      }
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        database.close();
        return;
      }
      settled = true;
      database.onversionchange = () => database.close();
      resolve(database);
    };
    request.onerror = () => rejectOnce(request.error ?? new LocalizedError(msg("无法打开本地项目数据库。")));
    request.onblocked = () => rejectOnce(new LocalizedError(msg("本地项目数据库正在被其他页面占用，请关闭旧页面后重试。")));
  });
}

export class IndexedDbProjectStore implements ProjectStore {
  constructor(
    private readonly indexedDb: IDBFactory = window.indexedDB,
    private readonly databaseName = LOCAL_PROJECT_DB_NAME,
  ) {}

  private open(): Promise<IDBDatabase> {
    return openDatabase(this.indexedDb, this.databaseName);
  }

  async loadCurrentProject(): Promise<StoredProjectRecord | undefined> {
    const database = await this.open();
    try {
      const transaction = database.transaction(PROJECT_STORE, "readonly");
      const result = await requestResult(
        transaction.objectStore(PROJECT_STORE).get("current") as IDBRequest<StoredProjectRecord | undefined>,
      );
      await transactionComplete(transaction, "read");
      return result;
    } finally {
      database.close();
    }
  }

  async saveDocument(document: ConversationDocument, savedAt: string): Promise<void> {
    const database = await this.open();
    try {
      const transaction = database.transaction(PROJECT_STORE, "readwrite");
      transaction.objectStore(PROJECT_STORE).put(createStoredProjectRecord(document, savedAt));
      await transactionComplete(transaction, "write");
    } finally {
      database.close();
    }
  }

  async putAsset(asset: StoredAssetRecord): Promise<void> {
    // Read the bytes first: a transaction commits as soon as it has nothing left to do.
    const row = await toRow(asset);
    const database = await this.open();
    try {
      const transaction = database.transaction(ASSET_STORE, "readwrite");
      transaction.objectStore(ASSET_STORE).put(row);
      await transactionComplete(transaction, "write");
    } finally {
      database.close();
    }
  }

  async getAsset(storageKey: string): Promise<StoredAssetRecord | undefined> {
    const database = await this.open();
    try {
      const transaction = database.transaction(ASSET_STORE, "readonly");
      const row = await requestResult(
        transaction.objectStore(ASSET_STORE).get(storageKey) as IDBRequest<StoredAssetRow | undefined>,
      );
      await transactionComplete(transaction, "read");
      return row ? fromRow(row) : undefined;
    } finally {
      database.close();
    }
  }

  async deleteAsset(storageKey: string): Promise<void> {
    const database = await this.open();
    try {
      const transaction = database.transaction(ASSET_STORE, "readwrite");
      transaction.objectStore(ASSET_STORE).delete(storageKey);
      await transactionComplete(transaction, "write");
    } finally {
      database.close();
    }
  }

  async replaceProject(
    document: ConversationDocument,
    assets: readonly StoredAssetRecord[],
    savedAt: string,
  ): Promise<void> {
    const rows = await Promise.all(assets.map(toRow));
    const database = await this.open();
    try {
      const transaction = database.transaction([PROJECT_STORE, ASSET_STORE], "readwrite");
      const assetStore = transaction.objectStore(ASSET_STORE);
      assetStore.clear();
      rows.forEach((row) => assetStore.put(row));
      transaction.objectStore(PROJECT_STORE).put(createStoredProjectRecord(document, savedAt));
      await transactionComplete(transaction, "write");
    } finally {
      database.close();
    }
  }
}
