import { describe, expect, it } from 'vitest';
import {
  type BenchSample,
  type BodyBenchRow,
  formatBodyReport,
  formatElapsed,
  formatExportRows,
  formatMultiRows,
  formatReport,
  gsRows,
  jgRows,
  jitterRms,
  lagMs,
  type LfSample,
  lfRows,
  liveRows,
  maskCoverage,
  median,
  pgnVerdict,
  PGS_MAX_MS,
  pj1gVerdict,
  PLB_MAX_MS,
  PWB_MAX_MS,
  summarize,
  summarizeLf,
  viewCallRows,
  visibilitySanity,
  wbRows,
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

describe('bench 多臉 L, both detectors (camera per-person spec §12.4)', () => {
  const ms = (center: number, n = 21) => Array.from({ length: n }, (_, i) => center + (i - (n >> 1)) * 0.1);
  it('names the detector in each L row and gives PL2 from the camera detector rows only (the front solo path)', () => {
    const rows = liveRows([
      { delegate: 'GPU', detector: 'photo', numFaces: 1, times: ms(15), fps: 30, faces: 1 },
      { delegate: 'GPU', detector: 'photo', numFaces: 10, times: ms(30), fps: 30, faces: 1 },
      { delegate: 'GPU', detector: 'camera', numFaces: 1, times: ms(11), fps: 30, faces: 1 },
      { delegate: 'GPU', detector: 'camera', numFaces: 3, times: ms(13), fps: 30, faces: 1 },
      { delegate: 'GPU', detector: 'camera', numFaces: 10, times: ms(14), fps: 30, faces: 1 },
    ]);
    expect(rows.filter((r) => r.row === 'L').map((r) => r.config)).toEqual([
      'GPU photo numFaces 1',
      'GPU photo numFaces 10',
      'GPU camera numFaces 1',
      'GPU camera numFaces 3',
      'GPU camera numFaces 10',
    ]);
    expect(rows.filter((r) => r.row === 'PL2')).toEqual([
      { row: 'PL2', config: 'GPU', values: { delta_p50_ms: 3, delta_p95_ms: 3, delta_pct: 27.3, limit_ms: 5, verdict: 'pass' } },
    ]);
  });

  it('viewCallRows: the group path’s call p50 per view kind, its copy p50, the faces it returned and its size', () => {
    expect(
      viewCallRows([
        { delegate: 'CPU', detector: 'photo', view: 'whole', size: '540x720', times: ms(20), copyTimes: [0.4, 0.6, 0.5], faces: 1 },
        { delegate: 'CPU', detector: 'camera', view: 't0,0', size: '540x540', times: [], copyTimes: [], faces: 0 },
      ]),
    ).toEqual([
      { row: 'L', config: 'CPU photo view whole', values: { p50_ms: 20, p95_ms: 20.9, copy_ms: 0.5, faces: 1, frames: 21, size: '540x720' } },
      { row: 'L', config: 'CPU camera view t0,0', values: { p50_ms: 'n/a', p95_ms: 'n/a', copy_ms: 'n/a', faces: 0, frames: 0, size: '540x540' } },
    ]);
  });
});

describe('camera per-person verdicts (camera per-person spec §10)', () => {
  it('PGN: ≥ 24 fps average, every face ≥ 5 Hz, the longest frame no longer than option C’s', () => {
    expect(pgnVerdict({ fps: 25, faceHz: [5.2, 7], longestMs: 60 }, 69)).toBe('pass');
    expect(pgnVerdict({ fps: 23.9, faceHz: [7], longestMs: 60 }, 69)).toBe('fail');
    expect(pgnVerdict({ fps: 25, faceHz: [4.9, 7], longestMs: 60 }, 69)).toBe('fail');
    expect(pgnVerdict({ fps: 25, faceHz: [7], longestMs: 70 }, 69)).toBe('fail');
    expect(pgnVerdict({ fps: 25, faceHz: [7], longestMs: 500 }, null)).toBe('pass');
  });
  it('PGN fails when no face’s refresh rate was measured', () => {
    expect(pgnVerdict({ fps: 30, faceHz: [], longestMs: 40 }, null)).toBe('fail');
  });
  it('PJ1G: RMS ≤ max(0.4 px, 1.25 × numFaces 1) and lag ≤ 1.25 × numFaces 1', () => {
    expect(pj1gVerdict(0.39, 0.1, 10, 10)).toBe('pass');
    expect(pj1gVerdict(0.5, 0.39, 10, 10)).toBe('fail');
    expect(pj1gVerdict(0.3, 0.3, 12.6, 10)).toBe('fail');
  });
  it('lfRows: PLB for one face on the back camera (detect p50 + render p50 ≤ 33 ms), PGN for ≥ 2 faces', () => {
    const one = lfRows({ config: 'GPU back group', fps: 30, longestMs: 40, maxGapMs: 40, every: 1, faceHz: [30], views: ['whole'], detectP50: 19, renderP50: 5, faces: 1 }, null);
    expect(one.find((r) => r.row === 'PLB')?.values).toMatchObject({ ms: 24, limit_ms: PLB_MAX_MS, verdict: 'pass' });
    const ten = lfRows({ config: 'GPU back group', fps: 25, longestMs: 60, maxGapMs: 70, every: 1, faceHz: Array(10).fill(7), views: ['whole', 't0,0'], detectP50: 32, renderP50: 5, faces: 10 }, 69);
    expect(ten.find((r) => r.row === 'PGN')?.values.verdict).toBe('pass');
  });
  it('lfRows: the LF row carries every measured value; no verdict without a face', () => {
    const rows = lfRows(
      { config: 'CPU back option C', fps: 23.66, longestMs: 88.04, maxGapMs: 100, every: 6, faceHz: [5.04, 6], views: [], detectP50: 82.04, renderP50: 4.96, faces: 10, tier: 'H' },
      null,
    );
    expect(rows[0]).toEqual({
      row: 'LF',
      config: 'CPU back option C',
      values: { fps: 23.7, longest_ms: 88, max_gap_ms: 100, every: 6, min_face_hz: 5, views: '—', detect_p50_ms: 82, render_p50_ms: 5, faces: 10, tier: 'H' },
    });
    expect(rows[1]).toMatchObject({ row: 'PGN', values: { verdict: 'fail', option_c_longest_ms: '—' } });
    const none = lfRows({ config: 'GPU back group', fps: 30, longestMs: 40, maxGapMs: 40, every: 1, faceHz: [], views: ['whole'], detectP50: 15, renderP50: 4, faces: 0 }, null);
    expect(none.map((r) => r.row)).toEqual(['LF']);
    expect(none[0].values.min_face_hz).toBe('n/a');
  });
  it('lfRows: PLB fails over 33 ms; PGN judges the longest frame against option C’s when given', () => {
    const slow = lfRows({ config: 'CPU back group', fps: 28, longestMs: 50, maxGapMs: 50, every: 1, faceHz: [28], views: ['whole'], detectP50: 29.5, renderP50: 4, faces: 1 }, null);
    expect(slow.find((r) => r.row === 'PLB')?.values).toEqual({ ms: 33.5, limit_ms: 33, verdict: 'fail' });
    const pgn = lfRows({ config: 'GPU back group', fps: 26, longestMs: 75, maxGapMs: 80, every: 1, faceHz: [6, 7], views: ['whole'], detectP50: 30, renderP50: 5, faces: 2 }, 69);
    expect(pgn.find((r) => r.row === 'PGN')?.values).toMatchObject({ fps: 26, min_face_hz: 6, longest_ms: 75, option_c_longest_ms: 69, verdict: 'fail' });
  });
});

describe('bench 多臉 LF: the per-frame samples of the live loop (camera per-person spec §12.4)', () => {
  const T = 1000 / 30;
  const sample = (t: number, presented: number, over: Partial<LfSample> = {}): LfSample => ({
    t,
    presented,
    every: 1,
    views: ['whole', 't0,0'],
    path: 'group',
    faces: 2,
    boxes: [],
    ...over,
  });
  // a 30 fps camera for 1.2 s: frame 10 is never processed (the preview jumps two camera frames) and frame 11's callback
  // runs 10 ms late (the longest frame, 2 T + 10, is longer than the gap it shows, 2 T); t1 is refreshed on every
  // frame, t2 on every third sample, t3 is shown for the first nine samples only
  const frames = Array.from({ length: 37 }, (_, k) => k).filter((k) => k !== 10);
  const samples = frames.map((k, i) => {
    const t = k * T + (k === 11 ? 10 : 0);
    const boxes = [
      { id: 't1', seen: t },
      { id: 't2', seen: frames[i - (i % 3)] * T },
      ...(i < 9 ? [{ id: 't3', seen: 0 }] : []),
    ];
    return sample(t, k, { boxes, faces: boxes.length, every: i < 5 ? 2 : 1, views: i < 5 ? ['whole'] : ['whole', 't0,0'] });
  });

  it('fps, the longest frame, the max gap between presented frames, k, the cycle and the faces', () => {
    const s = summarizeLf(samples);
    expect(s.fps).toBeCloseTo(35 / 1.2, 6);
    expect(s.longestMs).toBeCloseTo(2 * T + 10, 6);
    expect(s.maxGapMs).toBeCloseTo(2 * T, 6);
    expect(s.every).toBe(1);
    expect(s.views).toEqual(['whole', 't0,0']);
    expect(s.faces).toBe(2);
  });

  it('each face shown at least a second: its distinct refreshes over the span it was shown', () => {
    const s = summarizeLf(samples);
    expect(s.faceHz).toHaveLength(2);
    expect(s.faceHz[0]).toBeCloseTo(36 / 1.2, 6);
    expect(s.faceHz[1]).toBeCloseTo(12 / 1.2, 6);
  });

  it('no samples: zeros, no face', () => {
    expect(summarizeLf([])).toEqual({ fps: 0, longestMs: 0, maxGapMs: 0, every: 1, faceHz: [], views: [], faces: 0 });
  });

  it('gsRows: one PGS row per path change with the longest frame within ±1 s of it, and the GS row', () => {
    const t = (i: number) => i * T;
    const s: LfSample[] = [];
    for (let i = 0; i <= 150; i++) {
      const at = t(i) + (i > 31 ? 200 : 0) + (i > 120 ? 400 : 0);
      s.push(sample(at, i, { path: i <= 30 ? 'solo' : 'group', faces: i <= 30 ? 2 : 5 }));
    }
    const rows = gsRows('GPU front', s);
    expect(rows[0]).toMatchObject({ row: 'GS', config: 'GPU front', values: { changes: 1, longest_ms: 433.3, faces: 5 } });
    expect(rows.slice(1)).toEqual([
      { row: 'PGS', config: 'GPU front solo→group', values: { at_s: 1, longest_ms: 233.3, limit_ms: PGS_MAX_MS, verdict: 'pass' } },
    ]);
    const slow = s.map((x, i) => (i > 31 ? { ...x, t: x.t + 30 } : x));
    expect(gsRows('CPU front', slow)[1].values).toMatchObject({ longest_ms: 263.3, verdict: 'fail' });
    expect(gsRows('GPU front', s.slice(0, 20))).toEqual([{ row: 'GS', config: 'GPU front', values: { changes: 0, longest_ms: 33.3, faces: 2 } }]);
  });
});

describe('bench 多臉 WB: the first back-camera frame after a flip (PWB)', () => {
  it('a WB row per flip; PWB judges the cold one (≤ 300 ms after live)', () => {
    expect(
      wbRows('GPU', [
        { kind: 'cold', warmMs: 1180.44, firstMs: 140.21, detectMs: 30.06, pageCold: true },
        { kind: 'warm', warmMs: 12.04, firstMs: 60, detectMs: 25, pageCold: false },
      ]),
    ).toEqual([
      { row: 'WB', config: 'GPU cold flip', values: { warm_ms: 1180.4, first_ms: 140.2, first_detect_ms: 30.1, page_cold: 'true' } },
      { row: 'WB', config: 'GPU warm flip', values: { warm_ms: 12, first_ms: 60, first_detect_ms: 25, page_cold: 'false' } },
      { row: 'PWB', config: 'GPU', values: { first_ms: 140.2, limit_ms: PWB_MAX_MS, verdict: 'pass' } },
    ]);
  });
  it('no frame after the flip: n/a, and PWB fails', () => {
    const rows = wbRows('CPU', [{ kind: 'cold', warmMs: 40, firstMs: null, detectMs: null, pageCold: false }]);
    expect(rows[0].values).toMatchObject({ first_ms: 'n/a', first_detect_ms: 'n/a' });
    expect(rows[1]).toEqual({ row: 'PWB', config: 'CPU', values: { first_ms: 'n/a', limit_ms: PWB_MAX_MS, verdict: 'fail' } });
  });
});

describe('bench 多臉 JG: the group path’s jitter and lag (PJ1G)', () => {
  const pts = (dx: number) => {
    const p = new Float32Array(222);
    for (let i = 0; i < 111; i++) p.set([0.5 + dx, 0.5], i * 2);
    return p;
  };
  it('jitterRms: every pts111 point’s deviation from its mean, px at a 1080-px frame height, x scaled by the aspect', () => {
    // (pts111 are Float32: 0.501 is off by up to 3e-8, 3e-5 px here)
    expect(jitterRms([pts(0.001), pts(-0.001)], 1)).toBeCloseTo(1.08, 3);
    expect(jitterRms([pts(0.001), pts(-0.001)], 16 / 9)).toBeCloseTo(1.92, 3);
    expect(jitterRms([pts(0.001)], 1)).toBe(0);
    expect(jitterRms([], 1)).toBeNull();
  });
  it('lagMs: the mean of (raw − smoothed) / raw velocity, samples without motion skipped', () => {
    const t = Array.from({ length: 30 }, (_, i) => i * 33);
    const raw = t.map((x) => 0.0001 * x);
    const sm = t.map((x) => 0.0001 * (x - 50));
    const r = lagMs(raw, sm, t);
    expect(r.lag).toBeCloseTo(50, 6);
    expect(r.n).toBe(27);
    expect(lagMs(t.map(() => 0.5), t.map(() => 0.5), t)).toEqual({ lag: null, n: 0 });
  });
  it('jgRows: the app and MediaPipe per refresh kind, then PJ1G per kind; lag judged only where it was measured', () => {
    const rows = jgRows([
      { config: 'GPU whole', rms: 0.3, rms1: 0.3, lag: 10, lag1: 9, frames: 60, lagSamples: 100 },
      { config: 'GPU tile t1,0', rms: 0.2, rms1: 0.1, lag: null, lag1: null, frames: 60, lagSamples: 0 },
      { config: 'CPU tile', rms: null, rms1: null, lag: null, lag1: null, frames: 0, lagSamples: 0 },
    ]);
    expect(rows.filter((r) => r.row === 'JG')).toEqual([
      { row: 'JG', config: 'GPU whole app', values: { rms_px1080: 0.3, lag_ms: 10, frames: 60, lag_samples: 100 } },
      { row: 'JG', config: 'GPU whole mediapipe', values: { rms_px1080: 0.3, lag_ms: 9, frames: 60, lag_samples: 100 } },
      { row: 'JG', config: 'GPU tile t1,0 app', values: { rms_px1080: 0.2, lag_ms: 'n/a', frames: 60, lag_samples: 0 } },
      { row: 'JG', config: 'GPU tile t1,0 mediapipe', values: { rms_px1080: 0.1, lag_ms: 'n/a', frames: 60, lag_samples: 0 } },
      { row: 'JG', config: 'CPU tile app', values: { rms_px1080: 'n/a', lag_ms: 'n/a', frames: 0, lag_samples: 0 } },
      { row: 'JG', config: 'CPU tile mediapipe', values: { rms_px1080: 'n/a', lag_ms: 'n/a', frames: 0, lag_samples: 0 } },
    ]);
    expect(rows.filter((r) => r.row === 'PJ1G').map((r) => [r.config, r.values.judged, r.values.verdict])).toEqual([
      ['GPU whole', 'jitter, lag', 'pass'],
      ['GPU tile t1,0', 'jitter', 'pass'],
      ['CPU tile', 'none', 'n/a'],
    ]);
    const lagFail = jgRows([{ config: 'GPU whole', rms: 0.3, rms1: 0.3, lag: 12, lag1: 9, frames: 60, lagSamples: 100 }]);
    expect(lagFail.find((r) => r.row === 'PJ1G')?.values.verdict).toBe('fail');
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
