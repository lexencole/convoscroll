import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BrandMark } from "./BrandMark";
import indexHtml from "../../index.html?raw";

describe("shared product mark", () => {
  it("uses the local generated mark without duplicating the adjacent brand name", () => {
    const { container } = render(<><BrandMark /><h1>话卷 ConvoScroll</h1></>);
    const mark = container.querySelector("img")!;
    expect(mark).toHaveAttribute("src", "/brand/convoscroll-mark-r8-transparent.png");
    expect(mark).toHaveAttribute("alt", "");
    expect(mark).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("heading", { name: "话卷 ConvoScroll" })).toBeInTheDocument();
    expect(indexHtml).toContain('href="/brand/convoscroll-mark-r8-transparent.png"');
    expect(indexHtml).toContain('href="/brand/convoscroll-favicon-r8-transparent.png"');
    expect(indexHtml).not.toContain('href="/favicon.svg"');
  });
  it.each([["mark", 128], ["favicon", 32]] as const)("ships the %s at its declared size with alpha", (kind, size) => {
    const png = readFileSync(`public/brand/convoscroll-${kind}-r8-transparent.png`);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(size);
    expect(png.readUInt32BE(20)).toBe(size);
    expect(png[25]).toBe(6);
    expect(png.length).toBeLessThan(50_000);
  });
});
