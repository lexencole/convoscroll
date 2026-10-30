import { useCanvasText, useUiText } from "../i18n/LocaleContext";
import { Children, createContext, isValidElement, type ComponentPropsWithoutRef, type ReactNode, useContext, useEffect, useRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { keepLineEnd } from "./keep-line-end";
import { attachMathMetadata, captureMathMetadata } from "./math-metadata";
import { measureMathOverflow } from "./math-overflow";
import { ShikiCodeBlock } from "./ShikiCodeBlock";
import { wrapTaskListText } from "./task-list-text";
import { emptyTaskItems } from "./empty-task-items";

interface MarkdownBodyProps {
  readonly source: string;
  readonly onTaskToggle?: (index: number) => void;
}

const TaskToggleContext = createContext<MarkdownBodyProps["onTaskToggle"]>(undefined);

function SafeLink({ children, ...props }: ComponentPropsWithoutRef<"a">) {
  return (
    <a {...props} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}

const components: Components = {
  input: function TaskCheckbox({ node, ...props }) {
    const t = useUiText();
    const toggle = useContext(TaskToggleContext);
    if (!toggle) return <input {...props} />;
    const index = Number(node?.properties["data-task-index"]);
    return <label className="inline-task-toggle" onClick={(event) => event.stopPropagation()}>
      <input type="checkbox" checked={props.checked} aria-label={t("完成任务 {0}", index + 1)} onChange={() => toggle(index)} />
    </label>;
  },
  a: SafeLink,
  code({ className, children, ...props }) {
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  img: function BlockedImage({ alt }) {
    const t = useCanvasText();
    return (
      <span className="markdown-resource-placeholder" role="note">
        {alt ? t("Markdown 外部图片已禁用：{0}", alt) : t("Markdown 外部图片已禁用")}
      </span>
    );
  },
  pre({ children }) {
    // The pre wrapper, not the presence of a language or newline, identifies a code block.
    const child = Children.toArray(children)[0];
    if (isValidElement<{ className?: string; children?: ReactNode }>(child)) {
      const language = /language-([^\s]+)/.exec(child.props.className ?? "")?.[1];
      return <ShikiCodeBlock code={String(child.props.children ?? "").replace(/\n$/, "")} language={language} />;
    }
    return <pre>{children}</pre>;
  },
  table({ children }) {
    return (
      <div className="table-wrap">
        <table>{children}</table>
      </div>
    );
  },
};

export function MarkdownBody({ source, onTaskToggle }: MarkdownBodyProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let frame = 0;
    let disposed = false;
    let lastMeasuredWidth = -1;

    const scheduleMeasurement = (force = false) => {
      if (force) lastMeasuredWidth = -1;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (disposed || root.clientWidth === lastMeasuredWidth) return;
        lastMeasuredWidth = root.clientWidth;
        measureMathOverflow(root);
      });
    };

    scheduleMeasurement(true);

    const observer = new ResizeObserver(() => scheduleMeasurement());
    observer.observe(root);

    void document.fonts?.ready.then(() => scheduleMeasurement(true));

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [source]);

  return (
    <div className="markdown-body" ref={rootRef}>
      <TaskToggleContext.Provider value={onTaskToggle}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, emptyTaskItems]}
        rehypePlugins={[captureMathMetadata, rehypeKatex, attachMathMetadata, keepLineEnd, wrapTaskListText]}
        components={components}
      >
        {source}
      </ReactMarkdown>
      </TaskToggleContext.Provider>
    </div>
  );
}
