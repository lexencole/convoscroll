import type { LocalizedText } from "../../i18n/messages";
import { errorMessage } from "../../i18n/messages";
import { useUiText } from "../../i18n/LocaleContext";
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Icon } from "../../app/Icon";
import { measurePopover, observePopoverPosition, placePopover, revealPopoverItem } from "../../app/popover-position";
import type { MarkdownInsertion } from "../workbench-operations";
import { applyInlineSlash, filterSlashCommands, findSlashMatch, splitAtSlash, type SlashBlockType, type SlashCommand, type SlashMatch } from "./slash-commands";

interface Props {
  editor: Editor;
  enabled: boolean;
  hasToolCall: boolean;
  onBeforeCommand: () => void;
  onAfterCommand: () => void;
  onMath: (node: ProseMirrorNode, position: number) => void;
  onInsertBlock?: (type: SlashBlockType, insertion: Omit<MarkdownInsertion, "blockId">, trigger: HTMLElement) => void;
  onError: (message: LocalizedText) => void;
}
interface MenuState { match: SlashMatch; items: readonly SlashCommand[]; selected: number }

/** An autocomplete list: editing focus stays in ProseMirror, including on touch devices. */
export function InlineSlashMenu({ editor, ...props }: Props) {
  const t = useUiText();
  const handlers = useRef(props); handlers.current = props;
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const [menu, renderMenu] = useState<MenuState>();
  const current = useRef<MenuState | undefined>(undefined);
  const [position, setPosition] = useState<CSSProperties>();
  const positioned = Boolean(menu && position);
  const dismissed = useRef<number | undefined>(undefined);
  const composing = useRef(false);
  const refreshRef = useRef<() => void>(() => undefined);
  function setMenu(value?: MenuState) { current.current = value; renderMenu(value); }
  function dismiss() { dismissed.current = findSlashMatch(editor.state)?.from; setMenu(undefined); }
  function disabled(command: SlashCommand) { return command.id === "toolResult" && !handlers.current.hasToolCall; }
  function choose(command: SlashCommand) {
    const match = findSlashMatch(editor.state);
    if (!handlers.current.enabled || composing.current || editor.view.composing || !match || disabled(command)) return;
    dismiss();
    handlers.current.onBeforeCommand();
    try {
      if (command.block) handlers.current.onInsertBlock?.(command.block, splitAtSlash(editor.state, match), editor.view.dom);
      else if (applyInlineSlash(editor, command, match) && command.id === "blockMath") {
        const node = editor.state.doc.nodeAt(match.start);
        if (node?.type.name === "blockMath") handlers.current.onMath(node, match.start);
      }
    } catch (cause) { handlers.current.onError(errorMessage(cause, "内容没能添加，请再试一次。")); }
    finally { handlers.current.onAfterCommand(); }
  }
  const chooseRef = useRef(choose); chooseRef.current = choose;

  useEffect(() => {
    const key = new PluginKey("inlineSlashMenu");
    let compositionTimer: number | undefined;
    function refresh() {
      if (editor.isDestroyed || !editor.isEditable || !handlers.current.enabled || composing.current || editor.view.composing || !editor.view.hasFocus()) {
        if (current.current) setMenu(undefined);
        return;
      }
      const match = findSlashMatch(editor.state);
      if (!match) { dismissed.current = undefined; if (current.current) setMenu(undefined); return; }
      if (dismissed.current === match.from) return;
      const items = filterSlashCommands(match.query, Boolean(handlers.current.onInsertBlock));
      const previous = current.current;
      const selected = previous?.match.from === match.from && previous.match.query === match.query
        ? Math.min(previous.selected, Math.max(0, items.length - 1)) : Math.max(0, items.findIndex((item) => !disabled(item)));
      if (previous?.match.from === match.from && previous.match.to === match.to && previous.match.query === match.query
        && previous.selected === selected && previous.items.length === items.length) return;
      setMenu({ match, items, selected });
    }
    function keydown(event: KeyboardEvent) {
      if (event.isComposing || event.keyCode === 229 || composing.current || editor.view.composing || !handlers.current.enabled) return false;
      const value = current.current;
      if (!value || event.metaKey || event.ctrlKey || event.altKey) return false;
      if (event.key === "Escape") { event.preventDefault(); dismiss(); return true; }
      if (event.key === "Tab") { dismiss(); return false; }
      if (event.key === "Enter" && value.items.length) {
        event.preventDefault(); chooseRef.current(value.items[value.selected]); return true;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || !value.items.length) return false;
      event.preventDefault();
      const direction = event.key === "ArrowUp" || event.key === "End" ? -1 : 1;
      let selected = event.key === "Home" ? -1 : event.key === "End" ? value.items.length : value.selected;
      for (let i = 0; i < value.items.length; i++) {
        selected = (selected + direction + value.items.length) % value.items.length;
        if (!disabled(value.items[selected])) break;
      }
      setMenu({ ...value, selected });
      return true;
    }
    refreshRef.current = refresh;
    editor.registerPlugin(new Plugin({ key, state: {
      init: () => null,
      apply(transaction) {
        // Replacing the slash starts a new command; extending literal text after
        // Escape stays dismissed. Keep the anchor valid when earlier text moves.
        if (dismissed.current !== undefined && transaction.docChanged) {
          const start = transaction.mapping.mapResult(dismissed.current, 1);
          const end = transaction.mapping.mapResult(dismissed.current + 1, -1);
          dismissed.current = start.deleted || end.deleted || end.pos <= start.pos ? undefined : start.pos;
        }
        return null;
      },
    }, props: {
      handleKeyDown: (_view, event) => keydown(event),
      handleDOMEvents: {
        focus: () => { queueMicrotask(refresh); return false; },
        blur: () => { dismiss(); return false; },
        compositionstart: () => { window.clearTimeout(compositionTimer); composing.current = true; setMenu(undefined); return false; },
        compositionend: () => {
          compositionTimer = window.setTimeout(() => { composing.current = false; refresh(); }, 0);
          return false;
        },
        beforeinput: (_view, event) => {
          if (event.data?.startsWith("/") && event.inputType.startsWith("insert")) dismissed.current = undefined;
          if (event.inputType !== "insertParagraph" || event.isComposing || composing.current || editor.view.composing || !handlers.current.enabled || !current.current?.items.length) return false;
          event.preventDefault(); chooseRef.current(current.current.items[current.current.selected]); return true;
        },
      },
    }, view: () => ({ update: refresh }) }), (plugin, plugins) => [plugin, ...plugins]);
    refresh();
    return () => {
      window.clearTimeout(compositionTimer);
      refreshRef.current = () => undefined;
      if (!editor.isDestroyed) editor.unregisterPlugin(key);
    };
  }, [editor]);

  useEffect(() => { if (!props.enabled) dismiss(); else refreshRef.current(); }, [props.enabled, props.hasToolCall]);
  useEffect(() => {
    const element = editor.view.dom;
    if (menu) {
      element.setAttribute("aria-autocomplete", "list");
      element.setAttribute("aria-controls", id);
      if (menu.items.length) element.setAttribute("aria-activedescendant", `${id}-${menu.items[menu.selected].id}`);
      else element.removeAttribute("aria-activedescendant");
    } else {
      element.removeAttribute("aria-autocomplete"); element.removeAttribute("aria-controls"); element.removeAttribute("aria-activedescendant");
    }
    return () => { element.removeAttribute("aria-autocomplete"); element.removeAttribute("aria-controls"); element.removeAttribute("aria-activedescendant"); };
  }, [editor, id, menu]);
  useLayoutEffect(() => {
    if (!menu) { setPosition(undefined); return; }
    function place() {
      if (!panel.current || editor.isDestroyed || !current.current) return;
      const rect = editor.view.coordsAtPos(current.current.match.to);
      setPosition(placePopover(new DOMRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top), measurePopover(panel.current)));
    }
    place();
    return observePopoverPosition(panel.current, place);
  }, [editor, menu?.match.from, menu?.match.to, menu?.items.length]);
  useLayoutEffect(() => {
    if (!menu || !position) return;
    revealPopoverItem(panel.current, panel.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? null);
    // Moving the keyboard/visual viewport must not undo a user's touch scroll.
    // Reveal only when opening/filtering/navigating, after the panel is measured.
  }, [menu, positioned]);

  if (!menu) return null;
  return createPortal(<div ref={panel} id={id} role="listbox" aria-label={t("添加内容")} className="workbench-action-menu inline-slash-menu" data-ui-only="true"
    style={position ? { ...position, visibility: "visible" } : { visibility: "hidden" }}>
    <div className="workbench-action-menu__title" role="presentation">{t("添加内容")}</div>
    {menu.items.length ? menu.items.map((command, index) => <button key={command.id} id={`${id}-${command.id}`} role="option" type="button" tabIndex={-1}
      aria-selected={index === menu.selected} aria-disabled={disabled(command)} disabled={disabled(command)}
      title={disabled(command) ? t("请先添加工具调用") : undefined} className={index === menu.selected ? "is-active" : undefined}
      onMouseDown={(event) => event.preventDefault()}
      onPointerMove={(event) => { if (event.pointerType === "mouse" && !disabled(command) && current.current?.selected !== index) setMenu({ ...menu, selected: index }); }}
      onClick={() => choose(command)}><Icon name={command.icon} /><span>{t(command.label)}</span>{disabled(command) ? <small>{t("需先添加调用")}</small> : null}</button>)
      : <div className="inline-slash-menu__empty" role="status">{t("没有匹配的内容")}</div>}
  </div>, document.body);
}
