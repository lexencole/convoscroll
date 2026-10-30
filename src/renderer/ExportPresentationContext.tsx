import { createContext, useContext, type ReactNode } from "react";
import type { CollapseState, ExportState } from "../data/conversation-types";
import type { ExportFoldStrategy } from "../export/export-types";

export interface ExportMessageSlice {
  readonly messageId: string;
  readonly blockIds?: readonly string[];
  readonly continuedFromPrevious?: boolean;
  readonly continuesToNext?: boolean;
}

export interface ExportPartPresentation {
  readonly index: number;
  readonly total: number;
  readonly messages: readonly ExportMessageSlice[];
}

export interface ExportPresentation {
  readonly width: 480 | 720;
  readonly foldStrategy: ExportFoldStrategy;
  readonly part?: ExportPartPresentation;
}

const PresentationContext = createContext<ExportPresentation | undefined>(undefined);

export function ExportPresentationProvider({
  children,
  value,
}: {
  readonly children: ReactNode;
  readonly value?: ExportPresentation;
}) {
  return <PresentationContext.Provider value={value}>{children}</PresentationContext.Provider>;
}

export function useExportPresentation() {
  return useContext(PresentationContext);
}

export function resolveExportCollapseState(
  strategy: ExportFoldStrategy | undefined,
  exportState: ExportState,
  previewExpanded: boolean,
): CollapseState {
  if (!strategy || strategy === "preview") return previewExpanded ? "expanded" : "collapsed";
  if (strategy === "collapsed" || strategy === "expanded") return strategy;
  if (exportState === "collapsed" || exportState === "expanded") return exportState;
  return previewExpanded ? "expanded" : "collapsed";
}
