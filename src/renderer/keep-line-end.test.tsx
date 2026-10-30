import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownBody } from "./MarkdownBody";

function kept(source: string) {
  const { container } = render(<MarkdownBody source={source} />);
  return { container, spans: [...container.querySelectorAll(".keep-together")].map((span) => span.textContent) };
}

describe("keepLineEnd", () => {
  it("keeps the last three characters of a paragraph together", () => {
    const { container, spans } = kept("大家都在玩水，只有艾伦站成了一座雕像。");
    expect(spans).toEqual(["雕像。"]);
    expect(container.textContent).toBe("大家都在玩水，只有艾伦站成了一座雕像。");
  });

  it("follows bold, italic and links to the last text", () => {
    expect(kept("他脑子里只剩一句：*然后呢*").spans).toEqual(["然后呢"]);
    expect(kept("看这里 [海边的照片](https://example.com)").spans).toEqual(["的照片"]);
  });

  it("does not count closing punctuation as one of the kept characters", () => {
    expect(kept("她说：‘别提前告诉我该喜欢谁，也别替我解释。’").spans).toEqual(["解释。’"]);
    expect(kept("改成‘一起留下三个当下’：").spans).toEqual(["当下’："]);
  });

  it("leaves closing punctuation attached to what comes before it", () => {
    const bold = kept("他脑子里只剩一句：**然后呢？**。");
    expect(bold.spans).toEqual(["后呢？"]);
    expect(bold.container.querySelector("p")?.lastChild?.textContent).toBe("。");

    const math = kept("预算是 $B_{night}$。");
    expect(math.spans).toEqual([]);
    expect(math.container.querySelector(".katex")?.nextSibling?.nodeType).toBe(Node.TEXT_NODE);
    expect(math.container.querySelector(".katex")?.nextSibling?.textContent).toBe("。");
  });

  it("guards each list item and nested paragraph once", () => {
    const { spans } = kept("- 阿尔敏：真的是咸的！\n- 艾伦：站着\n  - 盯着海那头\n\n> 有人没能来，来了的人又各自在想别的事。");
    expect(spans).toEqual(["咸的！", "：站着", "海那头", "的事。"]);
  });

  it("guards task list text inside its wrapper", () => {
    expect(kept("- [x] 画一张不含**角色**的原创主题海报\n- [ ] 写下小满已经知道的基础设定").spans).toEqual(["题海报", "础设定"]);
  });

  it("leaves code, math and headings alone", () => {
    expect(kept("用 `math.sqrt`").spans).toEqual([]);
    expect(kept("公式 $a^2 + b^2$").spans).toEqual([]);
    expect(kept("# 三个人想去的地方").spans).toEqual([]);
  });
});
