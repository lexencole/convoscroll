import { useCanvasText } from "../i18n/LocaleContext";
import { useState } from "react";
import type { UnsupportedBlock } from "../data/conversation-types";

interface UnsupportedBlockViewProps {
  readonly block: UnsupportedBlock;
}

export function UnsupportedBlockView({ block }: UnsupportedBlockViewProps) {
  const t = useCanvasText();
  const [expanded, setExpanded] = useState(false);
  const contentId = `unsupported-${block.id}-raw`;

  return (
    <section className="unsupported-card" data-state={expanded ? "expanded" : "collapsed"}>
      <button
        type="button"
        className="unsupported-card__toggle"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="trace-card__chevron" aria-hidden="true">
          <svg viewBox="0 0 12 12" focusable="false">
            <path d="m4.25 2.5 3.5 3.5-3.5 3.5" />
          </svg>
        </span>
        <span>
          <small>{t("暂不支持")}</small>
          <strong>{block.originalType}</strong>
        </span>
        <em>{t("原内容已保留")}</em>
      </button>
      <p>{block.reason ?? t("这个版本还不支持这种内容。")}</p>
      {expanded ? <pre id={contentId}>{JSON.stringify(block.raw, null, 2)}</pre> : null}
    </section>
  );
}
