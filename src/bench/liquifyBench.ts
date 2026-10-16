// 推臉筆 bench rows (push-brush spec §6.2): ns per texel-stamp for push (straight, no bisection), push into a stretched
// area (bisecting) and restore, at 小／中／大; the replay of S30 and SCAP; the share of bisected work on S30; and the
// RG16F upload of a full field. Pure apart from `uploadMs`, which takes a WebGL2 context. Rules if the iPhone misses a
// budget are in the spec's table (rescale LIQUIFY_WORK_CAP / LIQUIFY_SYNC_WORK, dirty-tile uploads, a smaller ring).
import { BRUSH_PX, GUARD_STEPS } from '../config/limits';
import { LiquifyModel, liquifyGrid, strokeWork } from '../edit/liquify';
import { straightStroke, strokesCap, strokesS30 } from '../edit/strokeFixtures';
import type { BrushSize, LiquifyField, LiquifyFrame, Stroke } from '../types';

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
