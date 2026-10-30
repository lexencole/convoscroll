import { useCallback, useReducer } from "react";
import type { ConversationDocument } from "../data/conversation-types";
import {
  createDocumentHistory,
  documentHistoryReducer,
  isDocumentDirty,
} from "./document-history";

export function useDocumentHistory(initialDocument: ConversationDocument) {
  const [state, dispatch] = useReducer(
    documentHistoryReducer,
    initialDocument,
    createDocumentHistory,
  );
  const dirty = isDocumentDirty(state);

  const commit = useCallback((
    update: (document: ConversationDocument) => ConversationDocument,
    groupKey?: string,
  ) => dispatch({ type: "commit", update, groupKey }), []);
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);
  const markSaved = useCallback((document: ConversationDocument) => {
    dispatch({ type: "markSaved", document });
  }, []);
  const replace = useCallback((document: ConversationDocument) => {
    dispatch({ type: "replace", document });
  }, []);

  return {
    document: state.present,
    dirty,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    diagnostic: state.diagnostic,
    commit,
    undo,
    redo,
    markSaved,
    replace,
  };
}
