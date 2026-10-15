// Floating value slider (spec §7.3): one-way 0–100 with a recommended-default dot, or bidirectional
// −50…+50 with a centre tick, fill from centre and snap-to-0 within ±3. Relative dragging (the thumb
// never jumps under the finger), bubble while dragging that fades 600 ms after release, double-tap
// resets to the default. No haptics here — slider movement must never buzz (RB §1 #18). A binding's `scale` (拉直:
// −45.0°…+45.0°, step 0.1°, snap ±0.5°) replaces the display units; without one the output is v0.3's exactly.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { PanelSelection, SliderScale, SliderView } from '../panelModel';

const SNAP = 3; // display units
const TAP_SLOP = 6; // px
const DOUBLE_TAP_MS = 320;
const BUBBLE_LINGER_MS = 600;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const decimals = (step: number) => (step >= 1 ? 0 : Math.ceil(-Math.log10(step) - 1e-9));
/** the number of steps across a scale (900 for 拉直) */
const stepsOf = (s: SliderScale) => Math.round((s.max - s.min) / s.step);

export function displayOf(bidirectional: boolean, v: number, scale?: SliderScale): number {
  if (!scale) return bidirectional ? Math.round(v * 100 - 50) : Math.round(v * 100);
  const raw = scale.min + v * (scale.max - scale.min);
  const n = Number((Math.round(raw / scale.step) * scale.step).toFixed(decimals(scale.step)));
  return n === 0 ? 0 : n;
}

export function formatDisplay(bidirectional: boolean, v: number, scale?: SliderScale): string {
  const n = displayOf(bidirectional, v, scale);
  if (!scale) {
    if (!bidirectional || n === 0) return String(n);
    return n > 0 ? `+${n}` : `−${-n}`;
  }
  const d = decimals(scale.step);
  if (n === 0) return `0${scale.suffix}`;
  if (!bidirectional) return `${n.toFixed(d)}${scale.suffix}`;
  return n > 0 ? `+${n.toFixed(d)}${scale.suffix}` : `−${(-n).toFixed(d)}${scale.suffix}`;
}

/** under a split item's slider: the other on-screen side's value, e.g. 「右 +12」 or 「左 30」 (S5 §2.2) */
export function sideCaption(b: SliderView): string | null {
  if (!b.sides) return null;
  return `${b.sides.active === 'L' ? '右' : '左'} ${formatDisplay(b.bidirectional, b.sides.other)}`;
}

/**
 * the slider's accessible name: step 1's `aria` (「{label}，人物 {n}」 / 「{label}，全部」, set by decorate with ≥ 2 persons) or the
 * label, with the chosen side right after the item name while a side is chosen: 「瘦臉（左）」, 「瘦臉（左），人物 2」
 */
export function sliderAriaLabel(b: SliderView): string {
  const base = b.aria ?? b.label;
  if (!b.sides) return base;
  const side = `（${b.sides.active === 'L' ? '左' : '右'}）`;
  return base.startsWith(b.label) ? `${b.label}${side}${base.slice(b.label.length)}` : `${base}${side}`;
}

/** aria-valuetext: the value, plus the end it leans to when the slider has end captions (「−20 冷」, 「+15 暖」) */
export function valueText(text: string, n: number, ends?: readonly [string, string]): string {
  return ends && n !== 0 ? `${text} ${n < 0 ? ends[0] : ends[1]}` : text;
}

/** Drag maths, exported for tests: new value from a horizontal delta, with bidirectional snapping. */
export function dragValue(bidirectional: boolean, startV: number, dxPx: number, widthPx: number, scale?: SliderScale): { v: number; snapped: boolean } {
  let v = clamp01(startV + (widthPx > 0 ? dxPx / widthPx : 0));
  if (!scale) {
    v = Math.round(v * 100) / 100;
    if (bidirectional && Math.abs(displayOf(true, v)) <= SNAP) return { v: 0.5, snapped: true };
    return { v, snapped: false };
  }
  const steps = stepsOf(scale);
  v = Math.round(v * steps) / steps;
  if (bidirectional && Math.abs(displayOf(true, v, scale)) <= scale.snap) return { v: -scale.min / (scale.max - scale.min), snapped: true };
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
  binding: SliderView | null;
  onChange(v: number): void;
  onCommit(v: number): void;
  /** camera: float over the preview with a scrim */
  float?: boolean;
  /** shown in the empty row (程度 under 全部 with different presets) */
  emptyText?: string | null;
  /** 左｜右 chips: a side change is a selection change (view state, never an undo step) */
  onSel?(sel: PanelSelection): void;
}

