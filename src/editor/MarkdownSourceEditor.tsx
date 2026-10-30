import { useUiText, useCanvasText } from "../i18n/LocaleContext";
import { useRef, type ChangeEvent } from "react";

interface MarkdownSourceEditorProps {
  readonly id: string;
  readonly label?: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}

const templates = [
  { label: "代码块", value: "\n```typescript\nconst value = true;\n```\n", selection: "const value = true;" },
  { label: "行内公式", value: "$E = mc^2$", selection: "E = mc^2" },
  { label: "块级公式", value: "\n$$\nW_{output} = W_{css} \\times s\n$$\n", selection: "W_{output} = W_{css} \\times s" },
  { label: "表格", value: "\n| 项目 | 说明 |\n| --- | --- |\n| 示例 | 内容 |\n", selection: "示例" },
] as const;

export function MarkdownSourceEditor({
  id,
  label = "Markdown 内容",
  value,
  onChange,
}: MarkdownSourceEditorProps) {
  const t = useUiText();
  const canvasText = useCanvasText();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function insertTemplate(template: (typeof templates)[number]) {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? start;
    const insertion = template.label === "表格" ? canvasText(template.value) : template.value;
    const selection = template.label === "表格" ? canvasText(template.selection) : template.selection;
    const next = `${value.slice(0, start)}${insertion}${value.slice(end)}`;
    const selectionOffset = insertion.indexOf(selection);
    onChange(next);
    requestAnimationFrame(() => {
      const current = textareaRef.current;
      if (!current) return;
      const selectionStart = start + Math.max(0, selectionOffset);
      current.focus();
      current.setSelectionRange(selectionStart, selectionStart + selection.length);
    });
  }

  return (
    <div className="editor-field editor-field--full">
      <div className="editor-field__label-row">
        <label htmlFor={id}>{t(label)}</label>
        <div className="markdown-tools" aria-label={t("插入 Markdown 模板")}>
          {templates.map((template) => (
            <button key={t(template.label)} type="button" onClick={() => insertTemplate(template)}>
              {t(template.label)}
            </button>
          ))}
        </div>
      </div>
      <textarea
        ref={textareaRef}
        id={id}
        className="markdown-source"
        value={value}
        rows={9}
        spellCheck={false}
        onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
      />
    </div>
  );
}
