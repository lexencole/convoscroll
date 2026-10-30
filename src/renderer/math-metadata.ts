interface HastNode {
  readonly type?: string;
  readonly value?: string;
  readonly children?: HastNode[];
  properties?: Record<string, unknown>;
}

interface VFileLike {
  readonly data: Record<string, unknown>;
}

interface MathMetadata {
  readonly display: boolean;
  readonly source: string;
}

const MATH_METADATA_KEY = "conversationMathMetadata";

function classNames(node: HastNode): readonly string[] {
  const value = node.properties?.className;
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === "string") return value.split(/\s+/);
  return [];
}

function textContent(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  return node.children?.map(textContent).join("") ?? "";
}

function walk(node: HastNode, visit: (current: HastNode) => void) {
  visit(node);
  node.children?.forEach((child) => walk(child, visit));
}

export function captureMathMetadata() {
  return (root: HastNode, file: VFileLike) => {
    const metadata: MathMetadata[] = [];

    walk(root, (node) => {
      const classes = classNames(node);
      const display = classes.includes("math-display");
      if (!display && !classes.includes("math-inline")) return;

      metadata.push({
        display,
        source: textContent(node),
      });
    });

    file.data[MATH_METADATA_KEY] = metadata;
  };
}

export function attachMathMetadata() {
  return (root: HastNode, file: VFileLike) => {
    const metadata = file.data[MATH_METADATA_KEY];
    if (!Array.isArray(metadata)) return;

    let index = 0;
    walk(root, (node) => {
      if (!classNames(node).includes("katex")) return;

      const item = metadata[index] as MathMetadata | undefined;
      if (!item) return;

      node.properties ??= {};
      node.properties.dataMathDisplay = item.display ? "true" : "false";
      node.properties.dataMathIndex = String(index);
      node.properties.dataMathSource = item.source;
      index += 1;
    });
  };
}
