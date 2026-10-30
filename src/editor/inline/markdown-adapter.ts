import { LocalizedError, message as msg, type LocalizedText } from "../../i18n/messages";
import type { JSONContent } from "@tiptap/core";
import type { Root } from "mdast";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkStringify from "remark-stringify";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { emptyTaskItems } from "../../renderer/empty-task-items";
import { defaultHandlers } from "mdast-util-to-markdown";

interface Ast {
  type: string;
  children?: Ast[];
  value?: string;
  depth?: number;
  lang?: string | null;
  meta?: string | null;
  ordered?: boolean;
  start?: number | null;
  checked?: boolean | null;
  spread?: boolean;
  url?: string;
  title?: string | null;
  align?: ("left" | "right" | "center" | null)[];
  position?: { start: { offset?: number } };
}

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath).use(emptyTaskItems)
  .use(remarkStringify, { bullet: "-", fences: true, emphasis: "*", handlers: {
    listItem(node, parent, state, info) {
      const value = defaultHandlers.listItem(node, parent, state, info);
      if (typeof node.checked !== "boolean") return value;
      // GFM's handler misses a bare marker and can place the checkbox on the
      // next line for an empty parent. Insert it on the marker line in all cases.
      return value.replace(/^([-+*]|\d+\.)(?=$|[ \r\n])/, `$1 [${node.checked ? "x" : " "}]`);
    },
  } });

const syntaxNames: Readonly<Record<string, string>> = {
  image: "正文内嵌图片", html: "HTML", footnoteReference: "脚注", footnoteDefinition: "脚注定义",
  linkReference: "引用式链接", imageReference: "引用式图片", definition: "引用定义",
};

export class InlineCompatibilityError extends LocalizedError {
  constructor(detail?: LocalizedText) {
    const content = detail ? msg("这段内容（{0}）", typeof detail === "string" ? msg(detail) : detail) : msg("这段内容的格式");
    super(msg("暂不支持直接编辑{0}，原文已保留。请通过“Markdown 源码”修改。", content));
    this.name = "InlineCompatibilityError";
  }
}

function inline(nodes: Ast[], marks: NonNullable<JSONContent["marks"]> = []): JSONContent[] {
  return nodes.flatMap((node): JSONContent[] => {
    switch (node.type) {
      case "text": return node.value ? [{ type: "text", text: node.value, marks }] : [];
      case "inlineCode": return node.value ? [{ type: "text", text: node.value, marks: [...marks, { type: "code" }] }] : [];
      case "break": return [{ type: "hardBreak", marks }];
      case "inlineMath":
        if (marks.length) throw new InlineCompatibilityError("带格式的行内公式");
        return [{ type: "inlineMath", attrs: { latex: node.value } }];
      case "strong": case "emphasis": case "delete": case "link": {
        const type = { strong: "bold", emphasis: "italic", delete: "strike", link: "link" }[node.type]!;
        if (node.type === "link" && !safeHref(node.url ?? "")) throw new InlineCompatibilityError("不安全的链接");
        return inline(node.children ?? [], [...marks, {
          type,
          ...(node.type === "link" ? { attrs: { href: node.url, title: node.title ?? null } } : {}),
        }]);
      }
      default: throw new InlineCompatibilityError(syntaxNames[node.type] ?? msg("未支持的语法：{0}", node.type));
    }
  });
}

export function safeHref(href: string): boolean {
  const compact = href.replace(/[\u0000-\u0020\u007f]/g, "");
  return !/^[a-z][a-z0-9+.-]*:/i.test(compact) || /^(https?:|mailto:)/i.test(compact);
}

function blocks(nodes: Ast[]): JSONContent[] {
  return nodes.map((node): JSONContent => {
    switch (node.type) {
      case "paragraph": return { type: "paragraph", content: inline(node.children ?? []) };
      case "heading": return { type: "heading", attrs: { level: node.depth }, content: inline(node.children ?? []) };
      case "blockquote": return { type: "blockquote", content: node.children?.length ? blocks(node.children) : [{ type: "paragraph", content: [] }] };
      case "thematicBreak": return { type: "horizontalRule" };
      case "code":
        if (node.meta) throw new InlineCompatibilityError("代码块带有额外标记");
        return { type: "codeBlock", attrs: { language: node.lang ?? null }, content: node.value ? [{ type: "text", text: node.value }] : [] };
      case "math":
        if (node.meta) throw new InlineCompatibilityError("公式带有额外标记");
        return { type: "blockMath", attrs: { latex: node.value } };
      case "list": return {
        type: node.ordered ? "orderedList" : "bulletList",
        ...(node.ordered ? { attrs: { start: node.start ?? 1 } } : {}),
        content: blocks(node.children ?? []),
      };
      case "listItem": {
        const content = blocks(node.children ?? []);
        // Markdown omits an empty opening paragraph. The editor needs it to put
        // the caret after a new bullet, including an empty parent of a nested list.
        if (!content.length || content[0].type === "bulletList" || content[0].type === "orderedList") {
          content.unshift({ type: "paragraph", content: [] });
        }
        return { type: "listItem", ...(node.checked != null ? { attrs: { checked: node.checked } } : {}), content };
      }
      case "table": return {
        type: "table",
        content: (node.children ?? []).map((row, rowIndex) => ({
          type: "tableRow",
          content: (row.children ?? []).map((cell, column) => ({
            type: rowIndex === 0 ? "tableHeader" : "tableCell",
            attrs: { align: node.align?.[column] ?? null },
            content: [{ type: "paragraph", content: inline(cell.children ?? []) }],
          })),
        })),
      };
      default: throw new InlineCompatibilityError(syntaxNames[node.type] ?? msg("未支持的语法：{0}", node.type));
    }
  });
}

