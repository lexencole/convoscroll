import { describe, expect, it } from "vitest";
import storyFixture from "../../fixtures/story.fixture.json";
import { loadRenderSource, type RenderInputReader } from "./render-input";

const encoder = new TextEncoder();

function reader(input: string, files: Record<string, string> = {}): RenderInputReader & { readonly requested: string[] } {
  const requested: string[] = [];
  return {
    requested,
    readInput: async () => encoder.encode(input),
    readLocal: async (src) => {
      requested.push(src);
      return src in files ? encoder.encode(files[src]) : undefined;
    },
  };
}

const measure = async () => ({ width: 640, height: 480 });

const markdown = `<!-- conversation-markdown:v2 -->
<!-- message: {"role":"user"} -->
看图
<!-- image: {"src":"images/a.png"} -->
<!-- file: {"src":"notes.txt"} -->
<!-- /message -->`;

describe("loadRenderSource", () => {
  it("reads referenced files, measures images and keys blobs by storage key", async () => {
    const input = reader(markdown, { "images/a.png": "png-bytes", "notes.txt": "hello" });
    const source = await loadRenderSource("markdown", "chat.md", input, measure);

    expect(input.requested).toEqual(["images/a.png", "notes.txt"]);
    const [image, file] = source.document.assets;
    expect(image).toMatchObject({ kind: "image", byteSize: 9, width: 640, height: 480, mimeType: "image/png" });
    expect(file).toMatchObject({ kind: "file", byteSize: 5, mimeType: "text/plain" });
    expect(source.warnings).toEqual([]);
    for (const asset of source.document.assets) {
      expect(asset.source.kind === "local" && source.blobs.has(asset.source.storageKey)).toBe(true);
    }
    const again = await loadRenderSource("markdown", "chat.md", reader(markdown, { "images/a.png": "png-bytes", "notes.txt": "hello" }), measure);
    expect(again.document).toEqual(source.document);
  });

  it("rejects images the browser cannot decode", async () => {
    await expect(loadRenderSource("markdown", "chat.md", reader(markdown, { "images/a.png": "x", "notes.txt": "y" }), async () => undefined))
      .rejects.toMatchObject({ code: "UNREADABLE_CONVERSATION_MARKDOWN_IMAGE", path: "line:4" });
  });

  it("rejects input that is not UTF-8", async () => {
    const binary: RenderInputReader = { readInput: async () => new Uint8Array([0xff, 0xfe, 0x00]), readLocal: async () => undefined };
    await expect(loadRenderSource("markdown", "chat.md", binary, measure)).rejects.toMatchObject({ code: "INPUT_NOT_UTF8" });
  });

  it("loads document JSON whose fixture assets resolve through the bundle", async () => {
    const source = await loadRenderSource("json", "story.fixture.json", reader(JSON.stringify(storyFixture)), measure);

    expect(source.document.metadata.title).toBe(storyFixture.metadata.title);
    expect(source.warnings).toEqual([]);
  });

  it("warns about browser-local assets in document JSON and renders them as missing", async () => {
    const document = {
      ...storyFixture,
      assets: storyFixture.assets.map((asset) => ({ ...asset, source: { kind: "local", storageKey: `local:${asset.id}` } })),
    };
    const source = await loadRenderSource("json", "local.json", reader(JSON.stringify(document)), measure);

    expect(source.warnings.map((warning) => warning.code)).toEqual(storyFixture.assets.map(() => "ASSET_UNAVAILABLE"));
    expect(source.warnings[0].message).toContain(storyFixture.assets[0].fileName);
  });

  it("reports invalid JSON with a clear code", async () => {
    await expect(loadRenderSource("json", "bad.json", reader("{"), measure)).rejects.toMatchObject({ code: "INVALID_DOCUMENT_JSON" });
  });
});
