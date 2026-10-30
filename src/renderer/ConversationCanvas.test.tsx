import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getFixture } from "../data/fixtures";
import { ConversationCanvas } from "./ConversationCanvas";

describe("ConversationCanvas", () => {
  it("deduplicates identical name and model labels without changing source data or the brand icon", () => {
    const fixture = getFixture("basic");
    if (fixture.status !== "valid") throw new Error("Basic fixture must be valid");
    const assistant = fixture.document.messages.find((message) => message.role === "assistant")!;
    const document = { ...fixture.document, messages: [{ ...assistant, displayName: "ChatGPT", model: " chatgpt ", timestamp: undefined, status: undefined }] };
    const original = JSON.stringify(document);
    const { container, rerender } = render(<ConversationCanvas document={document} />);
    expect(container.querySelector(".message__identity strong")).toHaveTextContent("ChatGPT");
    expect(container.querySelector(".message__model")).toBeNull();
    expect(container.querySelector(".message__header-meta")).toBeNull();
    expect(container.querySelector('[data-model-brand="openai"]')).toBeInTheDocument();
    rerender(<ConversationCanvas document={document} exportPresentation={{ width: 480, foldStrategy: "block" }} />);
    expect(container.querySelector(".message__model")).toBeNull();
    expect(JSON.stringify(document)).toBe(original);
  });
  it("retains distinct models and other identity metadata", () => {
    const fixture = getFixture("basic");
    if (fixture.status !== "valid") throw new Error("Basic fixture must be valid");
    const assistant = fixture.document.messages.find((message) => message.role === "assistant")!;
    const message = { ...assistant, displayName: "ChatGPT", model: "GPT-5", timestamp: "2026-09-27T00:00:00Z", status: "complete" as const };
    const { container, rerender } = render(<ConversationCanvas document={{ ...fixture.document, messages: [message] }} />);
    expect(container.querySelector(".message__model")).toHaveTextContent("GPT-5");
    expect(container.querySelector("time")).toHaveAttribute("datetime", message.timestamp);
    expect(container.querySelector(".message__status")).toHaveTextContent("已完成");
    rerender(<ConversationCanvas document={{ ...fixture.document, messages: [{ ...message, model: "ChatGPT" }] }} />);
    expect(container.querySelector(".message__model")).toBeNull();
    expect(container.querySelector("time")).toHaveAttribute("datetime", message.timestamp);
    expect(container.querySelector(".message__status")).toHaveTextContent("已完成");
  });
  it("renders the basic fixture at its fixed logical width", () => {
    const fixture = getFixture("basic");
    if (fixture.status !== "valid") throw new Error("Basic fixture must be valid");

    render(<ConversationCanvas document={fixture.document} />);

    const canvas = screen.getByTestId("conversation-canvas");

    expect(canvas).toHaveAttribute("data-canvas-width", "480");
    expect(canvas).toHaveAttribute(
      "data-theme-id",
      "warm-editorial-v1",
    );
    expect(canvas).toHaveStyle({ width: "480px" });
    expect(canvas).toHaveStyle({
      "--color-canvas": "#fbfaf6",
      "--stream-gap": "24px",
      "--message-assistant-outline-width": "1px",
      "--message-assistant-border-width": "3px",
    });
    expect(getComputedStyle(canvas).borderTopStyle).toBe("none");
    expect(screen.getAllByText("Levi").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Claude").length).toBeGreaterThan(0);
    expect(screen.queryByText("2 messages")).not.toBeInTheDocument();
    expect(screen.queryByText("zh-CN")).not.toBeInTheDocument();
    expect(screen.queryByText("480 CSS px")).not.toBeInTheDocument();
    expect(screen.queryByText("Local preview")).not.toBeInTheDocument();
    expect(screen.queryByText("Schema v1")).not.toBeInTheDocument();
  });

  it("reads a wide logical width from the document instead of fixed CSS", () => {
    const fixture = getFixture("basic");
    if (fixture.status !== "valid") throw new Error("Basic fixture must be valid");
    const wideDocument = {
      ...fixture.document,
      canvas: { preset: "wide", width: 720, scale: 2 } as const,
    };

    render(<ConversationCanvas document={wideDocument} />);

    expect(screen.getByTestId("conversation-canvas")).toHaveAttribute("data-canvas-width", "720");
    expect(screen.getByTestId("conversation-canvas")).toHaveStyle({ width: "720px" });
  });

  it("shows headings, a table, math, code, an image and a file in the default story", () => {
    const fixture = getFixture("story");
    if (fixture.status !== "valid") throw new Error("Story fixture must be valid");
    const { container } = render(<ConversationCanvas document={fixture.document} />);

    expect(screen.getByRole("heading", { level: 2, name: "时长及格，时间不及格" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "正经复活方案" })).toBeInTheDocument();
    expect(screen.getByRole("table")).toHaveTextContent("睡眠中点");
    expect(screen.getByText("python", { selector: "figcaption" })).toBeInTheDocument();
    expect(container.querySelector(".katex-display")).toBeInTheDocument();
    expect(container.querySelector(".katex-error")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "上周七天的睡眠时段，整体比常规作息晚约 4.5 小时" })).toHaveAttribute("src");
    expect(screen.getByRole("article", { name: "文件：上周作息" })).toHaveTextContent("上周作息.csv");
    expect(container.querySelector(".asset-placeholder")).not.toBeInTheDocument();
    expect(container.querySelectorAll('[data-model-brand="claude"]')).toHaveLength(4);

    const reasoning = screen.getByRole("button", { name: /先核对这个对称命题/ });
    expect(reasoning).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(reasoning);
    expect(reasoning).toHaveAttribute("aria-expanded", "true");
  });

  it("uses a local model brand icon while preserving unknown-model and custom-avatar fallbacks", () => {
    const fixture = getFixture("basic");
    if (fixture.status !== "valid") throw new Error("Basic fixture must be valid");
    const brandedDocument = {
      ...fixture.document,
      messages: fixture.document.messages.map((message) => message.role === "assistant"
        ? { ...message, model: "Claude 4 Sonnet" }
        : message),
    };

    const { container, rerender } = render(<ConversationCanvas document={brandedDocument} />);
    expect(container.querySelector('[data-model-brand="claude"]')).toBeInTheDocument();

    const unknownModelDocument = {
      ...fixture.document,
      messages: fixture.document.messages.map((message) => message.role === "assistant"
        ? { ...message, displayName: "Atlas", model: "Atlas Demo 1.0" }
        : message),
    };
    rerender(<ConversationCanvas document={unknownModelDocument} />);
    expect(container.querySelector("[data-model-brand]")).not.toBeInTheDocument();
    expect(container.querySelector(".message--assistant .message__avatar")).toHaveTextContent("A");

    const rich = getFixture("rich");
    if (rich.status !== "valid") throw new Error("Rich fixture must be valid");
    const assistantId = "msg-rich-004-assistant-analysis";
    const customAvatarDocument = {
      ...rich.document,
      messages: rich.document.messages.map((message) => message.id === assistantId
        ? { ...message, avatarAssetId: "asset-rich-avatar" }
        : message),
    };
    rerender(<ConversationCanvas document={customAvatarDocument} />);
    const assistant = container.querySelector(`[data-message-id='${assistantId}']`);
    expect(assistant?.querySelector(".message__avatar img")).toHaveAttribute(
      "src",
      expect.stringMatching(/^data:image\/svg\+xml,/),
    );
    expect(assistant?.querySelector("[data-model-brand]")).not.toBeInTheDocument();
  });

  it("uses the same canvas for a derived continuation slice", () => {
    const fixture = getFixture("rich");
    if (fixture.status !== "valid") throw new Error("Rich fixture must be valid");
    const { container } = render(
      <ConversationCanvas
        document={fixture.document}
        exportPresentation={{
          width: 720,
          foldStrategy: "collapsed",
          part: {
            index: 1,
            total: 3,
            messages: [{
              messageId: "msg-rich-003-user",
              blockIds: ["block-rich-003-markdown"],
              continuedFromPrevious: true,
            }],
          },
        }}
      />,
    );

    const canvas = screen.getByTestId("conversation-canvas");
    expect(canvas).toHaveAttribute("data-export-part", "2/3");
    expect(canvas).toHaveStyle({ width: "720px" });
    expect(screen.getByText("续 · 第 2 部分，共 3 部分")).toBeInTheDocument();
    expect(container.querySelectorAll("[data-message-id]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-block-id]")).toHaveLength(1);
    expect(screen.getByText("续", { selector: ".message__continuation" })).toBeInTheDocument();
  });

  it("renders the complete rich block set with v1 metadata", () => {
    const fixture = getFixture("rich");
    if (fixture.status !== "valid") throw new Error("Rich fixture must be valid");

    const { container } = render(<ConversationCanvas document={fixture.document} />);

    expect(screen.getAllByText("工具调用").length).toBeGreaterThan(0);
    expect(screen.getByText("暂不支持")).toBeInTheDocument();
    expect(screen.getByText("episodeTimeline")).toBeInTheDocument();
    expect(screen.getByText("给观影群看的长预算式")).toBeInTheDocument();
    expect(screen.getByText("python", { selector: "figcaption" })).toBeInTheDocument();
    expect(container.querySelectorAll(".image-block")).toHaveLength(3);
    expect(
      container.querySelector(
        "[data-message-id='msg-rich-010-assistant-final'] .image-block--full",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("读不到这张图片")).toBeInTheDocument();
    expect(screen.getAllByText("已完成").length).toBeGreaterThan(0);
    expect(screen.getByText("2026-06-12 09:42 UTC")).toBeInTheDocument();
    expect(container.querySelector(".message__avatar img")).toHaveAttribute(
      "src",
      expect.stringMatching(/^data:image\/svg\+xml,/),
    );
    expect(container.querySelector("[data-message-id='msg-rich-003-user']")).toHaveClass(
      "message--user",
    );
    expect(container.querySelector("[data-message-id='msg-rich-004-assistant-analysis']")).toHaveClass(
      "message--assistant",
    );
    expect(container.querySelector(".trace-card__chevron svg path")).toHaveAttribute(
      "d",
      "m4.25 2.5 3.5 3.5-3.5 3.5",
    );
    const toolIdentifier = container.querySelector<HTMLElement>(
      '.trace-card[data-kind="toolResult"] .trace-card__heading strong',
    );
    expect(toolIdentifier).not.toBeNull();
    expect(toolIdentifier).toHaveClass("trace-card__title--technical");
    expect(toolIdentifier).toHaveTextContent("check_spoiler_boundary");
    expect(container.querySelectorAll(".trace-stack").length).toBeGreaterThan(0);
  });

  it("toggles reasoning, tool and unsupported content without mutating the fixture", () => {
    const fixture = getFixture("rich");
    if (fixture.status !== "valid") throw new Error("Rich fixture must be valid");
    const original = JSON.parse(JSON.stringify(fixture.document)) as unknown;

    render(<ConversationCanvas document={fixture.document} />);

    const reasoningToggle = screen.getByRole("button", { name: /先守住剧透边界/ });
    expect(reasoningToggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(reasoningToggle);
    expect(reasoningToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/先定义小满已经知道的范围/)).toBeInTheDocument();

    const unsupportedToggle = screen.getByRole("button", { name: /episodeTimeline/ });
    expect(unsupportedToggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(unsupportedToggle);
    expect(unsupportedToggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/"showSpoilerShield": true/)).toBeInTheDocument();

    expect(fixture.document).toEqual(original);
  });
});
