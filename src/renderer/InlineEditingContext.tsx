import { createContext, useContext, type ReactNode } from "react";
import type { ContentBlock } from "../data/conversation-types";

// Temporary editing views only. The provider must be removed before PNG capture.
type InlineBlockRenderer = (block: ContentBlock, rendered: ReactNode) => ReactNode;
const Context = createContext<InlineBlockRenderer | undefined>(undefined);
export const InlineEditingProvider = Context.Provider;
export const useInlineEditing = () => useContext(Context);
