import { describe, expect, it } from "vitest";
import type { ConversationAsset } from "../data/conversation-types";
import { attachAsset } from "./workbench-operations";
import {
  addMessage,
  createEmptyDocument,
  removeBlock,
  updateDocumentMetadata,
  updateMessage,
  type EditorIdFactory,
} from "./document-operations";
import {
  createDocumentHistory,
  documentHistoryReducer,
  isDocumentDirty,
} from "./document-history";
import { getFixture } from "../data/fixtures";

function basicDocument() {
  const fixture = getFixture("basic");
  if (fixture.status !== "valid") throw new Error("Basic fixture must be valid");
  return fixture.document;
}

function sequenceFactory(): EditorIdFactory {
  let sequence = 0;
  return (kind) => `${kind}-history-${sequence += 1}`;
}

describe("document history", () => {
  it("coalesces consecutive edits to the same field", () => {
    let state = createDocumentHistory(basicDocument());
    state = documentHistoryReducer(state, {
      type: "commit",
      groupKey: "metadata.title",
      update: (document) => updateDocumentMetadata(document, { title: "A" }),
    });
    state = documentHistoryReducer(state, {
      type: "commit",
      groupKey: "metadata.title",
      update: (document) => updateDocumentMetadata(document, { title: "AB" }),
    });

    expect(state.past).toHaveLength(1);
    expect(state.present.metadata.title).toBe("AB");
    state = documentHistoryReducer(state, { type: "undo" });
    expect(state.present.metadata.title).toBe("剩饭放了一夜");
  });

  it("supports branching undo and redo", () => {
    let state = createDocumentHistory(basicDocument());
    state = documentHistoryReducer(state, {
      type: "commit",
      update: (document) => updateDocumentMetadata(document, { title: "One" }),
    });
    state = documentHistoryReducer(state, { type: "undo" });
    expect(state.future).toHaveLength(1);
    state = documentHistoryReducer(state, { type: "redo" });
    expect(state.present.metadata.title).toBe("One");
    state = documentHistoryReducer(state, { type: "undo" });
    state = documentHistoryReducer(state, {
      type: "commit",
      update: (document) => updateDocumentMetadata(document, { title: "Two" }),
    });
    expect(state.future).toHaveLength(0);
    expect(state.present.metadata.title).toBe("Two");
  });

  it("rejects invalid candidate documents without changing the present", () => {
    const initial = basicDocument();
    const messageId = initial.messages[0].id;
    const state = documentHistoryReducer(createDocumentHistory(initial), {
      type: "commit",
      update: (document) => updateMessage(document, messageId, {
        role: "unknown",
        sourceRole: undefined,
      }),
    });

    expect(state.present).toBe(initial);
    expect(state.diagnostic?.code).toBe("MISSING_SOURCE_ROLE");
    expect(isDocumentDirty(state)).toBe(false);
  });

  it("marks only the current revision as saved without clearing undo", () => {
    const initial = basicDocument();
    let state = createDocumentHistory(initial);
    state = documentHistoryReducer(state, {
      type: "commit",
      update: (document) => updateDocumentMetadata(document, { title: "Saved" }),
    });
    const savedRevision = state.present;
    state = documentHistoryReducer(state, { type: "markSaved", document: savedRevision });

    expect(isDocumentDirty(state)).toBe(false);
    expect(state.past).toHaveLength(1);

    state = documentHistoryReducer(state, {
      type: "commit",
      update: (document) => updateDocumentMetadata(document, { title: "Newer" }),
    });
    state = documentHistoryReducer(state, { type: "markSaved", document: savedRevision });
    expect(isDocumentDirty(state)).toBe(true);
    expect(state.present.metadata.title).toBe("Newer");
  });

  it("replaces the document as a clean baseline after confirmed import", () => {
    const replacement = updateDocumentMetadata(basicDocument(), { title: "Imported" });
    let state = createDocumentHistory(basicDocument());
    state = documentHistoryReducer(state, {
      type: "commit",
      update: (document) => updateDocumentMetadata(document, { title: "Unsaved" }),
    });
    state = documentHistoryReducer(state, { type: "replace", document: replacement });

    expect(state.present.metadata.title).toBe("Imported");
    expect(state.past).toHaveLength(0);
    expect(state.future).toHaveLength(0);
    expect(isDocumentDirty(state)).toBe(false);
  });

  it("restores pruned asset metadata when an attachment deletion is undone", () => {
    const ids = sequenceFactory();
    const message = addMessage(createEmptyDocument(ids), "user", ids);
    const asset: ConversationAsset = {
      id: "asset-undo",
      kind: "file",
      fileName: "undo.txt",
      mimeType: "text/plain",
      byteSize: 4,
      source: { kind: "local", storageKey: "local:asset-undo" },
    };
    const attached = attachAsset(message.document, { messageId: message.messageId, kind: "file" }, asset);
    const block = attached.messages[0].blocks.at(-1)!;
    let state = createDocumentHistory(attached);

    state = documentHistoryReducer(state, {
      type: "commit",
      update: (document) => removeBlock(document, message.messageId, block.id),
    });
    expect(state.present.assets).toEqual([]);

    state = documentHistoryReducer(state, { type: "undo" });
    expect(state.present.assets).toEqual([asset]);
  });
});
