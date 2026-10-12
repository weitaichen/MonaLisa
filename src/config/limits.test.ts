import { describe, expect, it } from 'vitest';
import * as L from './limits';

describe('limits (S §3.5)', () => {
  it('ships the Phase 0 defaults', () => {
    expect(L.MAX_EDIT_FACES).toBe(6);
    expect(L.EDIT_DETECT_FACES).toBe(L.MAX_EDIT_FACES + 2);
    expect(L.MAX_RENDER_FACES).toBe(6);
    expect(L.MAX_EDIT_BODIES).toBe(4);
    expect(L.MAX_LIVE_FACES).toBe(3);
    // sub-step 1e: the camera tracks every face it can show (T1)
    expect(L.LIVE_DETECT_FACES).toBe(L.MAX_LIVE_FACES);
    expect(L.MIN_FACE_FRAC).toBe(0.03);
    expect(L.LOST_HOLD_MS).toBe(1000);
    expect(L.ONE_EURO).toEqual({ minCutoff: 0.05, beta: 80, dCutoff: 1.0 });
    expect(L.SEED_BOX_PAD).toBe(0.25);
    expect(L.PROTECT_WINDOW).toBe(128);
    expect(L.MAX_OBSTACLES).toBe(8);
  });
  it('keeps the invariants the engine relies on', () => {
    expect(L.MAX_EDIT_FACES).toBeLessThanOrEqual(L.MAX_RENDER_FACES);
    expect(L.LIVE_DETECT_FACES).toBeLessThanOrEqual(L.MAX_LIVE_FACES);
    expect(['texture', 'ubo']).toContain(L.FACE_TABLE_CARRIER);
  });
});
