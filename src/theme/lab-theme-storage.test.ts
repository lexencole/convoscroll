import { describe, expect, it } from "vitest";
import { createThemeDraft } from "./theme-presets";
import {
  clearLabSelection,
  labThemeStorageKey,
  loadLabSelection,
  saveLabSelection,
} from "./lab-theme-storage";

function createMemoryStorage() {
  const records = new Map<string, string>();
  return {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => { records.set(key, value); },
    removeItem: (key: string) => { records.delete(key); },
  };
}

describe("Visual Lab local selection", () => {
  it("round-trips a versioned theme draft and canvas preset", () => {
    const storage = createMemoryStorage();
    const draft = {
      ...createThemeDraft("warm-editorial"),
      isCustom: true,
      adjustments: {
        ...createThemeDraft("warm-editorial").adjustments,
        accent: "plum" as const,
      },
    };

    const saved = saveLabSelection(storage, draft, "wide", new Date("2026-08-23T08:00:00.000Z"));

    expect(saved.savedAt).toBe("2026-08-23T08:00:00.000Z");
    expect(loadLabSelection(storage)).toEqual(saved);
  });

  it("ignores malformed and unsupported records without breaking the Lab", () => {
    const storage = createMemoryStorage();
    storage.setItem(labThemeStorageKey, "{broken");
    expect(loadLabSelection(storage)).toBeNull();

    storage.setItem(labThemeStorageKey, JSON.stringify({
      schemaVersion: 1,
      draft: createThemeDraft("warm-editorial"),
      canvasPreset: "portrait",
      savedAt: "2026-08-23T08:00:00.000Z",
    }));
    expect(loadLabSelection(storage)).toBeNull();

    storage.setItem(labThemeStorageKey, JSON.stringify({
      schemaVersion: 2,
      draft: {
        ...createThemeDraft("warm-editorial"),
        adjustments: {
          ...createThemeDraft("warm-editorial").adjustments,
          density: "unlimited",
        },
      },
      canvasPreset: "portrait",
      savedAt: "2026-08-23T08:00:00.000Z",
    }));
    expect(loadLabSelection(storage)).toBeNull();
  });

  it("clears only the Visual Lab selection key", () => {
    const storage = createMemoryStorage();
    saveLabSelection(storage, createThemeDraft("soft-minimal"), "portrait");

    clearLabSelection(storage);

    expect(loadLabSelection(storage)).toBeNull();
  });

  it("treats unavailable storage as an empty selection", () => {
    const failingStorage = {
      getItem: () => { throw new Error("storage unavailable"); },
      setItem: () => { throw new Error("storage unavailable"); },
      removeItem: () => { throw new Error("storage unavailable"); },
    };

    expect(loadLabSelection(failingStorage)).toBeNull();
  });
});
