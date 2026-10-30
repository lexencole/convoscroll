import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";

interface PreviewStageProps {
  readonly children: ReactNode;
  readonly canvasWidth: number;
  readonly fitWidth?: number;
  readonly className?: string;
}

const DESKTOP_STAGE_GUTTER = 32;
/** Wider than any classic scrollbar, narrower than a deliberate window resize step. */
const SCROLLBAR_FLIP = 24;

export function calculatePreviewScale(viewportWidth: number, canvasWidth: number, fitWidth?: number) {
  const gutter = viewportWidth < 520 ? 0 : DESKTOP_STAGE_GUTTER;
  const availableWidth = Math.max(0, viewportWidth - gutter);
  const presentationWidth = fitWidth === undefined
    ? availableWidth
    : Math.min(availableWidth, fitWidth);

  return Math.min(1, presentationWidth / canvasWidth);
}

export function PreviewStage({ children, canvasWidth, fitWidth, className }: PreviewStageProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [contentHeight, setContentHeight] = useState(0);

  useEffect(() => {
    const viewport = viewportRef.current;
    const canvasHost = canvasHostRef.current;
    if (!viewport || !canvasHost) return;

    // A short document can make the page scrollbar flip: the scrollbar narrows the stage,
    // the smaller canvas no longer needs it, the stage widens again, and so on. WebKit
    // does not honour `scrollbar-gutter: stable` on the root, so when the stage grows back
    // by exactly what it just lost, keep the narrower fit.
    let width = 0;
    let lastShrink = 0;
    const measureViewport = () => {
      const next = viewport.clientWidth;
      if (width && next - width === lastShrink && lastShrink <= SCROLLBAR_FLIP) return;
      lastShrink = next < width ? width - next : 0;
      width = next;
      setScale(calculatePreviewScale(next, canvasWidth, fitWidth));
    };
    const measureCanvas = () => {
      setContentHeight(canvasHost.scrollHeight);
    };

    measureViewport();
    measureCanvas();

    const viewportObserver = new ResizeObserver(measureViewport);
    const canvasObserver = new ResizeObserver(measureCanvas);
    viewportObserver.observe(viewport);
    canvasObserver.observe(canvasHost);

    return () => {
      viewportObserver.disconnect();
      canvasObserver.disconnect();
    };
  }, [canvasWidth, children, fitWidth]);

  return (
    <div
      className={["preview-stage", className].filter(Boolean).join(" ")}
      data-preview-fit-width={fitWidth ?? "canvas"}
      data-preview-scale={scale}
      ref={viewportRef}
    >
      <div
        className="preview-frame"
        style={{
          width: canvasWidth * scale,
          height: contentHeight * scale,
        }}
      >
        <div
          className="preview-scale-host"
          ref={canvasHostRef}
          style={{ width: canvasWidth, transform: `scale(${scale})`, "--preview-scale": scale || 1 } as CSSProperties}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
