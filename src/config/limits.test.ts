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
    // camera per-person spec §6.3 (K5): every face in view up to the editor's cap (3 until 0.6)
    expect(L.MAX_LIVE_FACES).toBe(10);
    expect(L.MAX_LIVE_FACES).toBe(L.MAX_EDIT_FACES);
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
    // camera per-person spec §7.3–§7.5 (K7, K8): re-identification gates, the track size gate, the idle limit
    expect([L.REID_GRACE_MS, L.REID_DIST, L.REID_SIZE, L.REID_AMBIGUITY, L.TRACK_SIZE_JUMP, L.LIVE_IDLE_MAX_MS]).toEqual([4000, 1.5, 1.5, 1.25, 1.5, 60_000]);
    // camera per-person spec §6.3, §6.6 (K17, K18): the group path, its detectors, floors and schedule. The group path
    // is off since 2026-10-22: its desktop gate PGN failed (spec §10, §16 item 1), so option C ships (K17's fallback)
    expect(L.LIVE_GROUP).toBe(false);
    expect(L.LIVE_DETECTOR).toEqual({ user: 'camera', environment: 'photo' });
    expect(L.LIVE_FACE_FLOOR).toEqual({ user: 0.05, environment: 0.03 });
    expect(L.DETECTOR_FLOOR).toEqual({ camera: 0.11, photo: 0.08 });
    expect([L.LIVE_SCAN_EVERY, L.LIVE_SOLO_AFTER_MS, L.LIVE_VIEW_MAX_EDGE]).toEqual([4, 5000, 1280]);
    // camera per-person spec §6.4 (K6): the detection cadence keeps ≥ 24 fps on average, face updates ≥ 5 Hz
    expect([L.LIVE_MIN_FPS, L.LIVE_MAX_DETECT_EVERY]).toEqual([24, 6]);
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
