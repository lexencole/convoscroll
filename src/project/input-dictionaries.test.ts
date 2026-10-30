import { describe, expect, it } from "vitest";
import { prepareMarkdownSource } from "./markdown-import";
import { translator } from "../i18n/messages";
import { fileTypeLabel } from "../renderer/FileBlockView";

const names = ["__proto__", "constructor"];
const conversation = (version: string, body: string) => `<!-- conversation-markdown:v${version} -->\n<!-- message: {"role":"assistant"} -->\n${body}\n<!-- /message -->`;

describe("unrecognized input names", () => {
  it.each(names)("rejects unknown version %s", (name) => {
    expect(() => prepareMarkdownSource(conversation(name, "preserve me"), "input.md"))
      .toThrow(expect.objectContaining({ code: "CONVERSATION_MARKDOWN_VERSION_TOO_NEW" }));
  });
  it.each(names)("handles unusual file extensions and MIME labels: %s", (name) => {
    const prepared = prepareMarkdownSource(conversation("2", `<!-- file: {"src":"notes.${name}"} -->`), "input.md");
    expect(prepared.document.assets[0].mimeType).toBe("application/octet-stream");
    expect(() => prepareMarkdownSource(conversation("2", `<!-- image: {"src":"photo.${name}"} -->`), "input.md"))
      .toThrow(expect.objectContaining({ code: "UNSUPPORTED_CONVERSATION_MARKDOWN_IMAGE" }));
    expect(fileTypeLabel({ ...prepared.document.assets[0], fileName: "notes.txt", mimeType: name })).toBe("TXT");
  });
  it.each(names)("keeps an unknown diagnostic %s readable in English", (name) => {
    expect(translator("en")(name)).toBe(name);
  });
});
