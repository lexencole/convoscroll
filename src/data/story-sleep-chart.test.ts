import { describe, expect, it } from "vitest";
import sleepSvg from "../../fixtures/assets/sleep-shift.svg?raw";
import englishSleepSvg from "../../fixtures/assets/sleep-shift-en.svg?raw";
import englishSleepCsv from "../../fixtures/assets/sleep-week-en.csv?raw";
import { sample } from "../app/sample-document";
import { resolveFixtureAsset } from "./fixtures";
import sleepCsv from "../../fixtures/assets/sleep-week.csv?raw";
import { getFixture } from "./fixtures";

// The chart's time axis starts at 20:00 and spans 18 hours across 640px.
const AXIS_LEFT = 120;
const PX_PER_HOUR = 640 / 18;
const svg = new DOMParser().parseFromString(sleepSvg, "image/svg+xml");

function hoursSince20(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return (hours + minutes / 60 - 20 + 24) % 24;
}
function x(time: string): number {
  return AXIS_LEFT + hoursSince20(time) * PX_PER_HOUR;
}
function rect(id: string): SVGRectElement {
  const element = svg.getElementById(id);
  if (!element) throw new Error(`Missing ${id}`);
  return element as unknown as SVGRectElement;
}
const rows = sleepCsv.trim().split("\n").slice(1).map((line) => {
  const [day, start, end, hours] = line.split(",");
  return { day, start, end, hours: Number(hours) };
});
const bars = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((key) => rect(`sleep-${key}`));

describe("story sleep chart", () => {
  it("draws every night of the sleep log at its real start and end", () => {
    expect(svg.querySelector("parsererror")).toBeNull();
    expect(rows).toHaveLength(7);
    rows.forEach((row, index) => {
      const bar = bars[index];
      expect(bar.getAttribute("data-start")).toBe(row.start);
      expect(bar.getAttribute("data-end")).toBe(row.end);
      expect(Number(bar.getAttribute("x"))).toBeCloseTo(x(row.start), 1);
      expect(Number(bar.getAttribute("width"))).toBeCloseTo(row.hours * PX_PER_HOUR, 1);
      expect(row.hours).toBeGreaterThanOrEqual(7);
      expect(row.hours).toBeLessThanOrEqual(8);
    });
  });

  it("matches the averages the story quotes", () => {
    const average = rows.reduce((sum, row) => sum + row.hours, 0) / rows.length;
    expect(average.toFixed(1)).toBe("7.7");
    const midpoint = rows.reduce((sum, row) => sum + hoursSince20(row.start) + row.hours / 2, 0) / rows.length;
    // 07:30 is 11.5 hours after 20:00; the 23:00–07:00 reference midpoint is 03:00.
    expect(midpoint).toBeCloseTo(11.5, 8);
    expect(midpoint - hoursSince20("03:00")).toBeCloseTo(4.5, 8);
    const reference = rect("reference-window");
    expect(Number(reference.getAttribute("x"))).toBeCloseTo(x("23:00"), 1);
    expect(Number(reference.getAttribute("width"))).toBeCloseTo(8 * PX_PER_HOUR, 1);
  });

  it("keeps the asset byte sizes synchronized with the sources", () => {
    const fixture = getFixture("story");
    if (fixture.status !== "valid") throw new Error("Story fixture must be valid");
    const size = (id: string) => fixture.document.assets.find((item) => item.id === id)?.byteSize;
    expect(size("asset-story-sleep-chart")).toBe(new TextEncoder().encode(sleepSvg).byteLength);
    expect(size("asset-story-sleep-log")).toBe(new TextEncoder().encode(sleepCsv).byteLength);
  });
});

// Translation must not change any of the measurements represented in the chart.
describe("English story assets", () => {
  it("preserves the sleep data and chart geometry while translating all visible labels", () => {
    const englishRows = englishSleepCsv.trim().split("\n").slice(1).map((line) => line.split(",").slice(1));
    expect(englishRows).toEqual(sleepCsv.trim().split("\n").slice(1).map((line) => line.split(",").slice(1)));
    const englishSvg = new DOMParser().parseFromString(englishSleepSvg, "image/svg+xml");
    expect(englishSvg.querySelector("parsererror")).toBeNull();
    for (const bar of [...bars, rect("reference-window")]) {
      const translated = englishSvg.getElementById(bar.id);
      for (const attr of ["x", "y", "width", "height"]) {
        expect(translated?.getAttribute(attr)).toBe(bar.getAttribute(attr));
      }
    }
    expect(englishSvg.documentElement.textContent).not.toMatch(/\p{Script=Han}/u);
    expect(englishSleepCsv).not.toMatch(/\p{Script=Han}/u);
    const document = sample("story", "en");
    for (const asset of document.assets) {
      expect(resolveFixtureAsset(asset)).toBeTruthy();
      const source = asset.kind === "image" ? englishSleepSvg : englishSleepCsv;
      expect(asset.byteSize).toBe(new TextEncoder().encode(source).byteLength);
    }
  });
});
