import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EDIT_DETECT_FACES } from '../config/limits';
import { legacyFrame } from '../edit/frame';
import { splitLegacy } from '../edit/legacy';
import { retake, sampleFaceAt } from '../detect/testMeshes';
import { firstAnswer } from '../edit/migrate';
import { defaultPhoto } from '../edit/state';
import { applyPreset, setParam } from '../engine/params';
import { applyRatio, IDENTITY_GEOMETRY, rotateLeft, snapCrop } from '../geometry/view';
import { spotWindowGrowth } from '../media/exportPlan';
import { adapt } from '../tracking/adapter111';
import type { BeautyParams, Geometry, Landmarks478, PhotoParams, StillFrame } from '../types';
import { createStillSession, detectStill, sameDisplayFrame, type StillSession } from './still';
import { faceOf, fakeEngine, fakeTracker, makeBodyField, makeFace, makeLandmarks, stubRaf, weightOf } from './testFakes';

vi.mock('../tracking/adapter111', () => ({
  adapt: vi.fn(() => makeFace(7)),
}));

function bitmap(width = 1536, height = 2048) {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap & { close: ReturnType<typeof vi.fn> };
}

const natural = applyPreset('natural');
/** what a v0.3-style caller renders: the session's (first) face at weight 1 with params `p` */
const fr = (s: StillSession, p: BeautyParams) => legacyFrame(p, s.faces[0]?.face ?? null, 1);
/** one cached face (the session re-adapts it from the landmarks) */
const cached = () => [{ id: 'f0', lm: makeLandmarks().points, box: { x: 0.3, y: 0.3, w: 0.4, h: 0.4 } }];

