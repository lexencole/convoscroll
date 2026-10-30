// Keeps the last few characters of each paragraph and list item on one line, so a
// paragraph never ends with a line of one character, or one character and its
// punctuation. This replaces `text-wrap: pretty`: Safari applies it to the whole
// paragraph and leaves every line short, while this guard only moves characters
// onto the last line.

interface HastNode {
  type?: string;
  tagName?: string;
  value?: string;
  children?: HastNode[];
  properties?: Record<string, unknown>;
}

/** The kept run has at least three characters, two of them not closing punctuation. */
const KEEP = 3;
const KEEP_WITHOUT_PUNCTUATION = 2;
const CLOSING = /[。．.，,；;：:！？!?、…）)」』》〉】”’"']/u;
const GUARDED = new Set(["p", "li"]);
const INLINE = new Set(["strong", "em", "b", "i", "u", "s", "del", "mark", "a", "span"]);
/** A list item's own text ends where its nested list starts. */
const NESTED_LIST = new Set(["ul", "ol"]);

export function keepLineEnd() {
  return (root: HastNode) => walk(root);
}

function walk(node: HastNode) {
  for (const child of node.children ?? []) {
    if (child.type !== "element") continue;
    if (GUARDED.has(child.tagName ?? "")) guard(child);
    walk(child);
  }
}

/** Follows the trailing inline content down to its last text node and splits it. */
function guard(element: HastNode) {
  const children = element.children ?? [];
  for (let index = children.length - 1; index >= 0; index--) {
    const child = children[index];
    if (child.type === "text") {
      if (!child.value?.trim()) continue;
      const parts = split(child.value);
      children.splice(index, 1, ...parts);
      // Only closing punctuation: keep looking in the element before it.
      if (parts.some((part) => part.type === "element")) return;
      continue;
    }
    if (child.type === "element" && NESTED_LIST.has(child.tagName ?? "")) continue;
    // Code, math, images, line breaks and nested blocks end the search.
    if (child.type !== "element" || !INLINE.has(child.tagName ?? "") || isMath(child)) return;
    guard(child);
    return;
  }
}

/**
 * The part of one text node to keep together, as UTF-16 offsets. Closing punctuation
 * at the start is left out, so it stays attached to what comes before it; a formula
 * that moves to its own line takes it along (math-overflow.ts). Returns undefined when
 * the text is only punctuation and whitespace. The editor shows the same line ends
 * with this range (inline-keep-line-end.ts).
 */
export function keptRange(value: string): { start: number; end: number } | undefined {
  const characters = Array.from(value);
  let first = 0;
  while (first < characters.length && CLOSING.test(characters[first])) first++;
  let last = characters.length;
  while (last > first && /\s/.test(characters[last - 1])) last--;
  if (last === first) return undefined;
  let punctuation = 0;
  while (last - punctuation > first && CLOSING.test(characters[last - punctuation - 1])) punctuation++;
  const from = Math.max(first, last - Math.max(KEEP, punctuation + KEEP_WITHOUT_PUNCTUATION));
  const offset = (index: number) => characters.slice(0, index).join("").length;
  return { start: offset(from), end: offset(last) };
}

function split(value: string): HastNode[] {
  const range = keptRange(value);
  if (!range) return [{ type: "text", value }];
  const head = value.slice(0, range.start);
  const trailing = value.slice(range.end);
  const kept: HastNode = { type: "element", tagName: "span", properties: { className: ["keep-together"] }, children: [{ type: "text", value: value.slice(range.start, range.end) }] };
  return [
    ...(head ? [{ type: "text", value: head }] : []),
    kept,
    ...(trailing ? [{ type: "text", value: trailing }] : []),
  ];
}

function isMath(node: HastNode) {
  const value = node.properties?.className;
  const classes = Array.isArray(value) ? value.map(String) : typeof value === "string" ? value.split(/\s+/) : [];
  return classes.some((name) => name === "katex" || name.startsWith("math-"));
}
