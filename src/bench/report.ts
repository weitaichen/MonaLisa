// Pure helpers for the bench page: periodic samples, summary and the clipboard report.
import type { BodyDetection, Delegate, Tier } from '../types';

export interface BenchSample {
  /** seconds since the live loop started */
  t: number;
  fps: number;
  detectMs: number;
  renderMs: number;
  tier: Tier;
  face: boolean;
  mode: string;
  delegate: string;
}

export interface BenchSummary {
  n: number;
  fpsAvg: number;
  fpsMin: number;
  detectAvg: number;
  renderAvg: number;
  faceRatio: number;
}

export function summarize(samples: readonly BenchSample[]): BenchSummary {
  const n = samples.length;
  if (!n) return { n, fpsAvg: 0, fpsMin: 0, detectAvg: 0, renderAvg: 0, faceRatio: 0 };
  let fps = 0;
  let fpsMin = Infinity;
  let det = 0;
  let ren = 0;
  let face = 0;
  for (const s of samples) {
    fps += s.fps;
    fpsMin = Math.min(fpsMin, s.fps);
    det += s.detectMs;
    ren += s.renderMs;
    if (s.face) face++;
  }
  return { n, fpsAvg: fps / n, fpsMin, detectAvg: det / n, renderAvg: ren / n, faceRatio: face / n };
}

/** mm:ss (or h:mm:ss past an hour) */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const p2 = (v: number) => String(v).padStart(2, '0');
  return hh ? `${hh}:${p2(mm)}:${p2(ss)}` : `${p2(mm)}:${p2(ss)}`;
}

const COLS = ['t_s', 'fps', 'detect_ms', 'render_ms', 'tier', 'face', 'mode', 'delegate'] as const;

/**
 * Tab-separated report: `# key: value` header lines, a summary line, then one row per sample; the 美體偵測 table
 * follows when body rows were measured.
 */
export function formatReport(
  meta: Readonly<Record<string, string>>,
  samples: readonly BenchSample[],
  body: readonly BodyBenchRow[] = [],
): string {
  const lines = Object.entries(meta).map(([k, v]) => `# ${k}: ${v.replace(/\s+/g, ' ')}`);
  const s = summarize(samples);
  lines.push(
    `# summary: n=${s.n} fps_avg=${s.fpsAvg.toFixed(1)} fps_min=${s.fpsMin.toFixed(1)} ` +
      `detect_avg=${s.detectAvg.toFixed(1)}ms render_avg=${s.renderAvg.toFixed(1)}ms face=${Math.round(s.faceRatio * 100)}%`,
  );
  lines.push(COLS.join('\t'));
  for (const r of samples) {
    lines.push(
      [
        r.t.toFixed(0),
        r.fps.toFixed(1),
        r.detectMs.toFixed(1),
        r.renderMs.toFixed(1),
        r.tier,
        r.face ? '1' : '0',
        r.mode,
        r.delegate,
      ].join('\t'),
    );
  }
  if (body.length) lines.push(formatBodyReport(body));
  return lines.join('\n');
}

// ───────────────────────── 美體偵測 (BR P0) ─────────────────────────

/** One measured PoseLandmarker configuration. */
export interface BodyBenchRow {
  variant: 'full' | 'lite';
  mode: 'IMAGE' | 'VIDEO';
  /** delegate asked for */
  requested: Delegate;
  /** delegate that actually ran (createBodyTracker may differ, see bodyTracker.ts) */
  delegate: Delegate | null;
  /** model download (0 when already memoised) */
  loadMs: number;
  /** createBodyTracker (wasm module + graph) */
  createMs: number;
  /** first detection after creation (includes lazy init) */
  firstMs: number;
  /** median of the following detections */
  detectMs: number;
  n: number;
  people: number;
  /** e.g. 163x256, 'none' (requested but empty / unavailable), 'off' (not requested) */
  mask: string;
  /** fraction of mask texels ≥ 128 */
  maskCoverage: number;
  visibility: VisibilitySanity;
  error: string | null;
  /** performance.memory.usedJSHeapSize after detection, MB (Chromium only; 0 = unavailable) */
  heapMb: number;
}

