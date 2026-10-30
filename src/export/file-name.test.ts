import { describe, expect, it } from "vitest";
import { buildPngBundleFileName, buildPngFileName } from "./download-png";
import { safeFileBaseName } from "./file-name";
import { exportProjectPackage } from "../project/project-export";
import { createEmptyDocument } from "../editor/document-operations";

describe("safeFileBaseName", () => {
  it("keeps the title as written", () => {
    expect(safeFileBaseName("到了海边，然后呢？模拟器测试OK")).toBe("到了海边，然后呢？模拟器测试OK");
    expect(safeFileBaseName("Café 计划")).toBe("Café 计划");
  });

  it("replaces only characters that file systems reject", () => {
    expect(safeFileBaseName(" Conversation: Rich / 3× ")).toBe("Conversation- Rich - 3×");
    expect(safeFileBaseName("然后呢?")).toBe("然后呢");
    expect(safeFileBaseName("a\tb\nc")).toBe("a b c");
    expect(safeFileBaseName(".hidden")).toBe("hidden");
    expect(safeFileBaseName("***")).toBe("");
  });

  it("caps the length without splitting characters", () => {
    const result = safeFileBaseName("😀".repeat(100));
    expect(Array.from(result)).toHaveLength(80);
    expect(result).toBe("😀".repeat(80));
  });
});

describe("downloaded file names", () => {
  const title = "到了海边，然后呢？模拟器测试OK";

  it("uses the same base for PNG, ZIP and project files", async () => {
    const document = createEmptyDocument();
    const project = await exportProjectPackage({
      document: { ...document, metadata: { ...document.metadata, title } },
      resolveAssetBlob: async () => undefined,
    });
    expect(buildPngFileName(title)).toBe(`${title}.png`);
    expect(buildPngBundleFileName(title)).toBe(`${title}-parts.zip`);
    expect(project.fileName).toBe(`${title}.convcanvas`);
  });
});
