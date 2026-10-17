// 推臉筆 gestures (push-brush spec §2.5): which pointer draws, when a second finger cancels or commits the stroke and
// pinches, and when a stamp-free tap pair fits the view. Pure: zoomPan feeds it pointer events with their time and
// carries out the effects, so the rules are unit-tested without a DOM.
import { PINCH_GRACE_MS } from '../config/limits';

/** two stamp-free taps within this many ms fit the view (zoomPan.ts DOUBLE_TAP_MS) */
export const BRUSH_DOUBLE_TAP_MS = 300;

export type BrushGestureState =
  /** lastTap: when the last stamp-free tap ended (0 = none) */
  | { kind: 'idle'; lastTap: number }
  | { kind: 'stroke'; id: number; downAt: number; lastTap: number }
  | { kind: 'pinch'; ids: readonly [number, number] }
  /** one finger of a pinch is still down: it neither pans nor draws */
  | { kind: 'locked'; id: number };

export type BrushGestureEvent =
  | { type: 'down'; id: number; t: number }
  /** `stamped`: the live stroke applied a stamp (then it is never a tap) */
  | { type: 'up'; id: number; t: number; stamped: boolean }
  | { type: 'cancel'; id: number };

export type BrushEffect = 'strokeStart' | 'strokeCommit' | 'strokeCancel' | 'pinchStart' | 'pinchEnd' | 'fit';

export const BRUSH_IDLE: BrushGestureState = { kind: 'idle', lastTap: 0 };

export function brushGesture(s: BrushGestureState, e: BrushGestureEvent): { state: BrushGestureState; effects: BrushEffect[] } {
  const same = { state: s, effects: [] as BrushEffect[] };
  switch (s.kind) {
    case 'idle':
      if (e.type !== 'down') return same;
      return { state: { kind: 'stroke', id: e.id, downAt: e.t, lastTap: s.lastTap }, effects: ['strokeStart'] };
    case 'stroke':
      if (e.type === 'down') {
        const early = e.t - s.downAt <= PINCH_GRACE_MS;
        return { state: { kind: 'pinch', ids: [s.id, e.id] }, effects: [early ? 'strokeCancel' : 'strokeCommit', 'pinchStart'] };
      }
      if (e.id !== s.id) return same;
      if (e.type === 'cancel') return { state: BRUSH_IDLE, effects: ['strokeCommit'] };
      if (e.stamped) return { state: BRUSH_IDLE, effects: ['strokeCommit'] };
      if (s.lastTap > 0 && e.t - s.lastTap < BRUSH_DOUBLE_TAP_MS) return { state: BRUSH_IDLE, effects: ['strokeCommit', 'fit'] };
      return { state: { kind: 'idle', lastTap: e.t }, effects: ['strokeCommit'] };
    case 'pinch': {
      if (e.type === 'down') return same; // a third finger is ignored
      const [a, b] = s.ids;
      if (e.id !== a && e.id !== b) return same;
      return { state: { kind: 'locked', id: e.id === a ? b : a }, effects: ['pinchEnd'] };
    }
    case 'locked':
      if (e.type === 'down') return { state: { kind: 'pinch', ids: [s.id, e.id] }, effects: ['pinchStart'] };
      return e.id === s.id ? { state: BRUSH_IDLE, effects: [] } : same;
  }
}

/** what a pointer move does in this state */
export function brushMoveAction(s: BrushGestureState, id: number): 'feed' | 'pinch' | 'none' {
  if (s.kind === 'stroke') return s.id === id ? 'feed' : 'none';
  if (s.kind === 'pinch') return s.ids.includes(id) ? 'pinch' : 'none';
  return 'none';
}

/** the pointers this state tracks (zoomPan forgets every other one) */
export function brushPointers(s: BrushGestureState): number[] {
  if (s.kind === 'stroke' || s.kind === 'locked') return [s.id];
  if (s.kind === 'pinch') return [...s.ids];
  return [];
}
