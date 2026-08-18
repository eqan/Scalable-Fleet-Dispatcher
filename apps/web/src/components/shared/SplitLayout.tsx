import { useCallback, useRef, useState, type ReactNode } from "react";

/**
 * SplitLayout -- Resizable horizontal split between two panes.
 *
 * Renders a draggable divider between `left` (dispatch board) and
 * `right` (map). The split ratio persists in sessionStorage so it
 * survives hot-reload.
 *
 * On narrow screens (≤1024px) the panes stack vertically and the
 * resizer is hidden (handled by CSS media query).
 */

interface SplitLayoutProps {
  left: ReactNode;
  right: ReactNode;
}

const STORAGE_KEY = "dispatch:split-ratio";
const DEFAULT_RATIO = 55; // percent for left pane
const MIN_RATIO = 20;
const MAX_RATIO = 80;

function getInitialRatio(): number {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (stored) {
      const n = Number(stored);
      if (n >= MIN_RATIO && n <= MAX_RATIO) return n;
    }
  } catch {
    /* SSR or blocked storage */
  }
  return DEFAULT_RATIO;
}

export function SplitLayout({ left, right }: SplitLayoutProps) {
  const [ratio, setRatio] = useState(getInitialRatio);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragging.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const pct = Math.min(MAX_RATIO, Math.max(MIN_RATIO, (x / rect.width) * 100));
      setRatio(pct);
    },
    [],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      dragging.current = false;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try {
        sessionStorage.setItem(STORAGE_KEY, String(Math.round(ratio)));
      } catch {
        /* ignore */
      }
    },
    [ratio],
  );

  return (
    <div className="split-layout" ref={containerRef}>
      <div
        className="split-layout__board"
        style={{ flex: `0 0 ${ratio}%` }}
      >
        {left}
      </div>

      {/* Drag handle */}
      <div
        className="split-layout__resizer"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={Math.round(ratio)}
        aria-valuemin={MIN_RATIO}
        aria-valuemax={MAX_RATIO}
        tabIndex={0}
      />

      <div
        className="split-layout__map"
        style={{ flex: `0 0 ${100 - ratio}%` }}
      >
        {right}
      </div>
    </div>
  );
}
