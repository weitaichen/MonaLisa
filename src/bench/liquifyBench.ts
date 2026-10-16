// 推臉筆 bench rows (push-brush spec §6.2): ns per texel-stamp for push (straight, no bisection), push into a stretched
// area (bisecting) and restore, at 小／中／大; the replay of S30 and SCAP; the share of bisected work on S30; the
// RG16F upload of a full field; and the editor frame at 2048 with the strokes and every effect on (liquifyFrameRows).
// Pure apart from `uploadMs` and `frameTimeMs`, which take a WebGL2 context or an engine. Rules if the iPhone misses a
// budget are in the spec's table (rescale LIQUIFY_WORK_CAP / LIQUIFY_SYNC_WORK, dirty-tile uploads, a smaller ring).
import { BRUSH_PX, GUARD_STEPS } from '../config/limits';
import { LiquifyModel, liquifyGrid, strokeWork } from '../edit/liquify';
import { defaultPhoto } from '../edit/state';
import { straightStroke, strokesCap, strokesS30 } from '../edit/strokeFixtures';
import { ADJUST_IDS, ADJUST_ONE_WAY } from '../engine/adjustMath';
import { neutralValue, paramDef } from '../engine/params';
import type { BodyField, BrushSize, Engine, Face, LiquifyField, LiquifyFrame, LookId, PersonParamId, PersonParams, PhotoParamId, RenderInput, Spot, Stroke } from '../types';
import { makeupBenchPerson, warpBenchPerson } from './faceDetailBench';
import { spotGrid } from './toneBench';

export interface LiquifyBenchRow {
  /** e.g. liquify.stamp push 中 */
  name: string;
  value: number;
  unit: 'ns/texel-stamp' | 'ms' | '%';
  /** the PB §6.1 budget for the row, in the row's unit (null = informational) */
  budget: number | null;
}

const SIZE_LABEL: Record<BrushSize, string> = { s: '小', m: '中', l: '大' };

/** the radius of a size at zoom 1 on this frame: 中 = 28.7 texels on the 3:4 measuring frame (PB §0) */
function radiusOf(frame: LiquifyFrame, size: BrushSize): number {
  return (BRUSH_PX[size] / BRUSH_PX.m) * (28.7 / liquifyGrid(frame).F);
}

function timeSync(frame: LiquifyFrame, recs: Stroke[], now: () => number): { ms: number; work: number } {
  const m = new LiquifyModel(frame, { now, syncWork: Infinity });
  const t0 = now();
  m.sync(recs);
  const ms = now() - t0;
  const work = m.work;
  m.dispose();
  return { ms, work };
}

/** ns per texel-stamp of the three operators at each size */
export function benchStamps(frame: LiquifyFrame, now: () => number = () => performance.now()): LiquifyBenchRow[] {
  const g = liquifyGrid(frame);
  const rows: LiquifyBenchRow[] = [];
  const acrossAt = (R: number, k: number, kind: Stroke['kind'], y: number, tag: string) =>
    straightStroke(frame, kind, R, { x: 0.15, y }, { x: 0.15 + (4 * R) / g.ax, y }, `${kind}-${tag}-${k}`);
  // one untimed push-and-restore run first: the JIT's cold first pass through the stamp code would otherwise land on
  // the 小 push row (about 3× its warm value on desktop Chromium and Node)
  const warmR = radiusOf(frame, 'm');
  timeSync(frame, [0.2, 0.4, 0.6, 0.8].flatMap((y, k) => [...acrossAt(warmR, k, 'push', y, 'warm'), ...acrossAt(warmR, k, 'restore', y, 'warm')]), () => 0);
  for (const size of ['s', 'm', 'l'] as const) {
    const R = radiusOf(frame, size);
    const across = (k: number, kind: Stroke['kind'], y: number) => acrossAt(R, k, kind, y, size);
    // straight pushes on fresh ground: the guard check runs, no bisection
    const push = [0.2, 0.4, 0.6, 0.8].flatMap((y, k) => across(k, 'push', y));
    const p = timeSync(frame, push, now);
    rows.push({ name: `liquify.stamp push ${SIZE_LABEL[size]}`, value: (p.ms * 1e6) / p.work, unit: 'ns/texel-stamp', budget: 80 });
    // the same push five times from one start: the later stamps bisect (GUARD_STEPS each)
    const again = [0, 1, 2, 3, 4].flatMap((k) =>
      straightStroke(frame, 'push', R, { x: 0.3, y: 0.5 }, { x: 0.3 + R / g.ax, y: 0.5 }, `again-${size}-${k}`),
    );
    const b = timeSync(frame, again, now);
    rows.push({ name: `liquify.stamp push bisecting ${SIZE_LABEL[size]}`, value: (b.ms * 1e6) / b.work, unit: 'ns/texel-stamp', budget: 80 });
    // a restore pass over each push
    const restore = [...push, ...[0.2, 0.4, 0.6, 0.8].flatMap((y, k) => across(k, 'restore', y))];
    const r = timeSync(frame, restore, now);
    // the restore passes alone: the run with them minus the pushes' own run
    const restoreMs = Math.max(0, r.ms - p.ms);
    const restoreWork = Math.max(1, r.work - p.work);
    rows.push({ name: `liquify.stamp restore ${SIZE_LABEL[size]}`, value: (restoreMs * 1e6) / restoreWork, unit: 'ns/texel-stamp', budget: 80 });
  }
  return rows;
}

