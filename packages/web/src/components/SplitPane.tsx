/**
 * SplitPane — shared resizable two-pane layout (R-68, T-21).
 *
 * children: [main, side]. The side pane sits on the right; dragging the
 * divider left widens it. When `side` is null/false only the main pane renders.
 *
 * - Pointer events + pointer capture, so mouse, touch and pen all work and the
 *   drag keeps tracking when the pointer leaves the divider.
 * - Drag starts from the side pane's measured rendered width (no jump).
 * - One clamp: `min` px .. `maxVw` vw (the CSS uses the same bounds).
 * - Keyboard: ArrowLeft/ArrowRight ±16 px (Shift ±64), Home/End → max/min.
 * - Width persisted at localStorage['pane:' + id].
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export const PANE_STORAGE_PREFIX = 'pane:';
const STEP = 16;
const BIG_STEP = 64;

function readStored(id: string): number | null {
  try {
    const raw = localStorage.getItem(PANE_STORAGE_PREFIX + id);
    if (raw === null) return null;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

export interface SplitPaneProps {
  /** Stable id — scopes the persisted width. */
  id: string;
  children: [ReactNode, ReactNode];
  /** Initial side width in px when nothing is persisted (CSS default 42vw otherwise). */
  defaultWidth?: number;
  min?: number;
  maxVw?: number;
  /** Accessible label for the side pane landmark. */
  sideLabel?: string;
}

export default function SplitPane({
  id,
  children,
  defaultWidth,
  min = 320,
  maxVw = 70,
  sideLabel,
}: SplitPaneProps) {
  const [main, side] = children;
  const sideRef = useRef<HTMLElement>(null);
  const drag = useRef<{ startX: number; startWidth: number; pointerId: number } | null>(null);
  const [width, setWidth] = useState<number | null>(() => {
    const stored = readStored(id);
    if (stored === null) return defaultWidth ?? null;
    // Restore inside the current bounds (the viewport may have shrunk).
    return Math.round(Math.min(Math.max(stored, min), Math.max(min, (window.innerWidth * maxVw) / 100)));
  });
  const [measured, setMeasured] = useState<number>(0);
  const hasSide = side !== null && side !== undefined && side !== false;

  const maxPx = useCallback(() => Math.max(min, (window.innerWidth * maxVw) / 100), [min, maxVw]);
  const clamp = useCallback((w: number) => Math.round(Math.min(Math.max(w, min), maxPx())), [min, maxPx]);

  /** Width a resize starts from: the width we set, else the measured rendered width. */
  const currentWidth = () => {
    if (width !== null) return width;
    const rect = sideRef.current?.getBoundingClientRect().width ?? 0;
    return rect > 0 ? rect : (measured || min);
  };

  // Measure the rendered width for aria-valuenow before the user interacts.
  useLayoutEffect(() => {
    if (!hasSide) return;
    const w = sideRef.current?.getBoundingClientRect().width ?? 0;
    if (w > 0) setMeasured(Math.round(w));
  }, [hasSide, width]);

  // Persist on change.
  useEffect(() => {
    if (width === null) return;
    try { localStorage.setItem(PANE_STORAGE_PREFIX + id, String(width)); } catch { /* ignore */ }
  }, [id, width]);

  // Keep a persisted width inside the bounds when the viewport shrinks.
  useEffect(() => {
    const onResize = () => setWidth((w) => (w === null ? w : clamp(w)));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clamp]);

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    drag.current = { startX: e.clientX, startWidth: currentWidth(), pointerId: e.pointerId };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    setWidth(clamp(d.startWidth - (e.clientX - d.startX)));
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture?.(d.pointerId)) {
      e.currentTarget.releasePointerCapture?.(d.pointerId);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? BIG_STEP : STEP;
    let next: number | null = null;
    if (e.key === 'ArrowLeft') next = currentWidth() + step;
    else if (e.key === 'ArrowRight') next = currentWidth() - step;
    else if (e.key === 'Home') next = maxPx();
    else if (e.key === 'End') next = min;
    if (next === null) return;
    e.preventDefault();
    setWidth(clamp(next));
  }

  const sideId = `split-pane-side-${id}`;
  const valueNow = Math.round(width ?? measured);

  return (
    <div className="split-pane" data-pane-id={id}>
      <div className="split-pane-main">{main}</div>
      {hasSide && (
        <>
          <div
            className="split-pane-divider"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize panel"
            aria-controls={sideId}
            aria-valuenow={valueNow}
            aria-valuemin={min}
            aria-valuemax={Math.round(maxPx())}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onLostPointerCapture={() => { drag.current = null; }}
            onKeyDown={onKeyDown}
          />
          <aside
            id={sideId}
            ref={sideRef}
            className="split-pane-side"
            aria-label={sideLabel}
            style={width !== null ? { width } : undefined}
          >
            {side}
          </aside>
        </>
      )}
    </div>
  );
}