beforeEach(() => {
  vi.useFakeTimers();
  stubRaf();
  vi.mocked(adapt).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('createStillSession', () => {
  it('detects once in IMAGE mode and adapts with the bitmap size', () => {
    const engine = fakeEngine();
    const tracker = fakeTracker();
    const bmp = bitmap();
    const s = createStillSession(engine, tracker, bmp);
    expect(tracker.detectImage).toHaveBeenCalledTimes(1);
    expect(tracker.detectImage).toHaveBeenCalledWith(bmp, { maxFaces: EDIT_DETECT_FACES });
    expect(tracker.detectVideo).not.toHaveBeenCalled();
    expect(adapt).toHaveBeenCalledWith(expect.anything(), 1536, 2048);
    expect(s.faces[0]?.face ?? null).not.toBeNull();
    expect(s.width).toBe(1536);
    expect(s.height).toBe(2048);
    s.render(fr(s, natural));
    s.render(fr(s, natural));
    vi.advanceTimersByTime(100);
    expect(tracker.detectImage).toHaveBeenCalledTimes(1);
  });

  it('faceWeight is 1 with a face, 0 without, and no tracker means no face', () => {
    const e1 = fakeEngine();
    const withFace = createStillSession(e1, fakeTracker(), bitmap());
    withFace.render(fr(withFace, natural));
    vi.advanceTimersByTime(20);
    expect(e1.lastInput()).toMatchObject({ width: 1536, height: 2048 });
    expect(weightOf(e1.lastInput())).toBe(1);
    expect(faceOf(e1.lastInput())).toBe(withFace.faces[0].face);

    const e2 = fakeEngine();
    const noFace = createStillSession(e2, fakeTracker(undefined, false), bitmap());
    expect(noFace.faces[0]?.face ?? null).toBeNull();
    noFace.render(fr(noFace, natural));
    vi.advanceTimersByTime(20);
    expect(weightOf(e2.lastInput())).toBe(0);
    expect(faceOf(e2.lastInput())).toBeNull();

    const e3 = fakeEngine();
    const basic = createStillSession(e3, null, bitmap());
    expect(basic.faces[0]?.face ?? null).toBeNull();
    basic.render(fr(basic, natural));
    vi.advanceTimersByTime(20);
    expect(weightOf(e3.lastInput())).toBe(0);
    expect(faceOf(e3.lastInput())).toBeNull();
  });

  it('a throwing detector degrades to no face', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const tracker = fakeTracker();
    tracker.detectImage.mockImplementation(() => {
      throw new Error('image mode');
    });
    const s = createStillSession(fakeEngine(), tracker, bitmap());
    expect(s.faces[0]?.face ?? null).toBeNull();
  });

  it('coalesces renders to one per animation frame with the latest params, in still mode, unmirrored', () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, fakeTracker(), bitmap());
    const a = setParam(natural, 'skin.smooth', 0.1);
    const b = setParam(natural, 'skin.smooth', 0.9);
    s.render(fr(s, natural));
    s.render(fr(s, a));
    s.render(fr(s, b));
    expect(engine.render).not.toHaveBeenCalled();
    vi.advanceTimersByTime(16);
    expect(engine.render).toHaveBeenCalledTimes(1);
    // the latest frame wins (b: 磨皮 0.9)
    expect(engine.render.mock.calls[0][0].faces[0].person.values['skin.smooth']).toBe(0.9);
    expect(engine.render.mock.calls[0][1]).toEqual({ still: true });
    expect(engine.setOptions).toHaveBeenLastCalledWith({ mirror: false });
    vi.advanceTimersByTime(100);
    expect(engine.render).toHaveBeenCalledTimes(1); // nothing new requested
    s.render(fr(s, a));
    vi.advanceTimersByTime(16);
    expect(engine.render).toHaveBeenCalledTimes(2);
  });

  it('re-renders once engine.ready resolves (static textures may upload after the first render)', async () => {
    let ready!: () => void;
    const engine = fakeEngine();
    (engine as { ready: Promise<void> }).ready = new Promise<void>((r) => (ready = r));
    const s = createStillSession(engine, fakeTracker(), bitmap());
    s.render(fr(s, natural));
    vi.advanceTimersByTime(16);
    expect(engine.render).toHaveBeenCalledTimes(1);
    ready();
    await Promise.resolve();
    vi.advanceTimersByTime(16);
    expect(engine.render).toHaveBeenCalledTimes(2);
  });

  it('loads the filter LUT once and redraws when it arrives', async () => {
    let done!: () => void;
    const engine = fakeEngine();
    engine.loadFilter.mockImplementation(() => new Promise<void>((r) => (done = r)));
    const s = createStillSession(engine, fakeTracker(), bitmap());
    const glow = applyPreset('glow');
    s.render(fr(s, glow));
    s.render(fr(s, glow));
    vi.advanceTimersByTime(16);
    expect(engine.loadFilter).toHaveBeenCalledTimes(1);
    expect(engine.loadFilter).toHaveBeenCalledWith('warm');
    expect(engine.render).toHaveBeenCalledTimes(1);
    done();
    await Promise.resolve();
    vi.advanceTimersByTime(16);
    expect(engine.render).toHaveBeenCalledTimes(2);
  });

  it('compare shows the original while held, then the edit again', () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, fakeTracker(), bitmap());
    s.render(fr(s, natural));
    vi.advanceTimersByTime(16);
    s.setCompare(true);
    vi.advanceTimersByTime(16);
    expect(engine.renderOriginal).toHaveBeenCalledTimes(1);
    expect(engine.renderOriginal.mock.calls[0]).toEqual([
      // step 3: the original goes through the view geometry too (按住對比 keeps the crop, C §12 #17)
      { source: expect.anything(), width: 1536, height: 2048, geometry: IDENTITY_GEOMETRY },
      { still: true },
    ]);
    s.setCompare(false);
    vi.advanceTimersByTime(16);
    expect(engine.render).toHaveBeenCalledTimes(2);
  });

  it('exportImageData renders full resolution, never mirrored, and redraws the display', () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, fakeTracker(), bitmap());
    s.render(fr(s, natural));
    vi.advanceTimersByTime(16);
    const out = s.exportImageData(fr(s, natural));
    expect(out.width).toBe(1536);
    const [input, opts] = engine.renderToImageData.mock.calls[0];
    expect(input).toMatchObject({ width: 1536, height: 2048 });
    expect(weightOf(input)).toBe(1);
    expect(input.photo).toEqual(splitLegacy(natural).photo);
    expect(opts).toEqual({ mirror: false });
    vi.advanceTimersByTime(16);
    expect(engine.render).toHaveBeenCalledTimes(2);
  });

  it('retries a render while the context is lost', () => {
    const engine = fakeEngine();
    engine.lost = true;
    const s = createStillSession(engine, fakeTracker(), bitmap());
    s.render(fr(s, natural));
    vi.advanceTimersByTime(16 * 5);
    expect(engine.render).not.toHaveBeenCalled();
    engine.lost = false;
    vi.advanceTimersByTime(16);
    expect(engine.render).toHaveBeenCalledTimes(1);
  });

  it('dispose closes the bitmap, cancels the pending frame and ignores later calls', () => {
    const engine = fakeEngine();
    const bmp = bitmap();
    const s = createStillSession(engine, fakeTracker(), bmp);
    s.render(fr(s, natural));
    s.dispose();
    expect(bmp.close).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(engine.render).not.toHaveBeenCalled();
    s.render(fr(s, natural));
    vi.advanceTimersByTime(100);
    expect(engine.render).not.toHaveBeenCalled();
    expect(() => s.exportImageData(fr(s, natural))).toThrow(/disposed/);
    s.dispose();
    expect(bmp.close).toHaveBeenCalledTimes(1);
  });

  it('dispose releases the engine’s 美體 / 推臉筆 field textures once (nothing else draws with this photo’s fields)', () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, fakeTracker(), bitmap());
    s.setLiquify({ width: 2, height: 2, data: new Float32Array(8), version: 1 });
    s.render(fr(s, natural));
    expect(engine.releaseFields).not.toHaveBeenCalled();
    s.dispose();
    expect(engine.releaseFields).toHaveBeenCalledTimes(1);
    s.dispose();
    expect(engine.releaseFields).toHaveBeenCalledTimes(1);
  });

  it('ownsBitmap:false leaves the bitmap open on dispose (the caller rebinds it to a new engine)', () => {
    const bmp = bitmap();
    const s = createStillSession(fakeEngine(), fakeTracker(), bmp, { ownsBitmap: false });
    s.dispose();
    expect(bmp.close).not.toHaveBeenCalled();
  });

  it('redraws after webglcontextrestored and re-requests the filter dropped with the old context', async () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, fakeTracker(), bitmap());
    const glow = applyPreset('glow');
    s.render(fr(s, glow));
    await Promise.resolve();
    vi.advanceTimersByTime(16);
    const renders = engine.render.mock.calls.length;
    expect(engine.loadFilter).toHaveBeenCalledTimes(1);
    engine.canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(engine.loadFilter).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(16);
    expect(engine.render.mock.calls.length).toBeGreaterThan(renders);
    expect(engine.lastInput()!.photo).toEqual(splitLegacy(glow).photo);
    // after dispose the listener is gone
    s.dispose();
    engine.canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(engine.loadFilter).toHaveBeenCalledTimes(2);
  });

  it('prepareExport waits for the filter LUT and never rejects', async () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, fakeTracker(), bitmap());
    await expect(s.prepareExport(fr(s, natural))).resolves.toBeUndefined();
    let done!: () => void;
    engine.loadFilter.mockImplementationOnce(() => new Promise<void>((r) => (done = r)));
    let settled = false;
    const p = s.prepareExport(fr(s, applyPreset('glow'))).then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    done();
    await p;
    expect(settled).toBe(true);
    engine.loadFilter.mockImplementationOnce(() => Promise.reject(new Error('404')));
    await expect(s.prepareExport(fr(s, applyPreset('glow')))).resolves.toBeUndefined();
  });

  it('after a restore, redraws once the new engine.ready resolves and prepareExport waits for it', async () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, fakeTracker(), bitmap());
    s.render(fr(s, natural));
    await Promise.resolve();
    vi.advanceTimersByTime(16);
    // the engine swaps in a fresh `ready` on restore (its listener runs before the session's)
    let ready!: () => void;
    (engine as { ready: Promise<void> }).ready = new Promise<void>((r) => (ready = r));
    engine.canvas.dispatchEvent(new Event('webglcontextrestored'));
    vi.advanceTimersByTime(16);
    const renders = engine.render.mock.calls.length;
    let settled = false;
    const p = s.prepareExport(fr(s, natural)).then(() => (settled = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(s.exportReady(fr(s, natural))).toBe(false);
    ready();
    await p;
    expect(s.exportReady(fr(s, natural))).toBe(true);
    vi.advanceTimersByTime(16);
    expect(engine.render.mock.calls.length).toBe(renders + 1);
  });

  it('prepareExport re-waits when the context is lost and restored during its wait', async () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, fakeTracker(), bitmap());
    const glow = applyPreset('glow');
    const loads: (() => void)[] = [];
    engine.loadFilter.mockImplementation(() => new Promise<void>((r) => loads.push(r)));
    let settled = false;
    const p = s.prepareExport(fr(s, glow)).then(() => (settled = true));
    // loss + restore while the LUT downloads: the old load settles without leaving a texture behind
    let ready!: () => void;
    (engine as { ready: Promise<void> }).ready = new Promise<void>((r) => (ready = r));
    engine.canvas.dispatchEvent(new Event('webglcontextrestored'));
    const flushAll = async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    };
    loads[0]();
    await flushAll();
    expect(settled).toBe(false); // waits for the new `ready` and a fresh filter load
    ready();
    await flushAll();
    expect(settled).toBe(false);
    const fresh = loads.length - 1;
    expect(fresh).toBeGreaterThan(0);
    for (const done of loads.slice(1)) done();
    await p;
    expect(settled).toBe(true);
    expect(s.exportReady(fr(s, glow))).toBe(true);
  });

  it('prepareExport resolves (no retry) while the context is still lost', async () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, fakeTracker(), bitmap());
    engine.lost = true;
    (engine as { ready: Promise<void> }).ready = Promise.resolve();
    await expect(s.prepareExport(fr(s, applyPreset('glow')))).resolves.toBeUndefined();
    expect(s.exportReady(fr(s, applyPreset('glow')))).toBe(false);
  });

  it('exportReady is false until the static textures and the filter LUT have settled', async () => {
    let ready!: () => void;
    let lut!: (e?: unknown) => void;
    const engine = fakeEngine();
    (engine as { ready: Promise<void> }).ready = new Promise<void>((r) => (ready = r));
    engine.loadFilter.mockImplementation(() => new Promise<void>((_r, rej) => (lut = rej)));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = createStillSession(engine, fakeTracker(), bitmap());
    const glow = applyPreset('glow');
    s.render(fr(s, glow));
    expect(s.exportReady(fr(s, natural))).toBe(false);
    ready();
    await Promise.resolve();
    await Promise.resolve();
    expect(s.exportReady(fr(s, natural))).toBe(true);
    expect(s.exportReady(fr(s, glow))).toBe(false);
    lut(new Error('404')); // a failed LUT is skipped by the preview too: the export then matches it
    await Promise.resolve();
    await Promise.resolve();
    expect(s.exportReady(fr(s, glow))).toBe(true);
  });

  it('stopDisplay: no more display renders, exports still work', () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, fakeTracker(), bitmap());
    s.render(fr(s, natural));
    s.stopDisplay();
    vi.advanceTimersByTime(100);
    expect(engine.render).not.toHaveBeenCalled();
    expect(s.exportImageData(fr(s, natural)).width).toBe(1536);
    s.render(fr(s, natural));
    vi.advanceTimersByTime(100);
    expect(engine.render).not.toHaveBeenCalled();
  });

  it('an injected face skips detection; faceKnown is false only when the detector threw', () => {
    const tracker = fakeTracker();
    const s = createStillSession(fakeEngine(), tracker, bitmap(), { faces: cached() });
    expect(tracker.detectImage).not.toHaveBeenCalled();
    expect(s.faces).toHaveLength(1);
    expect(s.faceKnown).toBe(true);
    const none = createStillSession(fakeEngine(), tracker, bitmap(), { faces: [] });
    expect(tracker.detectImage).not.toHaveBeenCalled();
    expect(none.faces[0]?.face ?? null).toBeNull();
    expect(createStillSession(fakeEngine(), fakeTracker(undefined, false), bitmap()).faceKnown).toBe(true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    tracker.detectImage.mockImplementation(() => {
      throw new Error('graph');
    });
    const threw = createStillSession(fakeEngine(), tracker, bitmap());
    expect(threw.faces[0]?.face ?? null).toBeNull();
    expect(threw.faceKnown).toBe(false);
  });

  it('a throwing render is reported, not thrown into rAF', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const engine = fakeEngine();
    engine.render.mockImplementationOnce(() => {
      throw new Error('gl');
    });
    const s = createStillSession(engine, fakeTracker(), bitmap());
    s.render(fr(s, natural));
    expect(() => vi.advanceTimersByTime(16)).not.toThrow();
    expect(err).toHaveBeenCalled();
    s.render(fr(s, natural));
    vi.advanceTimersByTime(16);
    expect(engine.render).toHaveBeenCalledTimes(2);
  });
  it('setBody: the 美體 field reaches every render and export (preview = export); null removes it', () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, fakeTracker(), bitmap());
    expect(s.body).toBeNull();
    s.render(fr(s, natural));
    vi.advanceTimersByTime(16);
    expect(engine.lastInput()!.body).toBeNull();

    const field = makeBodyField(0.02);
    s.setBody(field);
    expect(s.body).toBe(field);
    vi.advanceTimersByTime(16); // setBody alone redraws
    expect(engine.render).toHaveBeenCalledTimes(2);
    expect(engine.lastInput()!.body).toBe(field);
    s.exportImageData(fr(s, natural));
    expect(engine.renderToImageData.mock.calls[0][0].body).toBe(field);

    // the builder refilled the same buffer (new version): passing it again redraws
    field.version++;
    s.setBody(field);
    vi.advanceTimersByTime(16);
    expect(engine.render.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(engine.lastInput()!.body!.version).toBe(2);

    s.setBody(null);
    vi.advanceTimersByTime(16);
    expect(engine.lastInput()!.body).toBeNull();
    s.exportImageData(fr(s, natural));
    expect(engine.renderToImageData.mock.calls[1][0].body).toBeNull();
  });

  it('an export keeps the field captured when it was asked for, while setBody moves the preview on', async () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, fakeTracker(), bitmap(), { body: makeBodyField(0.01) });
    s.render(fr(s, natural));
    const snap = makeBodyField(0.01); // the field at the tap (a copy)
    const pending = s.prepareExport(fr(s, natural));
    const later = makeBodyField(0.03);
    s.setBody(later); // a 美體 drag while the export waits for its LUT
    await pending;
    s.exportImageData(fr(s, natural), snap);
    expect(engine.renderToImageData.mock.calls[0][0].body).toBe(snap);
    s.exportImageData(fr(s, natural), null); // explicitly none
    expect(engine.renderToImageData.mock.calls[1][0].body).toBeNull();
    vi.advanceTimersByTime(16);
    expect(engine.lastInput()!.body).toBe(later); // the preview keeps the live field
  });

  it('a replacement session starts with the field it is given (no unretouched first frame)', () => {
    const engine = fakeEngine();
    const field = makeBodyField();
    const s = createStillSession(engine, fakeTracker(), bitmap(), { body: field });
    expect(s.body).toBe(field);
    s.render(fr(s, natural));
    vi.advanceTimersByTime(16);
    expect(engine.lastInput()!.body).toBe(field);
  });

  it('hold-to-compare shows the original without the body field; setBody after dispose is ignored', () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, fakeTracker(), bitmap(), { body: makeBodyField() });
    s.render(fr(s, natural));
    s.setCompare(true);
    vi.advanceTimersByTime(16);
    expect(engine.renderOriginal).toHaveBeenCalledTimes(1);
    expect(engine.render).not.toHaveBeenCalled();
    s.dispose();
    s.setBody(null);
    vi.advanceTimersByTime(16);
    expect(engine.render).not.toHaveBeenCalled();
  });

  it('each face of the frame carries its 瘦臉 limit to every render and export (A6)', () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, fakeTracker(), bitmap());
    const prot = { width: 2, height: 2, data: new Float32Array(4), version: 1 };
    const frame = legacyFrame(natural, s.faces[0].face, 1, prot);
    s.render(frame);
    vi.advanceTimersByTime(16);
    expect(engine.lastInput()!.faces[0].protect).toBe(prot);
    s.exportImageData(frame);
    expect(engine.renderToImageData.mock.calls[0][0].faces[0].protect).toBe(prot);
  });

  /** a frame without faces: the strokes are photo-level and need none */
  const naturalFrame: StillFrame = { faces: [], obstacles: [], globalSkin: null, photo: defaultPhoto() };
  const liq = (v = 1) => ({ width: 384, height: 512, data: new Float32Array(384 * 512 * 2), version: v });

  it('setLiquify: the 推臉筆 field reaches every render and export (preview = export); null removes it', () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, fakeTracker(), bitmap());
    expect(s.liquify).toBeNull();
    s.render(naturalFrame);
    vi.advanceTimersByTime(16);
    expect(engine.lastInput()!.liquify ?? null).toBeNull();
    const f = liq();
    s.setLiquify(f);
    expect(s.liquify).toBe(f);
    vi.advanceTimersByTime(16); // setLiquify alone redraws
    expect(engine.lastInput()!.liquify).toBe(f);
    s.exportImageData(naturalFrame);
    expect(engine.renderToImageData.mock.calls.at(-1)![0].liquify).toBe(f);
    s.setLiquify(null);
    vi.advanceTimersByTime(16);
    expect(engine.lastInput()!.liquify).toBeNull();
  });

  it('tile inputs carry the snapshot; bounds carry the liquify term only when given', () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, fakeTracker(), bitmap(), { liquify: liq(1) });
    const snap = liq(2);
    expect(s.tileInput(naturalFrame, undefined, snap).liquify).toBe(snap);
    expect(s.tileInput(naturalFrame).liquify).toBe(s.liquify);
    const m = (_r: { x: number; y: number; w: number; h: number }) => 0.01;
    expect(s.bounds(naturalFrame, undefined, m).liquifyMaxDisp).toBe(m);
    expect(s.bounds(naturalFrame).liquifyMaxDisp).toBeUndefined();
  });

  it('an export takes the snapshot it is given, while the preview keeps the live field', () => {
    const engine = fakeEngine();
    const live = liq(1);
    const s = createStillSession(engine, fakeTracker(), bitmap(), { liquify: live });
    s.render(naturalFrame);
    const snap = liq(1);
    s.exportImageData(naturalFrame, undefined, snap);
    expect(engine.renderToImageData.mock.calls.at(-1)![0].liquify).toBe(snap);
    s.exportImageData(naturalFrame, undefined, null);
    expect(engine.renderToImageData.mock.calls.at(-1)![0].liquify).toBeNull();
    vi.advanceTimersByTime(16);
    expect(engine.lastInput()!.liquify).toBe(live); // a replacement session draws the strokes on its first frame
  });
});

