import { describe, expect, it } from 'vitest';
import { benchReplay, benchStamps, formatLiquifyReport } from './liquifyBench';

/** a clock that advances 1 ms per read: the rows are deterministic and positive */
const tick = () => {
  let t = 0;
  return () => (t += 1);
};

describe('liquify bench rows (push-brush spec §6.2)', () => {
  const frame = { width: 300, height: 400 };

  it('stamp rows: push, bisecting push and restore at 小／中／大, in ns per texel-stamp with the 80 ns budget', () => {
    const rows = benchStamps(frame, tick());
    expect(rows.map((r) => r.name)).toEqual([
      'liquify.stamp push 小',
      'liquify.stamp push bisecting 小',
      'liquify.stamp restore 小',
      'liquify.stamp push 中',
      'liquify.stamp push bisecting 中',
      'liquify.stamp restore 中',
      'liquify.stamp push 大',
      'liquify.stamp push bisecting 大',
      'liquify.stamp restore 大',
    ]);
    for (const r of rows) {
      expect(Number.isFinite(r.value)).toBe(true);
      expect(r.value).toBeGreaterThanOrEqual(0);
      expect(r.unit).toBe('ns/texel-stamp');
      expect(r.budget).toBe(80);
    }
  });

  it('replay rows (S30 only here: SCAP is the slow one) and the report', () => {
    const rows = benchReplay(frame, tick(), false);
    expect(rows.map((r) => r.name)).toEqual(['liquify.replay S30', 'liquify.bisected S30']);
    expect(rows[0].budget).toBe(100);
    const text = formatLiquifyReport(rows);
    expect(text).toContain('推臉筆');
    expect(text.split('\n').filter((l) => l.startsWith('liquify.'))).toHaveLength(2);
    expect(formatLiquifyReport([])).toBe('');
  });
});
