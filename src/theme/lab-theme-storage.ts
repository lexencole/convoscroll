import type { CanvasSettings } from "../data/conversation-types";
import type { ThemeDraft } from "./theme-presets";

export const labThemeStorageKey = "conversation-canvas:visual-lab-selection:v2";

export type LabCanvasPreset = CanvasSettings["preset"];

export interface SavedLabSelection {
  readonly schemaVersion: 2;
  readonly draft: ThemeDraft;
  readonly canvasPreset: LabCanvasPreset;
  readonly savedAt: string;
}

interface StorageAdapter {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem: (key: string) => void;
}

const presetIds = ["warm-editorial", "clean-technical", "soft-minimal"] as const;
const densities = ["compact", "balanced", "airy"] as const;
const bodyScales = ["small", "standard", "large"] as const;
const lineHeights = ["balanced", "relaxed"] as const;
const headingStyles = ["sans", "editorial"] as const;
const cornerStyles = ["precise", "balanced", "soft"] as const;
const accentPalettes = ["forest", "blue", "plum"] as const;
const surfaceStyles = ["open", "defined", "soft"] as const;
const canvasPresets = ["portrait", "wide"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function includes<const Values extends readonly string[]>(
  values: Values,
  value: unknown,
): value is Values[number] {
  return typeof value === "string" && values.includes(value);
}

function isThemeDraft(value: unknown): value is ThemeDraft {
  if (!isRecord(value) || !isRecord(value.adjustments)) return false;

  const adjustments = value.adjustments;
  return (
    includes(presetIds, value.presetId) &&
    typeof value.isCustom === "boolean" &&
    includes(densities, adjustments.density) &&
    includes(bodyScales, adjustments.bodyScale) &&
    includes(lineHeights, adjustments.lineHeight) &&
    includes(headingStyles, adjustments.headingStyle) &&
    includes(cornerStyles, adjustments.cornerStyle) &&
    includes(accentPalettes, adjustments.accent) &&
    includes(surfaceStyles, adjustments.surface)
  );
}

function isSavedLabSelection(value: unknown): value is SavedLabSelection {
  return (
    isRecord(value) &&
    value.schemaVersion === 2 &&
    isThemeDraft(value.draft) &&
    includes(canvasPresets, value.canvasPreset) &&
    typeof value.savedAt === "string" &&
    Number.isFinite(Date.parse(value.savedAt))
  );
}

export function loadLabSelection(storage: StorageAdapter): SavedLabSelection | null {
  try {
    const raw = storage.getItem(labThemeStorageKey);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    return isSavedLabSelection(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveLabSelection(
  storage: StorageAdapter,
  draft: ThemeDraft,
  canvasPreset: LabCanvasPreset,
  now: Date = new Date(),
): SavedLabSelection {
  const selection: SavedLabSelection = {
    schemaVersion: 2,
    draft: {
      ...draft,
      adjustments: { ...draft.adjustments },
    },
    canvasPreset,
    savedAt: now.toISOString(),
  };

  storage.setItem(labThemeStorageKey, JSON.stringify(selection));
  return selection;
}

export function clearLabSelection(storage: StorageAdapter): void {
  storage.removeItem(labThemeStorageKey);
}