describe('濾鏡 and 質感 LUTs in the still session (step-2 spec §3.5)', () => {
  const frameOf = (photo: Partial<PhotoParams>): StillFrame => ({ faces: [], globalSkin: null, photo: { ...defaultPhoto(), ...photo } });

  it('prepareExport loads both LUTs; exportReady waits for the look LUT', async () => {
    const engine = fakeEngine();
    let done!: () => void;
    engine.loadLook.mockImplementation(() => new Promise<void>((r) => (done = r)));
    const s = createStillSession(engine, fakeTracker(), bitmap());
    const f = frameOf({ filterId: 'warm', look: { id: 'ccd', amount: 0.8 } });
    const p = s.prepareExport(f);
    expect(engine.loadLut).toHaveBeenCalledWith('filter', 'warm');
    expect(engine.loadLut).toHaveBeenCalledWith('look', 'ccd');
    await Promise.resolve();
    await Promise.resolve();
    expect(s.exportReady(f)).toBe(false);
    done();
    await p;
    expect(s.exportReady(f)).toBe(true);
  });

  it('a LUT the LRU evicted turns exportReady false again', async () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, fakeTracker(), bitmap());
    const f = frameOf({ look: { id: 'film', amount: 0.8 } });
    await s.prepareExport(f);
    expect(s.exportReady(f)).toBe(true);
    engine.lutStates.delete('look:film');
    expect(s.exportReady(f)).toBe(false);
  });

  it('a failed look LUT counts as settled (the preview skips it too)', async () => {
    const engine = fakeEngine();
    engine.loadLook.mockImplementation(() => Promise.reject(new Error('offline')));
    const s = createStillSession(engine, fakeTracker(), bitmap());
    const f = frameOf({ look: { id: 'blue', amount: 0.8 } });
    await s.prepareExport(f);
    expect(engine.lutState('look', 'blue')).toBe('failed');
    expect(s.exportReady(f)).toBe(true);
  });

  it('prepareExport retrying a failed look that now loads redraws the preview: the file and the screen agree (step-2 review)', async () => {
    const engine = fakeEngine();
    engine.loadLook.mockImplementationOnce(() => Promise.reject(new Error('offline')));
    const s = createStillSession(engine, fakeTracker(), bitmap());
    const f = frameOf({ look: { id: 'blue', amount: 0.8 } });
    s.render(f);
    for (let i = 0; i < 4; i++) await Promise.resolve();
    vi.advanceTimersByTime(16);
    expect(engine.lutState('look', 'blue')).toBe('failed');
    const renders = engine.render.mock.calls.length;
    await s.prepareExport(f); // the retry works this time
    expect(engine.lutState('look', 'blue')).toBe('ready');
    vi.advanceTimersByTime(16);
    expect(engine.render.mock.calls.length).toBe(renders + 1);
    // a prepare that changes nothing (everything resident) draws nothing more
    await s.prepareExport(f);
    vi.advanceTimersByTime(16);
    expect(engine.render.mock.calls.length).toBe(renders + 1);
  });

  it('redraws when a LUT that the screen started loading arrives', async () => {
    const engine = fakeEngine();
    let done!: () => void;
    engine.loadLook.mockImplementation(() => new Promise<void>((r) => (done = r)));
    void engine.loadLut('look', 'blue'); // the screen's useLutLoader asked first
    const s = createStillSession(engine, fakeTracker(), bitmap());
    s.render(frameOf({ look: { id: 'blue', amount: 0.8 } }));
    vi.advanceTimersByTime(16);
    const renders = engine.render.mock.calls.length;
    done();
    await Promise.resolve();
    await Promise.resolve();
    vi.advanceTimersByTime(16);
    expect(engine.render.mock.calls.length).toBe(renders + 1);
    expect(engine.loadLook).toHaveBeenCalledTimes(1);
  });
});

