import type { ConversationDocument, DocumentDiagnostic } from "../data/conversation-types";
import { loadConversationDocument } from "../data/document-loader";

const HISTORY_LIMIT = 100;

export interface DocumentHistoryState {
  readonly baseline: ConversationDocument;
  readonly past: readonly ConversationDocument[];
  readonly present: ConversationDocument;
  readonly future: readonly ConversationDocument[];
  readonly groupKey?: string;
  readonly diagnostic?: DocumentDiagnostic;
}

export type DocumentHistoryAction =
  | {
      readonly type: "commit";
      readonly update: (document: ConversationDocument) => ConversationDocument;
      readonly groupKey?: string;
    }
  | { readonly type: "undo" }
  | { readonly type: "redo" }
  | { readonly type: "markSaved"; readonly document: ConversationDocument }
  | { readonly type: "replace"; readonly document: ConversationDocument };

export function createDocumentHistory(initial: ConversationDocument): DocumentHistoryState {
  return {
    baseline: initial,
    past: [],
    present: initial,
    future: [],
  };
}

export function documentHistoryReducer(
  state: DocumentHistoryState,
  action: DocumentHistoryAction,
): DocumentHistoryState {
  if (action.type === "markSaved") {
    if (state.present !== action.document) return state;
    return { ...state, baseline: action.document };
  }

  if (action.type === "replace") {
    const loaded = loadConversationDocument(action.document);
    if (loaded.status === "invalid") {
      return { ...state, diagnostic: loaded.diagnostics[0] };
    }
    return createDocumentHistory(loaded.document);
  }

  if (action.type === "undo") {
    const previous = state.past.at(-1);
    if (!previous) return state;
    return {
      ...state,
      past: state.past.slice(0, -1),
      present: previous,
      future: [state.present, ...state.future],
      groupKey: undefined,
      diagnostic: undefined,
    };
  }

  if (action.type === "redo") {
    const next = state.future[0];
    if (!next) return state;
    return {
      ...state,
      past: [...state.past, state.present].slice(-HISTORY_LIMIT),
      present: next,
      future: state.future.slice(1),
      groupKey: undefined,
      diagnostic: undefined,
    };
  }

  const candidate = action.update(state.present);
  if (candidate === state.present) return { ...state, diagnostic: undefined };
  const loaded = loadConversationDocument(candidate);
  if (loaded.status === "invalid") {
    return { ...state, diagnostic: loaded.diagnostics[0] };
  }

  if (action.groupKey && action.groupKey === state.groupKey) {
    return {
      ...state,
      present: loaded.document,
      future: [],
      diagnostic: undefined,
    };
  }

  return {
    ...state,
    past: [...state.past, state.present].slice(-HISTORY_LIMIT),
    present: loaded.document,
    future: [],
    groupKey: action.groupKey,
    diagnostic: undefined,
  };
}

export function isDocumentDirty(state: DocumentHistoryState): boolean {
  return state.present !== state.baseline;
}
