import { useUiText } from "../i18n/LocaleContext";
import { useEffect, useMemo, useRef, useState } from "react";
import { IconButton } from "../app/Icon";
import { SelectField } from "../app/SelectField";
import type {
  ContentBlock,
  ConversationDocument,
  ExecutionStatus,
} from "../data/conversation-types";
import {
  collectToolCallIds,
  duplicateBlock,
  moveBlock,
  removeBlock,
  updateBlock,
  updateJsonBlockValue,
  updateToolCallId,
} from "./document-operations";
import { contentBlockLabels, executionStatusLabels } from "./editor-labels";
import type { DocumentCommit } from "./editor-types";
import { JsonValueEditor } from "./JsonValueEditor";
import { MarkdownSourceEditor } from "./MarkdownSourceEditor";

interface BlockEditorProps {
  readonly settingsOnly?: boolean;
  readonly document: ConversationDocument;
  readonly messageId: string;
  readonly block: ContentBlock;
  readonly index: number;
  readonly total: number;
  readonly commit: DocumentCommit;
  readonly selected: boolean;
  readonly onSelect: (blockId: string) => void;
}

const executionStatuses: readonly ExecutionStatus[] = [
  "neutral", "pending", "running", "success", "error",
];
const executionStatusOptions = executionStatuses.map((status) => ({ value: status, label: executionStatusLabels[status] }));
const imageWidthOptions = [
  { value: "small", label: "小" },
  { value: "medium", label: "中" },
  { value: "full", label: "全宽" },
] as const;

function OptionalIntegerField({
  id,
  value,
  onValidChange,
}: {
  readonly id: string;
  readonly value?: number;
  readonly onValidChange: (value: number | undefined) => void;
}) {
  const t = useUiText();
  const incoming = value === undefined ? "" : String(value);
  const [draft, setDraft] = useState(incoming);
  const [error, setError] = useState(false);
  const lastSubmitted = useRef(incoming);

  useEffect(() => {
    if (incoming === lastSubmitted.current) return;
    lastSubmitted.current = incoming;
    setDraft(incoming);
    setError(false);
  }, [incoming]);

  return (
    <div className="editor-field workbench-duration-field">
      <label htmlFor={id}>{t("用时（毫秒）")}</label>
      <input
        id={id}
        inputMode="numeric"
        value={draft}
        aria-invalid={error}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          if (next === "") {
            lastSubmitted.current = next;
            setError(false);
            onValidChange(undefined);
            return;
          }
          const parsed = Number(next);
          if (!Number.isInteger(parsed) || parsed < 0) {
            setError(true);
            return;
          }
          lastSubmitted.current = next;
          setError(false);
          onValidChange(parsed);
        }}
      />
      {error ? <small className="editor-field__error">{t("请输入 0 或正整数")}</small> : null}
    </div>
  );
}

// Expanding or collapsing is done with the arrow on the canvas and saved to the document;
// the export dialog folds everything at once.
function TraceSettings({
  block,
  update,
}: {
  readonly block: Extract<ContentBlock, { type: "reasoning" | "toolCall" | "toolResult" }>;
  readonly update: (patch: Record<string, unknown>, field: string) => void;
}) {
  const t = useUiText();
  return (
    <div className="editor-field--full workbench-trace-fields">
      <div className="editor-field">
        <label htmlFor={`${block.id}-status`}>{t("状态")}</label>
        <SelectField
          id={`${block.id}-status`}
          value={block.status ?? "neutral"}
          options={executionStatusOptions.map((option) => ({ ...option, label: t(option.label) }))}
          onChange={(status) => update({ status }, "status")}
        />
      </div>
      <OptionalIntegerField
        id={`${block.id}-duration`}
        value={block.durationMs}
        onValidChange={(durationMs) => update({ durationMs }, "duration")}
      />
    </div>
  );
}