describe('crop view mode, display pause and tiles (step 3)', () => {
  const photo = defaultPhoto();
  const frame = (g: Geometry = IDENTITY_GEOMETRY): StillFrame => ({ faces: [], obstacles: [], globalSkin: null, photo: { ...photo, geometry: g }, geometry: g });
  const turned = rotateLeft(IDENTITY_GEOMETRY);
  const square = applyRatio(IDENTITY_GEOMETRY, '1:1', { width: 1536, height: 2048 });

  beforeEach(() => vi.stubGlobal('window', globalThis));

  it('sameDisplayFrame ignores only the geometry', () => {
    expect(sameDisplayFrame(frame(), frame(turned))).toBe(true);
    expect(sameDisplayFrame(frame(), { ...frame(), photo: { ...photo, values: { ...photo.values } } })).toBe(false);
    expect(sameDisplayFrame(frame(), { ...frame(), globalSkin: { smooth: 0.5, rosy: 0, weight: 1 } })).toBe(false);
  });

  it('normal mode draws V through the snapped geometry; the canvas size is the view size', () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, null, bitmap(), { faces: [] });
    s.render(frame(square));
    vi.advanceTimersByTime(20);
    expect(engine.lastInput()!.geometry).toEqual(snapCrop(square, { width: 1536, height: 2048 }));
    expect(s.viewSizeFor(square)).toEqual({ width: 1536, height: 1536 });
  });

  it('crop mode draws identity geometry; a geometry-only change schedules no frame; exports still apply it', () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, null, bitmap(), { faces: [] });
    s.setViewMode('crop');
    s.render(frame());
    vi.advanceTimersByTime(20);
    expect(engine.render).toHaveBeenCalledTimes(1);
    expect(engine.lastInput()!.geometry).toEqual(IDENTITY_GEOMETRY);
    s.render(frame(turned));
    s.render(frame(square));
    vi.advanceTimersByTime(50);
    expect(engine.render).toHaveBeenCalledTimes(1);
    s.exportImageData(frame(square));
    expect(engine.renderToImageData.mock.calls.at(-1)![0].geometry).toEqual(snapCrop(square, { width: 1536, height: 2048 }));
    vi.advanceTimersByTime(20);
    expect(engine.render).toHaveBeenCalledTimes(1); // the autosave's export draws nothing in 裁切 mode
    s.setViewMode('normal');
    vi.advanceTimersByTime(20);
    // leaving 裁切 draws once, in normal mode (V)
    expect(engine.render).toHaveBeenCalledTimes(2);
    expect(engine.lastInput()!.geometry).toEqual(snapCrop(square, { width: 1536, height: 2048 }));
  });

  it('pauseDisplay drops every display frame until it is lifted, which draws once', () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, null, bitmap(), { faces: [] });
    s.pauseDisplay(true);
    s.render(frame());
    s.setCompare(true);
    vi.advanceTimersByTime(50);
    expect(engine.render).not.toHaveBeenCalled();
    expect(engine.renderOriginal).not.toHaveBeenCalled();
    s.pauseDisplay(false);
    vi.advanceTimersByTime(20);
    expect(engine.renderOriginal).toHaveBeenCalledTimes(1);
  });

  it('renderCount counts display frames only', () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, null, bitmap(), { faces: [] });
    const before = window.__meiyan?.renderCount ?? 0;
    s.render(frame());
    vi.advanceTimersByTime(20);
    expect(window.__meiyan!.renderCount).toBe(before + 1);
    s.exportImageData(frame());
    expect(window.__meiyan!.renderCount).toBe(before + 1);
  });

  it('a display frame publishes its passes and counts tone-field rebuilds (skin-cleanup spec §3.2, §4.3)', () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, null, bitmap(), { faces: [] });
    const builds = window.__meiyan!.toneBuilds;
    engine.render.mockReturnValueOnce({ cpuMs: 0, width: 1, height: 1, passes: ['toneField', 'retouch', 'composite'], toneBuilt: true });
    s.render(frame());
    vi.advanceTimersByTime(20);
    expect(window.__meiyan!.passes).toEqual(['toneField', 'retouch', 'composite']);
    expect(window.__meiyan!.toneBuilds).toBe(builds + 1);
    // a cached field: the passes still list it, nothing is rebuilt
    engine.render.mockReturnValueOnce({ cpuMs: 0, width: 1, height: 1, passes: ['toneField', 'retouch', 'composite'], toneBuilt: false });
    s.render(frame(square));
    vi.advanceTimersByTime(20);
    expect(window.__meiyan!.toneBuilds).toBe(builds + 1);
    // an export is not a display frame
    s.exportImageData(frame());
    expect(window.__meiyan!.toneBuilds).toBe(builds + 1);
  });

  it('tileInput carries the raw geometry and the working aspect; bounds lists the body field', () => {
    const s = createStillSession(fakeEngine(), null, bitmap(), { faces: [] });
    const body = makeBodyField();
    s.setBody(body);
    const t = s.tileInput(frame(square));
    expect(t.geometry).toBe(square);
    expect(t.oAspect).toBe(1536 / 2048);
    expect('source' in t).toBe(false);
    expect(s.bounds(frame()).body).toBe(body);
    expect(s.bounds(frame(), null).body).toBeNull();
  });

  it('step 4 (skin-cleanup spec §4.6): every tile carries the working bitmap as toneSource; bounds add the spot hooks', () => {
    const bmp = bitmap();
    const s = createStillSession(fakeEngine(), null, bmp, { faces: [] });
    expect(s.tileInput(frame()).toneSource).toEqual({ source: bmp, width: 1536, height: 2048 });
    expect(s.tileInput(frame()).toneSource!.source).toBe(bmp);
    const plainBounds = s.bounds(frame());
    expect(plainBounds.oSpacePasses).toBe(false);
    expect(plainBounds.spotWindowGrowth).toBeUndefined();
    const spot = { x: 0.5, y: 0.5, r: 0.01, dx: 0.02, dy: 0, owner: null };
    const withSpot: StillFrame = { ...frame(), photo: { ...photo, spots: [spot] } };
    const b = s.bounds(withSpot);
    expect(b.oSpacePasses).toBe(true);
    const win = { x: 0.49, y: 0.49, w: 0.002, h: 0.002 };
    expect(b.spotWindowGrowth!(win)).toEqual(spotWindowGrowth(win, [spot], { width: 1536, height: 2048 }));
  });
});