export interface VisibilitySanity {
  /** visibility values exist and are not all identical (0.10.0 returned none, MPI 4479) */
  present: boolean;
  min: number;
  mean: number;
  /** points with visibility > 0.6 */
  ok: number;
  /** points inside the frame with a 2 % margin */
  inFrame: number;
}

const GATE_VIS = 0.6;
const FRAME_MARGIN = 0.02;

export function visibilitySanity(points: Float32Array): VisibilitySanity {
  const n = Math.floor(points.length / 4);
  if (!n) return { present: false, min: 0, mean: 0, ok: 0, inFrame: 0 };
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let ok = 0;
  let inFrame = 0;
  for (let i = 0; i < n; i++) {
    const x = points[i * 4];
    const y = points[i * 4 + 1];
    const v = points[i * 4 + 3];
    min = Math.min(min, v);
    max = Math.max(max, v);
    sum += v;
    if (v > GATE_VIS) ok++;
    if (x >= FRAME_MARGIN && x <= 1 - FRAME_MARGIN && y >= FRAME_MARGIN && y <= 1 - FRAME_MARGIN) inFrame++;
  }
  return { present: max > 0 && max !== min, min, mean: sum / n, ok, inFrame };
}

export function maskCoverage(det: BodyDetection | null): number {
  const m = det?.mask;
  if (!m || !m.data.length) return 0;
  let on = 0;
  for (const v of m.data) if (v >= 128) on++;
  return on / m.data.length;
}