/** replay of S30 (budget 100 ms, synchronous) and SCAP (≈ 1 s of work), and S30's share of bisected work */
export function benchReplay(frame: LiquifyFrame, now: () => number = () => performance.now(), withCap = true): LiquifyBenchRow[] {
  const s30 = strokesS30(frame);
  const r = timeSync(frame, s30, now);
  const base = s30.reduce((s, x) => s + strokeWork(x, frame), 0);
  const rows: LiquifyBenchRow[] = [
    { name: 'liquify.replay S30', value: r.ms, unit: 'ms', budget: 100 },
    { name: 'liquify.bisected S30', value: (100 * (r.work - base)) / (GUARD_STEPS * Math.max(1, base)), unit: '%', budget: null },
  ];
  if (withCap) {
    const c = timeSync(frame, strokesCap(frame), now);
    rows.push({ name: 'liquify.replay SCAP', value: c.ms, unit: 'ms', budget: 1000 });
  }
  return rows;
}

/** ms for a full RG16F upload of `field` (median of 5, gl.finish included) */
export function uploadMs(gl: WebGL2RenderingContext, field: LiquifyField, now: () => number = () => performance.now()): number {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, field.width, field.height, 0, gl.RG, gl.FLOAT, field.data);
  gl.finish();
  const times: number[] = [];
  for (let i = 0; i < 5; i++) {
    const t0 = now();
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, field.width, field.height, gl.RG, gl.FLOAT, field.data);
    gl.finish();
    times.push(now() - t0);
  }
  gl.deleteTexture(tex);
  times.sort((a, b) => a - b);
  return times[2];
}

/** tab-separated rows for 複製結果 */
export function formatLiquifyReport(rows: readonly LiquifyBenchRow[]): string {
  if (!rows.length) return '';
  const lines = rows.map((r) =>
    [
      r.name,
      r.value.toFixed(r.unit === 'ms' ? 1 : 2),
      r.unit,
      r.budget === null ? '–' : String(r.budget),
      r.budget === null || r.value <= r.budget ? 'ok' : 'OVER',
    ].join('\t'),
  );
  return ['', '推臉筆', ['row', 'value', 'unit', 'budget', ''].join('\t'), ...lines].join('\n');
}

/** the photo the frame row draws: a 2048-long-edge image with its face (the bench's still photo, or sample_face.png) */
export interface LiquifyFrameScene {
  source: TexImageSource;
  width: number;
  height: number;
  /** null: no face found, so only the photo-level effects and the strokes draw */
  face: Face | null;
}

/** 美型 at max (both sides), every 美妝 part with a shade, 美膚 and every 膚質 tool on (PB §6.2 "every effect on") */
export function everyEffectPerson(): PersonParams {
  const warp = warpBenchPerson(1);
  const makeup = makeupBenchPerson();
  const values = { ...warp.values };
  for (const [id, v] of Object.entries(makeup.values)) if (id.startsWith('makeup.')) values[id as PersonParamId] = v;
  Object.assign(values, {
    'skin.smooth': 0.8,
    'skin.rosy': 0.5,
    'tone.even': 0.5,
    'tone.warmth': 0.65,
    'tone.darkCircle': 0.5,
    'tone.nasolabial': 0.5,
    'tone.teeth': 0.5,
    'tone.eyeBright': 0.5,
  });
  return { ...warp, values, shades: makeup.shades };
}

/** a smooth 美體 field (24 × 18 texels, ≤ 1 % of the frame) */
export function benchBodyField(): BodyField {
  const bw = 24;
  const bh = 18;
  const data = new Float32Array(bw * bh * 2);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      data[(y * bw + x) * 2] = 0.01 * Math.sin((x / bw) * 6) * Math.cos((y / bh) * 4);
      data[(y * bw + x) * 2 + 1] = 0.008 * Math.cos((x / bw) * 5);
    }
  return { width: bw, height: bh, data, version: 1 };
}

