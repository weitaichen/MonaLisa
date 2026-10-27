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
  /**
   * 美顏對象 when it was taken (camera per-person spec §12.4, Codex #3): 'every' (every face edited) or 'target' (the
   * target only, as 0.5's bench drew); a switch keeps the samples before it, so each one says which it measured
   */
  faces: string;
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

/** `faces` last, so the columns before it keep their places in older reports */
const COLS = ['t_s', 'fps', 'detect_ms', 'render_ms', 'tier', 'face', 'mode', 'delegate', 'faces'] as const;

function summaryLine(label: string, samples: readonly BenchSample[]): string {
  const s = summarize(samples);
  return (
    `# ${label}: n=${s.n} fps_avg=${s.fpsAvg.toFixed(1)} fps_min=${s.fpsMin.toFixed(1)} ` +
    `detect_avg=${s.detectAvg.toFixed(1)}ms render_avg=${s.renderAvg.toFixed(1)}ms face=${Math.round(s.faceRatio * 100)}%`
  );
}

/**
 * Tab-separated report: `# key: value` header lines, a summary line, then one row per sample; the 美體偵測 table
 * follows when body rows were measured. Samples of more than one 美顏對象 (Codex #3) get a summary line per scope too,
 * after the overall one, since every face edited and the target alone are not the same measurement.
 */
