import { createContext, useContext } from "react";
import type { CollapseState } from "../data/conversation-types";

// Saves an expand or collapse made with the arrow on the canvas into the document.
// Absent while exporting and in the command line, where the arrow is not used.
const Context = createContext<((blockId: string, displayState: CollapseState) => void) | undefined>(undefined);
export const TraceDisplayProvider = Context.Provider;
export const useTraceDisplay = () => useContext(Context);
