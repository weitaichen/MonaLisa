import { describe, expect, it } from 'vitest';
import { applyPreset, defaultParams, setParam } from '../engine/params';
import type { BeautyParams } from '../types';
import { stableKey, UndoStack } from './undo';

describe('UndoStack basics', () => {
  it('is empty before reset', () => {
    const s = new UndoStack<number>();
    expect(s.current).toBeNull();
    expect(s.canUndo).toBe(false);
    expect(s.canRedo).toBe(false);
    expect(s.undo()).toBeNull();
    expect(s.redo()).toBeNull();
  });

  it('reset sets current and clears history', () => {
    const s = new UndoStack<number>();
    s.reset(1);
    s.push(2);
    s.push(3);
    s.undo();
    s.reset(10);
    expect(s.current).toBe(10);
    expect(s.canUndo).toBe(false);
    expect(s.canRedo).toBe(false);
  });

  it('first push without reset becomes the initial state', () => {
    const s = new UndoStack<string>();
    s.push('a');
    expect(s.current).toBe('a');
    expect(s.canUndo).toBe(false);
    s.push('b');
    expect(s.undo()).toBe('a');
  });

  it('undo / redo walk the history and report availability', () => {
    const s = new UndoStack<number>();
    s.reset(0);
    s.push(1);
    s.push(2);
    expect(s.canUndo).toBe(true);
    expect(s.canRedo).toBe(false);
    expect(s.undo()).toBe(1);
    expect(s.undo()).toBe(0);
    expect(s.undo()).toBeNull();
    expect(s.current).toBe(0);
    expect(s.canUndo).toBe(false);
    expect(s.canRedo).toBe(true);
    expect(s.redo()).toBe(1);
    expect(s.redo()).toBe(2);
    expect(s.redo()).toBeNull();
    expect(s.current).toBe(2);
  });
});

describe('UndoStack redo branch', () => {
  it('push after undo drops the redo branch', () => {
    const s = new UndoStack<number>();
    s.reset(0);
    s.push(1);
    s.push(2);
    s.push(3);
    s.undo(); // 2
    s.undo(); // 1
    s.push(9);
    expect(s.canRedo).toBe(false);
    expect(s.redo()).toBeNull();
    expect(s.current).toBe(9);
    expect(s.undo()).toBe(1);
    expect(s.undo()).toBe(0);
    expect(s.undo()).toBeNull();
    // the dropped branch is really gone
    expect(s.redo()).toBe(1);
    expect(s.redo()).toBe(9);
    expect(s.redo()).toBeNull();
  });

  it('a duplicate push after undo keeps the redo branch', () => {
    const s = new UndoStack<number>();
    s.reset(0);
    s.push(1);
    s.push(2);
    s.undo(); // current 1
    s.push(1);
    expect(s.canRedo).toBe(true);
    expect(s.redo()).toBe(2);
  });
});

describe('UndoStack duplicate pushes', () => {
  it('ignores pushes JSON-equal to current', () => {
    const s = new UndoStack<{ a: number; b: number[] }>();
    s.reset({ a: 1, b: [1, 2] });
    s.push({ a: 1, b: [1, 2] });
    expect(s.canUndo).toBe(false);
    s.push({ a: 2, b: [1, 2] });
    s.push({ a: 2, b: [1, 2] });
    s.push({ a: 2, b: [1, 2] });
    expect(s.undo()).toEqual({ a: 1, b: [1, 2] });
    expect(s.canUndo).toBe(false);
  });

  it('treats objects with different key order as equal', () => {
    const s = new UndoStack<Record<string, unknown>>();
    s.reset({ a: 1, nested: { x: 1, y: 2 } });
    s.push({ nested: { y: 2, x: 1 }, a: 1 });
    expect(s.canUndo).toBe(false);
  });

  it('records a state equal to an older (non-current) state', () => {
    const s = new UndoStack<number>();
    s.reset(0);
    s.push(1);
    s.push(0);
    expect(s.current).toBe(0);
    expect(s.undo()).toBe(1);
    expect(s.undo()).toBe(0);
  });

  it('array order and value types still matter', () => {
    const s = new UndoStack<unknown>();
    s.reset([1, 2]);
    s.push([2, 1]);
    expect(s.canUndo).toBe(true);
    s.push(['2', 1]);
    expect(s.undo()).toEqual([2, 1]);
  });

  it('dedupes BeautyParams produced via different code paths', () => {
    const s = new UndoStack<BeautyParams>();
    s.reset(defaultParams());
    // same content, different construction / key order
    const p = defaultParams();
    const reordered: BeautyParams = {
      heightBand: p.heightBand,
      bodyProtect: p.bodyProtect,
      presetAmount: p.presetAmount,
      presetId: p.presetId,
      blushShade: p.blushShade,
      lipShade: p.lipShade,
      filterId: p.filterId,
      values: Object.fromEntries(Object.entries(p.values).reverse()) as BeautyParams['values'],
    };
    s.push(reordered);
    s.push(applyPreset('natural', 1));
    expect(s.canUndo).toBe(false);
    s.push(setParam(p, 'skin.smooth', 0.9));
    expect(s.canUndo).toBe(true);
  });
});