export function median(xs: readonly number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const BODY_COLS = [
  'variant',
  'mode',
  'req',
  'delegate',
  'load_ms',
  'create_ms',
  'first_ms',
  'detect_ms',
  'n',
  'people',
  'mask',
  'mask_cov',
  'vis',
  'vis_min',
  'vis_ok',
  'in_frame',
  'heap_mb',
  'error',
] as const;

/** `# 美體偵測` section: column header + one TSV row per configuration. */
export function formatBodyReport(rows: readonly BodyBenchRow[]): string {
  const lines = ['# 美體偵測 (PoseLandmarker 0.10.35)', BODY_COLS.join('\t')];
  for (const r of rows) {
    lines.push(
      [
        r.variant,
        r.mode,
        r.requested,
        r.delegate ?? '-',
        r.loadMs.toFixed(0),
        r.createMs.toFixed(0),
        r.firstMs.toFixed(1),
        r.detectMs.toFixed(1),
        String(r.n),
        String(r.people),
        r.mask,
        r.maskCoverage.toFixed(3),
        r.visibility.present ? '1' : '0',
        r.visibility.min.toFixed(2),
        String(r.visibility.ok),
        String(r.visibility.inFrame),
        r.heapMb ? r.heapMb.toFixed(0) : '-',
        (r.error ?? '').replace(/\s+/g, ' '),
      ].join('\t'),
    );
  }
  return lines.join('\n');
}

// ───────────────────────── 多臉 (v0.4 step 1, S §6.2) ─────────────────────────

/** One measured row of the bench 「多臉」 section (S §6.2). */
export interface MultiRow {
  row: string;
  config: string;
  values: Record<string, string | number>;
}

/** One `# 多臉 <row>` block per row id: a header of the value keys, then one tab-separated line per config. */
export function formatMultiRows(rows: readonly MultiRow[]): string {
  const ids = [...new Set(rows.map((r) => r.row))];
  return ids
    .map((id) => {
      const rs = rows.filter((r) => r.row === id);
      const keys = [...new Set(rs.flatMap((r) => Object.keys(r.values)))];
      const line = (r: MultiRow) => [r.config, ...keys.map((k) => String(r.values[k] ?? ''))].join('\t');
      return [`# 多臉 ${id}`, ['config', ...keys].join('\t'), ...rs.map(line)].join('\n');
    })
    .join('\n\n');
}

/** step-1 spec §6.3 camera rows: PL1 (3 faces in view) and PL2 (one face in view, the cost numFaces 3 adds to a selfie) */
export const PL1_MAX_P50_MS = 20;
export const PL1_MIN_FPS = 24;
export const PL2_MAX_DELTA_MS = 5;

/** one L measurement: every detectVideo time (ms) of one delegate at one numFaces */
export interface LiveRun {
  delegate: string;
  numFaces: number;
  times: readonly number[];
  fps: number;
  /** most faces one inference returned */
  faces: number;
  /** the first inference after each switch to this count (setOptions rebuilds the graph), ms */
  switchMs?: readonly number[];
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const p95 = (xs: readonly number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)];

/**
 * L rows (p50 / p95 / fps per delegate and numFaces; switch_ms, the slowest first inference after a switch to that count,
 * when measured), then the §6.3 verdicts. The faces in view are the most any run of that delegate found. One face in
 * view → PL2: p50 at the largest count minus p50 at numFaces 1, pass ≤ 5 ms. Three or more → PL1 per count ≥ 2
 * (numFaces 2 is the fallback's own measurement): pass at p50 ≤ 20 ms and fps ≥ 24.
 */
export function liveRows(runs: readonly LiveRun[]): MultiRow[] {
  const out: MultiRow[] = runs.map((r) => ({
    row: 'L',
    config: `${r.delegate} numFaces ${r.numFaces}`,
    values: {
      ...(r.times.length
        ? { p50_ms: r1(median(r.times)), p95_ms: r1(p95(r.times)), fps: r1(r.fps), faces: r.faces, frames: r.times.length }
        : { p50_ms: 'n/a', p95_ms: 'n/a', fps: r1(r.fps), faces: r.faces, frames: 0 }),
      ...(r.switchMs?.length ? { switch_ms: r1(Math.max(...r.switchMs)) } : {}),
    },
  }));
  const delegates = [...new Set(runs.map((r) => r.delegate))];
  for (const d of delegates) {
    const mine = runs.filter((r) => r.delegate === d && r.times.length > 0);
    const inView = Math.max(0, ...mine.map((r) => r.faces));
    const one = mine.find((r) => r.numFaces === 1);
    const top = mine.reduce<LiveRun | null>((a, r) => (a === null || r.numFaces > a.numFaces ? r : a), null);
    if (inView === 1 && one && top && top !== one) {
      const delta = median(top.times) - median(one.times);
      out.push({
        row: 'PL2',
        config: d,
        values: {
          delta_p50_ms: r1(delta),
          delta_p95_ms: r1(p95(top.times) - p95(one.times)),
          delta_pct: r1((delta / median(one.times)) * 100),
          limit_ms: PL2_MAX_DELTA_MS,
          verdict: delta <= PL2_MAX_DELTA_MS ? 'pass' : 'fail',
        },
      });
    }
    if (inView >= 3) {
      for (const r of mine.filter((x) => x.numFaces >= 2)) {
        const p50 = median(r.times);
        out.push({
          row: 'PL1',
          config: `${d} numFaces ${r.numFaces}`,
          values: {
            p50_ms: r1(p50),
            fps: r1(r.fps),
            limit: `p50 ≤ ${PL1_MAX_P50_MS} ms, fps ≥ ${PL1_MIN_FPS}`,
            verdict: p50 <= PL1_MAX_P50_MS && r.fps >= PL1_MIN_FPS ? 'pass' : 'fail',
          },
        });
      }
    }
  }
  return out;
}

// ───────────────────────── 輸出 (v0.4 step 3, S §6.4) ─────────────────────────

export interface ExportBenchRow {
  name: string;
  /** null: failed, or a manual row */
  ms: number | null;
  detail: string;
}

/** the export rows of 複製結果 (S §6.4) */
export function formatExportRows(rows: readonly ExportBenchRow[]): string {
  return ['輸出\tms\t說明', ...rows.map((r) => `${r.name}\t${r.ms === null ? '—' : r.ms.toFixed(0)}\t${r.detail}`)].join('\n');
}
