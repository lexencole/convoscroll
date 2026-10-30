import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  ConversationAsset,
  FileBlock,
  ReasoningBlock,
  ToolResultBlock,
  UnsupportedBlock,
} from "../data/conversation-types";
import { FileBlockView, fileTypeLabel, formatByteSize } from "./FileBlockView";
import { TraceBlockView } from "./TraceBlockView";
import { ExportPresentationProvider, resolveExportCollapseState } from "./ExportPresentationContext";
import { UnsupportedBlockView } from "./UnsupportedBlockView";

const pdfAsset: ConversationAsset = {
  id: "asset-test-pdf",
  kind: "file",
  fileName: "layout-brief.pdf",
  mimeType: "application/pdf",
  byteSize: 24_576,
  source: { kind: "local", storageKey: "test:layout-brief.pdf" },
};

const fileBlock: FileBlock = {
  id: "block-test-file",
  type: "file",
  assetId: pdfAsset.id,
  label: "排版说明",
};

describe("rich block views", () => {
  it("resolves per-block and global export fold strategies without mutating preview state", () => {
    expect(resolveExportCollapseState("block", "expanded", false)).toBe("expanded");
    expect(resolveExportCollapseState("block", "current", false)).toBe("collapsed");
    expect(resolveExportCollapseState("preview", "expanded", false)).toBe("collapsed");
    expect(resolveExportCollapseState("expanded", "collapsed", false)).toBe("expanded");
  });

  it("temporarily forces the export state and disables preview interaction", () => {
    const block = {
      id: "reasoning-export",
      type: "reasoning",
      source: "exported details",
      displayState: "collapsed",
      exportState: "expanded",
    } as const;
    render(
      <ExportPresentationProvider value={{
        width: 480,
        foldStrategy: "block",
      }}>
        <TraceBlockView block={block} />
      </ExportPresentationProvider>,
    );
    expect(screen.getByRole("button", { name: /思考过程/ })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /思考过程/ })).toBeDisabled();
    expect(screen.getByText((_, element) => element?.tagName === "P" && element.textContent === "exported details")).toBeInTheDocument();
  });
  it("derives deterministic file labels and readable sizes", () => {
    expect(fileTypeLabel(pdfAsset)).toBe("PDF");
    expect(fileTypeLabel({ ...pdfAsset, mimeType: "application/octet-stream", fileName: "bundle.zip" })).toBe("ZIP");
    expect(fileTypeLabel({ ...pdfAsset, mimeType: "application/octet-stream", fileName: "no-extension" })).toBe("FILE");
    expect(formatByteSize(512)).toBe("512 B");
    expect(formatByteSize(24_576)).toBe("24 KB");
    expect(formatByteSize(2_621_440)).toBe("2.5 MB");
    expect(formatByteSize()).toBe("大小未知");
  });

  it("shows complete file metadata and an explicit missing-asset state", () => {
    const { rerender } = render(<FileBlockView block={fileBlock} asset={pdfAsset} />);

    expect(screen.getByRole("article", { name: "文件：排版说明" })).toHaveTextContent("PDF");
    expect(screen.getByText("layout-brief.pdf")).toBeInTheDocument();
    expect(screen.getByText("application/pdf · 24 KB")).toBeInTheDocument();

    rerender(<FileBlockView block={fileBlock} />);
    expect(screen.getByRole("note")).toHaveTextContent("找不到文件：asset-test-pdf");
  });

  it("uses displayState as the initial state without exposing export diagnostics", () => {
    const block: ReasoningBlock = {
      id: "block-test-reasoning",
      type: "reasoning",
      title: "语义检查",
      summary: "先检查结构。",
      source: "**详细内容** 仅在展开后显示。",
      displayState: "collapsed",
      exportState: "expanded",
    };
    render(<TraceBlockView block={block} />);

    const toggle = screen.getByRole("button", { name: /语义检查/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("导出：强制展开")).not.toBeInTheDocument();
    expect(screen.queryByText("先检查结构。")).not.toBeInTheDocument();
    expect(screen.queryByText("详细内容")).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("先检查结构。")).toBeInTheDocument();
    expect(screen.getByText("详细内容")).toBeInTheDocument();
    expect(screen.queryByText("预览：展开")).not.toBeInTheDocument();
  });

  it("resolves a Tool Result title without duplicating the tool name in Schema", () => {
    const block: ToolResultBlock = {
      id: "block-test-result",
      type: "toolResult",
      callId: "call-test-layout",
      summary: "画布已测量。",
      output: { width: 480, overflow: false },
      status: "success",
      displayState: "expanded",
      exportState: "current",
    };
    render(<TraceBlockView block={block} relatedToolName="measure_layout" />);

    expect(screen.getByText("measure_layout")).toHaveClass("trace-card__title--technical");
    expect(screen.queryByText("call-test-layout")).not.toBeInTheDocument();
    expect(screen.getByText(/"overflow": false/)).toBeInTheDocument();
  });

  it("keeps unsupported raw JSON hidden until explicitly requested", () => {
    const block: UnsupportedBlock = {
      id: "block-test-unsupported",
      type: "unsupported",
      originalType: "futureChart",
      reason: "当前版本尚未支持。",
      raw: { nested: { values: [1, 2, 3] } },
    };
    render(<UnsupportedBlockView block={block} />);

    const toggle = screen.getByRole("button", { name: /futureChart/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/"values"/)).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/"values"/)).toBeInTheDocument();
  });
});
