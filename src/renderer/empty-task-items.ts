import type { Root, RootContent } from "mdast";
import type { VFile } from "vfile";

/** GFM needs text after a task marker. Preserve the unfinished item while editing. */
export function emptyTaskItems() {
  return (tree: Root, file: VFile) => {
    const source = String(file);
    function walk(node: Root | RootContent) {
      if (node.type === "listItem" && node.checked == null) {
        const first = node.children[0];
        if (first?.type === "paragraph" && first.children.length === 1 && first.children[0].type === "text") {
          const text = first.children[0];
          const raw = source.slice(text.position?.start.offset, text.position?.end.offset);
          // Check the original spelling so \[ ] and character references stay literal.
          const marker = /^\[([ xX])\]$/.exec(raw);
          if (marker) {
            node.checked = marker[1] !== " ";
            first.children = [];
          }
        }
      }
      if ("children" in node) for (const child of node.children) walk(child);
    }
    walk(tree);
  };
}