export function SliderRow({ binding, onChange, onCommit, float, emptyText, onSel }: Props) {
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

  if (!binding) {
    // the empty row is invisible; with a text (各人不同) it stays up and says why there is no slider
    return emptyText ? (
      <div class={`slider-row empty has-text${float ? ' float' : ''}`}>
        <span class="slider-empty">{emptyText}</span>
      </div>
    ) : (
      <div class={`slider-row empty${float ? ' float' : ''}`} aria-hidden="true" />
    );
  }

  const bi = binding.bidirectional;
  const sc = binding.scale;
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
    const r = dragValue(bi, d.v0, dx, width, sc);
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

  const text = formatDisplay(bi, v, sc);
  return (
    <div class={`slider-row${float ? ' float' : ''}`}>
      {binding.sides ? (
        <>
          <div class="side-chips" role="radiogroup" aria-label={`${binding.label}：左右`}>
            {(['L', 'R'] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={binding.sides!.active === s}
                class={`side-chip${binding.sides!.active === s ? ' on' : ''}`}
                onClick={() => onSel?.(binding.sides!.select(s))}
              >
                {s === 'L' ? '左' : '右'}
              </button>
            ))}
          </div>
          {/* under 全部 `mixed` compares the chosen side (S5 §3.4) */}
          {binding.mixed && <small class="slider-mixed">各人不同</small>}
        </>
      ) : (
        <span class="slider-label">
          {binding.label}
          {binding.mixed && <small class="slider-mixed">各人不同</small>}
        </span>
      )}
      <div
        class={`slider${dragV !== null ? ' dragging' : ''}`}
        ref={sliderRef}
        role="slider"
        aria-label={sliderAriaLabel(binding)}
        aria-valuemin={sc ? sc.min : bi ? -50 : 0}
        aria-valuemax={sc ? sc.max : bi ? 50 : 100}
        aria-valuenow={displayOf(bi, v, sc)}
        aria-valuetext={binding.mixed ? `${valueText(text, displayOf(bi, v, sc), binding.ends)}，各人不同` : valueText(text, displayOf(bi, v, sc), binding.ends)}
        tabIndex={0}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onCancel}
        onKeyDown={(e) => {
          const dir = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 0;
          if (!dir) return;
          e.preventDefault();
          // without a scale: today's exact 0.01 arithmetic (editor.spec.ts checks aria-valuenow 98)
          const nv = sc
            ? clamp01((Math.round(binding.value * stepsOf(sc)) + dir) / stepsOf(sc))
            : clamp01(Math.round((binding.value + dir * 0.01) * 100) / 100);
          onChange(nv);
          onCommit(nv);
        }}
      >
        <div class={`slider-track${binding.track ? ` track-${binding.track}` : ''}`} ref={trackRef}>
          <div class="slider-fill" style={fill} />
          {bi ? <div class="slider-tick" /> : binding.hideDefault ? null : <div class="slider-def" style={{ left: `${binding.defaultValue * 100}%` }} />}
          <div class="slider-thumb" style={{ left: `${pct}%` }} />
          <div class={`slider-bubble num${bubble ? ' show' : ''}`} style={{ left: `${pct}%` }}>
            {text}
          </div>
        </div>
        {binding.ends && (
          <div class="slider-ends" aria-hidden="true">
            <span>{binding.ends[0]}</span>
            <span>{binding.ends[1]}</span>
          </div>
        )}
        {binding.sides && <span class="side-caption num">{sideCaption(binding)}</span>}
      </div>
      <span class="slider-value num">{text}</span>
    </div>
  );
}