describe('UndoStack limit', () => {
  it('keeps at most `limit` undo steps, evicting the oldest', () => {
    const s = new UndoStack<number>(3);
    s.reset(0);
    for (let i = 1; i <= 10; i++) s.push(i);
    expect(s.current).toBe(10);
    expect(s.undo()).toBe(9);
    expect(s.undo()).toBe(8);
    expect(s.undo()).toBe(7);
    expect(s.undo()).toBeNull();
    expect(s.current).toBe(7);
    // redo still reaches the newest
    expect(s.redo()).toBe(8);
    expect(s.redo()).toBe(9);
    expect(s.redo()).toBe(10);
    expect(s.redo()).toBeNull();
  });

  it('eviction after a branch drop counts only the surviving branch', () => {
    const s = new UndoStack<number>(2);
    s.reset(0);
    s.push(1);
    s.push(2); // [0,1,2]
    s.undo(); // current 1
    s.undo(); // current 0
    s.push(5); // [0,5] — no eviction needed
    expect(s.undo()).toBe(0);
    expect(s.undo()).toBeNull();
    s.redo();
    s.push(6); // [0,5,6]
    s.push(7); // [5,6,7] — 0 evicted
    expect(s.undo()).toBe(6);
    expect(s.undo()).toBe(5);
    expect(s.undo()).toBeNull();
  });

  it('default limit is 50 steps', () => {
    const s = new UndoStack<number>();
    s.reset(0);
    for (let i = 1; i <= 80; i++) s.push(i);
    let steps = 0;
    while (s.undo() !== null) steps++;
    expect(steps).toBe(50);
    expect(s.current).toBe(30);
  });

  it('limit 0 keeps only the current state', () => {
    const s = new UndoStack<number>(0);
    s.reset(0);
    s.push(1);
    s.push(2);
    expect(s.current).toBe(2);
    expect(s.canUndo).toBe(false);
    expect(s.undo()).toBeNull();
  });

  it('sanitises a nonsensical limit', () => {
    const neg = new UndoStack<number>(-5);
    neg.reset(0);
    neg.push(1);
    expect(neg.canUndo).toBe(false);
    const nan = new UndoStack<number>(Number.NaN);
    nan.reset(0);
    for (let i = 1; i <= 60; i++) nan.push(i);
    let steps = 0;
    while (nan.undo() !== null) steps++;
    expect(steps).toBe(50);
    const frac = new UndoStack<number>(2.9);
    frac.reset(0);
    for (let i = 1; i <= 5; i++) frac.push(i);
    steps = 0;
    while (frac.undo() !== null) steps++;
    expect(steps).toBe(2);
  });
});

describe('UndoStack isolation (structuredClone)', () => {
  it('mutating a pushed object does not change history', () => {
    const s = new UndoStack<{ v: number }>();
    const a = { v: 1 };
    s.reset(a);
    a.v = 99;
    expect(s.current).toEqual({ v: 1 });
    const b = { v: 2 };
    s.push(b);
    b.v = 77;
    expect(s.current).toEqual({ v: 2 });
    // after mutation the caller's object equals nothing in history, so pushing it records a step
    s.push(b);
    expect(s.current).toEqual({ v: 77 });
  });

  it('mutating returned states does not change history', () => {
    const s = new UndoStack<{ v: number }>();
    s.reset({ v: 1 });
    s.push({ v: 2 });
    const cur = s.current!;
    cur.v = 1000;
    expect(s.current).toEqual({ v: 2 });
    const back = s.undo()!;
    back.v = 1000;
    expect(s.current).toEqual({ v: 1 });
    const fwd = s.redo()!;
    fwd.v = 1000;
    expect(s.current).toEqual({ v: 2 });
  });

  it('returned states are fresh objects each time', () => {
    const s = new UndoStack<{ v: number }>();
    s.reset({ v: 1 });
    expect(s.current).not.toBe(s.current);
  });

  it('BeautyParams survive a round trip unchanged', () => {
    const s = new UndoStack<BeautyParams>();
    const p0 = applyPreset('glow', 0.7);
    const p1 = setParam(p0, 'shape.chin', 0.8);
    s.reset(p0);
    s.push(p1);
    expect(s.undo()).toEqual(p0);
    expect(s.redo()).toEqual(p1);
  });
});

describe('stableKey', () => {
  it('sorts nested object keys', () => {
    expect(stableKey({ b: 1, a: { d: 1, c: 2 } })).toBe('{"a":{"c":2,"d":1},"b":1}');
  });
  it('distinguishes undefined from the string "undefined" and from null', () => {
    expect(stableKey(undefined)).not.toBe(stableKey('undefined'));
    expect(stableKey(undefined)).not.toBe(stableKey(null));
  });
  it('handles null-prototype objects', () => {
    const o = Object.create(null) as Record<string, number>;
    o.b = 2;
    o.a = 1;
    expect(stableKey(o)).toBe('{"a":1,"b":2}');
  });
});
