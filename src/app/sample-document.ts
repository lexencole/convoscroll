import englishBasic from "../../fixtures/basic-en.fixture.json";
import englishStory from "../../fixtures/story-en.fixture.json";
import { loadFixture } from "../data/document-loader";
import type { Locale } from "../i18n/locale";
import { getFixture } from "../data/fixtures";

const englishFixtures = { basic: loadFixture(englishBasic), story: loadFixture(englishStory) };

export function sample(key: "story" | "basic" | "rich" | "long", locale: Locale = "zh-CN") {
  const fixture = locale === "en" && (key === "basic" || key === "story") ? englishFixtures[key] : getFixture(key);
  if (fixture.status !== "valid") throw new Error("示例数据有误。");
  return fixture.document;
}
