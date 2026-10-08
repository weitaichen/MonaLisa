import { describe, expect, it } from 'vitest';
import {
  type BenchSample,
  type BodyBenchRow,
  formatBodyReport,
  formatElapsed,
  formatReport,
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
