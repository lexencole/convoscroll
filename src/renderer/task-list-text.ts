// A task list item is a flex row: checkbox, gap, text. Without a wrapper every inline
// element after the checkbox becomes its own flex item with a gap on each side, so
// bold text, links and the kept line end (keep-line-end.ts) split the line.

interface HastNode {
  type?: string;
  tagName?: string;
  children?: HastNode[];
  properties?: Record<string, unknown>;
}

export function wrapTaskListText() {
  return (root: HastNode) => {
    let index = 0;
    walk(root);
    function walk(node: HastNode) {
      for (const child of node.children ?? []) {
        if (child.type !== "element") continue;
        if (child.tagName === "li" && isTaskListItem(child)) wrap(child);
        if (child.tagName === "input" && child.properties?.type === "checkbox") {
          child.properties["data-task-index"] = index++;
        }
        walk(child);
      }
    }
  };
}

function wrap(item: HastNode) {
  const children = item.children ?? [];
  const checkbox = children.findIndex((child) => child.type === "element" && child.tagName === "input");
  if (checkbox < 0) {
    // Loose items put the checkbox in the first paragraph. Pull it out so all
    // paragraphs and nested lists remain one vertical body beside the checkbox.
    const paragraph = children.find((child) => child.type === "element");
    if (paragraph?.tagName !== "p") return;
    const input = paragraph.children?.find((child) => child.type === "element" && child.tagName === "input");
    if (!input) return;
    paragraph.children = paragraph.children!.filter((child) => child !== input);
    item.children = [input, { type: "element", tagName: "div", properties: { className: ["task-list-item__body"] }, children }];
    return;
  }
  if (checkbox === children.length - 1) return;
  const body: HastNode = { type: "element", tagName: "div", properties: { className: ["task-list-item__body"] }, children: children.slice(checkbox + 1) };
  item.children = [...children.slice(0, checkbox + 1), body];
}

function isTaskListItem(node: HastNode) {
  const value = node.properties?.className;
  const classes = Array.isArray(value) ? value.map(String) : typeof value === "string" ? value.split(/\s+/) : [];
  return classes.includes("task-list-item");
}