export function markdownToEditor(source: string): JSONContent {
  const root = processor.runSync(processor.parse(source), source) as Ast;
  return { type: "doc", content: blocks(root.children ?? []) };
}

function inlineAst(nodes: JSONContent[]): Ast[] {
  // Group consecutive runs of the same mark so a multiword link/emphasis stays one node.
  if (!nodes.length) return [];
  const output: Ast[] = [];
  for (let index = 0; index < nodes.length;) {
    const node = nodes[index];
    const mark = node.marks?.[0];
    if (mark && mark.type !== "code") {
      const run: JSONContent[] = [];
      while (index < nodes.length && JSON.stringify(nodes[index].marks?.[0]) === JSON.stringify(mark)) {
        run.push({ ...nodes[index], marks: nodes[index].marks?.slice(1) });
        index++;
      }
      const type = { bold: "strong", italic: "emphasis", strike: "delete", link: "link" }[mark.type];
      if (!type) throw new InlineCompatibilityError(msg("不支持的格式 {0}", mark.type));
      if (mark.type === "link" && !safeHref(String(mark.attrs?.href ?? ""))) throw new InlineCompatibilityError("不安全的链接");
      output.push({ type, children: inlineAst(run), ...(type === "link" ? { url: String(mark.attrs?.href ?? ""), title: mark.attrs?.title ?? null } : {}) });
      continue;
    }
    if (node.type === "text") {
      if ((node.marks?.length ?? 0) > 1) throw new InlineCompatibilityError("代码里套了别的格式");
      const type = mark?.type === "code" ? "inlineCode" : "text";
      const previous = output.at(-1);
      if (previous?.type === type) previous.value = (previous.value ?? "") + (node.text ?? "");
      else output.push({ type, value: node.text ?? "" });
    } else if (node.type === "hardBreak") output.push({ type: "break" });
    else if (node.type === "inlineMath") output.push({ type: "inlineMath", value: String(node.attrs?.latex ?? "") });
    else throw new InlineCompatibilityError(msg("不支持的写法 {0}", String(node.type)));
    index++;
  }
  return output;
}

function blockAst(nodes: JSONContent[]): Ast[] {
  return nodes.map((node): Ast => {
    const content = node.content ?? [];
    switch (node.type) {
      case "paragraph": return { type: "paragraph", children: inlineAst(content) };
      case "heading": return { type: "heading", depth: node.attrs?.level, children: inlineAst(content) };
      case "blockquote": return { type: "blockquote", children: blockAst(content) };
      case "horizontalRule": return { type: "thematicBreak" };
      case "codeBlock": return { type: "code", lang: node.attrs?.language || null, value: content.map((child) => child.text ?? "").join("") };
      case "blockMath": return { type: "math", value: String(node.attrs?.latex ?? "") };
      case "orderedList": case "bulletList": return {
        type: "list", ordered: node.type === "orderedList", start: node.type === "orderedList" ? node.attrs?.start ?? 1 : null,
        spread: false, children: blockAst(content),
      };
      case "listItem": return {
        type: "listItem",
        ...(typeof node.attrs?.checked === "boolean" ? { checked: node.attrs.checked } : {}),
        // A bare nested marker directly below text can become a setext heading
        // (or ordinary text). A blank line keeps an unfinished nested list a list.
        spread: content.some((child, index) => index > 0
          && (child.type === "bulletList" || child.type === "orderedList")
          && !child.content?.[0]?.content?.[0]?.content?.length),
        children: blockAst(content),
      };
      case "table": {
        const columns = content[0]?.content?.length ?? 0;
        if (!columns) throw new InlineCompatibilityError("空表格");
        return {
          type: "table", align: content[0].content!.map((cell) => cell.attrs?.align ?? null),
          children: content.map((row, index) => {
            if (row.type !== "tableRow" || row.content?.length !== columns) throw new InlineCompatibilityError("每行格数不一样的表格");
            return { type: "tableRow", children: row.content.map((cell) => {
              if (cell.type !== (index === 0 ? "tableHeader" : "tableCell") || (cell.attrs?.colspan ?? 1) !== 1 || (cell.attrs?.rowspan ?? 1) !== 1
                || cell.content?.length !== 1 || cell.content[0].type !== "paragraph") {
                throw new InlineCompatibilityError("合并的单元格，或单元格里有多段文字");
              }
              return { type: "tableCell", children: inlineAst(cell.content[0].content ?? []) };
            }) };
          }),
        };
      }
      default: throw new InlineCompatibilityError(msg("不支持的写法 {0}", String(node.type)));
    }
  });
}

/** Toggle one marker in place, preserving all other Markdown, including unsupported syntax. */
export function toggleTaskInMarkdown(source: string, index: number): string {
  const root = processor.runSync(processor.parse(source), source) as Ast;
  let current = 0;
  let offset: number | undefined;
  function walk(node: Ast) {
    if (node.type === "listItem" && node.checked != null && current++ === index) offset = node.position?.start.offset;
    for (const child of node.children ?? []) walk(child);
  }
  walk(root);
  if (offset === undefined) return source;
  const match = /^(?:[-+*]|\d+[.)])[ \t]+\[([ xX])\]/.exec(source.slice(offset));
  if (!match) return source;
  const position = offset + match[0].length - 2;
  return source.slice(0, position) + (match[1] === " " ? "x" : " ") + source.slice(position + 1);
}

export function editorToMarkdown(document: JSONContent): string {
  if (document.type !== "doc") throw new InlineCompatibilityError("无法识别的内容");
  const root = { type: "root", children: blockAst(document.content ?? []) } as Root;
  return processor.stringify(root);
}
