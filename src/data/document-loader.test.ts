import { describe, expect, it } from "vitest";
import {
  loadConversationDocument,
  MAX_JSON_NESTING_DEPTH,
  migrateConversationDocumentV0,
  restoreConversationDocument,
  serializeConversationDocument,
} from "./document-loader";
import { getFixture, resolveFixtureAsset } from "./fixtures";

function documentWithBlock(block: unknown) {
  const fixture = getFixture("basic");
  if (fixture.status !== "valid") throw new Error("Invalid fixture");
  return { ...fixture.document, messages: [{ ...fixture.document.messages[0], blocks: [block] }] };
}

describe("untrusted document boundaries", () => {
  it("reports malformed fields without coercing objects or traversing unrelated deep structures", () => {
    const raw = documentWithBlock({ id: "image", type: "image", assetId: { toString: null, valueOf: null } });
    const deep = JSON.parse("[".repeat(8000) + "0" + "]".repeat(8000)) as unknown;
    const input = { ...raw, schemaVersion: { toString: null, valueOf: null }, metadata: { title: deep }, unexpected: deep };
    const loaded = loadConversationDocument(input);
    expect(loaded.status).toBe("invalid");
    if (loaded.status !== "invalid") throw new Error("Expected invalid fields");
    expect(loaded.raw).toBe(input);
    expect(loaded.diagnostics.map((item) => item.code)).toEqual(expect.arrayContaining([
      "UNSUPPORTED_SCHEMA_VERSION", "UNKNOWN_FIELD", "INVALID_STRING", "MISSING_ASSET_ID", "ASSET_NOT_FOUND",
    ]));
    expect(() => JSON.stringify(loaded.diagnostics)).not.toThrow();
    expect(migrateConversationDocumentV0(input).status).toBe("invalid");
  });

  it.each(["__proto__", "constructor", "toString"])("rejects inherited block type %s without throwing", (type) => {
    const raw = documentWithBlock({ id: "block-test", type });
    expect(loadConversationDocument(raw)).toMatchObject({
      status: "invalid", raw,
      diagnostics: [expect.objectContaining({ code: "UNKNOWN_BLOCK_TYPE", path: "messages[0].blocks[0].type" })],
    });
  });

  it("rejects array-valued collapse and width enums instead of coercing them", () => {
    const trace = loadConversationDocument(documentWithBlock({
      id: "trace", type: "reasoning", source: "preserve me",
      displayState: ["expanded"], exportState: ["current"],
    }));
    expect(trace).toMatchObject({ status: "invalid", diagnostics: expect.arrayContaining([
      expect.objectContaining({ code: "INVALID_DISPLAY_STATE" }),
      expect.objectContaining({ code: "INVALID_EXPORT_STATE" }),
    ]) });
    expect(loadConversationDocument(documentWithBlock({ id: "image", type: "image", assetId: "missing", width: ["full"] })))
      .toMatchObject({ status: "invalid", diagnostics: expect.arrayContaining([expect.objectContaining({ code: "INVALID_IMAGE_WIDTH" })]) });
  });

  it.each(["2026-02-31T12:00:00+08:00", "2025-02-29T12:00:00Z", "2026-04-31T12:00:00Z", "2026-01-01T24:00:00Z"])("rejects normalized calendar time %s", (timestamp) => {
    const raw = documentWithBlock({ id: "body", type: "markdown", source: "" });
    const message = { ...raw.messages[0], timestamp };
    expect(loadConversationDocument({ ...raw, metadata: { ...raw.metadata, createdAt: timestamp }, messages: [message] }))
      .toMatchObject({ status: "invalid", diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_TIMESTAMP" }), expect.objectContaining({ code: "INVALID_DATE_TIME" }),
      ]) });
  });

  it.each(["2024-02-29T23:59:59.123456+08:00", "2000-02-29T00:00:00-05:30", "0099-12-31T00:00:00Z"])("preserves valid calendar time %s", (timestamp) => {
    const raw = documentWithBlock({ id: "body", type: "markdown", source: "" });
    expect(loadConversationDocument({ ...raw, messages: [{ ...raw.messages[0], timestamp }] }))
      .toMatchObject({ status: "valid", document: { messages: [{ timestamp }] } });
  });

  it("preserves JSON at the nesting limit through serialization and rejects deeper data intact", () => {
    const nested = (depth: number) => JSON.parse("[".repeat(depth) + '"keep"' + "]".repeat(depth)) as unknown;
    const block = { id: "opaque", type: "unsupported", originalType: "custom", raw: nested(MAX_JSON_NESTING_DEPTH) };
    const valid = loadConversationDocument(documentWithBlock(block));
    expect(valid.status).toBe("valid");
    if (valid.status !== "valid") throw new Error("Expected valid boundary");
    expect(restoreConversationDocument(serializeConversationDocument(valid.document))).toMatchObject({ status: "valid", document: valid.document });
    for (const depth of [MAX_JSON_NESTING_DEPTH + 1, 8000]) {
      const raw = documentWithBlock({ ...block, raw: nested(depth) });
      const loaded = loadConversationDocument(raw);
      expect(loaded.status).toBe("invalid");
      if (loaded.status !== "invalid") throw new Error("Expected bounded error");
      expect(loaded.raw).toBe(raw);
      expect(loaded.diagnostics).toEqual([expect.objectContaining({ code: "JSON_DEPTH_EXCEEDED", path: "messages[0].blocks[0].raw" })]);
    }
  });

  it("still rejects cycles and accepts repeated references without mistaking them for cycles", () => {
    const shared = { nested: ["keep"] };
    const block = { id: "opaque", type: "unsupported", originalType: "custom", raw: [shared, shared] };
    expect(loadConversationDocument(documentWithBlock(block)).status).toBe("valid");
    const cycle: unknown[] = []; cycle.push(cycle);
    expect(loadConversationDocument(documentWithBlock({ ...block, raw: cycle })))
      .toMatchObject({ status: "invalid", diagnostics: [expect.objectContaining({ code: "INVALID_JSON_VALUE" })] });
  });
});

