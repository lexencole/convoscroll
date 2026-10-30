import type { LocalizedText } from "../../i18n/messages";
import { errorMessage } from "../../i18n/messages";
import { useUiText, useUiLocale, useCanvasLocale } from "../../i18n/LocaleContext";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { EditorContent, useEditor, useEditorState, type UseEditorOptions } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import { Fragment, Slice, type Node } from "@tiptap/pm/model";
import { Selection } from "@tiptap/pm/state";
import { MarkdownBody } from "../../renderer/MarkdownBody";
import { focusPopoverItem, measurePopover, observePopoverPosition, placePopover } from "../../app/popover-position";
import { SelectField } from "../../app/SelectField";
import { Icon } from "../../app/Icon";
import { editingHelp } from "../../app/WorkbenchToolbar";
import { WorkbenchItemMenu, type WorkbenchMenuAction } from "../WorkbenchItemMenu";
import { CodeLanguageControl } from "./CodeLanguageControl";
import { editableContent, inlineExtensions, insertMultilineCode } from "./inline-extensions";
import { editorToMarkdown, markdownToEditor } from "./markdown-adapter";
import { noticeText } from "../../app/notice-text";
import { TASK_TOGGLE } from "./task-items";
import { InlineSlashMenu } from "./InlineSlashMenu";
import type { SlashBlockType } from "./slash-commands";
import type { MarkdownInsertion } from "../workbench-operations";

interface Props {
  blockActions?: readonly WorkbenchMenuAction[];
  initialFocus?: { x: number; y: number } | true | "end";
  onPasteImage?: (file: File) => void;
  source: string;
  toolbarHost: HTMLElement | null;
  active: boolean;
  enabled: boolean;
  label: string;
  onActivate: () => void;
  onChange: (source: string, group: string) => void;
  onBusy: (busy: boolean) => void;
  onUndo: () => void;
  onRedo: () => void;
  /** Removes an empty plain block and focuses the adjacent preceding text block. */
  onEmptyBackspace?: () => boolean;
  hasToolCall?: boolean;
  onInsertBlock?: (type: SlashBlockType, insertion: Omit<MarkdownInsertion, "blockId">, trigger: HTMLElement) => void;
  /** Short feedback shown by the workbench, so it never reflows the toolbar. */
  onNotice: (message: LocalizedText, tone: "status" | "alert") => void;
}

/**
 * Where the caret belongs after undo / redo replaces the whole block: at the end of
 * what changed. Keeping the old position number instead moves the caret by the length
 * of the undone text, often into the next paragraph.
 */
export function caretAfterReplace(before: Node, after: Node, fallback: number): number {
  const start = before.content.findDiffStart(after.content);
  if (start === null) return Math.min(fallback, after.content.size);
  const end = before.content.findDiffEnd(after.content);
  if (!end) return start;
  // Repeated text lets the unchanged tail overlap the unchanged head; shift past it.
  const overlap = start - Math.min(end.a, end.b);
  return overlap > 0 ? end.b + overlap : end.b;
}

export function InlineMarkdownEditor(props: Props) {
  const t = useUiText();
  const parsed = useMemo(() => {
    try { return { document: editableContent(props.source) }; }
    catch (cause) { return { error: errorMessage(cause, "这段内容不能直接编辑，原文没有改动。") }; }
  }, [props.source]);
  if (!parsed.document) return <>
    <p className="inline-notice" role="alert">{noticeText(t(parsed.error))}</p>
    <MarkdownBody source={props.source} />
  </>;
  return <SupportedEditor {...props} initialContent={parsed.document} />;
}

