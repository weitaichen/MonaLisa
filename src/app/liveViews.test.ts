import { describe, expect, it } from 'vitest';
import { DETECTOR_FLOOR, LIVE_VIEW_MAX_EDGE, MAX_LIVE_FACES } from '../config/limits';
import { centerCropRect } from '../ui/imaging';
import { holdsWhole, isLarge, layoutViews, mapLandmarks, refreshViews, tileFor, viewScope, ViewSchedule } from './liveViews';

const crop = (w: number, h: number, ratio: number) => {
  const r = centerCropRect(w, h, ratio);
  return { x: r.x, y: r.y, w: r.width, h: r.height };
};
const R = { '3:4': 3 / 4, '1:1': 1, '9:16': 9 / 16 } as const;

describe('layoutViews (§6.6)', () => {
  it.each([
    ['environment', 'photo', '3:4', 720, 2, 3],
    ['environment', 'photo', '9:16', 720, 2, 4],
    ['environment', 'photo', '1:1', 720, 2, 2],
    ['user', 'camera', '3:4', 873, 2, 2],
    ['user', 'camera', '1:1', 873, 2, 2],
    ['user', 'camera', '9:16', 873, 2, 3],
  ] as const)('%s / %s, %s of the upright 1080 × 1920 stream: %i px tiles, %i × %i', (facing, det, ratio, side, cols, rows) => {
    const c = crop(1080, 1920, R[ratio]);
    const l = layoutViews(1080, 1920, c, facing, det);
    expect(l.whole.rect).toEqual(c);
    expect(l.tiles).toHaveLength(cols * rows);
    expect(l.tiles[0].id).toBe('t0,0');
    expect(l.tiles.at(-1)!.id).toBe(`t${cols - 1},${rows - 1}`);
    for (const t of l.tiles) {
      expect(Math.abs(t.rect.w - side)).toBeLessThanOrEqual(1);
      expect(t.rect.w).toBe(t.rect.h);
      expect(t.copy).toEqual({ w: t.rect.w, h: t.rect.h });
      expect(t.rect.x >= c.x && t.rect.y >= c.y && t.rect.x + t.rect.w <= c.x + c.w && t.rect.y + t.rect.h <= c.y + c.h).toBe(true);
    }
    // neighbours overlap by at least DETECTOR_FLOOR × the crop's long edge, along both axes
    const min = DETECTOR_FLOOR[det] * Math.max(c.w, c.h);
    for (const axis of ['x', 'y'] as const) {
      const starts = [...new Set(l.tiles.map((t) => t.rect[axis]))].sort((a, b) => a - b);
      starts.slice(1).forEach((s, i) => expect(starts[i] + l.tiles[0].rect.w - s).toBeGreaterThanOrEqual(min - 1));
    }
  });
  it('the e2e fake camera (1280 × 720, 3:4 crop 540 × 720) uses the same fractions: front 1 × 2 tiles of 540, back 2 × 2 of 480', () => {
    const c = crop(1280, 720, 3 / 4);
    expect(layoutViews(1280, 720, c, 'user', 'camera').tiles.map((t) => t.rect.w)).toEqual([540, 540]);
    expect(layoutViews(1280, 720, c, 'environment', 'photo').tiles).toHaveLength(4);
  });
  it('the whole view copies at most LIVE_VIEW_MAX_EDGE on its long edge', () => {
    const l = layoutViews(1080, 1920, crop(1080, 1920, 9 / 16), 'environment', 'photo');
    expect(Math.max(l.whole.copy.w, l.whole.copy.h)).toBe(LIVE_VIEW_MAX_EDGE);
  });
  it('a crop too thin for the overlap (tile side = the overlap) or an empty one still gets a finite grid inside it that covers it', () => {
    // 1250 × 100 on 1280 × 720, full-range: tile side min(480, 100) = 100 = 0.08 × 1250, the overlap
    const c = { x: 15, y: 310, w: 1250, h: 100 };
    const l = layoutViews(1280, 720, c, 'environment', 'photo');
    expect(l.tiles.length).toBeGreaterThan(0);
    expect(l.tiles.length).toBeLessThan(100);
    for (const t of l.tiles) expect(t.rect.x >= c.x && t.rect.x + t.rect.w <= c.x + c.w && t.rect.y >= c.y && t.rect.y + t.rect.h <= c.y + c.h).toBe(true);
    const xs = l.tiles.map((t) => t.rect.x).sort((a, b) => a - b);
    expect(xs[0]).toBe(c.x);
    xs.slice(1).forEach((x, i) => expect(x).toBeLessThanOrEqual(xs[i] + l.tiles[0].rect.w));
    expect(xs.at(-1)! + l.tiles[0].rect.w).toBe(c.x + c.w);
    expect(layoutViews(640, 480, { x: 0, y: 240, w: 640, h: 0 }, 'user', 'camera').tiles.length).toBeLessThanOrEqual(1);
  });
});

