import basicFixture from "../../fixtures/basic.fixture.json";
import brokenFixture from "../../fixtures/broken.fixture.json";
import longFixture from "../../fixtures/long.fixture.json";
import richFixture from "../../fixtures/rich.fixture.json";
import storyFixture from "../../fixtures/story.fixture.json";
import spoilerFreeWatchPosterUrl from "../../fixtures/assets/spoiler-free-watch-poster.svg?url";
import sampleLandscapeUrl from "../../fixtures/assets/sample-landscape.svg?url";
import sampleAvatarUrl from "../../fixtures/assets/sample-avatar.svg?url";
import linAnAvatarUrl from "../../fixtures/assets/lin-an-avatar.svg?url";
import seaNotesUrl from "../../fixtures/assets/sea-character-notes.csv?url";
import seaReadingNotesUrl from "../../fixtures/assets/sea-character-notes.md?url";
import seaHorizonUrl from "../../fixtures/assets/sea-horizon.svg?url";
import sleepWeekEnglishUrl from "../../fixtures/assets/sleep-week-en.csv?url";
import sleepShiftEnglishUrl from "../../fixtures/assets/sleep-shift-en.svg?url";
import sleepWeekUrl from "../../fixtures/assets/sleep-week.csv?url";
import sleepShiftUrl from "../../fixtures/assets/sleep-shift.svg?url";
import type { ConversationAsset, LoadedDocument } from "./conversation-types";
import { loadFixture } from "./document-loader";

export type FixtureKey = "basic" | "rich" | "long" | "broken" | "story";

const fixtureSources: Partial<Record<FixtureKey, unknown>> = {
  story: storyFixture,
  basic: basicFixture,
  ...(import.meta.env.DEV ? { rich: richFixture, long: longFixture, broken: brokenFixture } : {}),
};

const loadedFixtures = new Map<FixtureKey, LoadedDocument>();

export function getFixture(key: FixtureKey): LoadedDocument {
  const cached = loadedFixtures.get(key);
  if (cached) return cached;

  const loaded = loadFixture(fixtureSources[key]);
  loadedFixtures.set(key, loaded);
  return loaded;
}

export function resolveFixtureAsset(asset: ConversationAsset): string | undefined {
  if (asset.source.kind !== "fixture") return undefined;
  if (asset.source.path === "fixtures/assets/sleep-week-en.csv") return sleepWeekEnglishUrl;
  if (asset.source.path === "fixtures/assets/sleep-shift-en.svg") return sleepShiftEnglishUrl;
  if (asset.source.path === "fixtures/assets/sleep-week.csv") return sleepWeekUrl;
  if (asset.source.path === "fixtures/assets/sleep-shift.svg") return sleepShiftUrl;
  // Projects saved from the earlier story sample still reference the sea assets.
  if (asset.source.path === "fixtures/assets/sea-character-notes.md") return seaReadingNotesUrl;
  // Projects saved before the reading notes became Markdown still reference the CSV.
  if (asset.source.path === "fixtures/assets/sea-character-notes.csv") return seaNotesUrl;
  if (asset.source.path === "fixtures/assets/sea-horizon.svg") return seaHorizonUrl;
  if (asset.source.path === "fixtures/assets/sample-landscape.svg") {
    return sampleLandscapeUrl;
  }
  if (asset.source.path === "fixtures/assets/sample-avatar.svg") {
    return sampleAvatarUrl;
  }
  if (asset.source.path === "fixtures/assets/spoiler-free-watch-poster.svg") {
    return spoilerFreeWatchPosterUrl;
  }
  if (asset.source.path === "fixtures/assets/lin-an-avatar.svg") {
    return linAnAvatarUrl;
  }
  return undefined;
}
