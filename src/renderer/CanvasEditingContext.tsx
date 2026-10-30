import { createContext, useContext, type ReactNode } from "react";
import type { ConversationMessage } from "../data/conversation-types";

// UI slots only: the entire provider is disabled for canonical rendering/export.
interface CanvasEditing {
  readonly documentTools: ReactNode;
  readonly documentTitle?: ReactNode;
  readonly messageTools: (message: ConversationMessage) => ReactNode;
  readonly messageFooter: (message: ConversationMessage) => ReactNode;
  readonly editIdentity: (message: ConversationMessage, trigger: HTMLElement) => void;
  readonly dropEdge: (messageId: string) => "before" | "after" | undefined;
}
const Context = createContext<CanvasEditing | undefined>(undefined);
export const CanvasEditingProvider = Context.Provider;
export const useCanvasEditing = () => useContext(Context);
