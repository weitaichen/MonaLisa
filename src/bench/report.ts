// Pure helpers for the bench page: periodic samples, summary and the clipboard report.
import type { Tier } from '../types';

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

/** Tab-separated report: `# key: value` header lines, a summary line, then one row per sample. */
export function formatReport(meta: Readonly<Record<string, string>>, samples: readonly BenchSample[]): string {
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
  return lines.join('\n');
}
