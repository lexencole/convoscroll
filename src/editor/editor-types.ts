import type { ConversationDocument } from "../data/conversation-types";

export type DocumentCommit = (
  update: (document: ConversationDocument) => ConversationDocument,
  groupKey?: string,
) => void;