export function formatReport(
  meta: Readonly<Record<string, string>>,
  samples: readonly BenchSample[],
  body: readonly BodyBenchRow[] = [],
): string {
  const lines = Object.entries(meta).map(([k, v]) => `# ${k}: ${v.replace(/\s+/g, ' ')}`);
  lines.push(summaryLine('summary', samples));
  const scopes = [...new Set(samples.map((r) => r.faces))];
  if (scopes.length > 1) for (const f of scopes) lines.push(summaryLine(`summary faces=${f}`, samples.filter((r) => r.faces === f)));
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
        r.faces,
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
  /**
   * the face detector of the VIDEO graph (camera per-person spec §12.4): 'camera' (short-range, the front solo path) or
   * 'photo' (full-range, the back camera's option C); absent = 'camera' (the rows before v0.6, not named in the config)
   */
  detector?: 'camera' | 'photo';
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
 * L rows (p50 / p95 / fps per delegate, detector and numFaces; switch_ms, the slowest first inference after a switch to
 * that configuration, when measured), then the §6.3 verdicts from the camera detector's runs only (the front solo path,
 * camera per-person spec §12.4). The faces in view are the most any such run of that delegate found. One face in
 * view → PL2: p50 at the largest count minus p50 at numFaces 1, pass ≤ 5 ms. Three or more → PL1 per count ≥ 2
 * (numFaces 2 is the fallback's own measurement): pass at p50 ≤ 20 ms and fps ≥ 24.
 */
export function liveRows(runs: readonly LiveRun[]): MultiRow[] {
  const out: MultiRow[] = runs.map((r) => ({
    row: 'L',
    config: `${r.delegate}${r.detector ? ` ${r.detector}` : ''} numFaces ${r.numFaces}`,
    values: {
      ...(r.times.length
        ? { p50_ms: r1(median(r.times)), p95_ms: r1(p95(r.times)), fps: r1(r.fps), faces: r.faces, frames: r.times.length }
        : { p50_ms: 'n/a', p95_ms: 'n/a', fps: r1(r.fps), faces: r.faces, frames: 0 }),
      ...(r.switchMs?.length ? { switch_ms: r1(Math.max(...r.switchMs)) } : {}),
    },
  }));
  const solo = runs.filter((r) => (r.detector ?? 'camera') === 'camera');
  const delegates = [...new Set(solo.map((r) => r.delegate))];
  for (const d of delegates) {
    const mine = solo.filter((r) => r.delegate === d && r.times.length > 0);
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

// ───────────────────────── 相機逐人 (v0.6, camera per-person spec §10, §12.4) ─────────────────────────

/** §10 PGN (desktop gate): row LF on upright_far10, preview fps (average) and every face's refresh rate */
export const PGN_MIN_FPS = 24;
export const PGN_MIN_FACE_HZ = 5;
/** §10 PLB: back camera, one face, group path: the call p50 + the live render, ms */
export const PLB_MAX_MS = 33;
/** §10 PGS: the front camera's move between its paths, the longest frame around the rebuild, ms (reported, no limits line) */
export const PGS_MAX_MS = 250;
/** §10 PWB: the first back-camera frame after a flip, cold, ms after `live` (reported, no limits line) */
export const PWB_MAX_MS = 300;

/** one group-path call measurement of row L (§12.4): detectView on one view's copy of the camera frame */
export interface ViewRun {
  delegate: string;
  detector: 'camera' | 'photo';
  /** 'whole' or the tile's id */
  view: string;
  /** the copy's size, `${w}x${h}` */
  size: string;
  /** each answered call, ms */
  times: readonly number[];
  /** each copy (drawImage of the view's rect), ms */
  copyTimes: readonly number[];
  /** most faces one call returned */
  faces: number;
}

/** row L's group-path calls: the call p50 / p95 per view kind and detector, the copy's p50, faces and the copy size */
export function viewCallRows(runs: readonly ViewRun[]): MultiRow[] {
  return runs.map((r) => ({
    row: 'L',
    config: `${r.delegate} ${r.detector} view ${r.view}`,
    values: {
      ...(r.times.length ? { p50_ms: r1(median(r.times)), p95_ms: r1(p95(r.times)) } : { p50_ms: 'n/a', p95_ms: 'n/a' }),
      copy_ms: r.copyTimes.length ? r1(median(r.copyTimes)) : 'n/a',
      faces: r.faces,
      frames: r.times.length,
      size: r.size,
    },
  }));
}

/** row LF (§12.4): the live loop as the app runs it, measured over 10 s */
export interface LfRun {
  config: string;
  /** preview frames per second (average) */
  fps: number;
  /** the longest interval between two processed frames, ms */
  longestMs: number;
  /** the most camera frames one processed frame stood for (rVFC presentedFrames), as ms */
  maxGapMs: number;
  /** frames per detection (median liveEvery) */
  every: number;
  /** each face's refresh rate, Hz */
  faceHz: readonly number[];
  /** the group path's cycle (liveViews), [] on the solo path or option C */
  views: readonly string[];
  /** p50 of every detection call (the loop's D, §6.4); with one face three calls in four are the whole view (PLB) */
  detectP50: number;
  /** p50 of the live render (engine.render) */
  renderP50: number;
  /** faces shown (median) */
  faces: number;
  /** the render tier at the end (auto may step down) */
  tier?: string;
}

/** §10 PGN: ≥ 24 fps average, every face ≥ 5 Hz (fails with none measured), the longest frame no longer than option C's (when given) */
export function pgnVerdict(r: Pick<LfRun, 'fps' | 'faceHz' | 'longestMs'>, optionCLongestMs: number | null): 'pass' | 'fail' {
  const hz = r.faceHz.length > 0 && Math.min(...r.faceHz) >= PGN_MIN_FACE_HZ;
  const longest = optionCLongestMs === null || r.longestMs <= optionCLongestMs;
  return r.fps >= PGN_MIN_FPS && hz && longest ? 'pass' : 'fail';
}

/**
 * PGN's longest-frame bound per delegate (§10: option C's longest frame at 10 faces on the same machine, row LFC's
 * longest_ms on that delegate). A delegate without one: that condition is not judged.
 */
export type OptionCBounds = Readonly<Partial<Record<Delegate, number>>>;

const MS = /^\d+(?:\.\d+)?$/;
const DELEGATE_MS = /^(GPU|CPU)\s*[=:]\s*(\d+(?:\.\d+)?)$/i;

/**
 * bench-multiface.mjs --option-c and the page's optionC: `GPU=<ms>,CPU=<ms>` (`:` for `=`, any order, case and
 * spaces ignored, either delegate may be left out) or a bare `<ms>` for both. Each ms a positive decimal. null for
 * anything else (empty, an unknown or repeated delegate, a value that is not a positive number), so a mistyped bound
 * is refused rather than read as no bound.
 */
export function parseOptionC(s: string): OptionCBounds | null {
  const t = s.trim();
  if (MS.test(t)) {
    const ms = Number(t);
    return ms > 0 ? { GPU: ms, CPU: ms } : null;
  }
  const out: Partial<Record<Delegate, number>> = {};
  for (const part of t.split(',')) {
    const m = DELEGATE_MS.exec(part.trim());
    if (!m) return null;
    const d = m[1].toUpperCase() as Delegate;
    const ms = Number(m[2]);
    if (!(ms > 0) || out[d] !== undefined) return null;
    out[d] = ms;
  }
  return out;
}

/** §10 PJ1G (S §6.3's PJ1 and PJ2 limits): RMS ≤ max(0.4 px, 1.25 × MediaPipe's numFaces-1 RMS) and lag ≤ 1.25 × its lag */
export function pj1gVerdict(rms: number, rms1: number, lag: number, lag1: number): 'pass' | 'fail' {
  return rms <= Math.max(0.4, 1.25 * rms1) && lag <= 1.25 * lag1 ? 'pass' : 'fail';
}

/**
 * The LF row, then its verdict: PGN with ≥ 2 faces (the longest frame judged against option C's when
 * `optionCLongestMs` is given: the bound of the run's own delegate from bench-multiface.mjs --option-c), PLB with one
 * face (row LF runs the back camera: the detection p50 + the render p50 ≤ 33 ms), none without a face.
 */
export function lfRows(run: LfRun, optionCLongestMs: number | null): MultiRow[] {
  const minHz = run.faceHz.length ? r1(Math.min(...run.faceHz)) : 'n/a';
  const out: MultiRow[] = [
    {
      row: 'LF',
      config: run.config,
      values: {
        fps: r1(run.fps),
        longest_ms: r1(run.longestMs),
        max_gap_ms: r1(run.maxGapMs),
        every: run.every,
        min_face_hz: minHz,
        views: run.views.join(' ') || '—',
        detect_p50_ms: r1(run.detectP50),
        render_p50_ms: r1(run.renderP50),
        faces: run.faces,
        ...(run.tier ? { tier: run.tier } : {}),
      },
    },
  ];
  if (run.faces >= 2) {
    out.push({
      row: 'PGN',
      config: run.config,
      values: {
        fps: r1(run.fps),
        min_face_hz: minHz,
        longest_ms: r1(run.longestMs),
        option_c_longest_ms: optionCLongestMs ?? '—',
        limit: `fps ≥ ${PGN_MIN_FPS}, every face ≥ ${PGN_MIN_FACE_HZ} Hz, ${optionCLongestMs === null ? 'longest frame not judged (no option C bound)' : 'longest frame ≤ option C’s'}`,
        verdict: pgnVerdict(run, optionCLongestMs),
      },
    });
  } else if (run.faces === 1) {
    const ms = run.detectP50 + run.renderP50;
    out.push({ row: 'PLB', config: run.config, values: { ms: r1(ms), limit_ms: PLB_MAX_MS, verdict: ms <= PLB_MAX_MS ? 'pass' : 'fail' } });
  }
  return out;
}

/** one rVFC callback's reading of window.__meiyan while the live loop runs (rows LF, GS) */
export interface LfSample {
  /** the callback's now, ms (performance.now()'s clock, as the loop's track times) */
  t: number;
  /** rVFC metadata.presentedFrames */
  presented: number;
  /** liveEvery */
  every: number;
  /** liveViews */
  views: readonly string[];
  /** livePath */
  path: 'solo' | 'group' | undefined;
  /** faces shown */
  faces: number;
  /** the shown boxes: id and `seen`, the time of the detection that last refreshed it */
  boxes: readonly { id: string; seen: number }[];
}

/** a face's refresh rate needs this long a span shown (a face seen briefly gives no rate) */
const LF_MIN_SPAN_MS = 1000;

const mostCommon = (xs: readonly string[]): string | undefined => {
  const n = new Map<string, number>();
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1);
  let best: string | undefined;
  for (const [x, c] of n) if (best === undefined || c > n.get(best)!) best = x;
  return best;
};

/**
 * Row LF's frame numbers from its samples (the measured window): fps over the span, the longest interval between two
 * samples, the max gap (the most camera frames one sample stood for, by presentedFrames, × the camera's own frame
 * interval: the median interval of samples one frame apart, else 1000 / 30), k (median), the most common cycle, the
 * faces (median) and, for each box shown at least LF_MIN_SPAN_MS, its distinct `seen` values over the span it was shown.
 */
export function summarizeLf(samples: readonly LfSample[]): Omit<LfRun, 'config' | 'detectP50' | 'renderP50' | 'tier'> {
  const n = samples.length;
  if (!n) return { fps: 0, longestMs: 0, maxGapMs: 0, every: 1, faceHz: [], views: [], faces: 0 };
  const span = samples[n - 1].t - samples[0].t;
  const intervals: { ms: number; frames: number }[] = [];
  for (let i = 1; i < n; i++) intervals.push({ ms: samples[i].t - samples[i - 1].t, frames: samples[i].presented - samples[i - 1].presented });
  const one = intervals.filter((x) => x.frames === 1).map((x) => x.ms);
  const T = one.length ? median(one) : 1000 / 30;
  const boxes = new Map<string, { first: number; last: number; seen: Set<number> }>();
  for (const s of samples) {
    for (const b of s.boxes) {
      const e = boxes.get(b.id) ?? { first: s.t, last: s.t, seen: new Set<number>() };
      e.last = s.t;
      e.seen.add(b.seen);
      boxes.set(b.id, e);
    }
  }
  const faceHz = [...boxes.values()].filter((e) => e.last - e.first >= LF_MIN_SPAN_MS).map((e) => e.seen.size / ((e.last - e.first) / 1000));
  const cycle = mostCommon(samples.map((s) => s.views.join(' ')));
  return {
    fps: span > 0 ? (n - 1) / (span / 1000) : 0,
    longestMs: Math.max(0, ...intervals.map((x) => x.ms)),
    maxGapMs: Math.max(0, ...intervals.map((x) => (x.frames > 0 ? x.frames * T : x.ms))),
    every: Math.round(median(samples.map((s) => s.every))),
    faceHz,
    views: cycle ? cycle.split(' ') : [],
    faces: Math.round(median(samples.map((s) => s.faces))),
  };
}

/** row GS: a path change is reported with the longest frame this far before or after it */
const GS_AROUND_MS = 1000;

/**
 * Row GS (§12.4) and its PGS rows (§10): the front camera's samples across its moves between the paths. The GS row: the
 * number of changes, the longest frame of the run and the faces (median); then per change (a sample whose livePath
 * differs from the one before) the longest interval ending within ±1 s of it, judged ≤ PGS_MAX_MS.
 */
export function gsRows(config: string, samples: readonly LfSample[]): MultiRow[] {
  const changes: MultiRow[] = [];
  let longest = 0;
  for (let i = 1; i < samples.length; i++) {
    longest = Math.max(longest, samples[i].t - samples[i - 1].t);
    const from = samples[i - 1].path;
    const to = samples[i].path;
    if (!from || !to || from === to) continue;
    const at = samples[i].t;
    let around = 0;
    for (let j = 1; j < samples.length; j++) {
      if (Math.abs(samples[j].t - at) <= GS_AROUND_MS) around = Math.max(around, samples[j].t - samples[j - 1].t);
    }
    changes.push({
      row: 'PGS',
      config: `${config} ${from}→${to}`,
      values: { at_s: r1((at - samples[0].t) / 1000), longest_ms: r1(around), limit_ms: PGS_MAX_MS, verdict: around <= PGS_MAX_MS ? 'pass' : 'fail' },
    });
  }
  const gs: MultiRow = { row: 'GS', config, values: { changes: changes.length, longest_ms: r1(longest), faces: Math.round(median(samples.map((s) => s.faces))) } };
  return [gs, ...changes];
}

/** one flip to the back camera of row WB */
export interface WbFlip {
  /** cold: the page's (or this delegate's) first full-range graph; warm: a flip after it */
  kind: 'cold' | 'warm';
  /** warm('IMAGE', 'photo') right after the flip (the app's warm-up, §6.3), ms */
  warmMs: number;
  /** from `live` to the end of the first rendered back-camera frame, ms; null: none came */
  firstMs: number | null;
  /** that frame's detection call, ms */
  detectMs: number | null;
  /** no full-range detection ran on this page before (the GPU's one-time compile was still to come) */
  pageCold: boolean;
}

/** Row WB (§12.4): a row per flip; PWB (§10) judges the cold one, ≤ PWB_MAX_MS after `live` */
export function wbRows(config: string, flips: readonly WbFlip[]): MultiRow[] {
  const ms = (v: number | null) => (v === null ? 'n/a' : r1(v));
  const out: MultiRow[] = flips.map((f) => ({
    row: 'WB',
    config: `${config} ${f.kind} flip`,
    values: { warm_ms: r1(f.warmMs), first_ms: ms(f.firstMs), first_detect_ms: ms(f.detectMs), page_cold: String(f.pageCold) },
  }));
  const cold = flips.find((f) => f.kind === 'cold');
  if (cold) {
    out.push({
      row: 'PWB',
      config,
      values: { first_ms: ms(cold.firstMs), limit_ms: PWB_MAX_MS, verdict: cold.firstMs !== null && cold.firstMs <= PWB_MAX_MS ? 'pass' : 'fail' },
    });
  }
  return out;
}

/**
 * Jitter (S row J): the RMS of every pts111 point's deviation from its mean over the frames, px at a 1080-px frame
 * height (x scaled by the frame's aspect, width / height); null without a frame.
 */
export function jitterRms(pts: readonly Float32Array[], aspect: number): number | null {
  const n = pts.length;
  if (!n) return null;
  const h = 1080;
  let s = 0;
  let c = 0;
  for (let i = 0; i < 111; i++) {
    let mx = 0;
    let my = 0;
    for (const p of pts) {
      mx += p[i * 2] / n;
      my += p[i * 2 + 1] / n;
    }
    for (const p of pts) {
      s += ((p[i * 2] - mx) * h * aspect) ** 2 + ((p[i * 2 + 1] - my) * h) ** 2;
      c++;
    }
  }
  return Math.sqrt(s / c);
}

/**
 * Lag (S row J2): the mean over frames of (raw − smoothed) / the raw velocity (over three frames) of the pts111 centroid
 * x, ms; frames without motion (|v| < 1e-5 UV / ms) are skipped. lag null when none moved.
 */
export function lagMs(raw: readonly number[], smooth: readonly number[], t: readonly number[]): { lag: number | null; n: number } {
  let sum = 0;
  let n = 0;
  for (let i = 3; i < raw.length; i++) {
    const v = (raw[i] - raw[i - 3]) / (t[i] - t[i - 3]);
    if (!(Math.abs(v) >= 1e-5)) continue;
    sum += (raw[i] - smooth[i]) / v;
    n++;
  }
  return { lag: n ? sum / n : null, n };
}

/** one refresh kind of row JG: the group path's IMAGE landmarks through the app smoother beside MediaPipe's numFaces-1 VIDEO smoothing */
export interface JgRun {
  /** delegate and refresh kind, e.g. 'GPU whole', 'GPU tile t1,0' */
  config: string;
  /** jitter, px at 1080 (null: no frame) */
  rms: number | null;
  rms1: number | null;
  /** lag, ms (null: nothing moved, a static clip) */
  lag: number | null;
  lag1: number | null;
  frames: number;
  lagSamples: number;
}

/**
 * Row JG (§12.4) and PJ1G (§10) per refresh kind. The jitter is always judged; the lag only where it was measured (a
 * static clip has no motion: 'jitter' alone, a pan clip both); no jitter frame → 'n/a'.
 */
export function jgRows(runs: readonly JgRun[]): MultiRow[] {
  const v = (x: number | null) => (x === null ? 'n/a' : r1(x));
  const out: MultiRow[] = runs.flatMap((r): MultiRow[] => [
    { row: 'JG', config: `${r.config} app`, values: { rms_px1080: v(r.rms), lag_ms: v(r.lag), frames: r.frames, lag_samples: r.lagSamples } },
    { row: 'JG', config: `${r.config} mediapipe`, values: { rms_px1080: v(r.rms1), lag_ms: v(r.lag1), frames: r.frames, lag_samples: r.lagSamples } },
  ]);
  for (const r of runs) {
    const lagged = r.lag !== null && r.lag1 !== null;
    const judged = r.rms === null || r.rms1 === null ? 'none' : lagged ? 'jitter, lag' : 'jitter';
    // without motion the lag condition is not judged: 0 ≤ 1.25 × 0 leaves the jitter condition alone
    const verdict = judged === 'none' ? 'n/a' : pj1gVerdict(r.rms!, r.rms1!, lagged ? r.lag! : 0, lagged ? r.lag1! : 0);
    out.push({
      row: 'PJ1G',
      config: r.config,
      values: {
        rms_px1080: v(r.rms),
        rms1_px1080: v(r.rms1),
        lag_ms: v(r.lag),
        lag1_ms: v(r.lag1),
        limit: 'RMS ≤ max(0.4 px, 1.25 × numFaces 1), lag ≤ 1.25 × numFaces 1',
        judged,
        verdict,
      },
    });
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
