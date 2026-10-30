import { translator } from "../../i18n/messages";
import type { Locale } from "../../i18n/locale";
import { Extension, InputRule } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import type { NodeView } from "@tiptap/pm/view";

export const TASK_TOGGLE = "taskItemToggle";

/** Keep one list-item type so tasks can mix and nest with ordinary list items. */
export const TaskItems = Extension.create<{ getLocale: () => Locale }>({
  name: "taskItems",
  addOptions: () => ({ getLocale: () => "zh-CN" }),
  priority: 1100,
  addGlobalAttributes() {
    return [{ types: ["listItem"], attributes: {
      checked: {
        default: null,
        parseHTML: (element) => element.hasAttribute("data-task-checked") ? element.getAttribute("data-task-checked") === "true" : null,
        renderHTML: (attrs) => typeof attrs.checked === "boolean" ? { "data-task-checked": String(attrs.checked) } : {},
      },
    } }];
  },
  addInputRules() {
    return [new InputRule({
      find: /^\[([ xX]?)\]$/,
      handler: ({ state, range, match }) => {
        const { $from } = state.selection;
        if ($from.parent.type.name !== "paragraph" || $from.depth < 2 || $from.node(-1).type.name !== "listItem"
          || $from.index(-1) !== 0 || $from.node(-1).attrs.checked != null) return null;
        state.tr.delete(range.from, range.to)
          .setNodeMarkup($from.before(-1), undefined, { ...$from.node(-1).attrs, checked: match[1] === "x" || match[1] === "X" });
      },
    })];
  },
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { $from } = this.editor.state.selection;
        if ($from.depth < 2 || $from.node(-1).type.name !== "listItem" || $from.node(-1).attrs.checked == null) return false;
        return this.editor.commands.splitListItem("listItem", { checked: false });
      },
    };
  },
  addProseMirrorPlugins() {
    const getLocale = this.options.getLocale;
    const refreshTasks = new Set<() => void>();
    return [new Plugin({
      props: {
        nodeViews: {
          listItem(node, view, getPos): NodeView {
            const task = typeof node.attrs.checked === "boolean";
            const dom = document.createElement("li");
            if (!task) return {
              dom, contentDOM: dom,
              update: (next) => next.type === node.type && next.attrs.checked == null,
            };
            let current = node;
            dom.className = "task-list-item";
            const toggle = document.createElement("label");
            toggle.className = "inline-task-toggle";
            toggle.contentEditable = "false";
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            const contentDOM = document.createElement("div");
            contentDOM.className = "task-list-item__body";
            toggle.append(checkbox);
            dom.append(toggle, contentDOM);
            function sync() {
              dom.dataset.taskChecked = String(current.attrs.checked);
              checkbox.checked = current.attrs.checked;
              checkbox.disabled = !view.editable;
              checkbox.setAttribute("aria-label", translator(getLocale())("完成任务：{0}", current.firstChild?.textContent || translator(getLocale())("未命名任务")));
            }
            sync();
            refreshTasks.add(sync);
            // Pointer toggling must not move the text caret or close the mobile keyboard.
            toggle.addEventListener("mousedown", (event) => event.preventDefault());
            toggle.addEventListener("click", (event) => event.stopPropagation());
            checkbox.addEventListener("change", () => {
              const position = getPos();
              if (!view.editable || view.composing || position === undefined) { sync(); return; }
              view.dispatch(view.state.tr.setNodeMarkup(position, undefined, { ...current.attrs, checked: checkbox.checked }).setMeta(TASK_TOGGLE, true));
            });
            return {
              dom, contentDOM,
              destroy: () => { refreshTasks.delete(sync); },
              update(next) {
                if (next.type !== current.type || typeof next.attrs.checked !== "boolean") return false;
                current = next;
                sync();
                return true;
              },
              stopEvent: (event) => toggle.contains(event.target as globalThis.Node),
              ignoreMutation: (mutation) => mutation.type !== "selection" && !contentDOM.contains(mutation.target),
            };
          },
        },
      },
      view: () => ({ update() {
        refreshTasks.forEach((refresh) => refresh());
      } }),
    })];
  },
});
