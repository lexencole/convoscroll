import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import "katex/dist/katex.min.css";
import "../styles/global.css";
import { MarkdownBody } from "./MarkdownBody";

describe("MarkdownBody", () => {
  it("renders GFM tables and math without enabling raw HTML", () => {
    const { container } = render(
      <MarkdownBody
        source={[
          "| A | B |",
          "| - | - |",
          "| 1 | 2 |",
          "",
          "Inline $a^2+b^2=c^2$.",
          "",
          "$$",
          "E=mc^2",
          "$$",
          "",
          "<script>window.fixtureWasExecuted = true</script>",
        ].join("\n")}
      />,
    );

    expect(screen.getByRole("table")).toBeInTheDocument();
    const math = container.querySelectorAll<HTMLElement>(".katex[data-math-index]");
    expect(math).toHaveLength(2);
    expect(math[0]).toHaveAttribute("data-math-source", "a^2+b^2=c^2");
    expect(math[0]).toHaveAttribute("data-math-display", "false");
    expect(math[1]).toHaveAttribute("data-math-source", "E=mc^2");
    expect(math[1]).toHaveAttribute("data-math-display", "true");
    expect(container.querySelector("script")).not.toBeInTheDocument();
    expect((window as Window & { fixtureWasExecuted?: boolean }).fixtureWasExecuted).toBeUndefined();
  });

  it("uses the code renderer for fenced code", async () => {
    const { container } = render(
      <MarkdownBody source={'```ts\nconst width = 480;\n```'} />,
    );

    expect(container.querySelector(".code-block")).toHaveAttribute("data-highlight-state");
    await waitFor(() => {
      expect(container.querySelector(".code-block__highlight code")).toHaveTextContent(
        "const width = 480;",
      );
    });
  });

  it.each(["```python\n```", "```\n```", "```\nprint(1)\n```"])("keeps empty and unlabelled fences as code blocks: %s", async (source) => {
    const { container } = render(<MarkdownBody source={source} />);
    await waitFor(() => expect(container.querySelector(".code-block")).toHaveAttribute("data-highlight-state", "ready"));
    expect(container.querySelector(".code-block code")?.textContent).toBe(source.includes("print") ? "print(1)" : "");
    expect(container).not.toHaveTextContent("undefined");
  });

  it("renders task lists without duplicate bullets and aligns the checkbox row", () => {
    const { container } = render(
      <MarkdownBody source={"- [x] 使用本地图片\n- [ ] 不依赖远程资源"} />,
    );

    const list = container.querySelector("ul.contains-task-list");
    const items = container.querySelectorAll("li.task-list-item");
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');

    expect(list).not.toBeNull();
    expect(getComputedStyle(list!).listStyleType).toBe("none");
    expect(items).toHaveLength(2);
    expect(getComputedStyle(items[0]).display).toBe("flex");
    expect(checkbox).toBeChecked();
    expect(getComputedStyle(checkbox!).marginTop).toBe("0.4em");
  });

  it("keeps KaTeX scripts indivisible inside breakable markdown", () => {
    const { container } = render(
      <MarkdownBody source={String.raw`Inline $W_{output}=W_{css}\times s$.`} />,
    );

    const katexHtml = container.querySelector<HTMLElement>(".katex-html");
    const scriptPart = container.querySelector<HTMLElement>(".katex-html .msupsub span");

    expect(katexHtml).not.toBeNull();
    expect(scriptPart).not.toBeNull();
    expect(getComputedStyle(katexHtml!).overflowWrap).toBe("normal");
    expect(getComputedStyle(katexHtml!).whiteSpace).toBe("nowrap");
    expect(getComputedStyle(scriptPart!).overflowWrap).toBe("normal");
    expect(getComputedStyle(scriptPart!).wordBreak).toBe("normal");

    katexHtml!.closest(".katex")!.classList.add("math-overflow--fallback");

    expect(getComputedStyle(katexHtml!).overflowWrap).toBe("anywhere");
    expect(getComputedStyle(katexHtml!).whiteSpace).not.toBe("nowrap");
  });

  it("hides the rendered display formula once it falls back to LaTeX source", () => {
    const { container } = render(<MarkdownBody source={"$$\nE=mc^2\n$$"} />);
    const katexHtml = container.querySelector<HTMLElement>(".katex-display > .katex > .katex-html");
    expect(katexHtml).not.toBeNull();
    expect(getComputedStyle(katexHtml!).display).toBe("block");
    katexHtml!.closest(".katex")!.classList.add("math-overflow--fallback");
    expect(getComputedStyle(katexHtml!).display).toBe("none");
  });
});
