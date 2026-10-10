import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { loadPoseFixture } from '../body/fixtures.node';
import { addEntry, closeHistory, getEntry, updateEntry } from '../store/history';
import { adapt } from '../tracking/adapter111';
import { buildFaceProtect } from '../tracking/faceProtect';
import { applyPreset, setParam } from '../engine/params';
import { SegmenterContextLostError } from '../tracking/segmenter';
import type { BeautyParams, Face, FaceProtect, PersonMask } from '../types';
import {
  CONTOUR_IDS,
  contourActive,
  FaceProtectSource,
  isContourEdit,
  maskCoversFace,
  paramsPatch,
  PROTECT_WAIT_MS,
  type FaceProtectDeps,
} from './faceProtectModel';

const face = (): Face => ({ pts111: new Float32Array(222), ext: new Float32Array(16), oval: new Float32Array(72), yaw: 0 });
const mask = (): PersonMask => ({ width: 1, height: 1, data: new Uint8Array(1) });
const flush = () => new Promise((r) => setTimeout(r, 0));

function harness(
  seg: { segment(): PersonMask | null } | null | 'throw' = { segment: () => mask() },
  savedMask: PersonMask | null = null,
  requested = false,
) {
  let n = 0;
  const built: { face: Face; mask: PersonMask }[] = [];
  const deps = {
    build: vi.fn((f: Face, m: PersonMask): FaceProtect => {
      built.push({ face: f, mask: m });
      return { width: 1, height: 1, data: new Float32Array(1), version: ++n };
    }),
    covers: vi.fn((_f: Face, _m: PersonMask) => true),
    segmenter: vi.fn(() => (seg === 'throw' ? Promise.reject(new Error('boom')) : Promise.resolve(seg))),
    pause: vi.fn(() => Promise.resolve()),
    now: vi.fn(() => 1000),
    cancelled: vi.fn(() => false),
    report: vi.fn(),
  } satisfies FaceProtectDeps;
  const changed = vi.fn();
  return { deps, changed, built, src: new FaceProtectSource(deps, changed, savedMask, requested) };
}

describe('contourActive', () => {
  const original = applyPreset('original', 1);
  it('is true only when a contour warp (瘦臉 / V臉 / 窄臉 / 下巴 / 額頭) is off neutral', () => {
    expect(contourActive(original)).toBe(false);
    expect(contourActive(setParam(original, 'shape.eyeEnlarge', 1))).toBe(false);
    expect(contourActive(setParam(original, 'shape.noseSlim', 1))).toBe(false);
    for (const id of ['shape.faceSlim', 'shape.faceV', 'shape.faceNarrow'] as const) expect(contourActive(setParam(original, id, 0.3))).toBe(true);
    expect(contourActive(setParam(original, 'shape.chin', 0.2))).toBe(true);
    expect(contourActive(setParam(original, 'shape.forehead', 0.8))).toBe(true);
    expect(contourActive(applyPreset('natural', 1))).toBe(true); // 自然 uses light 瘦臉 / V臉
  });
});

/** a face whose oval is the ellipse centred at (cx, cy) with radii rx, ry (UV) */
function ovalFace(cx: number, cy: number, rx: number, ry: number): Face {
  const oval = new Float32Array(72);
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    oval[i * 2] = cx + rx * Math.cos(a);
    oval[i * 2 + 1] = cy + ry * Math.sin(a);
  }
  return { ...face(), oval };
}
/** a 64×64 mask, person (255) inside the axis box [x0, x1) × [y0, y1) (UV) */
function boxMask(x0: number, y0: number, x1: number, y1: number): PersonMask {
  const W = 64;
  const data = new Uint8Array(W * W);
  for (let y = 0; y < W; y++)
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      const v = (y + 0.5) / W;
      if (u >= x0 && u < x1 && v >= y0 && v < y1) data[y * W + x] = 255;
    }
  return { width: W, height: W, data };
}

