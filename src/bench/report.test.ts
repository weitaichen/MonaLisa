import { describe, expect, it } from 'vitest';
import { type BenchSample, formatElapsed, formatReport, summarize } from './report';

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
});
