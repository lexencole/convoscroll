import { describe, expect, it } from "vitest";
import horizonSvg from "../../fixtures/assets/sea-horizon.svg?raw";

type Point = [number, number];
const svg = new DOMParser().parseFromString(horizonSvg, "image/svg+xml");
function attribute(id: string, name: string): string {
  const value = svg.getElementById(id)?.getAttribute(name);
  if (value === null || value === undefined) throw new Error(`Missing ${id}.${name}`);
  return value;
}
function point(id: string): Point {
  return [Number(attribute(id, "cx")), Number(attribute(id, "cy"))];
}
const subtract = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1];
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
const length = (v: Point) => Math.hypot(...v);
const eye = point("eye");
const center = point("earth-center");
const horizon = point("horizon");
const sight = subtract(eye, horizon);
const radius = subtract(center, horizon);

describe("Conversation Markdown v2 horizon diagram", () => {
  it("places the horizon on the sea circle with a perpendicular sight line", () => {
    expect(svg.querySelector("parsererror")).toBeNull();
    expect(dot(sight, radius)).toBeCloseTo(0, 8);
    const r = length(radius);
    const arc = `M${center[0]} ${center[1] - r} A${r} ${r} 0 0 1 ${center[0] + r} ${center[1]}`;
    expect(attribute("sea-surface", "d")).toBe(arc);
    expect(attribute("sea-fill", "d")).toBe(`${arc} L${center.join(" ")}Z`);
    expect(attribute("sight-triangle", "d"))
      .toBe(`M${eye.join(" ")}L${center.join(" ")}L${horizon.join(" ")}Z`);
    expect(horizon[0]).toBeGreaterThan(center[0]);
    expect(horizon[1]).toBeLessThan(center[1]);
  });

  it("keeps the square marker inside the angle with both endpoints on its rays", () => {
    const coordinates = attribute("right-angle", "d").match(/-?\d+(?:\.\d+)?/g)?.map(Number);
    if (!coordinates || coordinates.length !== 6) throw new Error("Expected a three-point marker");
    const [ax, ay, bx, by, cx, cy] = coordinates;
    const start: Point = [ax, ay];
    const corner: Point = [bx, by];
    const end: Point = [cx, cy];
    const startOffset = subtract(start, horizon);
    const endOffset = subtract(end, horizon);
    expect(cross(startOffset, sight)).toBeCloseTo(0, 8);
    expect(cross(endOffset, radius)).toBeCloseTo(0, 8);
    expect(dot(startOffset, sight)).toBeGreaterThan(0);
    expect(dot(endOffset, radius)).toBeGreaterThan(0);
    expect(length(startOffset)).toBeLessThan(length(sight));
    expect(length(endOffset)).toBeLessThan(length(radius));
    expect(length(startOffset)).toBeCloseTo(length(endOffset), 8);
    expect(corner[0]).toBeCloseTo(start[0] + end[0] - horizon[0], 8);
    expect(corner[1]).toBeCloseTo(start[1] + end[1] - horizon[1], 8);
    expect(dot(subtract(start, corner), subtract(end, corner))).toBeCloseTo(0, 8);
  });

});