export function BlockEditor({
  settingsOnly = false,
  document,
  messageId,
  block,
  index,
  total,
  commit,
  selected,
  onSelect,
}: BlockEditorProps) {
  const t = useUiText();
  const [callIdDraft, setCallIdDraft] = useState(block.type === "toolCall" ? block.callId : "");
  const [callIdError, setCallIdError] = useState<string>();
  const toolCallIds = useMemo(() => collectToolCallIds(document), [document]);
  const asset = block.type === "image" || block.type === "file"
    ? document.assets.find((candidate) => candidate.id === block.assetId)
    : undefined;

  useEffect(() => {
    if (block.type === "toolCall") setCallIdDraft(block.callId);
  }, [block]);

  function patchBlock(patch: Record<string, unknown>, field: string) {
    commit(
      (current) => updateBlock(current, messageId, block.id, (candidate) => (
        candidate.type === block.type ? { ...candidate, ...patch } as ContentBlock : candidate
      )),
      `block:${block.id}:${field}`,
    );
  }

  function handleCallId(next: string) {
    if (block.type !== "toolCall") return;
    setCallIdDraft(next);
    const trimmed = next.trim();
    if (!trimmed) {
      setCallIdError("调用 ID 不能为空");
      return;
    }
    if (toolCallIds.some((callId) => callId !== block.callId && callId === trimmed)) {
      setCallIdError("调用 ID 重复了");
      return;
    }
    setCallIdError(undefined);
    commit(
      (current) => updateToolCallId(current, messageId, block.id, trimmed),
      `block:${block.id}:call-id`,
    );
  }

  return (
    <section
      className={`block-editor${selected ? " is-selected" : ""}`}
      data-block-type={block.type}
      onPointerDown={() => onSelect(block.id)}
      onFocusCapture={() => onSelect(block.id)}
    >
      {!settingsOnly ? <header className="block-editor__header">
        <div>
          <span>{t("内容块 {0}", index + 1)}</span>
          <strong>{t(contentBlockLabels[block.type])}</strong>
        </div>
        <div className="editor-icon-actions" aria-label={t("{0}操作", t(contentBlockLabels[block.type]))}>
          <IconButton
            icon="arrow-up"
            label={t("上移内容块")}
            disabled={index === 0}
            onClick={() => commit((current) => moveBlock(current, messageId, block.id, -1))}
          />
          <IconButton
            icon="arrow-down"
            label={t("下移内容块")}
            disabled={index === total - 1}
            onClick={() => commit((current) => moveBlock(current, messageId, block.id, 1))}
          />
          <IconButton
            icon="copy"
            label={t("复制内容块")}
            onClick={() => commit((current) => duplicateBlock(current, messageId, block.id).document)}
          />
          <IconButton
            icon="trash"
            className="is-danger"
            label={t("删除内容块")}
            onClick={() => commit((current) => removeBlock(current, messageId, block.id))}
          />
        </div>
      </header> : null}

      <div className="block-editor__fields">
        {block.type === "markdown" ? (
          <MarkdownSourceEditor
            id={`${block.id}-source`}
            value={block.source}
            onChange={(source) => patchBlock({ source }, "source")}
          />
        ) : null}

        {block.type === "reasoning" ? (
          <>
            <div className="editor-field">
              <label htmlFor={`${block.id}-title`}>{t("标题")}</label>
              <input id={`${block.id}-title`} value={block.title ?? ""} onChange={(event) => patchBlock({ title: event.target.value }, "title")} />
            </div>
            <div className="editor-field editor-field--full">
              <label htmlFor={`${block.id}-summary`}>{t("摘要")}</label>
              <input id={`${block.id}-summary`} value={block.summary ?? ""} onChange={(event) => patchBlock({ summary: event.target.value }, "summary")} />
            </div>
            <MarkdownSourceEditor
              id={`${block.id}-source`}
              label={t("思考内容（Markdown）")}
              value={block.source}
              onChange={(source) => patchBlock({ source }, "source")}
            />
            <TraceSettings block={block} update={patchBlock} />
          </>
        ) : null}

        {block.type === "toolCall" ? (
          <>
            <div className="editor-field">
              <label htmlFor={`${block.id}-call-id`}>{t("调用 ID")}</label>
              <input
                id={`${block.id}-call-id`}
                value={callIdDraft}
                aria-invalid={Boolean(callIdError)}
                onChange={(event) => handleCallId(event.target.value)}
              />
              {callIdError ? <small className="editor-field__error">{t(callIdError)}</small> : null}
            </div>
            <div className="editor-field">
              <label htmlFor={`${block.id}-tool-name`}>{t("工具名称")}</label>
              <input id={`${block.id}-tool-name`} value={block.toolName} onChange={(event) => patchBlock({ toolName: event.target.value }, "tool-name")} />
            </div>
            <div className="editor-field editor-field--full">
              <label htmlFor={`${block.id}-summary`}>{t("摘要")}</label>
              <input id={`${block.id}-summary`} value={block.summary ?? ""} onChange={(event) => patchBlock({ summary: event.target.value }, "summary")} />
            </div>
            <JsonValueEditor
              id={`${block.id}-json`}
              label={t("参数（JSON）")}
              value={block.input}
              onValidChange={(input) => commit(
                (current) => updateJsonBlockValue(current, messageId, block.id, input),
                `block:${block.id}:json`,
              )}
            />
            <TraceSettings block={block} update={patchBlock} />
          </>
        ) : null}

        {block.type === "toolResult" ? (
          <>
            <div className="editor-field">
              <label htmlFor={`${block.id}-call-id`}>{t("对应的调用 ID")}</label>
              <SelectField
                id={`${block.id}-call-id`}
                value={block.callId}
                options={toolCallIds.map((callId) => ({ value: callId, label: callId }))}
                onChange={(callId) => patchBlock({ callId }, "call-id")}
              />
            </div>
            <div className="editor-field editor-field--full">
              <label htmlFor={`${block.id}-summary`}>{t("摘要")}</label>
              <input id={`${block.id}-summary`} value={block.summary ?? ""} onChange={(event) => patchBlock({ summary: event.target.value }, "summary")} />
            </div>
            <JsonValueEditor
              id={`${block.id}-json`}
              label={t("结果（JSON）")}
              value={block.output}
              onValidChange={(output) => commit(
                (current) => updateJsonBlockValue(current, messageId, block.id, output),
                `block:${block.id}:json`,
              )}
            />
            <TraceSettings block={block} update={patchBlock} />
          </>
        ) : null}

        {block.type === "image" ? (
          <>
            {!settingsOnly ? <p className="asset-editor-note editor-field--full">
              {asset ? `${asset.fileName} · ${asset.mimeType}` : t("找不到文件 {0}", block.assetId)}
            </p> : null}
            <div className="editor-field">
              <label htmlFor={`${block.id}-alt`}>{t("图片描述")}</label>
              <input id={`${block.id}-alt`} value={block.alt ?? ""} onChange={(event) => patchBlock({ alt: event.target.value }, "alt")} />
            </div>
            <div className="editor-field">
              <label htmlFor={`${block.id}-width`}>{t("显示宽度")}</label>
              <SelectField
                id={`${block.id}-width`}
                value={block.width ?? "full"}
                options={imageWidthOptions.map((option) => ({ ...option, label: t(option.label) }))}
                onChange={(width) => patchBlock({ width }, "width")}
              />
            </div>
            <div className="editor-field editor-field--full">
              <label htmlFor={`${block.id}-caption`}>{t("图片说明")}</label>
              <input id={`${block.id}-caption`} value={block.caption ?? ""} onChange={(event) => patchBlock({ caption: event.target.value }, "caption")} />
            </div>
          </>
        ) : null}

        {block.type === "file" ? (
          <>
            {!settingsOnly ? <p className="asset-editor-note editor-field--full">
              {asset ? `${asset.fileName} · ${asset.mimeType}` : t("找不到文件 {0}", block.assetId)}
            </p> : null}
            <div className="editor-field editor-field--full">
              <label htmlFor={`${block.id}-label`}>{t("显示名称")}</label>
              <input id={`${block.id}-label`} value={block.label ?? ""} onChange={(event) => patchBlock({ label: event.target.value }, "label")} />
            </div>
          </>
        ) : null}

        {block.type === "unsupported" ? (
          <>
            <div className="editor-field">
              <label htmlFor={`${block.id}-original-type`}>{t("原始类型")}</label>
              <input id={`${block.id}-original-type`} value={block.originalType} onChange={(event) => patchBlock({ originalType: event.target.value }, "original-type")} />
            </div>
            <div className="editor-field editor-field--full">
              <label htmlFor={`${block.id}-reason`}>{t("保留原因")}</label>
              <input id={`${block.id}-reason`} value={block.reason ?? ""} onChange={(event) => patchBlock({ reason: event.target.value }, "reason")} />
            </div>
            <JsonValueEditor
              id={`${block.id}-json`}
              label={t("原始 JSON")}
              value={block.raw}
              onValidChange={(raw) => commit(
                (current) => updateJsonBlockValue(current, messageId, block.id, raw),
                `block:${block.id}:json`,
              )}
            />
          </>
        ) : null}
      </div>
    </section>
  );
}
