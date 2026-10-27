import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { MAX_EDIT_FACES, PROTECT_WINDOW } from '../config/limits';
import { createWarpGuard } from '../edit/warpGuard';
import { mapMinDet } from '../engine/passes/reshapeCpu';
import { adapt } from '../tracking/adapter111';
import type { StillFrame } from '../types';
import { FOLD_BUDGET_MS, foldGuardRows } from './foldGuardBench';

// a pass-through spy: each mapMinDet call is one face checked
vi.mock('../engine/passes/reshapeCpu', async (importOriginal) => {
  const m = await importOriginal<typeof import('../engine/passes/reshapeCpu')>();
  return { ...m, mapMinDet: vi.fn(m.mapMinDet) };
});
const checks = vi.mocked(mapMinDet);
// pass-through guards that record every frame they check, in order
const guarded = vi.hoisted((): StillFrame[] => []);
vi.mock('../edit/warpGuard', async (importOriginal) => {
  const m = await importOriginal<typeof import('../edit/warpGuard')>();
  return {
    ...m,
    createWarpGuard: vi.fn(() => {
      const g = m.createWarpGuard();
      return (frame: StillFrame, aspect: number, opts?: Parameters<typeof g>[2]) => {
        guarded.push(frame);
        return g(frame, aspect, opts);
      };
    }),
  };
});

const lm = JSON.parse(readFileSync(new URL('../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as { width: number; height: number; points: number[] };
const base = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
const limited = (f: StillFrame) => f.faces.every((x) => x.protect !== null);

describe('row PC: the slider commit’s fold check (step-1 spec §6.1, §6.3 PC1)', () => {
  it('6, 8 and MAX_EDIT_FACES (10) faces on row R’s 2-row grids: a 全部 commit checks every face, one person’s change one face; λ stays 1', () => {
    checks.mockClear();
    const rows = foldGuardRows(base, { runs: 3 });
    expect(rows.map((r) => r.config)).toEqual(['6 faces grid 2×3 @1.3FW', '8 faces grid 2×4 @1.3FW', `${MAX_EDIT_FACES} faces grid 2×5 @1.3FW`]);
    // per layout, with the 瘦臉 limits: the warm-up and 3 全部 commits check every face, then 3 one-person commits one
    // face each; without: the warm-up and 3 全部 commits
    expect(checks).toHaveBeenCalledTimes([6, 8, MAX_EDIT_FACES].reduce((s, n) => s + (4 * n + 3) + 4 * n, 0));
    for (const r of rows) {
      expect(r.row).toBe('PC');
      expect(r.values.lambda_min).toBe(1);
      expect(r.values.budget_ms).toBe(FOLD_BUDGET_MS);
      for (const k of ['all_ms', 'one_ms', 'all_ms_unlimited']) expect(r.values[k] as number, k).toBeGreaterThan(0);
      expect(r.values.verdict).toBe((r.values.all_ms as number) <= FOLD_BUDGET_MS ? 'ok' : 'OVER');
    }
  });

  it('times only the guard call, as the median of the runs', () => {
    let t = 0;
    // every clock read advances it 1 ms, and a timed commit reads it twice: 1 ms each
    const rows = foldGuardRows(base, { runs: 3, now: () => (t += 1) });
    for (const r of rows) {
      expect(r.values.all_ms).toBe(1);
      expect(r.values.one_ms).toBe(1);
      expect(r.values.all_ms_unlimited).toBe(1);
      expect(r.values.verdict).toBe('ok');
    }
  });

  it('all_ms and one_ms (and so PC1) time commits that carry every face’s 瘦臉 limit, as the editor’s check does after a contour drag; all_ms_unlimited the same 全部 commits without', () => {
    guarded.length = 0;
    vi.mocked(createWarpGuard).mockClear();
    let t = 0;
    // a commit's second clock read comes right after its guard call: the elapsed time says whether that frame had limits
    const rows = foldGuardRows(base, { runs: 3, now: () => (t += guarded.length && limited(guarded.at(-1)!) ? 10 : 1) });
    for (const r of rows) {
      expect(r.values.all_ms, r.config).toBe(10);
      expect(r.values.one_ms, r.config).toBe(10);
      expect(r.values.all_ms_unlimited, r.config).toBe(1);
    }
    // the limits are the editor's with ≥ 2 faces (editorModel.ts protectRequests): one per face, in a PROTECT_WINDOW²
    // window around it, built once (the guard's memo keys on the limit's identity and version)
    const withLimits = guarded.filter(limited);
    expect(withLimits.length).toBe(3 * (1 + 3 + 3));
    for (const f of withLimits) {
      const protects = f.faces.map((x) => x.protect!);
      expect(new Set(protects).size).toBe(f.faces.length);
      for (const p of protects) {
        expect([p.width, p.height]).toEqual([PROTECT_WINDOW, PROTECT_WINDOW]);
        expect(p.window).toBeDefined();
        expect(p.data.every(Number.isFinite)).toBe(true);
      }
    }
    const ten = withLimits.filter((f) => f.faces.length === MAX_EDIT_FACES);
    expect(ten.every((f) => f.faces.every((x, i) => x.protect === ten[0].faces[i].protect))).toBe(true);
  });
});
