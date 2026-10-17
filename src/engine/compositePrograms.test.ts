// The base composite + the lazily compiled 調節 program (step-2 spec §4.1, §7), with createProgram faked.
import { describe, expect, it, vi } from 'vitest';
import { adjustUniforms, frameFor } from './adjustMath';

const state = vi.hoisted(() => ({ labels: [] as string[], failAdjust: false }));

vi.mock('./gl/gl', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./gl/gl')>()),
  createProgram: vi.fn((_gl: unknown, _vs: string, _fs: string, label: string) => {
    state.labels.push(label);
    if (label === 'composite-adjust' && state.failAdjust) throw new Error('[composite-adjust] FS compile error');
    return { program: {}, u: (name: string) => ({ name }), use: vi.fn(), dispose: vi.fn() };
  }),
}));

import { createCompositePrograms, uploadAdjust } from './compositePrograms';

/** a WebGL2 stand-in that records every call; constants read as 1 */
function recordingGl() {
  const calls: [string, unknown[]][] = [];
  const gl = new Proxy(
    {},
    {
      get: (_t, k) =>
        typeof k === 'string' && /^[A-Z0-9_]+$/.test(k)
          ? 1
          : (...args: unknown[]) => {
              calls.push([String(k), args]);
              return null;
            },
    },
  ) as unknown as WebGL2RenderingContext;
  return { gl, calls };
}
const reset = () => {
  state.labels.length = 0;
  state.failAdjust = false;
};

describe('composite programs (step-2 spec §4.1, §7)', () => {
  it('compiles only the base program until a frame wants 調節, then the 調節 program once', () => {
    reset();
    const { gl } = recordingGl();
    const c = createCompositePrograms(gl);
    expect(state.labels).toEqual(['composite']);
    expect(c.pick(false)).toBe(c.base);
    expect(state.labels).toEqual(['composite']);
    const a = c.pick(true);
    expect(a).not.toBe(c.base);
    expect(c.pick(true)).toBe(a);
    expect(c.pick(false)).toBe(c.base);
    expect(state.labels).toEqual(['composite', 'composite-adjust']);
    expect(c.adjustFailed).toBe(false);
  });

  it('binds the 質感 LUT sampler to unit 8 in the 調節 program only', () => {
    reset();
    const { gl, calls } = recordingGl();
    const c = createCompositePrograms(gl);
    const lookBinds = () => calls.filter(([f, a]) => f === 'uniform1i' && (a[0] as { name: string }).name === 'uLookLut');
    expect(lookBinds()).toEqual([]);
    c.pick(true);
    expect(lookBinds().map(([, a]) => a[1])).toEqual([8]);
  });

  it('a 調節 compile failure: the base program draws, the failure is flagged and logged once, never retried', () => {
    reset();
    state.failAdjust = true;
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { gl } = recordingGl();
    const c = createCompositePrograms(gl);
    expect(c.pick(true)).toBe(c.base);
    expect(c.pick(true)).toBe(c.base);
    expect(c.adjustFailed).toBe(true);
    expect(state.labels.filter((l) => l === 'composite-adjust')).toHaveLength(1);
    expect(err).toHaveBeenCalledTimes(1);
    err.mockRestore();
  });

  it('uploadAdjust sends every uniform, the seed as uint and the 9 curve knots as 18 floats', () => {
    reset();
    const { gl, calls } = recordingGl();
    const c = createCompositePrograms(gl);
    const p = c.pick(true);
    calls.length = 0;
    const u = adjustUniforms({ 'adjust.grain': 0.5, 'adjust.contrast': 0.8 }, null, false, frameFor({ width: 100, height: 50 }, null, 4));
    uploadAdjust(gl, p, u, false);
    const by = (name: string) => calls.find(([, a]) => (a[0] as { name?: string } | null)?.name === name);
    expect(by('uSeedMix')).toEqual(['uniform1ui', [{ name: 'uSeedMix' }, u.seedMix]]);
    expect((by('uCurve')![1][1] as Float32Array).length).toBe(18);
    expect(by('uLookAmt')![1][1]).toBe(0);
    for (const n of ['uAdjustOn', 'uExp', 'uCurveOn', 'uWbOn', 'uWb', 'uSat', 'uSkinA', 'uSkinB', 'uTaper', 'uFade', 'uVig', 'uVAspect', 'uVMap', 'uGrain', 'uGrainScale'])
      expect(by(n), n).toBeDefined();
  });
});