describe('assignment, scope and mapping (§6.6)', () => {
  const l = layoutViews(1080, 1920, crop(1080, 1920, 3 / 4), 'environment', 'photo'); // crop 1080 × 1440 at y 240
  const box = (cx: number, cy: number, w: number) => ({ x: cx - w / 2, y: cy - (w * 1080) / 1920 / 2, w, h: (w * 1080) / 1920 });
  it('large at ≥ 1.25 × DETECTOR_FLOOR × the crop long edge (144 px); a small box goes to the tile holding it whole with the nearest centre', () => {
    expect(isLarge(box(0.5, 0.5, 145 / 1080), l)).toBe(true);
    expect(isLarge(box(0.5, 0.5, 143 / 1080), l)).toBe(false);
    const small = box(0.2, 0.2, 0.05);
    expect(tileFor(small, l)!.id).toBe('t0,0');
    expect(refreshViews(l, [small, box(0.5, 0.5, 0.2)]).map((v) => v.id)).toEqual(['whole', 't0,0']);
  });
  it('a tile misses only what it holds whole; the whole view misses large tracks and tracks no tile holds (out of the crop)', () => {
    const t00 = l.tiles[0];
    const small = box(0.2, 0.2, 0.05);
    expect(viewScope(t00, l).missable(small)).toBe(true);
    expect(viewScope(l.whole, l).missable(small)).toBe(false);
    expect(viewScope(l.whole, l).matchable(small)).toBe(true);
    expect(viewScope(l.whole, l).missable(box(0.5, 0.5, 0.2))).toBe(true);
    expect(viewScope(l.whole, l).missable(box(0.5, 0.05, 0.05))).toBe(true); // above the crop
    expect(holdsWhole(t00, box(0.6, 0.5, 0.05), l)).toBe(false);
  });
  it('mapLandmarks: view-normalized x, y → stream UV by the rect; z scaled by the rect width over the frame width', () => {
    const lm = { points: new Float32Array(478 * 3) };
    lm.points.set([0.5, 0.5, 0.1], 0);
    const m = mapLandmarks(lm, { x: 360, y: 480, w: 720, h: 720 }, 1080, 1920);
    expect(Array.from(m.points.slice(0, 3))).toEqual([expect.closeTo(720 / 1080, 6), expect.closeTo(840 / 1920, 6), expect.closeTo(0.1 * 720 / 1080, 6)]);
  });
});

describe('ViewSchedule (§6.6)', () => {
  const l = layoutViews(1080, 1920, crop(1080, 1920, 3 / 4), 'environment', 'photo'); // 6 tiles
  const ids = (s: ViewSchedule, refresh: string[], tracked: number, n: number) =>
    Array.from({ length: n }, () => s.next(l, refresh.map((id) => (id === 'whole' ? l.whole : l.tiles.find((t) => t.id === id)!)), tracked).id);
  it('the whole view in every cycle; every 4th call scans the next tile in raster order that is not a refresh view', () => {
    expect(ids(new ViewSchedule(), ['whole'], 2, 8)).toEqual(['whole', 'whole', 'whole', 't0,0', 'whole', 'whole', 'whole', 't1,0']);
    expect(ids(new ViewSchedule(), ['whole', 't0,0'], 3, 8)).toEqual(['whole', 't0,0', 'whole', 't1,0', 't0,0', 'whole', 't0,0', 't0,1']);
  });
  it(`no scans while MAX_LIVE_FACES (${MAX_LIVE_FACES}) faces are tracked: ten far faces over two tiles run a cycle of three views`, () => {
    expect(ids(new ViewSchedule(), ['whole', 't0,0', 't1,1'], MAX_LIVE_FACES, 6)).toEqual(['whole', 't0,0', 't1,1', 'whole', 't0,0', 't1,1']);
  });
  it('a refresh list that changes mid-cycle goes on in raster order, so a tile later in the cycle is not starved', () => {
    const s = new ViewSchedule();
    expect(ids(s, ['whole', 't0,0', 't1,2'], MAX_LIVE_FACES, 2)).toEqual(['whole', 't0,0']);
    // the t0,0 track moved into t1,0: the cycle goes on after t0,0 instead of starting over at the whole view
    expect(ids(s, ['whole', 't1,0', 't1,2'], MAX_LIVE_FACES, 3)).toEqual(['t1,0', 't1,2', 'whole']);
  });
  it('reset starts the cycle and the call count over', () => {
    const s = new ViewSchedule();
    ids(s, ['whole', 't0,0'], 2, 3);
    s.reset();
    expect(ids(s, ['whole', 't0,0'], 2, 4)).toEqual(['whole', 't0,0', 'whole', 't1,0']);
  });
});
