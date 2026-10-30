import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const shikiMocks = vi.hoisted(() => ({
  codeToHtml: vi.fn(),
  createHighlighterCore: vi.fn(),
}));

vi.mock("@shikijs/core", () => ({
  createCssVariablesTheme: vi.fn(() => ({ name: "conversation-neutral" })),
  createHighlighterCore: shikiMocks.createHighlighterCore,
}));

function highlighted(code: string) {
  const escaped = code
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
  return `<pre class="shiki"><code>${escaped}</code></pre>`;
}

async function expectReady() {
  await waitFor(() => expect(screen.getByRole("figure")).toHaveAttribute("data-highlight-state", "ready"));
}

describe("ShikiCodeBlock", () => {
  beforeEach(() => {
    vi.resetModules();
    shikiMocks.codeToHtml.mockReset();
    shikiMocks.codeToHtml.mockImplementation((code: string) => highlighted(code));
    shikiMocks.createHighlighterCore.mockReset();
    shikiMocks.createHighlighterCore.mockImplementation(async () => ({
      codeToHtml: shikiMocks.codeToHtml,
      getLoadedLanguages: () => [],
      loadLanguage: async () => undefined,
    }));
  });

  it("does not initialize Shiki until a supported language is rendered", async () => {
    const { ShikiCodeBlock } = await import("./ShikiCodeBlock");
    expect(shikiMocks.createHighlighterCore).not.toHaveBeenCalled();

    render(<ShikiCodeBlock code="echo hello" language="unknown-language" />);
    await expectReady();

    expect(shikiMocks.createHighlighterCore).not.toHaveBeenCalled();
    expect(screen.getByRole("figure")).toHaveTextContent("unknown-language");
  });

  it("loads only requested grammars and shares concurrent language requests", async () => {
    const languages = await import("./code-languages");
    const load = vi.spyOn(languages, "loadCodeLanguages");
    const { getHighlighter } = await import("./ShikiCodeBlock");
    await Promise.all([getHighlighter(["py"]), getHighlighter(["python"])]);
    expect(load.mock.calls).toEqual([[["python"]]]);
    await getHighlighter(["json"]);
    expect(load.mock.calls).toEqual([[["python"]], [["json"]]]);
    expect(shikiMocks.createHighlighterCore).toHaveBeenCalledTimes(1);
    load.mockRestore();
  });

  it("retries a failed grammar without reinitializing or blocking another language", async () => {
    const languages = await import("./code-languages");
    const load = vi.spyOn(languages, "loadCodeLanguages").mockRejectedValueOnce(new Error("offline"));
    const { getHighlighter } = await import("./ShikiCodeBlock");
    await expect(getHighlighter(["python"])).rejects.toThrow("offline");
    await getHighlighter(["json"]);
    await getHighlighter(["python"]);
    expect(load.mock.calls).toEqual([[["python"]], [["json"]], [["python"]]]);
    expect(shikiMocks.createHighlighterCore).toHaveBeenCalledTimes(1);
    load.mockRestore();
  });

  it("keeps only the 64 most recently used highlighted results", async () => {
    const { ShikiCodeBlock } = await import("./ShikiCodeBlock");
    const { rerender } = render(<ShikiCodeBlock code="code-0" language="json" />);
    await expectReady();

    for (let index = 1; index <= 64; index += 1) {
      rerender(<ShikiCodeBlock code={`code-${index}`} language="json" />);
      await expectReady();
    }
    expect(shikiMocks.codeToHtml).toHaveBeenCalledTimes(65);

    rerender(<ShikiCodeBlock code="code-0" language="json" />);
    await expectReady();
    expect(shikiMocks.codeToHtml).toHaveBeenCalledTimes(66);

    rerender(<ShikiCodeBlock code="code-64" language="json" />);
    await expectReady();
    expect(shikiMocks.codeToHtml).toHaveBeenCalledTimes(66);
  });

  it("evicts least-recently-used results when their combined character weight exceeds the budget", async () => {
    const firstCode = "a".repeat(70_000);
    const secondCode = "b".repeat(70_000);
    const { ShikiCodeBlock } = await import("./ShikiCodeBlock");
    const { rerender } = render(<ShikiCodeBlock code={firstCode} language="json" />);
    await expectReady();

    rerender(<ShikiCodeBlock code={secondCode} language="json" />);
    await expectReady();
    expect(shikiMocks.codeToHtml).toHaveBeenCalledTimes(2);

    rerender(<ShikiCodeBlock code={firstCode} language="json" />);
    await expectReady();
    expect(shikiMocks.codeToHtml).toHaveBeenCalledTimes(3);
  });

  it("bypasses the cache for a single source larger than the character budget", async () => {
    const oversizedCode = "x".repeat(300_000);
    const { ShikiCodeBlock } = await import("./ShikiCodeBlock");
    const first = render(<ShikiCodeBlock code={oversizedCode} language="json" />);
    await expectReady();
    first.unmount();

    render(<ShikiCodeBlock code={oversizedCode} language="json" />);
    await expectReady();
    expect(shikiMocks.codeToHtml).toHaveBeenCalledTimes(2);
  });

  it("verifies the source before reusing entries whose fixed-size keys collide", async () => {
    const firstCode = "collision-004pvu";
    const secondCode = "collision-00b3ea";
    const { ShikiCodeBlock } = await import("./ShikiCodeBlock");
    const { rerender } = render(<ShikiCodeBlock code={firstCode} language="json" />);
    await expectReady();

    rerender(<ShikiCodeBlock code={secondCode} language="json" />);
    await expectReady();

    expect(shikiMocks.codeToHtml).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("figure")).toHaveTextContent(secondCode);
    expect(screen.getByRole("figure")).not.toHaveTextContent(firstCode);
  });

  it("removes a rejected highlight entry so the same code can be retried", async () => {
    let rejectNext = true;
    shikiMocks.codeToHtml.mockImplementation((code: string) => {
      if (rejectNext) {
        rejectNext = false;
        return Promise.reject(new Error("temporary highlight failure"));
      }
      return highlighted(code);
    });
    const { ShikiCodeBlock } = await import("./ShikiCodeBlock");
    const first = render(<ShikiCodeBlock code="retry-me" language="typescript" />);
    await waitFor(() => expect(screen.getByRole("figure")).toHaveAttribute("data-highlight-state", "fallback"));
    first.unmount();

    render(<ShikiCodeBlock code="retry-me" language="typescript" />);
    await expectReady();

    expect(shikiMocks.createHighlighterCore).toHaveBeenCalledTimes(1);
    expect(shikiMocks.codeToHtml).toHaveBeenCalledTimes(2);
  });

  it("retries initialization after a transient highlighter failure", async () => {
    shikiMocks.createHighlighterCore
      .mockRejectedValueOnce(new Error("temporary initialization failure"))
      .mockImplementation(async () => ({ codeToHtml: shikiMocks.codeToHtml, getLoadedLanguages: () => [], loadLanguage: async () => undefined }));
    const { ShikiCodeBlock } = await import("./ShikiCodeBlock");
    const first = render(<ShikiCodeBlock code="retry-init" language="python" />);
    await waitFor(() => expect(screen.getByRole("figure")).toHaveAttribute("data-highlight-state", "fallback"));
    first.unmount();

    render(<ShikiCodeBlock code="retry-init" language="python" />);
    await expectReady();

    expect(shikiMocks.createHighlighterCore).toHaveBeenCalledTimes(2);
    expect(shikiMocks.codeToHtml).toHaveBeenCalledTimes(1);
  });
});