describe('createStillSession: the short-range retry (step-1 spec §6.5)', () => {
  /** the full-range detector misses the face (a close-up, a cut-off forehead or side), the camera's short-range one finds it */
  function missedByFullRange(found = 1) {
    const tracker = fakeTracker(undefined, false);
    tracker.photoDetector = 'full-range';
    tracker.detectImage.mockImplementation((_img, o) => (o.detector === 'camera' ? Array.from({ length: found }, (_, i) => makeLandmarks(i)) : []));
    return tracker;
  }

  it('an answer without a usable face is asked once more on the short-range detector, and its face is taken', () => {
    vi.stubGlobal('window', {});
    const tracker = missedByFullRange();
    const s = createStillSession(fakeEngine(), tracker, bitmap());
    expect(tracker.detectImage.mock.calls.map((c) => c[1])).toEqual([{ maxFaces: EDIT_DETECT_FACES }, { maxFaces: EDIT_DETECT_FACES, detector: 'camera' }]);
    expect(s.faces).toHaveLength(1);
    expect(s.faceKnown).toBe(true);
    // one face answer (detectCalls), one retry inside it
    expect(window.__meiyan).toMatchObject({ detectCalls: 1, detectRetries: 1, faces: 1 });
  });

  it('no retry when the full-range answer has a face, or when photos already run the short-range detector', () => {
    const found = fakeTracker();
    found.photoDetector = 'full-range';
    createStillSession(fakeEngine(), found, bitmap());
    expect(found.detectImage).toHaveBeenCalledTimes(1);
    const short = fakeTracker(undefined, false);
    short.photoDetector = 'short-range';
    expect(createStillSession(fakeEngine(), short, bitmap()).faces).toHaveLength(0);
    expect(short.detectImage).toHaveBeenCalledTimes(1);
  });

  it('a retry that finds nobody either keeps the first answer: a definite no-face', () => {
    const tracker = missedByFullRange(0);
    const s = createStillSession(fakeEngine(), tracker, bitmap());
    expect(tracker.detectImage).toHaveBeenCalledTimes(2);
    expect(s.faces).toHaveLength(0);
    expect(s.faceKnown).toBe(true);
  });

  it('a session on cached faces asks neither detector', () => {
    const tracker = missedByFullRange();
    createStillSession(fakeEngine(), tracker, bitmap(), { faces: cached() });
    expect(tracker.detectImage).not.toHaveBeenCalled();
  });

  it("detectStill (the completion's probe, §6.5) answers as a session would, without one: the bound session keeps its fields and the debug state its faces (round 4 F6)", () => {
    vi.stubGlobal('window', {});
    const engine = fakeEngine();
    // the session bound to the engine, drawing 美體 and 推臉筆 fields, its one cached face on screen
    const bound = createStillSession(engine, fakeTracker(), bitmap(), { faces: cached(), body: makeBodyField(0.01) });
    bound.setLiquify({ width: 2, height: 2, data: new Float32Array(8), version: 1 });
    bound.render(fr(bound, natural));
    expect(window.__meiyan).toMatchObject({ faces: 1, stillSessions: 1, detectCalls: 0 });
    const tracker = missedByFullRange();
    const d = detectStill(tracker, bitmap());
    // the same answer: the full-range one, then the short-range retry inside it
    expect(tracker.detectImage).toHaveBeenCalledTimes(2);
    expect(d.faces).toHaveLength(1);
    expect(d).toMatchObject({ faceKnown: true, detector: 'full-range', dropped: { tooSmall: 0, overCap: 0 } });
    // nothing released (a probe session's dispose dropped the bound one's field textures), nothing drawn, no session made,
    // and __meiyan still describes the photo on screen; the answer is counted
    expect(engine.releaseFields).not.toHaveBeenCalled();
    expect(window.__meiyan).toMatchObject({ faces: 1, stillSessions: 1, detectCalls: 1, detectRetries: 1 });
    expect(bound.body).not.toBeNull();
    expect(bound.liquify).not.toBeNull();
    // a detect call that throws: no face known (the caller's detectSession makes it unsure)
    const threw = fakeTracker();
    threw.detectImage.mockImplementation(() => {
      throw new Error('graph');
    });
    expect(detectStill(threw, bitmap())).toMatchObject({ faces: [], faceKnown: false, detector: null });
  });
});

