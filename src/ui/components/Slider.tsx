// Floating value slider (spec §7.3): one-way 0–100 with a recommended-default dot, or bidirectional
// −50…+50 with a centre tick, fill from centre and snap-to-0 within ±3. Relative dragging (the thumb
// never jumps under the finger), bubble while dragging that fades 600 ms after release, double-tap
// resets to the default. No haptics here — slider movement must never buzz (RB §1 #18).
import { useEffect, useRef, useState } from 'preact/hooks';
import type { SliderBinding } from '../panelModel';

const SNAP = 3; // display units
const TAP_SLOP = 6; // px
const DOUBLE_TAP_MS = 320;
const BUBBLE_LINGER_MS = 600;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export function displayOf(bidirectional: boolean, v: number): number {
  return bidirectional ? Math.round(v * 100 - 50) : Math.round(v * 100);
}

export function formatDisplay(bidirectional: boolean, v: number): string {
  const n = displayOf(bidirectional, v);
  if (!bidirectional || n === 0) return String(n);
  return n > 0 ? `+${n}` : `−${-n}`;
}

/** Drag maths, exported for tests: new value from a horizontal delta, with bidirectional snapping. */
export function dragValue(bidirectional: boolean, startV: number, dxPx: number, widthPx: number): { v: number; snapped: boolean } {
  let v = clamp01(startV + (widthPx > 0 ? dxPx / widthPx : 0));
  v = Math.round(v * 100) / 100;
  if (bidirectional && Math.abs(displayOf(true, v)) <= SNAP) return { v: 0.5, snapped: true };
  return { v, snapped: false };
}

/** restart the CSS snap pulse without re-mounting (re-mounting would drop pointer capture) */
function restartPulse(el: HTMLElement | null): void {
  if (!el) return;
  el.classList.remove('snapped');
  void el.offsetWidth;
  el.classList.add('snapped');
}

interface Props {
  binding: SliderBinding | null;
  onChange(v: number): void;
  onCommit(v: number): void;
  /** camera: float over the preview with a scrim */
  float?: boolean;
}

export function SliderRow({ binding, onChange, onCommit, float }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; x0: number; v0: number; moved: boolean; snapped: boolean } | null>(null);
  const lastTap = useRef(0);
  const [dragV, setDragV] = useState<number | null>(null);
  const [bubble, setBubble] = useState(false);
  const sliderRef = useRef<HTMLDivElement>(null);
  const bubbleTimer = useRef(0);

  const key = binding?.key ?? '';
  useEffect(() => {
    drag.current = null;
    setDragV(null);
    setBubble(false);
    lastTap.current = 0;
  }, [key]);
  useEffect(() => () => clearTimeout(bubbleTimer.current), []);

  if (!binding) return <div class={`slider-row empty${float ? ' float' : ''}`} aria-hidden="true" />;

  const bi = binding.bidirectional;
  const v = dragV ?? binding.value;
  const pct = v * 100;
  const fill = bi
    ? { left: `${Math.min(50, pct)}%`, width: `${Math.abs(pct - 50)}%` }
    : { left: '0%', width: `${pct}%` };

  const showBubbleNow = () => {
    clearTimeout(bubbleTimer.current);
    setBubble(true);
  };
  const hideBubbleLater = () => {
    clearTimeout(bubbleTimer.current);
    bubbleTimer.current = window.setTimeout(() => setBubble(false), BUBBLE_LINGER_MS);
  };

  const onDown = (e: PointerEvent) => {
    if (drag.current) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, x0: e.clientX, v0: binding.value, moved: false, snapped: false };
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x0;
    if (!d.moved) {
      if (Math.abs(dx) < TAP_SLOP) return;
      d.moved = true;
      d.x0 = e.clientX; // start from here so crossing the slop never jumps the value
      showBubbleNow();
      return;
    }
    const width = trackRef.current?.getBoundingClientRect().width ?? 0;
    const r = dragValue(bi, d.v0, dx, width);
    if (r.snapped && !d.snapped) restartPulse(sliderRef.current);
    d.snapped = r.snapped;
    if (r.v !== (dragV ?? binding.value)) {
      setDragV(r.v);
      onChange(r.v);
    }
  };
  const onUp = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (d.moved) {
      const final = dragV ?? binding.value;
      setDragV(null);
      onCommit(final);
      hideBubbleLater();
      lastTap.current = 0;
      return;
    }
    const now = performance.now();
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      onChange(binding.defaultValue);
      onCommit(binding.defaultValue);
      showBubbleNow();
      hideBubbleLater();
    } else {
      lastTap.current = now;
    }
  };
  const onCancel = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (d.moved) onCommit(dragV ?? binding.value);
    setDragV(null);
    hideBubbleLater();
  };

  const text = formatDisplay(bi, v);
  return (
    <div class={`slider-row${float ? ' float' : ''}`}>
      <span class="slider-label">{binding.label}</span>
      <div
        class={`slider${dragV !== null ? ' dragging' : ''}`}
        ref={sliderRef}
        role="slider"
        aria-label={binding.label}
        aria-valuemin={bi ? -50 : 0}
        aria-valuemax={bi ? 50 : 100}
        aria-valuenow={displayOf(bi, v)}
        aria-valuetext={text}
        tabIndex={0}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        onKeyDown={(e) => {
          const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 0.01 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -0.01 : 0;
          if (!step) return;
          e.preventDefault();
          const nv = clamp01(Math.round((binding.value + step) * 100) / 100);
          onChange(nv);
          onCommit(nv);
        }}
      >
        <div class="slider-track" ref={trackRef}>
          <div class="slider-fill" style={fill} />
          {bi ? <div class="slider-tick" /> : <div class="slider-def" style={{ left: `${binding.defaultValue * 100}%` }} />}
          <div class="slider-thumb" style={{ left: `${pct}%` }} />
          <div class={`slider-bubble num${bubble ? ' show' : ''}`} style={{ left: `${pct}%` }}>
            {text}
          </div>
        </div>
      </div>
      <span class="slider-value num">{text}</span>
    </div>
  );
}
