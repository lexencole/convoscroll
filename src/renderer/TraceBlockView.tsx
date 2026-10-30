import { useCanvasText } from "../i18n/LocaleContext";
import { useEffect, useState } from "react";
import type {
  ExecutionStatus,
  ReasoningBlock,
  ToolCallBlock,
  ToolResultBlock,
} from "../data/conversation-types";
import { MarkdownBody } from "./MarkdownBody";
import { resolveExportCollapseState, useExportPresentation } from "./ExportPresentationContext";
import { useTraceDisplay } from "./TraceDisplayContext";

type TraceBlock = ReasoningBlock | ToolCallBlock | ToolResultBlock;

interface TraceBlockViewProps {
  readonly block: TraceBlock;
  readonly relatedToolName?: string;
}

const kindLabels = {
  reasoning: "思考过程",
  toolCall: "工具调用",
  toolResult: "工具结果",
} as const;

/** Shown on the card; the settings offer the same words (editor-labels). */
export const traceStatusLabels: Record<ExecutionStatus, string> = {
  error: "失败",
  neutral: "记录",
  pending: "等待中",
  running: "进行中",
  success: "已完成",
};

function traceTitle(block: TraceBlock, unknownTool: string, relatedToolName?: string): string {
  if (block.type === "reasoning") return block.title ?? "Reasoning";
  if (block.type === "toolCall") return block.toolName;
  return relatedToolName ?? unknownTool;
}

export function TraceBlockView({ block, relatedToolName }: TraceBlockViewProps) {
  const t = useCanvasText();
  const [expanded, setExpanded] = useState(block.displayState === "expanded");
  const saveDisplay = useTraceDisplay();
  const exportPresentation = useExportPresentation();
  const contentId = `trace-${block.id}-content`;
  const status = block.status ?? "neutral";
  const technical = block.type !== "reasoning";
  const title = traceTitle(block, t("未知工具"), relatedToolName);
  const effectiveExpanded = resolveExportCollapseState(
    exportPresentation?.foldStrategy,
    block.exportState,
    expanded,
  ) === "expanded";

  useEffect(() => {
    setExpanded(block.displayState === "expanded");
  }, [block.id, block.displayState]);

  return (
    <section
      className={`trace-card trace-card--${status}`}
      data-kind={block.type}
      data-state={effectiveExpanded ? "expanded" : "collapsed"}
    >
      <button
        type="button"
        className="trace-card__toggle"
        aria-expanded={effectiveExpanded}
        aria-controls={contentId}
        disabled={Boolean(exportPresentation)}
        onClick={() => {
          const next = !expanded;
          setExpanded(next);
          saveDisplay?.(block.id, next ? "expanded" : "collapsed");
        }}
      >
        <span className="trace-card__chevron" aria-hidden="true">
          <svg viewBox="0 0 12 12" focusable="false">
            <path d="m4.25 2.5 3.5 3.5-3.5 3.5" />
          </svg>
        </span>
        <span className="trace-card__heading">
          <span className="trace-card__kind">{t(kindLabels[block.type])}</span>
          <strong className={technical ? "trace-card__title--technical" : "trace-card__title"}>
            {title}
          </strong>
        </span>
        <span className="trace-card__status">{t(traceStatusLabels[status])}</span>
      </button>
      {effectiveExpanded ? (
        <>
          {block.summary ? <p className="trace-card__summary">{block.summary}</p> : null}
          <div className="trace-card__content" id={contentId}>
            {block.type === "reasoning" ? (
              <MarkdownBody source={block.source} />
            ) : (
              <pre>{JSON.stringify(block.type === "toolCall" ? block.input : block.output, null, 2)}</pre>
            )}
          </div>
          {block.durationMs !== undefined ? (
            <div className="trace-card__meta"><span>{block.durationMs} ms</span></div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