describe('createStillSession: the camera seed in no full-range face (D2, step-1 spec §6.5)', () => {
  /**
   * landmarks the mocked adapt turns into a face centred at (cx, 0.5) with an oval of radius r (box 2r × 2r), landmark
   * 0's y and z holding cx and r; with `marks`, every other landmark is those of that mesh (sameHead reads them)
   */
  const lmAt = (cx: number, r = 0.2, marks?: Landmarks478) => {
    const l = makeLandmarks();
    if (marks) l.points.set(marks.points.subarray(3), 3);
    l.points[1] = cx;
    l.points[2] = r;
    return l;
  };
  beforeEach(() => {
    vi.mocked(adapt).mockImplementation((l) => {
      const f = makeFace(0, l.points[1]);
      const r = l.points[2];
      for (let i = 0; i < 36; i++) {
        f.oval[i * 2] = l.points[1] + r * Math.cos((i / 36) * 2 * Math.PI);
        f.oval[i * 2 + 1] = 0.5 + r * Math.sin((i / 36) * 2 * Math.PI);
      }
      return f;
    });
  });
  afterEach(() => {
    vi.mocked(adapt).mockImplementation(() => makeFace(7));
  });
  /** two people: A whole at x 0.25, B at x 0.75 (cut by the edge in the shot): full-range finds A, short-range both */
  function twoFaces(short = [lmAt(0.25), lmAt(0.75)]) {
    const tracker = fakeTracker();
    tracker.photoDetector = 'full-range';
    tracker.detectImage.mockImplementation((_img, o) => (o.detector === 'camera' ? short : [lmAt(0.25)]));
    return tracker;
  }
  const centres = (s: StillSession) => s.faces.map((f) => +(f.box.x + f.box.w / 2).toFixed(2));

  it('a seed in no full-range face asks the short-range detector once and adds the face that holds it', () => {
    vi.stubGlobal('window', {});
    const tracker = twoFaces();
    const s = createStillSession(fakeEngine(), tracker, bitmap(), { faceSeed: { x: 0.75, y: 0.5 } });
    expect(tracker.detectImage.mock.calls.map((c) => c[1])).toEqual([{ maxFaces: EDIT_DETECT_FACES }, { maxFaces: EDIT_DETECT_FACES, detector: 'camera' }]);
    // the union, numbered in display order: A (f0) and B (f1), the seed's face
    expect(centres(s)).toEqual([0.25, 0.75]);
    expect(s.faces.map((f) => f.id)).toEqual(['f0', 'f1']);
    expect(window.__meiyan).toMatchObject({ detectCalls: 1, detectRetries: 1, faces: 2 });
    // and the first answer selects the camera's face
    const a = firstAnswer({ detect: null, prepared: { faces: [...s.faces], obstacles: [...s.obstacles], dropped: s.dropped }, size: { width: 1536, height: 2048 }, v1Body: null, rematch: null, faceSeed: { x: 0.75, y: 0.5 } });
    expect(a.detect.primary).toBe('f1');
  });

  it('only the faces holding the seed are added: another face short-range finds stays out', () => {
    const tracker = twoFaces([lmAt(0.25), lmAt(0.75), lmAt(0.5, 0.05)]);
    const s = createStillSession(fakeEngine(), tracker, bitmap(), { faceSeed: { x: 0.75, y: 0.5 } });
    expect(centres(s)).toEqual([0.25, 0.75]);
  });

  it("a short-range face holding the seed that is a full-range face boxed larger replaces it (IoU > 0.6, sameHead): one face, the seed's", () => {
    const tracker = fakeTracker();
    tracker.photoDetector = 'full-range';
    // full-range: x 0.3–0.7 (padded by 25 %: 0.2–0.8, without the seed at 0.81); short-range: x 0.31–0.75 (0.2–0.86 padded)
    tracker.detectImage.mockImplementation((_img, o) => (o.detector === 'camera' ? [lmAt(0.53, 0.22)] : [lmAt(0.5)]));
    const s = createStillSession(fakeEngine(), tracker, bitmap(), { faceSeed: { x: 0.81, y: 0.5 } });
    expect(s.faces).toHaveLength(1);
    expect(s.faces[0].box.w).toBeCloseTo(0.44, 5);
  });

  it("a full-range face on the seed's head boxed apart from the short-range one (IoU ≤ 0.6), its landmarks on the short-range ones (sameHead), is the same face: the short-range face replaces it; a neighbour stays", () => {
    const tracker = fakeTracker();
    tracker.photoDetector = 'full-range';
    // the seed's head, x 0.3–0.7 short-range. Full-range boxes it smaller and off to the side, x 0.56–0.72: IoU 0.14,
    // and padded by 25 % (0.52–0.76) it misses the seed at the head's centre; its landmarks are the head's, moved a
    // twentieth of an eye span. The neighbour, x 0.06–0.34, overlaps the head's box (cheek to cheek) and is found by both
    const head = sampleFaceAt(0.5, 0.5, 0.4, { width: 1536, height: 2048 });
    const neighbour = lmAt(0.2, 0.14);
    tracker.detectImage.mockImplementation((_img, o) =>
      o.detector === 'camera' ? [lmAt(0.2, 0.14), lmAt(0.5, 0.2, head)] : [neighbour, lmAt(0.64, 0.08, retake(head, { dx: 0.05 }, 1536, 2048))],
    );
    const s = createStillSession(fakeEngine(), tracker, bitmap(), { faceSeed: { x: 0.5, y: 0.5 } });
    expect(tracker.detectImage).toHaveBeenCalledTimes(2);
    // one face per head: the neighbour (f0) and the seed's, its short-range box (f1)
    expect(centres(s)).toEqual([0.2, 0.5]);
    expect(s.faces[1].box.w).toBeCloseTo(0.4, 5);
    const a = firstAnswer({ detect: null, prepared: { faces: [...s.faces], obstacles: [...s.obstacles], dropped: s.dropped }, size: { width: 1536, height: 2048 }, v1Body: null, rematch: null, faceSeed: { x: 0.5, y: 0.5 } });
    expect(a.detect.primary).toBe('f1');
    expect(a.detect.persons.map((p) => p.id)).toEqual(['f0', 'f1']);
  });

  it('a throw in the seed retry keeps the full-range answer, which has faces: a definite answer, not unsure', () => {
    vi.stubGlobal('window', {});
    const tracker = twoFaces();
    tracker.detectImage.mockImplementation((_img, o) => {
      if (o.detector === 'camera') throw new Error('graph rebuild failed');
      return [lmAt(0.25)];
    });
    const s = createStillSession(fakeEngine(), tracker, bitmap(), { faceSeed: { x: 0.75, y: 0.5 } });
    expect(tracker.detectImage).toHaveBeenCalledTimes(2);
    expect(centres(s)).toEqual([0.25]);
    expect(s.faceKnown).toBe(true);
    expect(s.detector).toBe('full-range');
    expect(window.__meiyan).toMatchObject({ detectCalls: 1, detectRetries: 1, faces: 1 });
    expect(window.__meiyan!.lastError).toMatch(/retry.*graph rebuild failed/);
  });

  it('no retry when a full-range face holds the seed, for no seed or 全部, or on short-range photos', () => {
    const held = twoFaces();
    createStillSession(fakeEngine(), held, bitmap(), { faceSeed: { x: 0.3, y: 0.5 } });
    expect(held.detectImage).toHaveBeenCalledTimes(1);
    const none = twoFaces();
    createStillSession(fakeEngine(), none, bitmap(), { faceSeed: null });
    createStillSession(fakeEngine(), none, bitmap());
    expect(none.detectImage).toHaveBeenCalledTimes(2);
    const short = twoFaces();
    short.photoDetector = 'short-range';
    expect(centres(createStillSession(fakeEngine(), short, bitmap(), { faceSeed: { x: 0.75, y: 0.5 } }))).toEqual([0.25]);
    expect(short.detectImage).toHaveBeenCalledTimes(1);
  });

  it('a retry that finds no face holding the seed keeps the full-range answer', () => {
    const tracker = twoFaces([lmAt(0.25)]);
    const s = createStillSession(fakeEngine(), tracker, bitmap(), { faceSeed: { x: 0.75, y: 0.5 } });
    expect(tracker.detectImage).toHaveBeenCalledTimes(2);
    expect(centres(s)).toEqual([0.25]);
  });

  it('the session says which detector answered (D3): full-range, short-range while it is missing, null for cached faces', () => {
    const full = twoFaces();
    expect(createStillSession(fakeEngine(), full, bitmap()).detector).toBe('full-range');
    const short = twoFaces();
    short.photoDetector = 'short-range';
    expect(createStillSession(fakeEngine(), short, bitmap()).detector).toBe('short-range');
    expect(createStillSession(fakeEngine(), full, bitmap(), { faces: cached() }).detector).toBeNull();
    expect(createStillSession(fakeEngine(), null, bitmap()).detector).toBeNull();
  });
});