describe('maskCoversFace', () => {
  const f = ovalFace(0.3, 0.3, 0.08, 0.1);
  it("this face's own person: the mask covers the oval", () => {
    expect(maskCoversFace(f, boxMask(0.15, 0.1, 0.45, 1))).toBe(true);
  });
  it('another person beside it (group photo), or nobody: no', () => {
    expect(maskCoversFace(f, boxMask(0.55, 0.1, 0.9, 1))).toBe(false);
    expect(maskCoversFace(f, boxMask(0, 0, 0, 0))).toBe(false);
  });
  it('the recorded sample_face: its own 美體 mask covers its face; the same mask moved a face width aside does not', () => {
    const lm = JSON.parse(readFileSync(new URL('../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as {
      width: number;
      height: number;
      points: number[];
    };
    const real = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
    const m = loadPoseFixture('sample_face.pose.json')!.mask!;
    expect(maskCoversFace(real, m)).toBe(true);
    // the person shifted right by half the photo: someone else standing beside this face
    const shifted = new Uint8Array(m.data.length);
    const dx = Math.round(m.width / 2);
    for (let y = 0; y < m.height; y++)
      for (let x = dx; x < m.width; x++) shifted[y * m.width + x] = m.data[y * m.width + x - dx];
    expect(maskCoversFace(real, { ...m, data: shifted })).toBe(false);
  });
  it('a mask clipping only an edge of the oval is not enough; over half of it is', () => {
    expect(maskCoversFace(f, boxMask(0.36, 0, 1, 1))).toBe(false); // about the far quarter
    expect(maskCoversFace(f, boxMask(0.29, 0, 1, 1))).toBe(true); // a bit over the far half
  });
});

describe('isContourEdit', () => {
  it('only a contour slider that actually moved', () => {
    expect([...CONTOUR_IDS].sort()).toEqual(['shape.chin', 'shape.faceNarrow', 'shape.faceSlim', 'shape.faceV', 'shape.forehead']);
    for (const id of CONTOUR_IDS) {
      expect(isContourEdit(id, 0.15, 0.3)).toBe(true);
      expect(isContourEdit(id, 0.15, 0.15)).toBe(false); // a tap that did not move it
    }
    expect(isContourEdit('shape.eyeEnlarge', 0, 1)).toBe(false);
    expect(isContourEdit('preset.natural', 1, 0.5)).toBe(false); // 程度 of a preset
    expect(isContourEdit('body.slim', 0, 1)).toBe(false);
  });
});

describe('FaceProtectSource', () => {
  it('the shipped default (自然: 瘦臉 / V臉 on) never starts the segmenter by itself: only a user contour edit does', async () => {
    const h = harness();
    const f = face();
    const natural = applyPreset('natural', 1);
    expect(contourActive(natural)).toBe(true);
    expect(h.src.update(f, contourActive(natural), null, false)).toBeNull(); // photo import, preset, undo, reopen
    await flush();
    expect(h.src.segPhase).toBe('idle');
    expect(h.deps.segmenter).not.toHaveBeenCalled();
    expect(h.changed).not.toHaveBeenCalled(); // nothing re-renders on its own
    expect(h.src.update(f, true, null, true)).toBeNull(); // the user dragged 瘦臉
    expect(h.src.segPhase).toBe('working');
    await flush();
    expect(h.deps.segmenter).toHaveBeenCalledTimes(1);
    expect(h.src.update(f, true, null, true)).not.toBeNull();
  });

  it('an export waits for a segmentation in flight, at most PROTECT_WAIT_MS from its start (K12)', async () => {
    let release!: (s: { segment(): PersonMask | null }) => void;
    const h = harness();
    h.deps.segmenter.mockImplementationOnce(() => new Promise((r) => (release = r)));
    const f = face();
    expect(h.src.outputHoldMs()).toBe(0); // nothing in flight
    h.src.update(f, true, null, false);
    expect(h.src.outputHoldMs()).toBe(0); // the default look alone starts nothing to wait for
    h.src.update(f, true, null, true); // started at now() = 1000
    expect(h.src.outputHoldMs()).toBe(PROTECT_WAIT_MS);
    h.deps.now.mockReturnValue(1000 + PROTECT_WAIT_MS - 300);
    expect(h.src.outputHoldMs()).toBe(300);
    h.deps.now.mockReturnValue(1000 + PROTECT_WAIT_MS + 1); // a hung segmenter never blocks autosave
    expect(h.src.outputHoldMs()).toBe(0);
    h.deps.now.mockReturnValue(1100);
    release({ segment: () => mask() });
    await flush();
    expect(h.src.segPhase).toBe('done');
    expect(h.src.outputHoldMs()).toBe(0); // settled: the export goes ahead with the limit
  });

  it("another person's 美體 mask (group photo) is not used: the segmenter covers this face instead (K11)", async () => {
    const h = harness();
    const f = face();
    const foreign = mask();
    h.deps.covers.mockReturnValue(false);
    expect(h.src.update(f, true, foreign, false)).toBeNull(); // not the bare oval: today's unlimited warp
    expect(h.deps.build).not.toHaveBeenCalled();
    expect(h.deps.segmenter).not.toHaveBeenCalled(); // still only on the user's contour edit
    h.src.update(f, true, foreign, true);
    expect(h.src.segPhase).toBe('working');
    await flush();
    const p = h.src.update(f, true, foreign, true);
    expect(p).not.toBeNull();
    expect(h.built).toHaveLength(1);
    expect(h.built[0].mask).not.toBe(foreign); // the segmenter's
    h.src.update(f, true, foreign, true);
    expect(h.deps.covers).toHaveBeenCalledTimes(1); // the verdict is cached per (face, mask)
  });

  it("another person's 美體 mask with the segmenter unavailable: unlimited, not oval-only", async () => {
    const h = harness(null);
    h.deps.covers.mockReturnValue(false);
    const f = face();
    const foreign = mask();
    h.src.update(f, true, foreign, true);
    await flush();
    expect(h.src.update(f, true, foreign, true)).toBeNull();
    expect(h.deps.build).not.toHaveBeenCalled();
  });

  it('a 美體 mask without the request is not used: the default look stays unlimited (L2)', () => {
    const h = harness();
    expect(h.src.update(face(), true, mask(), false)).toBeNull();
    expect(h.deps.build).not.toHaveBeenCalled();
    expect(h.deps.covers).not.toHaveBeenCalled();
    expect(h.deps.segmenter).not.toHaveBeenCalled();
  });

  it('with the request, a 美體 mask is used as is and no segmenter loads', () => {
    const h = harness();
    expect(h.src.update(face(), true, mask(), true)).not.toBeNull();
    expect(h.deps.segmenter).not.toHaveBeenCalled();
  });

  it('a 美體 detection landing live on the 自然 default (no contour edit) changes nothing shown (L2)', () => {
    const h = harness();
    const f = face();
    const natural = contourActive(applyPreset('natural', 1));
    expect(h.src.update(f, natural, null, false)).toBeNull(); // import: 自然 drawn unlimited
    expect(h.src.update(f, natural, mask(), false)).toBeNull(); // the user opened 美體, the pose model finished
    expect(h.deps.build).not.toHaveBeenCalled();
    expect(h.changed).not.toHaveBeenCalled();
    expect(h.src.outputHoldMs()).toBe(0); // nothing re-arms the export either
  });

  it('no face → no limit and no segmenter', () => {
    const h = harness();
    expect(h.src.update(null, true, mask(), false)).toBeNull();
    expect(h.deps.segmenter).not.toHaveBeenCalled();
  });

  it('a cached 美體 mask is used as is (no segmenter), once a contour warp asks for it; kept afterwards', () => {
    const h = harness();
    const f = face();
    const m = mask();
    expect(h.src.update(f, false, m, true)).toBeNull(); // no contour warp drawn
    expect(h.deps.build).not.toHaveBeenCalled();
    const p = h.src.update(f, true, m, true);
    expect(p).not.toBeNull();
    expect(h.built).toEqual([{ face: f, mask: m }]);
    expect(h.src.update(f, true, m, true)).toBe(p); // unchanged inputs: same object, no rebuild
    expect(h.src.update(f, false, m, true)).toBe(p); // sliders back to neutral (undo / 重置): kept (no effect there)
    expect(h.deps.build).toHaveBeenCalledTimes(1);
    expect(h.deps.segmenter).not.toHaveBeenCalled();
  });

  it('a new face (re-detection) rebuilds from the same mask', () => {
    const h = harness();
    const m = mask();
    const p1 = h.src.update(face(), true, m, true);
    const f2 = face();
    const p2 = h.src.update(f2, false, m, true);
    expect(p2).not.toBe(p1);
    expect(h.built[1].face).toBe(f2);
  });

  it('without a 美體 mask: the segmenter runs once, only when a contour warp is drawn, then the limit is built', async () => {
    const h = harness();
    const f = face();
    expect(h.src.update(f, false, null, true)).toBeNull();
    expect(h.deps.segmenter).not.toHaveBeenCalled();
    expect(h.src.update(f, true, null, true)).toBeNull(); // unlimited until the mask arrives
    expect(h.src.segPhase).toBe('working');
    h.src.update(f, true, null, true);
    await flush();
    expect(h.deps.segmenter).toHaveBeenCalledTimes(1);
    expect(h.deps.pause).toHaveBeenCalledTimes(1);
    expect(h.changed).toHaveBeenCalledTimes(1);
    expect(h.src.segPhase).toBe('done');
    const p = h.src.update(f, true, null, true);
    expect(p).not.toBeNull();
    expect(h.src.update(f, true, null, true)).toBe(p);
    expect(h.deps.segmenter).toHaveBeenCalledTimes(1);
  });

  it('a 美體 mask arriving later replaces the segmenter one', async () => {
    const h = harness();
    const f = face();
    h.src.update(f, true, null, true);
    await flush();
    const p1 = h.src.update(f, true, null, true);
    const body = mask();
    const p2 = h.src.update(f, true, body, true);
    expect(p2).not.toBe(p1);
    expect(h.built[1].mask).toBe(body);
  });

  it("segmenter unavailable, nobody found, or a throw → today's unlimited warp, never retried for this photo", async () => {
    const throwing = {
      segment: (): PersonMask | null => {
        throw new Error('abort');
      },
    };
    const cases: [Parameters<typeof harness>[0], number][] = [
      [null, 0],
      [{ segment: () => null }, 0],
      ['throw', 1],
      [throwing, 1],
    ];
    for (const [seg, reports] of cases) {
      const h = harness(seg);
      const f = face();
      h.src.update(f, true, null, true);
      await flush();
      expect(h.src.update(f, true, null, true)).toBeNull();
      expect(h.deps.build).not.toHaveBeenCalled();
      h.src.update(f, true, null, true);
      await flush();
      expect(h.deps.segmenter).toHaveBeenCalledTimes(1);
      expect(h.deps.report).toHaveBeenCalledTimes(reports);
    }
  });

  // A lost context is retried once for the same photo (services rebuilds a lost instance once per session), so a
  // segmenter that keeps losing it is now asked twice, not once: the per-start retry flag is what stops it there.
  it('a lost WebGL context twice in a row (iOS backgrounding) is warned about, not reported, asked once more, then unlimited', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const segment = vi.fn((): PersonMask | null => {
        throw new SegmenterContextLostError();
      });
      const h = harness({ segment });
      const f = face();
      h.src.update(f, true, null, true);
      await flush();
      await flush();
      expect(h.src.update(f, true, null, true)).toBeNull();
      expect(h.src.segPhase).toBe('failed');
      expect(h.deps.build).not.toHaveBeenCalled();
      expect(h.deps.report).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('WebGL context'), expect.any(SegmenterContextLostError));
      // one retry, never a loop: two asks, two segmentations, and nothing more for this photo
      expect(h.deps.segmenter).toHaveBeenCalledTimes(2);
      expect(segment).toHaveBeenCalledTimes(2);
      h.src.update(f, true, null, true);
      await flush();
      expect(h.deps.segmenter).toHaveBeenCalledTimes(2);
      expect(h.changed).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('a lost WebGL context is retried once for the same photo: the rebuilt segmenter brings the limit', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const m = mask();
      const lostOne = {
        segment: vi.fn((): PersonMask | null => {
          throw new SegmenterContextLostError();
        }),
      };
      const fresh = { segment: vi.fn((): PersonMask | null => m) };
      const h = harness();
      h.deps.segmenter.mockReset();
      h.deps.segmenter.mockResolvedValueOnce(lostOne).mockResolvedValueOnce(fresh);
      const f = face();
      h.src.update(f, true, null, true);
      await flush();
      await flush();
      expect(h.deps.segmenter).toHaveBeenCalledTimes(2);
      // the retry lets a frame paint first, like the first try
      expect(h.deps.pause).toHaveBeenCalledTimes(2);
      expect(fresh.segment).toHaveBeenCalledTimes(1);
      expect(h.src.segPhase).toBe('done');
      expect(h.changed).toHaveBeenCalledTimes(1);
      expect(h.src.update(f, true, null, true)).not.toBeNull();
      expect(h.built).toEqual([{ face: f, mask: m }]);
      expect(h.deps.report).not.toHaveBeenCalled();
      expect(h.src.record(h.src.protect)).toEqual({ faceProtect: true, faceMask: m });
    } finally {
      warn.mockRestore();
    }
  });

  it('a lost context whose retry finds the segmenter unavailable (rebuild budget used up) settles unlimited', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const h = harness();
      h.deps.segmenter.mockReset();
      h.deps.segmenter
        .mockResolvedValueOnce({
          segment: (): PersonMask | null => {
            throw new SegmenterContextLostError();
          },
        })
        .mockResolvedValueOnce(null);
      const f = face();
      h.src.update(f, true, null, true);
      await flush();
      await flush();
      expect(h.deps.segmenter).toHaveBeenCalledTimes(2);
      expect(h.src.segPhase).toBe('failed');
      expect(h.src.update(f, true, null, true)).toBeNull();
      expect(h.deps.report).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('a lost context in an editor closed meanwhile is not retried', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const h = harness({
        segment: (): PersonMask | null => {
          h.deps.cancelled.mockReturnValue(true);
          throw new SegmenterContextLostError();
        },
      });
      h.src.update(face(), true, null, true);
      await flush();
      await flush();
      expect(h.deps.segmenter).toHaveBeenCalledTimes(1);
      expect(h.changed).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('a non-loss throw is never retried (an abort repeats)', async () => {
    const h = harness({
      segment: (): PersonMask | null => {
        throw new Error('abort');
      },
    });
    h.src.update(face(), true, null, true);
    await flush();
    await flush();
    expect(h.deps.segmenter).toHaveBeenCalledTimes(1);
    expect(h.deps.report).toHaveBeenCalledTimes(1);
  });

  it('a build that throws is reported and leaves the warp unlimited', () => {
    const h = harness();
    h.deps.build.mockImplementationOnce(() => {
      throw new Error('bad mask');
    });
    expect(h.src.update(face(), true, mask(), true)).toBeNull();
    expect(h.deps.report).toHaveBeenCalledWith(expect.any(Error), 'buildFaceProtect');
  });

  it('a closed editor drops a late segmentation without notifying', async () => {
    const h = harness();
    h.deps.cancelled.mockReturnValue(true);
    h.src.update(face(), true, null, true);
    await flush();
    expect(h.changed).not.toHaveBeenCalled();
  });
});

describe('FaceProtectSource.record → reopen (L1: a reopened entry draws what was saved)', () => {
  it('records the request, and the segmenter mask the limit was built from', async () => {
    const h = harness();
    const f = face();
    expect(h.src.record(null)).toEqual({ faceProtect: false }); // the unlimited default: never requested
    h.src.update(f, true, null, false);
    expect(h.src.record(null)).toEqual({ faceProtect: false });
    h.src.update(f, true, null, true);
    // a segmentation still in flight: drawn unlimited for now, but requested (a reopen segments again)
    expect(h.src.record(null)).toEqual({ faceProtect: true });
    await flush();
    const p = h.src.update(f, true, null, true)!;
    const segMask = h.built[0].mask;
    expect(h.src.record(p)).toEqual({ faceProtect: true, faceMask: segMask });
    // a 美體 mask took over: limited, but its mask is cached with the detection, not here
    const body = mask();
    const p2 = h.src.update(f, true, body, true)!;
    expect(h.src.record(p2)).toEqual({ faceProtect: true });
  });

  it('a failed segmentation records "unlimited" (what that output was): the reopen stays unlimited', async () => {
    const h = harness(null);
    const f = face();
    h.src.update(f, true, null, true);
    await flush();
    const drawn = h.src.update(f, true, null, true);
    expect(drawn).toBeNull();
    expect(h.src.record(drawn)).toEqual({ faceProtect: false });
    // nobody found: the same
    const n = harness({ segment: () => null });
    n.src.update(f, true, null, true);
    await flush();
    expect(n.src.update(f, true, null, true)).toBeNull();
    expect(n.src.record(null)).toEqual({ faceProtect: false });
  });

  it('the request is recorded while the limit cannot act yet (M1 / M3): neutral contour, no face, 基本模式', () => {
    // a reopened entry saved with the request and its mask, every contour slider neutral: nothing to limit yet
    const h = harness(undefined, mask(), true);
    expect(h.src.update(face(), false, null, false)).toBeNull();
    expect(h.src.record(null)).toEqual({ faceProtect: true });
    // no face found on the reopen (or 基本模式: no tracker): the same
    const g = harness(undefined, mask(), true);
    expect(g.src.update(null, true, null, false)).toBeNull();
    expect(g.src.record(null)).toEqual({ faceProtect: true });
    // flagged without a saved mask (the 美體 one built it), before the 美體 cache has been read
    const b = harness(undefined, null, true);
    expect(b.src.update(null, true, null, false)).toBeNull();
    expect(b.src.record(null)).toEqual({ faceProtect: true });
  });

  it('a user contour edit requests it for good: undo / 重置 to neutral keep the request (sticky)', async () => {
    const h = harness();
    const f = face();
    h.src.request(); // the drag, before its effect ran
    expect(h.src.requested).toBe(true);
    expect(h.src.record(null)).toEqual({ faceProtect: true });
    h.src.update(f, false, null, false); // undo back to neutral: the caller's flag is not consulted any more
    expect(h.src.record(null)).toEqual({ faceProtect: true });
    expect(h.src.update(f, true, null, false)).toBeNull(); // still requested: segments
    expect(h.src.segPhase).toBe('working');
    await flush();
    expect(h.src.update(f, true, null, false)).not.toBeNull();
  });

  it('a reopened entry saved with the segmenter mask: the limit at once (before the first frame), no model, no hold', () => {
    const saved = mask();
    const h = harness(undefined, saved);
    const f = face();
    const p = h.src.update(f, true, null, true); // requested by the entry's faceProtect flag, no edit
    expect(p).not.toBeNull();
    expect(h.built).toEqual([{ face: f, mask: saved }]);
    expect(h.deps.segmenter).not.toHaveBeenCalled();
    expect(h.src.outputHoldMs()).toBe(0);
    expect(h.src.record(p)).toEqual({ faceProtect: true, faceMask: saved });
  });

  it('a reopened entry with the flag and a covering 美體 cache builds at once from it', () => {
    const h = harness();
    const body = mask();
    const p = h.src.update(face(), true, body, true);
    expect(p).not.toBeNull();
    expect(h.built[0].mask).toBe(body);
    expect(h.deps.segmenter).not.toHaveBeenCalled();
  });

  it('a reopened entry with the flag but no saved mask and no 美體: segments without any edit, the encode holds meanwhile', async () => {
    const h = harness();
    const f = face();
    expect(h.src.update(f, true, null, true)).toBeNull();
    expect(h.src.segPhase).toBe('working');
    expect(h.src.outputHoldMs()).toBeGreaterThan(0); // the share-cache encode waits for the limit (K12)
    await flush();
    expect(h.src.update(f, true, null, true)).not.toBeNull();
  });

  it('an entry saved unlimited (no flag): a saved mask alone applies nothing until a contour edit', () => {
    const h = harness(undefined, mask());
    const f = face();
    expect(h.src.update(f, true, null, false)).toBeNull();
    expect(h.deps.build).not.toHaveBeenCalled();
    expect(h.src.update(f, true, null, true)).not.toBeNull(); // the edit: no model needed
    expect(h.deps.segmenter).not.toHaveBeenCalled();
  });

  it('round trip through history with the real limit: the reopened limit equals the saved one, byte for byte', async () => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    closeHistory();
    try {
      const lm = JSON.parse(readFileSync(new URL('../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as {
        width: number;
        height: number;
        points: number[];
      };
      const W = lm.width;
      const H = lm.height;
      const realFace = () => adapt({ points: new Float32Array(lm.points) }, W, H);
      const personMask = loadPoseFixture('sample_face.pose.json')!.mask!; // stands in for the segmenter's output
      const realDeps = (h: ReturnType<typeof harness>) => {
        h.deps.build.mockImplementation((f: Face, m: PersonMask) => buildFaceProtect(f, m, W, H));
        h.deps.covers.mockImplementation((f: Face, m: PersonMask) => maskCoversFace(f, m));
      };
      // session 1: a new photo, the user drags 瘦臉 (no 美體 run), the segmenter lands, autosave writes the entry
      const s1 = harness({ segment: () => personMask });
      realDeps(s1);
      const f1 = realFace();
      s1.src.update(f1, true, null, true);
      await flush();
      const p1 = s1.src.update(f1, true, null, true)!;
      expect(p1).not.toBeNull();
      const rec = s1.src.record(p1);
      const blob = new Blob(['x'], { type: 'image/jpeg' });
      const id = await addEntry({
        original: blob,
        thumb: blob,
        params: applyPreset('natural', 1),
        width: W,
        height: H,
        faceProtect: rec.faceProtect,
        ...(rec.faceMask ? { faceMask: rec.faceMask } : {}),
      });
      // a later edit's write (mask already stored) keeps both
      await updateEntry(id, { params: applyPreset('natural', 0.8), thumb: blob, faceProtect: true });
      const entry = (await getEntry(id))!;
      expect(entry.faceProtect).toBe(true);
      expect(entry.faceMask).toBeTruthy();
      // session 2: reopened from 最近編輯, no contour edit; the face is detected again (a new object)
      const s2 = harness({ segment: () => personMask }, entry.faceMask ?? null);
      realDeps(s2);
      const p2 = s2.src.update(realFace(), true, null, entry.faceProtect === true)!;
      expect(p2).not.toBeNull();
      expect(s2.deps.segmenter).not.toHaveBeenCalled();
      expect(p2.width).toBe(p1.width);
      expect(p2.height).toBe(p1.height);
      expect(Array.from(p2.data)).toEqual(Array.from(p1.data));
    } finally {
      closeHistory();
      vi.unstubAllGlobals();
    }
  });
});

describe('the request survives edits made while the limit cannot act (M1 / M3: L1 must not come back)', () => {
  const lm = JSON.parse(readFileSync(new URL('../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as {
    width: number;
    height: number;
    points: number[];
  };
  const W = lm.width;
  const H = lm.height;
  /** the face as the tracker finds it on each open (a new object every time) */
  const realFace = () => adapt({ points: new Float32Array(lm.points) }, W, H);
  const personMask = () => loadPoseFixture('sample_face.pose.json')!.mask!; // stands in for the segmenter's output
  const blob = new Blob(['x'], { type: 'image/jpeg' });
  const neutral = (p: BeautyParams) =>
    CONTOUR_IDS.reduce((q, k) => setParam(q, k, k === 'shape.chin' || k === 'shape.forehead' ? 0.5 : 0), p);

  /** an editor on the photo: its FaceProtectSource (as Editor builds it) and its autosave (as Editor writes it) */
  async function open(id: string | null, segment = () => personMask()) {
    const entry = id ? await getEntry(id) : undefined;
    const h = harness({ segment }, entry?.faceMask ?? null, entry?.faceProtect === true);
    h.deps.build.mockImplementation((f: Face, m: PersonMask) => buildFaceProtect(f, m, W, H));
    h.deps.covers.mockImplementation((f: Face, m: PersonMask) => maskCoversFace(f, m));
    let maskStored = !!entry?.faceMask;
    /** Editor's limitRequested: a contour edit in this editor, or the reopened entry's flag */
    let edited = false;
    const requested = () => edited || entry?.faceProtect === true;
    return {
      h,
      entry,
      /** the protect effect: what the session draws for `p` with `face` */
      draw: (face: Face | null, p: BeautyParams) => h.src.update(face, contourActive(p), null, requested()),
      contourEdit: () => {
        edited = true;
      },
      /** the autosave of an output drawn with `drawn` (writeHistory / the lost-engine flush) */
      save: async (p: BeautyParams, drawn: FaceProtect | null): Promise<string> => {
        const rec = h.src.record(drawn);
        const patch = paramsPatch(p, rec, maskStored, blob);
        if (rec.faceMask) maskStored = true;
        if (id) {
          await updateEntry(id, patch);
          return id;
        }
        return addEntry({ original: blob, width: W, height: H, ...patch, thumb: blob });
      },
    };
  }

  /** session 1: a new photo, the user drags 瘦臉 to `slim`, the segmenter lands, the limited result is autosaved */
  async function limitedEntry(slim: number) {
    const s1 = await open(null);
    const f1 = realFace();
    const p = setParam(applyPreset('natural', 1), 'shape.faceSlim', slim);
    s1.contourEdit();
    s1.draw(f1, p);
    await flush();
    const drawn = s1.draw(f1, p)!;
    expect(drawn).not.toBeNull();
    const id = await s1.save(p, drawn);
    expect((await getEntry(id))!.faceProtect).toBe(true);
    return { s1, f1, p, id, limit: drawn };
  }

  const inDb = async (body: () => Promise<void>) => {
    vi.stubGlobal('indexedDB', new IDBFactory());
    closeHistory();
    try {
      await body();
    } finally {
      closeHistory();
      vi.unstubAllGlobals();
    }
  };

  it('saved at neutral contour → reopen → 美白 only → reopen → 重置: 自然 is drawn limited, as in sessions 1 and 2', () =>
    inDb(async () => {
      const { s1, f1, p, id, limit } = await limitedEntry(0.6);
      // every contour slider back to neutral (still session 1): the in-session limit is kept and autosaved
      const n = neutral(p);
      await s1.save(n, s1.draw(f1, n));
      // session 2: reopened at neutral contour: nothing to limit, so nothing is drawn with it
      const s2 = await open(id);
      expect(s2.draw(realFace(), n)).toBeNull();
      // 重置 here would draw 自然 limited (the flag requests it) ...
      const s2b = await open(id);
      expect(s2b.draw(realFace(), applyPreset('natural', 1))).not.toBeNull();
      // ... but the user only moves 美白: its autosave must keep the request
      await s2.save(setParam(n, 'skin.whiten', 0.5), s2.draw(realFace(), setParam(n, 'skin.whiten', 0.5)));
      const e = (await getEntry(id))!;
      expect(e.faceProtect).toBe(true);
      expect(e.faceMask).toBeTruthy();
      // session 3: 重置 → 自然, drawn with the same limit (from the saved mask, no model)
      const s3 = await open(id);
      const p3 = s3.draw(realFace(), applyPreset('natural', 1));
      expect(p3).not.toBeNull();
      expect(s3.h.deps.segmenter).not.toHaveBeenCalled();
      expect(Array.from(p3!.data)).toEqual(Array.from(limit.data));
    }));

  it('reopened with no face found (or 基本模式) → any edit → reopen with the face: the same limit, the mask kept', () =>
    inDb(async () => {
      const { p, id, limit } = await limitedEntry(1);
      // session 2: the face is not found on the reopened JPEG (or there is no tracker): nothing is drawn with the limit
      const s2 = await open(id);
      expect(s2.draw(null, p)).toBeNull();
      const edit = setParam(p, 'skin.whiten', 0.5);
      await s2.save(edit, s2.draw(null, edit));
      const e = (await getEntry(id))!;
      expect(e.faceProtect).toBe(true);
      expect(e.faceMask).toBeTruthy();
      // session 3: the face is found again: 瘦臉 100 is drawn with the limit session 1 drew, no model
      const s3 = await open(id);
      const p3 = s3.draw(realFace(), edit);
      expect(p3).not.toBeNull();
      expect(s3.h.deps.segmenter).not.toHaveBeenCalled();
      expect(Array.from(p3!.data)).toEqual(Array.from(limit.data));
    }));

  it('reopened while the request cannot be served yet (segmentation in flight): an edit keeps it, the next reopen segments', () =>
    inDb(async () => {
      // session 1 requested the limit, but the app went away before the segmenter answered (no mask saved)
      const s1 = await open(null, () => {
        throw new Error('never reached');
      });
      const f1 = realFace();
      const p = setParam(applyPreset('natural', 1), 'shape.faceSlim', 0.6);
      s1.contourEdit();
      s1.h.deps.segmenter.mockImplementation(() => new Promise(() => undefined)); // in flight for good
      const id = await s1.save(p, s1.draw(f1, p));
      expect((await getEntry(id))!.faceProtect).toBe(true);
      // session 2: requested by the flag, segments on its own, the limit lands
      const s2 = await open(id);
      const f2 = realFace();
      expect(s2.draw(f2, p)).toBeNull();
      await flush();
      expect(s2.draw(f2, p)).not.toBeNull();
    }));

  it('never requested (the 自然 default, presets, 美體 only): every write records "unlimited"', () =>
    inDb(async () => {
      const s1 = await open(null);
      const f1 = realFace();
      const p = applyPreset('natural', 1);
      const id = await s1.save(p, s1.draw(f1, p));
      await s1.save(neutral(p), s1.draw(f1, neutral(p)));
      expect((await getEntry(id))!.faceProtect).toBeUndefined();
      expect(s1.h.deps.segmenter).not.toHaveBeenCalled();
    }));
});

describe('paramsPatch (M2: every params write carries the limit record)', () => {
  const p = applyPreset('natural', 1);
  it('the request rides along with the params, also without a thumbnail (the lost-engine flush)', () => {
    expect(paramsPatch(p, { faceProtect: true }, true)).toEqual({ params: p, faceProtect: true });
    expect(paramsPatch(p, { faceProtect: false }, true)).toEqual({ params: p, faceProtect: false });
  });
  it('the segmenter mask only while none is stored; a thumbnail when given', () => {
    const m = mask();
    const t = new Blob(['t']);
    expect(paramsPatch(p, { faceProtect: true, faceMask: m }, false, t)).toEqual({ params: p, thumb: t, faceProtect: true, faceMask: m });
    expect(paramsPatch(p, { faceProtect: true, faceMask: m }, true, t)).toEqual({ params: p, thumb: t, faceProtect: true });
  });
});
