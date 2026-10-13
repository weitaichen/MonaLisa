import { describe, expect, it } from 'vitest';
import {
  type BenchSample,
  type BodyBenchRow,
  formatBodyReport,
  formatElapsed,
  formatExportRows,
  formatMultiRows,
  formatReport,
  liveRows,
  maskCoverage,
  median,
  summarize,
  visibilitySanity,
} from './report';

const row = (t: number, fps: number, face = true): BenchSample => ({
  t,
  fps,
  detectMs: 10,
  renderMs: 4,
  tier: 'M',
  face,
  mode: 'skin+shape',
  delegate: 'GPU',
});

describe('bench report', () => {
  it('summarize averages and handles empty input', () => {
    expect(summarize([]).n).toBe(0);
    const s = summarize([row(5, 30), row(10, 20, false)]);
    expect(s).toEqual({ n: 2, fpsAvg: 25, fpsMin: 20, detectAvg: 10, renderAvg: 4, faceRatio: 0.5 });
  });

  it('formatElapsed', () => {
    expect(formatElapsed(0)).toBe('00:00');
    expect(formatElapsed(83_400)).toBe('01:23');
    expect(formatElapsed(3_723_000)).toBe('1:02:03');
    expect(formatElapsed(-5)).toBe('00:00');
  });

  it('formatReport is header + summary + TSV rows', () => {
    const text = formatReport({ ua: 'Mozilla/5.0\n(iPhone)', video: '1280×720' }, [row(5, 29.94), row(10, 30)]);
    const lines = text.split('\n');
    expect(lines[0]).toBe('# ua: Mozilla/5.0 (iPhone)');
    expect(lines[1]).toBe('# video: 1280×720');
    expect(lines[2]).toMatch(/^# summary: n=2 fps_avg=30\.0 fps_min=29\.9 /);
    expect(lines[3].split('\t')).toEqual(['t_s', 'fps', 'detect_ms', 'render_ms', 'tier', 'face', 'mode', 'delegate']);
    expect(lines[4].split('\t')).toEqual(['5', '29.9', '10.0', '4.0', 'M', '1', 'skin+shape', 'GPU']);
    expect(lines).toHaveLength(6);
  });

  it('formatReport appends the 美體偵測 table only when body rows exist', () => {
    expect(formatReport({}, [row(5, 30)]).includes('美體')).toBe(false);
    const text = formatReport({}, [row(5, 30)], [bodyRow()]);
    const lines = text.split('\n');
    const at = lines.indexOf('# 美體偵測 (PoseLandmarker 0.10.35)');
    expect(at).toBe(3);
    expect(lines[at + 1].split('\t')[0]).toBe('variant');
    expect(lines).toHaveLength(at + 3);
  });
});

const bodyRow = (over: Partial<BodyBenchRow> = {}): BodyBenchRow => ({
  variant: 'full',
  mode: 'IMAGE',
  requested: 'CPU',
  delegate: 'GPU',
  loadMs: 812.4,
  createMs: 301.6,
  firstMs: 95.25,
  detectMs: 41.04,
  n: 5,
  people: 1,
  mask: '163x256',
  maskCoverage: 0.2134,
  visibility: { present: true, min: 0.884, mean: 0.98, ok: 33, inFrame: 31 },
  error: null,
  heapMb: 0,
  ...over,
});

describe('美體偵測 report', () => {
  it('formatBodyReport is a header line, the columns and one TSV row per configuration', () => {
    const lines = formatBodyReport([bodyRow(), bodyRow({ requested: 'GPU', delegate: null, mask: 'off', error: 'no\nwebgl', heapMb: 123.4 })]).split('\n');
    expect(lines[0]).toBe('# 美體偵測 (PoseLandmarker 0.10.35)');
    const cols = lines[1].split('\t');
    expect(cols).toHaveLength(18);
    expect(lines[2].split('\t')).toEqual([
      'full', 'IMAGE', 'CPU', 'GPU', '812', '302', '95.3', '41.0', '5', '1', '163x256', '0.213', '1', '0.88', '33', '31', '-', '',
    ]);
    const r2 = lines[3].split('\t');
    expect(r2[3]).toBe('-');
    expect(r2[16]).toBe('123');
    expect(r2[17]).toBe('no webgl');
  });

  it('visibilitySanity: presence, minimum, gate count and in-frame count', () => {
    const p = new Float32Array(33 * 4);
    for (let i = 0; i < 33; i++) p.set([0.5, 0.5, 0, 0.9], i * 4);
    p.set([0.5, 1.2, 0, 0.3], 32 * 4); // below the frame, not visible
    p.set([0.01, 0.5, 0, 0.7], 31 * 4); // inside the image but within the 2 % margin
    const s = visibilitySanity(p);
    expect(s.present).toBe(true);
    expect(s.min).toBeCloseTo(0.3);
    expect(s.ok).toBe(32);
    expect(s.inFrame).toBe(31);
    // all-zero (or all-identical) visibility means the field is missing
    expect(visibilitySanity(new Float32Array(132)).present).toBe(false);
    expect(visibilitySanity(new Float32Array(0)).present).toBe(false);
  });

  it('maskCoverage and median', () => {
    expect(maskCoverage(null)).toBe(0);
    const data = new Uint8Array([0, 127, 128, 255]);
    const det = { pose: { points: new Float32Array(132) }, mask: { width: 2, height: 2, data }, people: 1, width: 2, height: 2 };
    expect(maskCoverage(det)).toBe(0.5);
    expect(maskCoverage({ ...det, mask: null })).toBe(0);
    expect(median([])).toBe(0);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('bench 多臉 report', () => {
  it('formats rows as a tab-separated section with a header per row id', () => {
    const text = formatMultiRows([
      { row: 'D', config: 'GPU 2048 n8', values: { first_ms: 812.4, median_ms: 120, faces: 3 } },
      { row: 'D', config: 'CPU 1440 n1', values: { first_ms: 300, median_ms: 90, faces: 1 } },
      { row: 'GL', config: 'limits', values: { MAX_TEXTURE_SIZE: 16384 } },
    ]);
    expect(text).toContain('# 多臉 D');
    expect(text).toContain('config\tfirst_ms\tmedian_ms\tfaces');
    expect(text).toContain('GPU 2048 n8\t812.4\t120\t3');
    expect(text).toContain('# 多臉 GL');
  });
});

describe('bench 多臉 L / PL1 / PL2 (S §6.3)', () => {
  const ms = (center: number, n = 21) => Array.from({ length: n }, (_, i) => center + (i - (n >> 1)) * 0.1);
  it('one face in view: L rows per delegate and count, and PL2 = p50 at numFaces 3 minus p50 at numFaces 1, ≤ 5 ms', () => {
    const rows = liveRows([
      { delegate: 'GPU', numFaces: 1, times: ms(12), fps: 30, faces: 1 },
      { delegate: 'GPU', numFaces: 2, times: ms(15), fps: 30, faces: 1 },
      { delegate: 'GPU', numFaces: 3, times: ms(17), fps: 30, faces: 1 },
      { delegate: 'CPU', numFaces: 1, times: ms(10), fps: 30, faces: 1 },
      { delegate: 'CPU', numFaces: 3, times: ms(15.5), fps: 29, faces: 1 },
    ]);
    expect(rows.filter((r) => r.row === 'L').map((r) => r.config)).toEqual(['GPU numFaces 1', 'GPU numFaces 2', 'GPU numFaces 3', 'CPU numFaces 1', 'CPU numFaces 3']);
    expect(rows.find((r) => r.config === 'GPU numFaces 3')!.values).toEqual({ p50_ms: 17, p95_ms: 17.9, fps: 30, faces: 1, frames: 21 });
    const pl2 = rows.filter((r) => r.row === 'PL2');
    expect(pl2).toEqual([
      { row: 'PL2', config: 'GPU', values: { delta_p50_ms: 5, delta_p95_ms: 5, delta_pct: 41.7, limit_ms: 5, verdict: 'pass' } },
      { row: 'PL2', config: 'CPU', values: { delta_p50_ms: 5.5, delta_p95_ms: 5.5, delta_pct: 55, limit_ms: 5, verdict: 'fail' } },
    ]);
    expect(rows.some((r) => r.row === 'PL1')).toBe(false);
  });

  it('three faces in view: PL1 per count ≥ 2 (p50 ≤ 20 ms and fps ≥ 24), no PL2', () => {
    const rows = liveRows([
      { delegate: 'GPU', numFaces: 1, times: ms(12), fps: 30, faces: 1 },
      { delegate: 'GPU', numFaces: 2, times: ms(19), fps: 26, faces: 2 },
      { delegate: 'GPU', numFaces: 3, times: ms(30), fps: 25, faces: 3 },
      { delegate: 'CPU', numFaces: 3, times: ms(18), fps: 23.9, faces: 3 },
    ]);
    expect(rows.filter((r) => r.row === 'PL1')).toEqual([
      { row: 'PL1', config: 'GPU numFaces 2', values: { p50_ms: 19, fps: 26, limit: 'p50 ≤ 20 ms, fps ≥ 24', verdict: 'pass' } },
      { row: 'PL1', config: 'GPU numFaces 3', values: { p50_ms: 30, fps: 25, limit: 'p50 ≤ 20 ms, fps ≥ 24', verdict: 'fail' } },
      { row: 'PL1', config: 'CPU numFaces 3', values: { p50_ms: 18, fps: 23.9, limit: 'p50 ≤ 20 ms, fps ≥ 24', verdict: 'fail' } },
    ]);
    expect(rows.some((r) => r.row === 'PL2')).toBe(false);
  });

  it('a delegate without a numFaces 1 run (or with no frames) gives no PL2 row', () => {
    const rows = liveRows([
      { delegate: 'GPU', numFaces: 3, times: ms(17), fps: 30, faces: 1 },
      { delegate: 'CPU', numFaces: 1, times: [], fps: 0, faces: 0 },
      { delegate: 'CPU', numFaces: 3, times: ms(15), fps: 30, faces: 1 },
    ]);
    expect(rows.some((r) => r.row === 'PL2')).toBe(false);
    expect(rows.find((r) => r.config === 'CPU numFaces 1')!.values).toEqual({ p50_ms: 'n/a', p95_ms: 'n/a', fps: 0, faces: 0, frames: 0 });
  });
});

describe('bench 多臉 L: the cost of a numFaces switch', () => {
  it('reports the slowest first inference after a count switch (a graph rebuild) when the run measured one', () => {
    const rows = liveRows([
      { delegate: 'GPU', numFaces: 1, times: [12], fps: 30, faces: 1, switchMs: [380.24, 912.36] },
      { delegate: 'GPU', numFaces: 3, times: [16], fps: 30, faces: 1, switchMs: [] },
    ]);
    expect(rows[0].values.switch_ms).toBe(912.4);
    expect(rows[1].values).not.toHaveProperty('switch_ms');
  });
});

describe('formatExportRows (S §6.4)', () => {
  it('one TSV line per row with ms rounded, and — for manual or failed rows', () => {
    expect(
      formatExportRows([
        { name: 'decode 12MP', ms: 412.6, detail: '4032×3024 from 4032×3024' },
        { name: 'share after 3.5 / 4.5 / 5.5 s', ms: null, detail: 'manual on the iPhone' },
      ]),
    ).toBe('輸出\tms\t說明\ndecode 12MP\t413\t4032×3024 from 4032×3024\nshare after 3.5 / 4.5 / 5.5 s\t—\tmanual on the iPhone');
  });
});
