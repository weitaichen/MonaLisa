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