function SupportedEditor({ source, initialContent, toolbarHost, active, enabled, label, initialFocus, blockActions = [], ...callbacks }: Props & {
  initialContent: ReturnType<typeof markdownToEditor>;
}) {
  const t = useUiText();
  const { locale: uiLocale } = useUiLocale();
  const canvasLocale = useCanvasLocale();
  const languages = useRef({ ui: uiLocale, canvas: canvasLocale });
  languages.current = { ui: uiLocale, canvas: canvasLocale };
  const handlers = useRef(callbacks);
  handlers.current = callbacks;
  const editorRef = useRef<Editor | null>(null);
  const sessionId = useId();
  const lastSource = useRef(source);
  const composing = useRef(false);
  const unpublished = useRef(false);
  const group = useRef({ id: 0, last: 0 });
  const notify = (message: LocalizedText, tone: "status" | "alert" = "status") => handlers.current.onNotice(message, tone);
  const [math, setMath] = useState<{ position: number; type: string; latex: string }>();
  const mathInput = useRef<HTMLTextAreaElement>(null);
  const mathPanel = useRef<HTMLElement>(null);
  const [mathPosition, setMathPosition] = useState<CSSProperties>();
  const formulaDraft = useRef(false);
  formulaDraft.current = Boolean(math);

  function backspaceEmptyBlock() {
    const editor = editorRef.current;
    if (!editor?.isEditable || editor.view.composing || composing.current || formulaDraft.current) return false;
    const { doc, selection } = editor.state;
    // An empty list, code block or table still carries structure. Let the editor
    // handle those boundaries before considering removal of the whole block.
    if (!selection.empty || doc.childCount !== 1 || doc.firstChild?.type.name !== "paragraph" || doc.firstChild.content.size !== 0) return false;
    group.current.last = 0;
    return handlers.current.onEmptyBackspace?.() ?? false;
  }

  function publish() {
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed || composing.current || !unpublished.current) return;
    const next = editorToMarkdown(editor.getJSON());
    unpublished.current = false;
    if (next === lastSource.current) return;
    const now = Date.now();
    if (now - group.current.last > 700) group.current.id++;
    group.current.last = now;
    lastSource.current = next;
    handlers.current.onChange(next, `inline-text-${sessionId}-${group.current.id}`);
  }

  function editMath(node: Node, position: number) {
    const editor = editorRef.current;
    if (!editor?.isEditable || composing.current) return;
    handlers.current.onActivate();
    setMathPosition(undefined);
    setMath({ position, type: node.type.name, latex: node.attrs.latex });
    editor.setEditable(false, false);
    handlers.current.onBusy(true);
  }

  // Keep extensions and DOM handlers stable: resetting view options during an input
  // can interrupt the browser's multi-event text replacement or composition.
  const [options] = useState<UseEditorOptions>(() => ({
    extensions: inlineExtensions({ onReject: (message) => notify(message, "alert"), onMath: editMath, getCanvasLocale: () => languages.current.canvas, getUiLocale: () => languages.current.ui }),
    content: initialContent,
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: { class: "markdown-body inline-prose", role: "textbox", "aria-label": label, "aria-multiline": "true", spellcheck: "false" },
      handleKeyDown(view, event) {
        if (event.isComposing || composing.current) return false;
        if ((event.metaKey || event.ctrlKey) && (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")) {
          event.preventDefault();
          group.current.last = 0;
          if (event.shiftKey || event.key.toLowerCase() === "y") handlers.current.onRedo(); else handlers.current.onUndo();
          return true;
        }
        if (event.key === "Tab" && view.state.selection.$from.parent.type.name === "codeBlock") {
          view.dispatch(view.state.tr.insertText("    "));
          return true;
        }
        if (event.key === "Backspace" && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && backspaceEmptyBlock()) {
          event.preventDefault();
          return true;
        }
        return false;
      },
      handleDOMEvents: {
        // Intercept before ProseMirror parses any clipboard HTML or dropped files.
        paste(view, event) {
          const image = [...(event.clipboardData?.files ?? [])].find((file) => file.type.startsWith("image/"));
          if (image && handlers.current.onPasteImage) {
            event.preventDefault();
            if (!composing.current && view.editable) handlers.current.onPasteImage(image);
            return true;
          }
          const text = event.clipboardData?.getData("text/plain");
          if (text === undefined) return false;
          event.preventDefault();
          if (!text) { notify("剪贴板里没有文字或图片。要加文件，请用“添加内容”。"); return true; }
          const inCode = view.state.selection.$from.parent.type.name === "codeBlock";
          if (inCode || !/[\r\n]/.test(text)) view.dispatch(view.state.tr.insertText(text));
          else {
            const paragraphs = text.split(/\r?\n/).map((line) => view.state.schema.nodes.paragraph.create(null, line ? view.state.schema.text(line) : undefined));
            view.dispatch(view.state.tr.replaceSelection(new Slice(Fragment.fromArray(paragraphs), 1, 1)));
          }
          if (event.clipboardData?.types.includes("text/html")) notify("已粘贴为纯文字，网页里的格式和图片没有带过来。");
          return true;
        },
        drop(_view, event) {
          event.preventDefault();
          notify("这里不能直接拖入。调整顺序请拖右上角的点状图标，加文件请用“添加内容”。");
          return true;
        },
        beforeinput(view, event) {
          // Mobile keyboards may send beforeinput without a Backspace keydown.
          if (event.inputType === "deleteContentBackward" && !event.isComposing && backspaceEmptyBlock()) {
            event.preventDefault();
            return true;
          }
          return !composing.current && insertMultilineCode(view, event);
        },
        compositionstart() { composing.current = true; handlers.current.onBusy(true); return false; },
        compositionend() {
          window.setTimeout(() => {
            composing.current = false;
            publish();
            handlers.current.onBusy(formulaDraft.current);
          }, 0);
          return false;
        },
        blur() { group.current.last = 0; return false; },
      },
    },
    onUpdate({ editor: current, transaction }) {
      const toggle = transaction.getMeta(TASK_TOGGLE);
      if (toggle) group.current.last = 0;
      unpublished.current = true;
      if (!current.view.composing && !composing.current) publish();
      if (toggle) group.current.last = 0;
    },
    onFocus() { handlers.current.onActivate(); },
  }));
  const editor = useEditor(options);
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    editor.view.dom.setAttribute("aria-label", label);
    editor.view.dispatch(editor.state.tr.setMeta("localeChanged", true).setMeta("addToHistory", false));
  }, [editor, label, uiLocale, canvasLocale]);
  editorRef.current = editor;

  useLayoutEffect(() => {
    if (!editor || !initialFocus) return;
    if (initialFocus === "end") {
      // Tiptap preserves mobile keyboard focus and restores it after React mounts.
      editor.commands.focus("end", { scrollIntoView: false });
      return;
    }
    const position = initialFocus === true ? undefined : editor.view.posAtCoords({ left: initialFocus.x, top: initialFocus.y })?.pos;
    editor.commands.focus(position ?? "start", { scrollIntoView: false });
  }, [editor]);

  useEffect(() => { editor?.setEditable(enabled && !math, false); }, [editor, enabled, Boolean(math)]);
  useEffect(() => { if (!active) group.current.last = 0; }, [active]);

  useEffect(() => {
    if (!editor || source === lastSource.current || composing.current) return;
    const before = editor.state.doc;
    const position = editor.state.selection.from;
    lastSource.current = source;
    unpublished.current = false;
    editor.commands.setContent(markdownToEditor(source), { emitUpdate: false });
    const caret = caretAfterReplace(before, editor.state.doc, position);
    editor.commands.command(({ tr }) => { tr.setSelection(Selection.near(tr.doc.resolve(caret), -1)); return true; });
    group.current.last = 0;
  }, [editor, source]);

  useLayoutEffect(() => {
    if (!math || !editor) return;
    function place() {
      const node = editor!.view.nodeDOM(math!.position);
      const panel = mathPanel.current;
      if (!(node instanceof Element) || !panel) return;
      setMathPosition(placePopover(node.getBoundingClientRect(), measurePopover(panel), { maxHeight: Infinity }));
    }
    place();
    return observePopoverPosition(mathPanel.current, place);
  }, [math?.position, editor]);
  useEffect(() => { if (math && mathPosition) return focusPopoverItem(mathPanel.current, mathInput.current); }, [Boolean(math), Boolean(mathPosition)]);
  const state = useEditorState({ editor, selector: ({ editor: current }) => ({
    bold: current?.isActive("bold"), italic: current?.isActive("italic"), strike: current?.isActive("strike"),
    heading: current?.isActive("heading") ? String(current.getAttributes("heading").level) : "paragraph",
    bullet: current?.isActive("bulletList"), ordered: current?.isActive("orderedList"),
    code: current?.isActive("codeBlock"), language: String(current?.getAttributes("codeBlock").language ?? ""),
    table: current?.isActive("table"),
  }) });

  function closeMath(apply: boolean) {
    if (!editor || !math) return;
    if (apply && !math.latex.trim()) { notify("请输入公式；如需删除，请取消并返回正文操作。", "alert"); return; }
    editor.setEditable(true, false);
    if (apply) {
      group.current.last = 0;
      if (math.type === "blockMath") editor.commands.updateBlockMath({ pos: math.position, latex: math.latex });
      else editor.commands.updateInlineMath({ pos: math.position, latex: math.latex });
    }
    setMath(undefined);
    handlers.current.onBusy(false);
    editor.commands.focus();
  }

  function action(label: string, run: () => void, pressed = false, visual?: ReactNode): ReactNode {
    return <button type="button" aria-label={t(label)} title={t(label)} aria-pressed={pressed} disabled={Boolean(math) || !enabled}
      className={visual ? `inline-format-icon${label === "斜体" ? " inline-format-italic" : ["删除线", "列表", "编号", "代码块", "转为正文"].includes(label) ? " inline-format-wide" : ""}` : undefined} onMouseDown={(event) => event.preventDefault()}
      onClick={() => { group.current.last = 0; run(); }}>{visual ?? t(label)}</button>;
  }

  return <>
    <div className="inline-editable-block" data-active={active}><EditorContent editor={editor} /></div>
    {editor ? <InlineSlashMenu editor={editor} enabled={active && enabled && !math} hasToolCall={callbacks.hasToolCall ?? false}
      onBeforeCommand={() => { group.current.last = 0; }} onAfterCommand={() => { group.current.last = 0; }} onMath={editMath}
      onInsertBlock={callbacks.onInsertBlock ? (type, insertion, trigger) => handlers.current.onInsertBlock?.(type, { ...insertion, source: lastSource.current }, trigger) : undefined}
      onError={(message) => notify(message, "alert")} /> : null}
    {editor && toolbarHost && active ? createPortal(<>
      <div className="inline-format-tools" data-code={state?.code || undefined} role="group" aria-label={t("文字格式")}>
        {state?.code ? <CodeLanguageControl value={state.language} disabled={!enabled || Boolean(math)}
          onChange={(language) => { group.current.last = 0; editor.chain().focus().updateAttributes("codeBlock", { language: language || null }).run(); }} /> : <>
        <SelectField ariaLabel={t("段落样式")} compact typography="toolbar" restoreFocusOnSelect={false}
          disabled={!enabled || Boolean(math) || state?.table || state?.code} value={state?.heading ?? "paragraph"}
          options={[{ value: "paragraph", label: t("正文") }, ...[1, 2, 3, 4, 5, 6].map((level) => ({ value: String(level), label: t("标题 {0}", level) }))]}
          onChange={(value) => { group.current.last = 0; if (value === "paragraph") editor.chain().focus().setParagraph().run();
            else editor.chain().focus().setHeading({ level: Number(value) as 1 | 2 | 3 | 4 | 5 | 6 }).run(); }} />
        {action("加粗", () => editor.chain().focus().toggleBold().run(), state?.bold, <Icon name="bold" />)}
        {action("斜体", () => editor.chain().focus().toggleItalic().run(), state?.italic, <Icon name="italic" />)}
        {action("删除线", () => editor.chain().focus().toggleStrike().run(), state?.strike, <Icon name="strike" />)}
        {action("列表", () => editor.chain().focus().toggleBulletList().run(), state?.bullet, <Icon name="list" />)}
        {action("编号", () => editor.chain().focus().toggleOrderedList().run(), state?.ordered, <Icon name="list-ordered" />)}
        </>}
        {action(state?.code ? "转为正文" : "代码块", () => editor.chain().focus().toggleCodeBlock().run(), state?.code, <Icon name="code" />)}
        <WorkbenchItemMenu label={t("更多编辑操作")} title={t("编辑")} disabled={!enabled || Boolean(math)} actions={[
          { label: "斜体", icon: "italic", group: "format", opensSettings: true, run: () => { group.current.last = 0; editor.chain().focus().toggleItalic().run(); } },
          { label: "删除线", icon: "strike", group: "format", opensSettings: true, run: () => { group.current.last = 0; editor.chain().focus().toggleStrike().run(); } },
          { label: "列表", icon: "list", group: "format", opensSettings: true, run: () => { group.current.last = 0; editor.chain().focus().toggleBulletList().run(); } },
          { label: "编号", icon: "list-ordered", group: "format", opensSettings: true, run: () => { group.current.last = 0; editor.chain().focus().toggleOrderedList().run(); } },
          { label: state?.code ? "转为正文" : "代码块", icon: "code", group: "format", opensSettings: true, run: () => { group.current.last = 0; editor.chain().focus().toggleCodeBlock().run(); } },
          ...blockActions,
          { label: "编辑帮助", icon: "help", group: "help", run: () => notify(editingHelp) },
        ]} />
      </div>
    </>, toolbarHost) : null}
    {math ? createPortal(<section ref={mathPanel} className="inline-math-popover" role="dialog" aria-modal="false" aria-label={t("修改公式")}
      style={mathPosition ? { ...mathPosition, visibility: "visible" } : { visibility: "hidden" }} onKeyDown={(event) => { if (event.key === "Escape") closeMath(false); if ((event.metaKey || event.ctrlKey) && event.key === "Enter") closeMath(true); }}>
      <label>{t("公式（LaTeX）")}<textarea ref={mathInput} value={math.latex} onChange={(event) => setMath({ ...math, latex: event.target.value })} /></label>
      <div><button type="button" onClick={() => closeMath(false)}>{t("取消")}</button><button type="button" onClick={() => closeMath(true)}>{t("确定")}</button></div>
    </section>, document.body) : null}
  </>;
}
