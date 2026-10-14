// 膚質 bench rows (skin-cleanup spec §6): whole-frame render + readback times (renderToImageData) with and without each
// step-4 pass, so the difference to the base row is the pass cost; one readback per frame keeps the GPU from queueing.
import type { Engine, RenderInput, Spot } from '../types';

export interface ToneBenchRow {
  row: string;
  ms: number;
  delta: number | null;
}
export interface ToneBenchCase {
  row: string;
  /** the input of run i (the rebuild row alternates a value per run) */
  input(i: number): RenderInput;
}

export const TONE_BENCH_WARMUP = 3;
export const TONE_BENCH_RUNS = 10;

export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** n spots on a grid inside `box` (normalized O), r = 0.012, each with a donor 3 r to its right */
export function spotGrid(n: number, box: { x: number; y: number; w: number; h: number }): Spot[] {
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const r = 0.012;
  const out: Spot[] = [];
  for (let i = 0; i < n; i++) {
    const cx = box.x + ((i % cols) + 0.5) * (box.w / cols);
    const cy = box.y + (Math.floor(i / cols) + 0.5) * (box.h / rows);
    out.push({ x: cx, y: cy, r, dx: 3 * r, dy: 0, owner: null });
  }
  return out;
}

export function withDeltas(rows: readonly { row: string; ms: number }[], base: string): ToneBenchRow[] {
  const b = rows.find((r) => r.row === base)?.ms;
  return rows.map((r) => ({ row: r.row, ms: r.ms, delta: r.row === base || b === undefined ? null : r.ms - b }));
}

export function formatToneBench(rows: readonly ToneBenchRow[]): string {
  return ['row\tms\tΔ ms', ...rows.map((r) => `${r.row}\t${r.ms.toFixed(2)}\t${r.delta === null ? '' : r.delta.toFixed(2)}`)].join('\n');
}

export async function runToneBench(engine: Engine, cases: readonly ToneBenchCase[], base: string, pause: () => Promise<void>): Promise<ToneBenchRow[]> {
  const rows: { row: string; ms: number }[] = [];
  for (const c of cases) {
    const times: number[] = [];
    for (let i = 0; i < TONE_BENCH_WARMUP + TONE_BENCH_RUNS; i++) {
      const input = c.input(i);
      const t = performance.now();
      engine.renderToImageData(input, { mirror: false });
      if (i >= TONE_BENCH_WARMUP) times.push(performance.now() - t);
    }
    rows.push({ row: c.row, ms: median(times) });
    await pause();
  }
  return withDeltas(rows, base);
}
