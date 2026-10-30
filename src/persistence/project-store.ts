import type { ConversationDocument } from "../data/conversation-types";

export const LOCAL_PROJECT_STORAGE_VERSION = 1 as const;

export interface StoredProjectRecord {
  readonly key: "current";
  readonly storageVersion: typeof LOCAL_PROJECT_STORAGE_VERSION;
  readonly document: unknown;
  readonly savedAt: string;
}

export interface StoredAssetRecord {
  readonly storageKey: string;
  readonly blob: Blob;
  readonly fileName: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly savedAt: string;
}

export interface ProjectStore {
  loadCurrentProject(): Promise<StoredProjectRecord | undefined>;
  saveDocument(document: ConversationDocument, savedAt: string): Promise<void>;
  putAsset(asset: StoredAssetRecord): Promise<void>;
  getAsset(storageKey: string): Promise<StoredAssetRecord | undefined>;
  deleteAsset(storageKey: string): Promise<void>;
  replaceProject(
    document: ConversationDocument,
    assets: readonly StoredAssetRecord[],
    savedAt: string,
  ): Promise<void>;
}

export function createStoredProjectRecord(
  document: ConversationDocument,
  savedAt: string,
): StoredProjectRecord {
  return {
    key: "current",
    storageVersion: LOCAL_PROJECT_STORAGE_VERSION,
    document,
    savedAt,
  };
}

export class MemoryProjectStore implements ProjectStore {
  private project?: StoredProjectRecord;
  private readonly assets = new Map<string, StoredAssetRecord>();

  async loadCurrentProject(): Promise<StoredProjectRecord | undefined> {
    return this.project ? structuredClone(this.project) : undefined;
  }

  async saveDocument(document: ConversationDocument, savedAt: string): Promise<void> {
    this.project = structuredClone(createStoredProjectRecord(document, savedAt));
  }

  async putAsset(asset: StoredAssetRecord): Promise<void> {
    this.assets.set(asset.storageKey, cloneStoredAsset(asset));
  }

  async getAsset(storageKey: string): Promise<StoredAssetRecord | undefined> {
    const asset = this.assets.get(storageKey);
    return asset ? cloneStoredAsset(asset) : undefined;
  }

  async deleteAsset(storageKey: string): Promise<void> {
    this.assets.delete(storageKey);
  }

  async replaceProject(
    document: ConversationDocument,
    assets: readonly StoredAssetRecord[],
    savedAt: string,
  ): Promise<void> {
    const nextAssets = new Map<string, StoredAssetRecord>();
    assets.forEach((asset) => nextAssets.set(asset.storageKey, cloneStoredAsset(asset)));
    this.project = structuredClone(createStoredProjectRecord(document, savedAt));
    this.assets.clear();
    nextAssets.forEach((asset, key) => this.assets.set(key, asset));
  }
}

export class UnavailableProjectStore implements ProjectStore {
  private readonly error: Error;

  constructor(message = "当前浏览器无法保存本地项目，请更换浏览器后重试。") {
    this.error = new Error(message);
  }

  private unavailable(): Promise<never> {
    return Promise.reject(this.error);
  }

  loadCurrentProject(): Promise<StoredProjectRecord | undefined> {
    return this.unavailable();
  }

  saveDocument(_document: ConversationDocument, _savedAt: string): Promise<void> {
    return this.unavailable();
  }

  putAsset(_asset: StoredAssetRecord): Promise<void> {
    return this.unavailable();
  }

  getAsset(_storageKey: string): Promise<StoredAssetRecord | undefined> {
    return this.unavailable();
  }

  deleteAsset(_storageKey: string): Promise<void> {
    return this.unavailable();
  }

  replaceProject(
    _document: ConversationDocument,
    _assets: readonly StoredAssetRecord[],
    _savedAt: string,
  ): Promise<void> {
    return this.unavailable();
  }
}

function cloneStoredAsset(asset: StoredAssetRecord): StoredAssetRecord {
  return {
    ...asset,
    blob: asset.blob.slice(0, asset.blob.size, asset.blob.type),
  };
}
