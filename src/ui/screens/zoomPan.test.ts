import { describe, expect, it } from 'vitest';
import { clampView, tapOutcome, type GestureEvent } from './zoomPan';

const ev = (type: GestureEvent['type'], x: number, y: number, t: number, id = 1): GestureEvent => ({ type, id, x, y, t });

describe('tapOutcome (skin-cleanup spec §2.3)', () => {
  it('one finger that stays within 8 px taps, on its up', () => {
    expect(tapOutcome([ev('down', 100, 100, 0), ev('move', 104, 103, 40), ev('up', 105, 104, 80)], -Infinity, 'spot')).toEqual({ tap: { x: 105, y: 104, t: 80 }, fit: false });
  });

  it('a move over 8 px or a second finger is no tap', () => {
    expect(tapOutcome([ev('down', 100, 100, 0), ev('move', 109, 100, 40), ev('up', 100, 100, 80)], -Infinity, 'spot').tap).toBeNull();
    expect(tapOutcome([ev('down', 100, 100, 0), ev('down', 200, 100, 20, 2), ev('up', 200, 100, 60, 2), ev('up', 100, 100, 80)], -Infinity, 'spot').tap).toBeNull();
  });

  it('a pointercancel never adds a spot; in view mode it still ends the gesture like an up (v0.3)', () => {
    expect(tapOutcome([ev('down', 100, 100, 0), ev('cancel', 100, 100, 50)], -Infinity, 'spot')).toEqual({ tap: null, fit: false });
    expect(tapOutcome([ev('down', 100, 100, 0), ev('cancel', 100, 100, 50)], -Infinity, 'view').tap).not.toBeNull();
  });

  it('view mode: a second tap within 300 ms also fits the view', () => {
    expect(tapOutcome([ev('down', 100, 100, 1000), ev('up', 100, 100, 1050)], 800, 'view').fit).toBe(true);
    expect(tapOutcome([ev('down', 100, 100, 1000), ev('up', 100, 100, 1050)], 600, 'view').fit).toBe(false);
  });

  it('spot mode: a quick double tap is two taps and never a fit (Review Focus 2)', () => {
    const a = tapOutcome([ev('down', 100, 100, 0), ev('up', 100, 100, 40)], -Infinity, 'spot');
    const b = tapOutcome([ev('down', 102, 101, 100), ev('up', 102, 101, 140)], a.tap!.t, 'spot');
    expect([a.tap !== null, a.fit, b.tap !== null, b.fit]).toEqual([true, false, true, false]);
  });

  it('clampView is unchanged', () => {
    expect(clampView({ s: 0.5, x: 9, y: 9 }, 100, 100)).toEqual({ s: 1, x: 0, y: 0 });
  });
});