describe("fixture loader", () => {
  it.each(["basic", "rich", "long", "story"] as const)("loads the %s fixture", (key) => {
    const fixture = getFixture(key);

    expect(fixture.status).toBe("valid");
    if (fixture.status === "valid") {
      expect(fixture.document.schemaVersion).toBe(1);
      expect(fixture.document.canvas.width).toBe(480);
      expect(fixture.document.messages.length).toBeGreaterThan(0);
    }
  });

  it("keeps the default story representative without missing fixture assets", () => {
    const fixture = getFixture("story");
    if (fixture.status !== "valid") throw new Error("Story fixture must be valid");
    const blocks = fixture.document.messages.flatMap((message) => message.blocks);
    expect(new Set(blocks.map((block) => block.type))).toEqual(new Set([
      "markdown", "image", "file", "reasoning", "toolCall", "toolResult",
    ]));
    expect(fixture.document.assets).toHaveLength(2);
    for (const asset of fixture.document.assets) {
      expect(asset.source.kind).toBe("fixture");
      expect(resolveFixtureAsset(asset)).toBeTruthy();
    }
    const log = fixture.document.assets.find((asset) => asset.id === "asset-story-sleep-log");
    expect(log).toMatchObject({ fileName: "上周作息.csv", mimeType: "text/csv" });
    if (!log) throw new Error("Story sleep log asset must exist");
    for (const path of [
      "fixtures/assets/sea-character-notes.md",
      "fixtures/assets/sea-character-notes.csv",
      "fixtures/assets/sea-horizon.svg",
    ]) {
      expect(resolveFixtureAsset({ ...log, source: { kind: "fixture", path } })).toBeTruthy();
    }
    expect(restoreConversationDocument(serializeConversationDocument(fixture.document)))
      .toMatchObject({ status: "valid", document: fixture.document });
  });

  it("serializes and restores a deeply equivalent v1 document", () => {
    const fixture = getFixture("rich");
    expect(fixture.status).toBe("valid");
    if (fixture.status !== "valid") return;

    const serialized = serializeConversationDocument(fixture.document);
    const restored = restoreConversationDocument(serialized);

    expect(restored.status).toBe("valid");
    if (restored.status === "valid") {
      expect(restored.document).toEqual(fixture.document);
      const unsupported = restored.document.messages
        .flatMap((message) => message.blocks)
        .find((block) => block.type === "unsupported");
      expect(unsupported).toMatchObject({
        type: "unsupported",
        raw: {
          segments: ["第 1–2 集", "第 3–4 集", "第 5–6 集"],
          durationMinutes: [48, 48, 48],
          breakMinutes: 12,
          showSpoilerShield: true,
        },
      });
    }
  });

  it("migrates v0 without mutating or dropping its data", () => {
    const fixture = getFixture("basic");
    expect(fixture.status).toBe("valid");
    if (fixture.status !== "valid") return;

    const v0 = JSON.parse(JSON.stringify(fixture.document)) as Record<string, unknown>;
    v0.schemaVersion = 0;
    const snapshot = JSON.parse(JSON.stringify(v0)) as unknown;
    const migrated = migrateConversationDocumentV0(v0);

    expect(v0).toEqual(snapshot);
    expect(migrated.status).toBe("valid");
    if (migrated.status === "valid") {
      expect(migrated.document).toEqual({ ...(snapshot as object), schemaVersion: 1 });
    }
  });

  it("rejects unknown fields instead of silently stripping them", () => {
    const fixture = getFixture("basic");
    expect(fixture.status).toBe("valid");
    if (fixture.status !== "valid") return;

    const raw = JSON.parse(JSON.stringify(fixture.document)) as Record<string, unknown>;
    raw.futureField = { mustBePreservedByAnAdapter: true };
    const loaded = loadConversationDocument(raw);

    expect(loaded.status).toBe("invalid");
    if (loaded.status === "invalid") {
      expect(loaded.diagnostics).toContainEqual(expect.objectContaining({
        code: "UNKNOWN_FIELD",
        path: "futureField",
      }));
      expect(loaded.raw).toBe(raw);
    }
  });

  it("reports nested v1 semantic failures with exact paths", () => {
    const fixture = getFixture("rich");
    expect(fixture.status).toBe("valid");
    if (fixture.status !== "valid") return;

    const raw = JSON.parse(JSON.stringify(fixture.document)) as {
      messages: Array<Record<string, unknown> & { blocks: Array<Record<string, unknown>> }>;
      assets: Array<Record<string, unknown>>;
    };
    raw.messages[0].timestamp = "August 23, 2026";
    raw.messages[0].futureLabel = "must not be stripped";
    raw.messages[0].avatarAssetId = "asset-rich-brief-file";
    const firstToolCall = raw.messages
      .flatMap((message) => message.blocks)
      .find((block) => block.type === "toolCall");
    if (!firstToolCall) throw new Error("Rich fixture must contain a ToolCall");
    raw.messages[0].blocks.push({ ...firstToolCall, id: "block-rich-duplicate-call" });

    const loaded = loadConversationDocument(raw);

    expect(loaded.status).toBe("invalid");
    if (loaded.status === "invalid") {
      expect(loaded.diagnostics).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "INVALID_TIMESTAMP", path: "messages[0].timestamp" }),
        expect.objectContaining({ code: "UNKNOWN_FIELD", path: "messages[0].futureLabel" }),
        expect.objectContaining({ code: "AVATAR_ASSET_KIND_MISMATCH", path: "messages[0].avatarAssetId" }),
        expect.objectContaining({ code: "DUPLICATE_TOOL_CALL_ID" }),
      ]));
      expect(loaded.raw).toBe(raw);
    }
  });

  it("keeps legacy over-schema-length strings loadable until a versioned migration exists", () => {
    const fixture = getFixture("basic");
    expect(fixture.status).toBe("valid");
    if (fixture.status !== "valid") return;

    const raw = JSON.parse(JSON.stringify(fixture.document)) as {
      metadata: Record<string, unknown>;
    };
    raw.metadata.title = "😀".repeat(301);

    const loaded = loadConversationDocument(raw);
    expect(loaded.status).toBe("valid");
    if (loaded.status === "valid") {
      expect(loaded.document.metadata.title).toBe(raw.metadata.title);
    }
  });

  it("reports invalid serialized JSON without replacing it with an empty document", () => {
    const restored = restoreConversationDocument("{not-json");

    expect(restored.status).toBe("invalid");
    if (restored.status === "invalid") {
      expect(restored.diagnostics).toEqual([
        expect.objectContaining({ code: "INVALID_JSON", path: "$" }),
      ]);
      expect(restored.raw).toBe("{not-json");
    }
  });

  it("isolates broken input and returns actionable diagnostics", () => {
    const fixture = getFixture("broken");

    expect(fixture.status).toBe("invalid");
    if (fixture.status === "invalid") {
      const codes = fixture.diagnostics.map((diagnostic) => diagnostic.code);
      expect(codes).toEqual(
        expect.arrayContaining([
          "UNSUPPORTED_SCHEMA_VERSION",
          "DUPLICATE_MESSAGE_ID",
          "MISSING_MESSAGE_ID",
          "UNKNOWN_BLOCK_TYPE",
          "MISSING_SOURCE_ROLE",
          "INVALID_EXECUTION_STATUS",
          "INVALID_DURATION",
          "ASSET_NOT_FOUND",
          "ORPHAN_TOOL_RESULT",
          "DUPLICATE_ASSET_ID",
          "UNKNOWN_FIELD",
          "INVALID_TIMESTAMP",
          "INVALID_MESSAGE_STATUS",
          "AVATAR_ASSET_KIND_MISMATCH",
          "DUPLICATE_TOOL_CALL_ID",
        ]),
      );
      expect(fixture.raw).toBeDefined();
    }
  });
});