/**
 * PB §6.2's liquify.frame: the editor frame at 2048 with the strokes and every effect on — the face's 美型, 美膚, 美妝
 * and 膚質 (everyEffectPerson), 20 祛痘 spots on it, a 美體 field, 美白 and 銳化, the 自然 filter, all 12 調節 items at
 * ±40 and the look `lookId` at 0.8 (its LUT must be resident to draw). `everything` false: the strokes alone, with every
 * other effect neutral, so the difference is what the rest costs.
 */
export function liquifyFrameInput(scene: LiquifyFrameScene, field: LiquifyField | null, strokes: readonly Stroke[], lookId: LookId | null, everything = true): RenderInput {
  const base = defaultPhoto();
  if (!everything) {
    const values = { ...base.values };
    for (const id of Object.keys(values) as PhotoParamId[]) values[id] = neutralValue(paramDef(id));
    return {
      source: scene.source,
      width: scene.width,
      height: scene.height,
      faces: [],
      obstacles: [],
      globalSkin: null,
      photo: { ...base, values, filterId: 'none', look: null, strokes: [...strokes] },
      liquify: field,
    };
  }
  const values = { ...base.values, 'skin.whiten': 0.4, 'skin.sharpen': 0.3 };
  ADJUST_IDS.forEach((id, i) => {
    values[id] = ADJUST_ONE_WAY.has(id) ? 0.4 : i % 2 === 0 ? 0.9 : 0.1;
  });
  const face = scene.face;
  let spots: Spot[] = [];
  if (face) {
    const xs = Array.from(face.oval).filter((_, i) => i % 2 === 0);
    const ys = Array.from(face.oval).filter((_, i) => i % 2 === 1);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    spots = spotGrid(20, { x: x0 + 0.25 * (x1 - x0), y: y0 + 0.45 * (y1 - y0), w: 0.5 * (x1 - x0), h: 0.25 * (y1 - y0) });
  }
  return {
    source: scene.source,
    width: scene.width,
    height: scene.height,
    faces: face ? [{ face, weight: 1, person: everyEffectPerson(), protect: null }] : [],
    obstacles: [],
    globalSkin: face ? null : { smooth: 0.8, rosy: 0.5, weight: 1 },
    photo: { ...base, values, look: lookId ? { id: lookId, amount: 0.8 } : null, strokes: [...strokes], spots },
    body: benchBodyField(),
    liquify: field,
  };
}

/**
 * The median of `runs` editor frames (engine.render with `still`, to the engine's canvas), each waited on with a 1 × 1
 * readPixels so the GPU work is complete; no frame readback (PB §6.2). The first `warmup` frames compile, upload and
 * build the tone field; they are not counted.
 */
export function frameTimeMs(engine: Engine, input: RenderInput, runs = 9, warmup = 2, now: () => number = () => performance.now()): { ms: number; passes: string[]; width: number; height: number } {
  const gl = engine.canvas.getContext('webgl2');
  if (!gl) throw new Error('frameTimeMs: no WebGL2 context');
  const px = new Uint8Array(4);
  const times: number[] = [];
  let last = engine.render(input, { still: true });
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  for (let i = 1; i < warmup + runs; i++) {
    const t0 = now();
    last = engine.render(input, { still: true });
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    if (i >= warmup) times.push(now() - t0);
  }
  times.sort((a, b) => a - b);
  return { ms: times[times.length >> 1], passes: last.passes, width: last.width, height: last.height };
}

/** the two liquify.frame rows: every effect on (the PB §6.2 row, budget 33 ms) and the strokes alone (for the split) */
export function liquifyFrameRows(engine: Engine, scene: LiquifyFrameScene, model: LiquifyModel, lookId: LookId | null): { rows: LiquifyBenchRow[]; passes: string[] } {
  const all = frameTimeMs(engine, liquifyFrameInput(scene, model.field, model.records, lookId));
  const strokes = frameTimeMs(engine, liquifyFrameInput(scene, model.field, model.records, null, false));
  const size = `${all.width}×${all.height}`;
  return {
    rows: [
      { name: `liquify.frame ${size} every effect${scene.face ? '' : ' (no face)'}`, value: all.ms, unit: 'ms', budget: 33 },
      { name: `liquify.frame ${size} strokes only`, value: strokes.ms, unit: 'ms', budget: null },
    ],
    passes: all.passes,
  };
}
