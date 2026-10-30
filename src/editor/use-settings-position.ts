import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import type { SettingsSession } from "./settings-types";

const DOCK_GAP = 24;
const DOCK_MARGIN = 16;

export function useSettingsPosition(session: SettingsSession, panel: RefObject<HTMLElement | null>, busy: boolean) {
  const [position, setPosition] = useState<CSSProperties>();
  const protectDeparture = useRef(false);
  protectDeparture.current = busy;
  const { target } = session;
  useEffect(() => {
    function positionPanel() {
      const rect = session.trigger?.getBoundingClientRect();
      const width = panel.current?.getBoundingClientRect().width ?? 0;
      // Dock beside the paper when it fits, so live changes stay visible and the panel reads as its inspector.
      const paper = document.querySelector(".workbench .preview-frame")?.getBoundingClientRect();
      const viewport = document.documentElement.clientWidth;
      if (paper && paper.right + DOCK_GAP + width + DOCK_MARGIN <= viewport) {
        const below = document.querySelector(".workbench .inline-toolbar")?.getBoundingClientRect().bottom ?? 0;
        const top = Math.max(DOCK_MARGIN, below + DOCK_MARGIN);
        setPosition({ left: paper.right + DOCK_GAP, top, maxHeight: window.innerHeight - top - DOCK_MARGIN });
        return;
      }
      const left = rect && rect.right + width + 24 < window.innerWidth ? rect.right + 12
        : rect && rect.left > width + 24 ? rect.left - width - 12 : (window.innerWidth - width) / 2;
      const top = Math.max(16, Math.min(rect?.top ?? 80, window.innerHeight * 0.09));
      setPosition({ left: Math.max(12, left), top });
    }
    positionPanel();
    panel.current?.querySelector<HTMLElement>(target.type === "message" ? 'input:not([type=file])' : "input:not([type=file]), textarea, [role=combobox]")?.focus({ preventScroll: true });
    window.addEventListener("resize", positionPanel);
    const protect = (event: BeforeUnloadEvent) => { if (protectDeparture.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", protect);
    return () => { window.removeEventListener("resize", positionPanel); window.removeEventListener("beforeunload", protect);
      window.requestAnimationFrame(() => { if (session.trigger?.isConnected) session.trigger.focus(); }); };
  }, [session]);

  return position;
}
