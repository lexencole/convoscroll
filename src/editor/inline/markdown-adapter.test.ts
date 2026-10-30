import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { inlineExtensions } from "./inline-extensions";
import { getFixture } from "../../data/fixtures";
import { editorToMarkdown, markdownToEditor, safeHref, toggleTaskInMarkdown } from "./markdown-adapter";

const examples = [
  "# 海的另一边\n\n中文 **加粗**、*倾斜*、~~删除~~与 `code`。\n",
  "- 阿尔敏\n- 艾伦\n  - 自由\n\n3. 第三项\n4. 第四项\n",
  "> 一段话\n>\n> 第二段\n\n---\n",
  "```python\nr = 6371\nprint(r)\n```\n",
  "眼睛高度 $h = 1.7$。\n\n$$\nd = \\sqrt{2Rh + h^2}\n$$\n",
  "| 人物 | 看见了什么 | 数量 |\n| :--- | :---: | ---: |\n| 阿尔敏 | **海** | 1 |\n| 艾伦 | `敌人` | 2 |\n",
  "[一段 **链接** 文字](https://example.com/a?q=1 \"保留标题\")，换行\\\n下一行。\n",
  "## 金额与符号\n\n\\$5 和 \\$10，普通 <https://example.com>。\n",
  "- [ ] 待办 **加粗** $x$\n- 普通项\n- [x] 已完成\n  - [ ] 子任务\n\n3. [X] 有序任务\n4. 普通编号\n",
  "- [ ]\n- [x] \n- [X]\n",
  "- [ ]\n  - [x] 子任务\n",
  "> - [ ] 空任务\n> - [x]\n",
  "- \\[ ]\n- &#91;x]\n- `[]`\n",
];

describe("bounded inline Markdown adapter", () => {
  it.each(examples)("preserves semantic nodes on a parse/stringify round trip: %s", (source) => {
    const original = markdownToEditor(source);
    expect(markdownToEditor(editorToMarkdown(original))).toEqual(original);
  });

  it.each(examples)("survives the actual editor schema: %s", (source) => {
    const editor = new Editor({
      extensions: inlineExtensions({ onReject: () => undefined, onMath: () => undefined }),
      content: markdownToEditor(source),
    });
    try {
      expect(markdownToEditor(editorToMarkdown(editor.getJSON()))).toEqual(markdownToEditor(source));
    } finally { editor.destroy(); }
  });

  it("keeps every default story paragraph editable in place", () => {
    const fixture = getFixture("story");
    if (fixture.status !== "valid") throw new Error("Story fixture must be valid");
    const sources = fixture.document.messages.flatMap((message) => message.blocks)
      .flatMap((block) => block.type === "markdown" ? [block.source] : []);
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      const content = markdownToEditor(source);
      expect(markdownToEditor(editorToMarkdown(content))).toEqual(content);
    }
  });

  it.each([
    "<script>alert(1)</script>",
    "![外部图片](https://example.com/a.png)",
    "[引用][a]\n\n[a]: https://example.com",
    "```js title=秘密\nx\n```",
    "[危险](javascript:alert%281%29)",
    "脚注[^1]\n\n[^1]: 注释",
  ])("rejects unsupported source without modifying it: %s", (source) => {
    const original = source;
    expect(() => markdownToEditor(source)).toThrow(/原文已保留/);
    expect(source).toBe(original);
  });

  it("rejects unsupported editor nodes, merged cells and multiple cell paragraphs", () => {
    expect(() => editorToMarkdown({ type: "doc", content: [{ type: "image" }] })).toThrow();
    const table = markdownToEditor("| A | B |\n| --- | --- |\n| C | D |");
    const cell = table.content![0].content![1].content![0];
    cell.attrs = { colspan: 2 };
    expect(() => editorToMarkdown(table)).toThrow(/合并的单元格/);
    cell.attrs = {};
    cell.content!.push({ type: "paragraph" });
    expect(() => editorToMarkdown(table)).toThrow(/多段文字/);
  });

  it("toggles only the chosen marker, preserving unsupported content and Markdown spelling", () => {
    const source = "+ [X] 第一项\n  * [ ] 子项\n\n<!-- keep -->\n\n> 3) [ ]\n\n- \\[ ]\n";
    expect(toggleTaskInMarkdown(source, 0)).toBe(source.replace("[X]", "[ ]"));
    expect(toggleTaskInMarkdown(source, 1)).toBe(source.replace("* [ ]", "* [x]"));
    expect(toggleTaskInMarkdown(source, 2)).toBe(source.replace("3) [ ]", "3) [x]"));
    expect(toggleTaskInMarkdown(source, 3)).toBe(source);
  });

  it("rejects script and data protocols including control-character disguises", () => {
    for (const url of ["javascript:alert(1)", " java\nscript:alert(1)", "data:text/html,x", "vbscript:x"]) expect(safeHref(url)).toBe(false);
    for (const url of ["https://example.com", "mailto:a@example.com", "#section", "/relative"]) expect(safeHref(url)).toBe(true);
  });
});
