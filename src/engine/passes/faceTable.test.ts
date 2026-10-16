import { describe, expect, it } from 'vitest';
import { FT, FT_SPAN } from './faceTable';
import { RESHAPE_FS } from './reshape';

describe('the face table layout (FT)', () => {
  it('names every texel of the 96-texel row exactly once, in order (no overlap, no spare)', () => {
    const owner: string[] = new Array(FT.ROW).fill('');
    for (const [name, at] of Object.entries(FT)) {
      if (name === 'ROW') continue;
      const span = FT_SPAN[name as keyof typeof FT] ?? 1;
      for (let t = at; t < at + span; t++) {
        expect(owner[t], `texel ${t}: ${name} and ${owner[t]}`).toBe('');
        owner[t] = name;
      }
    }
    expect(owner.findIndex((o) => o === '')).toBe(-1);
    expect(FT.RIGHT2).toBe(FT.RIGHT + 1);
  });

  it('RESHAPE_FS reads the step-5 texels through the named entries', () => {
    for (const t of [FT.S5, FT.S6, FT.AXES, FT.HAIR_R, FT.HAIR_MOUTH_DISP, FT.MOUTH_R, FT.MOUTH_AXIS, FT.WING, FT.ROOT, FT.ROOT_RY]) expect(RESHAPE_FS).toContain(`F(f, ${t})`);
    for (const t of [FT.JT, FT.TA, FT.TT]) expect(RESHAPE_FS).toContain(`F(f, ${t} + (k >> 1))`);
  });
});
