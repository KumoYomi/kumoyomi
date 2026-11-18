import { type KeyboardEvent, type PointerEvent, useRef, useState } from 'react';

interface ReaderProgressScrubberProps {
  total: number;
  value: number;
  onCommit: (pageIndex: number) => void;
  formatLabel?: (pageOneBased: number, total: number) => string;
}

export function ReaderProgressScrubber({
  total,
  value,
  onCommit,
  formatLabel = (p, n) => `${p} / ${n}`,
}: ReaderProgressScrubberProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [hoverInfo, setHoverInfo] = useState<{ index: number; pct: number } | null>(null);

  if (total <= 1) {
    return (
      <div className="h-2 flex-1 rounded-full bg-white/10">
        <div className="ky-accent-badge h-full w-full rounded-full opacity-80" />
      </div>
    );
  }

  const displayIndex = draggingIndex ?? Math.max(0, Math.min(total - 1, value));
  const fillPercent = ((displayIndex + 0.5) / total) * 100;

  function ratioFromClientX(clientX: number): { index: number; pct: number } {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return { index: displayIndex, pct: fillPercent };
    const ratio = Math.max(0, Math.min(0.999999, (clientX - rect.left) / rect.width));
    const index = Math.min(total - 1, Math.floor(ratio * total));
    return {
      index,
      pct: ((index + 0.5) / total) * 100,
    };
  }

  function handlePointerDown(e: PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore synthetic pointer events without active pointerId
    }
    isDraggingRef.current = true;
    const { index } = ratioFromClientX(e.clientX);
    setDraggingIndex(index);
  }

  function handlePointerMove(e: PointerEvent<HTMLDivElement>) {
    const info = ratioFromClientX(e.clientX);
    setHoverInfo(info);
    if (isDraggingRef.current) {
      setDraggingIndex(info.index);
    }
  }

  function handlePointerUp(e: PointerEvent<HTMLDivElement>) {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    const { index } = ratioFromClientX(e.clientX);
    setDraggingIndex(null);
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore synthetic pointer capture cleanup errors
    }
    onCommit(index);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      onCommit(Math.max(0, displayIndex - 1));
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      onCommit(Math.min(total - 1, displayIndex + 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      onCommit(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      onCommit(total - 1);
    }
  }

  const tickCount = total <= 48 ? total : 24;
  const tooltipTarget =
    draggingIndex !== null
      ? { index: draggingIndex, pct: ((draggingIndex + 0.5) / total) * 100 }
      : hoverInfo;

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={0}
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={displayIndex + 1}
      aria-valuetext={formatLabel(displayIndex + 1, total)}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={() => {
        isDraggingRef.current = false;
        setDraggingIndex(null);
      }}
      onPointerLeave={() => setHoverInfo(null)}
      onKeyDown={handleKeyDown}
      className="group relative flex h-8 flex-1 cursor-pointer touch-none items-center select-none focus:outline-none"
    >
      {/* Tooltip page preview */}
      {tooltipTarget && (
        <div
          style={{ left: `clamp(24px, ${tooltipTarget.pct}%, calc(100% - 24px))` }}
          className="pointer-events-none absolute -top-8 -translate-x-1/2 whitespace-nowrap rounded-lg border border-white/15 bg-slate-900/95 px-2 py-0.5 font-mono text-[11px] font-semibold text-white shadow-lg backdrop-blur"
        >
          {formatLabel(tooltipTarget.index + 1, total)}
        </div>
      )}

      {/* Piste divisée par pages */}
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-white/12 ring-1 ring-white/10 transition-[height] group-hover:h-2.5">
        {/* Barre de progression */}
        <div
          style={{
            width: `${fillPercent}%`,
            backgroundImage: 'linear-gradient(90deg, var(--ky-accent), var(--ky-accent-2))',
          }}
          className="h-full rounded-full"
        />

        {/* Repères de division égaux */}
        <div className="pointer-events-none absolute inset-0 flex justify-between">
          {Array.from({ length: tickCount + 1 }).map((_, idx) => (
            <span
              key={idx}
              className={`h-full w-px ${
                idx === 0 || idx === tickCount ? 'bg-transparent' : 'bg-black/35'
              }`}
            />
          ))}
        </div>
      </div>

      {/* Curseur */}
      <div
        style={{ left: `${fillPercent}%` }}
        className={`pointer-events-none absolute h-4 w-4 -translate-x-1/2 rounded-full border-2 border-white bg-[var(--ky-accent)] shadow-md shadow-black/50 transition-transform ${
          draggingIndex !== null ? 'scale-125' : 'group-hover:scale-110'
        }`}
      />
    </div>
  );
}
