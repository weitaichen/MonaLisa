import { describe, expect, it, vi } from 'vitest';
import { IDENTITY_GEOMETRY } from '../../geometry/view';
import type { Geometry } from '../../types';
import { CropDrag, type CropDragHost } from './CropOverlay';

const O = { width: 1536, height: 2048 };

function setup(start: Geometry = { ...IDENTITY_GEOMETRY, crop: { x: 0.2, y: 0.2, w: 0.5, h: 0.5 } }) {
  const changes: { g: Geometry; commit: boolean }[] = [];
  const host: CropDragHost = { geometry: start, lock: 'free', oSize: O, eBox: { w: 300, h: 400 }, onChange: (g, commit) => changes.push({ g, commit }) };
  const active = vi.fn();
  const drag = new CropDrag(() => host, active);
  return { drag, changes, active, host };
}

describe('CropDrag (one undo step per gesture)', () => {
  it('a move gesture previews each step and commits its last once on release', () => {
    const { drag, changes, active } = setup();
    drag.down({ kind: 'move' }, 1, 100, 100);
    drag.move(1, 130, 100);
    drag.move(1, 160, 140);
    drag.end(1);
    expect(changes.map((c) => c.commit)).toEqual([false, false, true]);
    expect(changes[2].g).toBe(changes[1].g);
    expect(changes[1].g.crop.x).toBeCloseTo(0.2 + 60 / 300, 9);
    expect(active.mock.calls).toEqual([[true], [false]]);
  });

  it('an unmount mid-drag (abort) commits what is on screen exactly once (Review Focus 3)', () => {
    const { drag, changes } = setup();
    drag.down({ kind: 'corner', corner: 'br' }, 7, 0, 0);
    drag.move(7, -30, -40);
    drag.abort();
    drag.abort();
    expect(changes.filter((c) => c.commit)).toHaveLength(1);
    expect(drag.dragging).toBe(false);
  });

  it('another pointer is ignored; a press without a move commits nothing', () => {
    const { drag, changes } = setup();
    drag.down({ kind: 'edge', edge: 'left' }, 1, 0, 0);
    expect(drag.move(2, 50, 0)).toBe(false);
    drag.down({ kind: 'move' }, 3, 0, 0);
    expect(drag.end(1)).toBe(true);
    expect(changes).toEqual([]);
  });
});
