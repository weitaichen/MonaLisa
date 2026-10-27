import { describe, expect, it } from 'vitest';
import * as L from './limits';

describe('limits (S §3.5)', () => {
  it('ships the Phase 0 defaults', () => {
    // 2026-10-18 (S §6.7, the user: 「人數上限改到10人以下」): a group photo of up to ten people is selectable whole
    // (6 until §6.6, 8 until §6.7)
    expect(L.MAX_EDIT_FACES).toBe(10);
    expect(L.EDIT_DETECT_FACES).toBe(L.MAX_EDIT_FACES + 2);
    expect(L.EDIT_DETECT_FACES).toBe(12);
    expect(L.MAX_RENDER_FACES).toBe(10);
    expect(L.MAX_EDIT_BODIES).toBe(4);
    expect(L.MAX_LIVE_FACES).toBe(3);
    // sub-step 1e: the camera tracks every face it can show (T1)
    expect(L.LIVE_DETECT_FACES).toBe(L.MAX_LIVE_FACES);
    expect(L.MIN_FACE_FRAC).toBe(0.03);
    expect(L.LOST_HOLD_MS).toBe(1000);
    expect(L.ONE_EURO).toEqual({ minCutoff: 0.05, beta: 80, dCutoff: 1.0 });
    expect(L.SEED_BOX_PAD).toBe(0.25);
    expect(L.PROTECT_WINDOW).toBe(128);
    // S §6.7: one per face a detection returns (was 8, below EDIT_DETECT_FACES − 1 once the request grew to 12)
    expect(L.MAX_OBSTACLES).toBe(12);
    // PR1 (S §6.3, §6.6): the faster carrier ships. Bench R, 2026-10-18 desktop, 8 faces at 2048: UBO 4.4–4.8 ms,
    // texture 11.8–12.3 ms
    expect(L.FACE_TABLE_CARRIER).toBe('ubo');
  });
  it('keeps the invariants the engine relies on', () => {
    expect(L.MAX_EDIT_FACES).toBeLessThanOrEqual(L.MAX_RENDER_FACES);
    // face ids f0…f{MAX_RENDER_FACES − 1} are one digit (cache.ts / state.ts PERSON_ID); uDetail has a bit per face
    expect(L.MAX_RENDER_FACES).toBeLessThanOrEqual(10);
    // A1: every face a detection drops (too small or over the cap) is an obstacle, also when it kept only one face
    expect(L.MAX_OBSTACLES).toBeGreaterThanOrEqual(L.EDIT_DETECT_FACES - 1);
    expect(L.LIVE_DETECT_FACES).toBeLessThanOrEqual(L.MAX_LIVE_FACES);
    expect(['texture', 'ubo']).toContain(L.FACE_TABLE_CARRIER);
  });
});
