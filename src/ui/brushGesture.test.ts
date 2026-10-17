import { describe, expect, it } from 'vitest';
import { PINCH_GRACE_MS } from '../config/limits';
import {
  BRUSH_DOUBLE_TAP_MS,
  BRUSH_IDLE,
  brushGesture,
  brushMoveAction,
  brushPointers,
  type BrushEffect,
  type BrushGestureEvent,
  type BrushGestureState,
} from './brushGesture';

/** run events from idle; returns the final state and every effect in order */
function run(events: BrushGestureEvent[], from: BrushGestureState = BRUSH_IDLE) {
  let s = from;
  const fx: BrushEffect[] = [];
  for (const e of events) {
    const r = brushGesture(s, e);
    s = r.state;
    fx.push(...r.effects);
  }
  return { s, fx };
}

describe('brushGesture (push-brush spec §2.5)', () => {
  it('one finger draws: down starts, moves feed, up commits', () => {
    const { s, fx } = run([{ type: 'down', id: 1, t: 0 }]);
    expect(fx).toEqual(['strokeStart']);
    expect(brushMoveAction(s, 1)).toBe('feed');
    expect(brushMoveAction(s, 2)).toBe('none');
    expect(run([{ type: 'up', id: 1, t: 500, stamped: true }], s).fx).toEqual(['strokeCommit']);
  });

  it(`a second finger at ${PINCH_GRACE_MS - 1} ms cancels the stroke and pinches`, () => {
    const { s, fx } = run([
      { type: 'down', id: 1, t: 1000 },
      { type: 'down', id: 2, t: 1000 + PINCH_GRACE_MS - 1 },
    ]);
    expect(fx).toEqual(['strokeStart', 'strokeCancel', 'pinchStart']);
    expect(s).toEqual({ kind: 'pinch', ids: [1, 2] });
    expect(brushMoveAction(s, 1)).toBe('pinch');
    expect(brushMoveAction(s, 2)).toBe('pinch');
  });

  it(`exactly at the grace (${PINCH_GRACE_MS} ms) it still cancels; at ${PINCH_GRACE_MS + 1} ms it commits`, () => {
    expect(run([{ type: 'down', id: 1, t: 0 }, { type: 'down', id: 2, t: PINCH_GRACE_MS }]).fx).toContain('strokeCancel');
    const late = run([{ type: 'down', id: 1, t: 0 }, { type: 'down', id: 2, t: PINCH_GRACE_MS + 1 }]);
    expect(late.fx).toEqual(['strokeStart', 'strokeCommit', 'pinchStart']);
  });

  it('pinch → one finger lifts → locked (no pan, no draw) → last finger lifts → idle', () => {
    let { s, fx } = run([{ type: 'down', id: 1, t: 0 }, { type: 'down', id: 2, t: 50 }]);
    ({ s, fx } = run([{ type: 'up', id: 1, t: 400, stamped: false }], s));
    expect(fx).toEqual(['pinchEnd']);
    expect(s).toEqual({ kind: 'locked', id: 2 });
    expect(brushMoveAction(s, 2)).toBe('none');
    ({ s, fx } = run([{ type: 'up', id: 2, t: 600, stamped: false }], s));
    expect(fx).toEqual([]);
    expect(s).toEqual(BRUSH_IDLE);
  });

  it('a finger landing while locked pinches again; a third finger is ignored', () => {
    let { s, fx } = run([{ type: 'down', id: 1, t: 0 }, { type: 'down', id: 2, t: 50 }, { type: 'up', id: 1, t: 100, stamped: false }]);
    ({ s, fx } = run([{ type: 'down', id: 3, t: 200 }], s));
    expect(fx).toEqual(['pinchStart']);
    expect(s).toEqual({ kind: 'pinch', ids: [2, 3] });
    ({ s, fx } = run([{ type: 'down', id: 4, t: 300 }], s));
    expect(fx).toEqual([]);
    expect(brushPointers(s)).toEqual([2, 3]);
  });

  it('pointercancel during a stroke commits it (an iOS system gesture)', () => {
    expect(run([{ type: 'down', id: 1, t: 0 }, { type: 'cancel', id: 1 }]).fx).toEqual(['strokeStart', 'strokeCommit']);
  });

  it('a double tap without stamps fits; a gesture with stamps is never a tap', () => {
    const tap = (id: number, t: number, stamped = false): BrushGestureEvent[] => [
      { type: 'down', id, t },
      { type: 'up', id, t: t + 40, stamped },
    ];
    expect(run([...tap(1, 0), ...tap(2, 200)]).fx).toEqual(['strokeStart', 'strokeCommit', 'strokeStart', 'strokeCommit', 'fit']);
    expect(run([...tap(1, 0, true), ...tap(2, 200)]).fx).not.toContain('fit');
    expect(run([...tap(1, 0), ...tap(2, 200, true)]).fx).not.toContain('fit');
    expect(run([...tap(1, 0), ...tap(2, 40 + BRUSH_DOUBLE_TAP_MS + 10)]).fx).not.toContain('fit');
  });

  it('events of untracked pointers change nothing', () => {
    const s0 = run([{ type: 'down', id: 1, t: 0 }]).s;
    expect(brushGesture(s0, { type: 'up', id: 9, t: 10, stamped: false })).toEqual({ state: s0, effects: [] });
    expect(brushGesture(BRUSH_IDLE, { type: 'up', id: 9, t: 10, stamped: false })).toEqual({ state: BRUSH_IDLE, effects: [] });
    expect(brushPointers(BRUSH_IDLE)).toEqual([]);
  });
});
