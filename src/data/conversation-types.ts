export type JsonPrimitive = boolean | number | string | null;

import type { LocalizedText } from "../i18n/messages";

export type JsonValue =
  | JsonPrimitive
  | { readonly [key: string]: JsonValue }
  | readonly JsonValue[];

export type StableId = string;

export interface DocumentMetadata {
  readonly title?: string;
  readonly subtitle?: string;
  readonly locale?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export type CanvasSettings =
  | {
      readonly preset: "portrait";
      readonly width: 480;
      readonly scale: 3;
    }
  | {
      readonly preset: "wide";
      readonly width: 720;
      readonly scale: 2;
    };

export interface ThemeReference {
  readonly id: StableId;
}

export type MessageRole =
  | "user"
  | "assistant"
  | "system"
  | "developer"
  | "tool"
  | "unknown";

export type MessageStatus = "complete" | "streaming" | "error" | "cancelled";

export type ExecutionStatus =
  | "neutral"
  | "pending"
  | "running"
  | "success"
  | "error";

export type CollapseState = "collapsed" | "expanded";
export type ExportState = "current" | CollapseState;

interface BlockBase {
  readonly id: StableId;
}

export interface MarkdownBlock extends BlockBase {
  readonly type: "markdown";
  readonly source: string;
}

export interface ImageBlock extends BlockBase {
  readonly type: "image";
  readonly assetId: StableId;
  readonly alt?: string;
  readonly caption?: string;
  readonly width?: "small" | "medium" | "full";
}

export interface FileBlock extends BlockBase {
  readonly type: "file";
  readonly assetId: StableId;
  readonly label?: string;
}

export interface ReasoningBlock extends BlockBase {
  readonly type: "reasoning";
  readonly title?: string;
  readonly summary?: string;
  readonly source: string;
  readonly status?: ExecutionStatus;
  readonly durationMs?: number;
  readonly displayState: CollapseState;
  readonly exportState: ExportState;
}

export interface ToolCallBlock extends BlockBase {
  readonly type: "toolCall";
  readonly callId: StableId;
  readonly toolName: string;
  readonly summary?: string;
  readonly input: JsonValue;
  readonly status: ExecutionStatus;
  readonly durationMs?: number;
  readonly displayState: CollapseState;
  readonly exportState: ExportState;
}

export interface ToolResultBlock extends BlockBase {
  readonly type: "toolResult";
  readonly callId: StableId;
  readonly summary?: string;
  readonly output: JsonValue;
  readonly status: ExecutionStatus;
  readonly durationMs?: number;
  readonly displayState: CollapseState;
  readonly exportState: ExportState;
}

export interface UnsupportedBlock extends BlockBase {
  readonly type: "unsupported";
  readonly originalType: string;
  readonly reason?: string;
  readonly raw: JsonValue;
}

export type ContentBlock =
  | MarkdownBlock
  | ImageBlock
  | FileBlock
  | ReasoningBlock
  | ToolCallBlock
  | ToolResultBlock
  | UnsupportedBlock;

export interface ConversationMessage {
  readonly id: StableId;
  readonly role: MessageRole;
  readonly sourceRole?: string;
  readonly displayName?: string;
  readonly model?: string;
  readonly avatarAssetId?: StableId;
  readonly timestamp?: string;
  readonly status?: MessageStatus;
  readonly blocks: readonly ContentBlock[];
}

export type FixtureAssetSource = {
  readonly kind: "fixture";
  readonly path: string;
};

export type LocalAssetSource = {
  readonly kind: "local";
  readonly storageKey: string;
};

export interface ConversationAsset {
  readonly id: StableId;
  readonly kind: "image" | "file";
  readonly fileName: string;
  readonly mimeType: string;
  readonly byteSize?: number;
  readonly width?: number;
  readonly height?: number;
  readonly source: FixtureAssetSource | LocalAssetSource;
}

export interface ConversationDocument {
  readonly schemaVersion: 1;
  readonly id: StableId;
  readonly metadata: DocumentMetadata;
  readonly canvas: CanvasSettings;
  readonly theme: ThemeReference;
  readonly messages: readonly ConversationMessage[];
  readonly assets: readonly ConversationAsset[];
}

export interface DocumentDiagnostic {
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly messageText?: LocalizedText;
  readonly subject?: "image" | "file";
}

export type LoadedDocument =
  | {
      readonly status: "valid";
      readonly document: ConversationDocument;
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: "invalid";
      readonly title: string;
      readonly diagnostics: readonly DocumentDiagnostic[];
      readonly raw: unknown;
    };
