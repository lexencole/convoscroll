import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { calculatePreviewScale, PreviewStage } from "./PreviewStage";

describe("PreviewStage", () => {
  it("fits the 480px canvas to a representative 390px phone width", () => {
    expect(calculatePreviewScale(1024, 480, 390)).toBe(0.8125);
  });

  it("uses the full canvas size when no fit width is requested", () => {
    expect(calculatePreviewScale(1024, 480)).toBe(1);
  });

  it("still respects a viewport narrower than the requested phone width", () => {
    expect(calculatePreviewScale(360, 480, 390)).toBe(0.75);
  });

  describe("when the page scrollbar flips", () => {
    const resized: ResizeObserverCallback[] = [];
    afterEach(() => { resized.length = 0; vi.unstubAllGlobals(); });

    it("keeps the narrower fit instead of growing back, and follows real resizes", () => {
      vi.stubGlobal("ResizeObserver", class {
        constructor(callback: ResizeObserverCallback) { resized.push(callback); }
        observe() {} unobserve() {} disconnect() {}
      });
      let width = 320;
      const stageWidth = vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
        return this.classList.contains("preview-stage") ? width : 0;
      });
      const { container } = render(<PreviewStage canvasWidth={480}><div /></PreviewStage>);
      const stage = container.querySelector<HTMLElement>(".preview-stage")!;
      const resize = (next: number) => act(() => { width = next; resized[0]([], {} as ResizeObserver); });
      expect(stage.dataset.previewScale).toBe(String(320 / 480));

      resize(308); // the scrollbar appeared
      expect(stage.dataset.previewScale).toBe(String(308 / 480));
      resize(320); // it went away again because the canvas got shorter
      expect(stage.dataset.previewScale).toBe(String(308 / 480));
      resize(400); // the window really got wider
      expect(stage.dataset.previewScale).toBe(String(400 / 480));
      stageWidth.mockRestore();
    });
  });
});
