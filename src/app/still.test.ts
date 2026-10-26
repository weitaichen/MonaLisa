import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EDIT_DETECT_FACES } from '../config/limits';
import { boxIoU } from '../detect/faces';
import { legacyFrame } from '../edit/frame';
import { splitLegacy } from '../edit/legacy';
import { retake, sampleFaceAt } from '../detect/testMeshes';
import { firstAnswer, handOverEdit } from '../edit/migrate';
import { defaultPhoto, naturalPerson, personFromPreset } from '../edit/state';
import { applyPreset, setParam } from '../engine/params';
import { applyRatio, IDENTITY_GEOMETRY, rotateLeft, snapCrop } from '../geometry/view';
import { spotWindowGrowth } from '../media/exportPlan';
import { adapt } from '../tracking/adapter111';
import type { BeautyParams, Geometry, Landmarks478, PhotoParams, PxRect, Rect, StillFrame } from '../types';
import { createStillSession, detectStill, sameDisplayFrame, zoomCrop, type StillSession } from './still';
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

describe('createStillSession: the hand-over retries (camera per-person spec §5.4, K21)', () => {
  beforeEach(() => {
    // a face at (lm0.x, lm0.y) with radius lm0.z (a fraction of the width), square in pixels: mapLandmarks moves it like a real face
    vi.mocked(adapt).mockImplementation((l, w, h) => {
      const f = makeFace(0, l.points[0]);
      for (let i = 0; i < 36; i++) {
        f.oval[i * 2] = l.points[0] + l.points[2] * Math.cos((i / 36) * 2 * Math.PI);
        f.oval[i * 2 + 1] = l.points[1] + l.points[2] * (w / h) * Math.sin((i / 36) * 2 * Math.PI);
      }
      return f;
    });
    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        constructor(
          public width: number,
          public height: number,
        ) {}
        getContext() {
          return { drawImage: vi.fn() };
        }
      },
    );
  });
  afterEach(() => {
    vi.mocked(adapt).mockImplementation(() => makeFace(7));
  });
  const face = (x: number, y: number, r: number) => {
    const l = makeLandmarks();
    l.points.set([x, y, r], 0);
    return l;
  };
  const nat = naturalPerson();
  /** an edited camera person's box (params set): the retries ask for it */
  const ed = (box: Rect) => ({ box, params: nat });
  const far = { x: 0.59375, y: 0.3, w: 0.0625, h: 0.046875 }; // 96 px wide, centre x 960 px
  const xs = (s: StillSession) => s.faces.map((f) => f.box.x + f.box.w / 2);
  /** each detectImage call: the detector asked ('photo' when none is named) and the input's size, read at call time */
  function record(tracker: ReturnType<typeof fakeTracker>, answer: (img: unknown, o: { detector?: string }) => Landmarks478[]) {
    const calls: { detector: string; size: [number, number] }[] = [];
    tracker.detectImage.mockImplementation((img, o) => {
      const v = img as unknown as { width: number; height: number };
      calls.push({ detector: o.detector ?? 'photo', size: [v.width, v.height] });
      return answer(img, o);
    });
    return calls;
  }
  it('a box no full-range face holds gets one full-range detection on a crop of side box width / 0.25; the face holding its centre joins; the crop is freed', () => {
    const bmp = bitmap();
    const tracker = fakeTracker();
    tracker.photoDetector = 'full-range';
    const calls = record(tracker, (img) => (img === bmp ? [face(0.25, 0.5, 0.15)] : [face(0.5, 0.5, 0.125)]));
    const s = createStillSession(fakeEngine(), tracker, bmp, { handOver: [ed(far)] });
    expect(calls[1]).toEqual({ detector: 'photo', size: [384, 384] });
    expect(tracker.detectImage.mock.calls[1][1]).toEqual({ maxFaces: EDIT_DETECT_FACES });
    expect(xs(s)).toEqual([expect.closeTo(0.25, 6), expect.closeTo(0.625, 6)]);
    // its pixels go at once (round-1 review C15), as grabOriginalFrame's copy does
    const crop = tracker.detectImage.mock.calls[1][0] as unknown as { width: number; height: number };
    expect([crop.width, crop.height]).toEqual([0, 0]);
  });
  it('zoomCrop moves the crop inside the image at an edge', () => {
    expect(zoomCrop({ x: 0.97, y: 0.97, w: 0.02, h: 0.015 }, 1536, 2048)).toEqual({ x: 1536 - 123, y: 2048 - 123, w: 123, h: 123 });
  });
  it('a box twice full-range’s floor or more and the faceSeed share one short-range pass (missed for its cut or pose, not its size)', () => {
    const bmp = bitmap();
    const tracker = fakeTracker();
    tracker.photoDetector = 'full-range';
    tracker.detectImage.mockImplementation((_img, o) => (o.detector === 'camera' ? [face(0.25, 0.5, 0.15), face(0.75, 0.5, 0.2)] : [face(0.25, 0.5, 0.15)]));
    const big = { x: 0.55, y: 0.4, w: 0.4, h: 0.3 }; // 614 px ≥ 2 × 0.08 × 2048
    const s = createStillSession(fakeEngine(), tracker, bmp, { handOver: [ed(big)], faceSeed: { x: 0.75, y: 0.5 } });
    expect(tracker.detectImage.mock.calls.map((c) => c[1])).toEqual([{ maxFaces: EDIT_DETECT_FACES }, { maxFaces: EDIT_DETECT_FACES, detector: 'camera' }]);
    expect(xs(s)).toEqual([expect.closeTo(0.25, 6), expect.closeTo(0.75, 6)]);
  });
  it('nothing more runs when every seed is found; a box its zoomed retry misses is left out (firstAnswer counts it)', () => {
    const bmp = bitmap();
    const found = fakeTracker();
    found.photoDetector = 'full-range';
    found.detectImage.mockImplementation(() => [face(0.25, 0.5, 0.15)]);
    createStillSession(fakeEngine(), found, bmp, { handOver: [ed({ x: 0.2, y: 0.45, w: 0.1, h: 0.075 })] });
    expect(found.detectImage).toHaveBeenCalledTimes(1);
    const missed = fakeTracker();
    missed.photoDetector = 'full-range';
    missed.detectImage.mockImplementation((img) => (img === bmp ? [face(0.25, 0.5, 0.15)] : []));
    // 96 px, under the short-range detector's floor on the whole photo (0.11 × 2048): no short-range pass either
    const s = createStillSession(fakeEngine(), missed, bmp, { handOver: [ed(far)] });
    expect(missed.detectImage).toHaveBeenCalledTimes(2);
    expect(xs(s)).toEqual([expect.closeTo(0.25, 6)]);
  });

  describe('round 1 (C2): the size that picks the retry is the face over the long edge, for 3:4 and 9:16 shots and cut faces', () => {
    /** the user, found by full-range; the friend at `friend`, found by the short-range detector only (cut by the left edge) */
    function cutFriend(bmp: ImageBitmap, friend: Rect) {
      const aspect = bmp.width / bmp.height;
      const c = { x: friend.x + friend.w / 2, y: friend.y + friend.h / 2 };
      const user = face(0.6, 0.5, 0.15);
      const tracker = fakeTracker();
      tracker.photoDetector = 'full-range';
      const calls = record(tracker, (img, o) => (o.detector === 'camera' ? [user, face(c.x, c.y, friend.w / 2)] : img === bmp ? [user] : []));
      return { calls, tracker, box: { ...friend, h: friend.w * aspect } };
    }
    it('3:4 (1080 × 1440): a face 30 % of the width cut by the edge (22.5 % of the long edge) takes the short-range pass, not a zoom of 1.1×', () => {
      const bmp = bitmap(1080, 1440);
      const { calls, tracker, box } = cutFriend(bmp, { x: -0.03, y: 0.4, w: 0.3, h: 0 });
      const s = createStillSession(fakeEngine(), tracker, bmp, { handOver: [ed(box)] });
      expect(calls.map((c) => c.detector)).toEqual(['photo', 'camera']);
      // the friend's box clipped to the photo (x 0–0.27, ovalBox)
      expect(xs(s)).toEqual([expect.closeTo(0.135, 6), expect.closeTo(0.6, 6)]);
    });
    it('9:16 (1080 × 1920): 30 % of the width (16.9 % of the long edge) is a short-range face too', () => {
      const bmp = bitmap(1080, 1920);
      const { calls, tracker, box } = cutFriend(bmp, { x: -0.03, y: 0.4, w: 0.3, h: 0 });
      const s = createStillSession(fakeEngine(), tracker, bmp, { handOver: [ed(box)] });
      expect(calls.map((c) => c.detector)).toEqual(['photo', 'camera']);
      expect(xs(s)).toHaveLength(2);
    });
    it('9:16: 26 % of the width (14.6 % of the long edge) is zoomed first; the zoom missing it, the short-range pass, which can see it, finds it', () => {
      const bmp = bitmap(1080, 1920);
      const { calls, tracker, box } = cutFriend(bmp, { x: -0.03, y: 0.4, w: 0.26, h: 0 });
      const s = createStillSession(fakeEngine(), tracker, bmp, { handOver: [ed(box)] });
      expect(calls.map((c) => c.detector)).toEqual(['photo', 'photo', 'camera']);
      expect(xs(s)).toEqual([expect.closeTo(0.115, 6), expect.closeTo(0.6, 6)]);
    });
  });

  it('round 1 (C15): the zoom runs first, on the full-range graph; a faceSeed in a small edited box is that box’s, so no short-range pass runs for a face it cannot find', () => {
    const bmp = bitmap();
    const tracker = fakeTracker();
    tracker.photoDetector = 'full-range';
    const calls = record(tracker, (img) => (img === bmp ? [face(0.25, 0.5, 0.15)] : [face(0.5, 0.5, 0.125)]));
    // far: 96 px, 4.7 % of the long edge; the seed its centre (the camera's target is this edited person)
    const s = createStillSession(fakeEngine(), tracker, bmp, { handOver: [ed(far)], faceSeed: { x: far.x + far.w / 2, y: far.y + far.h / 2 } });
    expect(calls.map((c) => c.detector)).toEqual(['photo', 'photo']);
    expect(xs(s)).toEqual([expect.closeTo(0.25, 6), expect.closeTo(0.625, 6)]);
    // the zoom missing it too: still no short-range pass (the face is under that detector's floor on the whole photo)
    const lost = fakeTracker();
    lost.photoDetector = 'full-range';
    const none = record(lost, (img) => (img === bmp ? [face(0.25, 0.5, 0.15)] : []));
    createStillSession(fakeEngine(), lost, bmp, { handOver: [ed(far)], faceSeed: { x: far.x + far.w / 2, y: far.y + far.h / 2 } });
    expect(none.map((c) => c.detector)).toEqual(['photo', 'photo']);
    // a zoom and a short-range pass in one answer: the zoom first, so the graph changes detector once
    const both = fakeTracker();
    both.photoDetector = 'full-range';
    const order = record(both, (img, o) => (o.detector === 'camera' ? [face(0.25, 0.5, 0.15), face(0.75, 0.5, 0.2)] : img === bmp ? [face(0.25, 0.5, 0.15)] : [face(0.5, 0.5, 0.125)]));
    const s2 = createStillSession(fakeEngine(), both, bmp, { handOver: [ed({ x: 0.55, y: 0.35, w: 0.4, h: 0.3 }), ed(far)] });
    expect(order.map((c) => c.detector)).toEqual(['photo', 'photo', 'camera']);
    expect(xs(s2)).toEqual([expect.closeTo(0.25, 6), expect.closeTo(0.625, 6), expect.closeTo(0.75, 6)]);
  });

  it('round 1 (C8): while photos run the short-range detector, a lost box is still zoomed (a quarter of the crop is over its floor); no repeat of the whole-photo pass', () => {
    const bmp = bitmap();
    const tracker = fakeTracker();
    tracker.photoDetector = 'short-range';
    const calls = record(tracker, (img) => (img === bmp ? [face(0.25, 0.5, 0.15)] : [face(0.5, 0.5, 0.125)]));
    const s = createStillSession(fakeEngine(), tracker, bmp, { handOver: [ed(far)] });
    expect(calls).toEqual([
      { detector: 'photo', size: [1536, 2048] },
      { detector: 'photo', size: [384, 384] },
    ]);
    expect(xs(s)).toEqual([expect.closeTo(0.25, 6), expect.closeTo(0.625, 6)]);
    expect(s.detector).toBe('short-range');
    // no face at all on a short-range answer: the boxes are zoomed, and no 'camera' pass repeats the detection
    const none = fakeTracker();
    none.photoDetector = 'short-range';
    const c2 = record(none, (img) => (img === bmp ? [] : [face(0.5, 0.5, 0.125)]));
    expect(xs(createStillSession(fakeEngine(), none, bmp, { handOver: [ed(far)] }))).toEqual([expect.closeTo(0.625, 6)]);
    expect(c2.map((c) => c.detector)).toEqual(['photo', 'photo']);
  });

  describe('round 1 (C10): which boxes are retried is firstAnswer’s one-to-one pairing, obstacles included', () => {
    // Y at x 0.4–0.6 (padded 0.35–0.65); X, 96 px, its centre at x 0.640625: inside Y's padded box, apart from Y's own
    const Y = { x: 0.4, y: 0.425, w: 0.2, h: 0.15 };
    const X = { x: 0.609375, y: 0.4765625, w: 0.0625, h: 0.046875 };
    function scene() {
      const bmp = bitmap();
      const tracker = fakeTracker();
      tracker.photoDetector = 'full-range';
      const calls = record(tracker, (img) => (img === bmp ? [face(0.5, 0.5, 0.1)] : [face(0.5, 0.5, 0.125)]));
      return { bmp, tracker, calls };
    }
    it('Y claimed by its own box: X, whose centre Y’s padded box holds, is retried and found', () => {
      const { bmp, tracker, calls } = scene();
      const s = createStillSession(fakeEngine(), tracker, bmp, { handOver: [ed(Y), ed(X)] });
      expect(calls.map((c) => c.detector)).toEqual(['photo', 'photo']);
      expect(xs(s)).toEqual([expect.closeTo(0.5, 6), expect.closeTo(0.640625, 6)]);
    });
    it('Y a person never edited (params null): it still claims its face, so X is retried; a box of such a person is never retried itself', () => {
      const { bmp, tracker, calls } = scene();
      const s = createStillSession(fakeEngine(), tracker, bmp, { handOver: [{ box: Y, params: null }, ed(X)] });
      expect(calls).toHaveLength(2);
      expect(xs(s)).toHaveLength(2);
      const lone = scene();
      createStillSession(fakeEngine(), lone.tracker, lone.bmp, { handOver: [{ box: far, params: null }] });
      expect(lone.calls).toHaveLength(1);
    });
    it('a box on an obstacle (the eleventh face, over the cap) is claimed by it: no retry, which would find it over the cap again', () => {
      const bmp = bitmap();
      const tracker = fakeTracker();
      tracker.photoDetector = 'full-range';
      const eleven = [...Array.from({ length: 10 }, (_, i) => face(0.05 + i * 0.09, 0.5, 0.035)), face(0.95, 0.5, 0.02)];
      const calls = record(tracker, (img) => (img === bmp ? eleven : [face(0.5, 0.5, 0.125)]));
      const s = createStillSession(fakeEngine(), tracker, bmp, { handOver: [ed({ x: 0.93, y: 0.485, w: 0.04, h: 0.03 })] });
      expect(s.obstacles).toHaveLength(1);
      expect(calls).toHaveLength(1);
    });
  });

  describe('round 2: what a retry may count as the box’s face (D6, D8)', () => {
    // a 3:4 shot, 1080 × 1440; a face at (x, y) with radius r (a fraction of the width), square in px
    const W = 1080;
    const H = 1440;
    const boxOf = (x: number, y: number, r: number): Rect => ({ x: x - r, y: y - r * (W / H), w: 2 * r, h: 2 * r * (W / H) });
    /** the face at (x, y, r) of the photo as a detection on `crop` (px) answers it */
    const inCrop = (x: number, y: number, r: number, crop: PxRect) => face((x * W - crop.x) / crop.w, (y * H - crop.y) / crop.h, (r * W) / crop.w);
    const user = [0.25, 0.5, 0.12] as const;
    it('D6: a held box’s zoom adds only a face of its size in its place (a blink), never a smaller stranger at its spot', () => {
      const A = [0.5, 0.4, 0.06] as const; // held at the shutter, 130 px (9 % of the long edge): zoomed
      const crop = zoomCrop(boxOf(...A), W, H);
      const run = (inZoom: readonly [number, number, number]) => {
        const bmp = bitmap(W, H);
        const tracker = fakeTracker();
        tracker.photoDetector = 'full-range';
        tracker.detectImage.mockImplementation((img, o) => (o.detector === 'camera' || img === bmp ? [face(...user)] : [inCrop(...inZoom, crop)]));
        return createStillSession(fakeEngine(), tracker, bmp, { handOver: [{ box: boxOf(...user), params: null }, { box: boxOf(...A), params: nat, held: true }] });
      };
      // a far face (43 px, under the live floor: never tracked) right behind where A stood: not A
      expect(xs(run([0.505, 0.402, 0.02]))).toEqual([expect.closeTo(0.25, 6)]);
      // A, who blinked at the shutter: the same face in the same place
      expect(xs(run(A))).toEqual([expect.closeTo(0.25, 6), expect.closeTo(0.5, 6)]);
    });
    it('round 3 (E5): a stale box (unseen at the shutter since a no-answer, the last answer’s box) is retried as a guess, as a held one: never a smaller face at its spot', () => {
      const A = [0.5, 0.4, 0.06] as const;
      const crop = zoomCrop(boxOf(...A), W, H);
      const run = (inZoom: readonly [number, number, number]) => {
        const bmp = bitmap(W, H);
        const tracker = fakeTracker();
        tracker.photoDetector = 'full-range';
        tracker.detectImage.mockImplementation((img, o) => (o.detector === 'camera' || img === bmp ? [face(...user)] : [inCrop(...inZoom, crop)]));
        return createStillSession(fakeEngine(), tracker, bmp, { handOver: [{ box: boxOf(...user), params: null }, { box: boxOf(...A), params: nat, stale: true }] });
      };
      expect(xs(run([0.505, 0.402, 0.02]))).toEqual([expect.closeTo(0.25, 6)]);
      expect(xs(run(A))).toEqual([expect.closeTo(0.25, 6), expect.closeTo(0.5, 6)]);
    });
    it('round 4 (F2): a stale box’s zoom adds their face moved 0.4 of a width since the no-answer (a face of its size near its place), as the pairing would give it; a held box’s does not', () => {
      const A = [0.5, 0.4, 0.06] as const; // their last box, 130 px: zoomed
      const moved = [0.5 + 0.4 * 0.12, 0.4 + 0.4 * 0.12 * (W / H), 0.06] as const; // 0.4 of a width down and right
      expect(boxIoU(boxOf(...A), boxOf(...moved))).toBeLessThan(0.3);
      const crop = zoomCrop(boxOf(...A), W, H);
      const run = (flag: 'stale' | 'held') => {
        const bmp = bitmap(W, H);
        const tracker = fakeTracker();
        tracker.photoDetector = 'full-range';
        tracker.detectImage.mockImplementation((img, o) => (o.detector === 'camera' || img === bmp ? [face(...user)] : [inCrop(...moved, crop)]));
        const handOver = [{ box: boxOf(...user), params: null }, { box: boxOf(...A), params: nat, [flag]: true }];
        const s = createStillSession(fakeEngine(), tracker, bmp, { handOver });
        const a = firstAnswer({ detect: null, prepared: { faces: [...s.faces], obstacles: [...s.obstacles], dropped: s.dropped }, size: { width: W, height: H }, v1Body: null, rematch: null, faceSeed: null, handOver });
        return { xs: xs(s), missed: a.handOverMissed };
      };
      expect(run('stale')).toEqual({ xs: [expect.closeTo(0.25, 6), expect.closeTo(moved[0], 6)], missed: 0 });
      expect(run('held')).toEqual({ xs: [expect.closeTo(0.25, 6)], missed: 0 });
      // a smaller face where they were stays someone else's (E5, above)
    });
    it('round 3 (E4): a held person on their own face keeps it from a found neighbour the editor missed, whose centre its padded box holds; the neighbour is retried, then counted', () => {
      const A = [0.45, 0.4, 0.06] as const; // held at the shutter (a blink), 130 px: the editor finds their face in place
      const B = [0.52, 0.4, 0.05] as const; // found at the shutter beside A, partly behind; the editor misses B
      const ab = boxOf(...A);
      const bb = boxOf(...B);
      const ref = personFromPreset('refined', 1);
      const opened = handOverEdit({ photo: defaultPhoto(), persons: [], ambient: null });
      for (const bParams of [nat, null]) {
        const bmp = bitmap(W, H);
        const tracker = fakeTracker();
        tracker.photoDetector = 'full-range';
        const calls = record(tracker, (img) => (img === bmp ? [face(...A)] : [inCrop(...A, zoomCrop(bb, W, H))]));
        const handOver = [{ box: ab, params: ref, held: true }, { box: bb, params: bParams }];
        const s = createStillSession(fakeEngine(), tracker, bmp, { handOver });
        // B's zoom (when edited) finds only A's face again, which A's box claimed: no face for B
        expect(calls.map((c) => c.detector)).toEqual(bParams ? ['photo', 'photo'] : ['photo']);
        expect(xs(s)).toEqual([expect.closeTo(0.45, 6)]);
        const a = firstAnswer({ detect: null, prepared: { faces: [...s.faces], obstacles: [...s.obstacles], dropped: s.dropped }, size: { width: W, height: H }, v1Body: null, rematch: null, faceSeed: null, handOver });
        const owner = a.detect.persons.find((p) => p.face === s.faces[0].id)!.id;
        expect(a.rebase(opened).persons[owner]).toEqual(ref);
        expect(a.handOverMissed).toBe(bParams ? 1 : 0);
      }
    });
    it('D6: a large held box’s short-range pass adds only a face of its size in its place', () => {
      const A = [0.65, 0.5, 0.13] as const; // held, 281 px (19.5 % of the long edge): the short-range pass
      const run = (short: readonly [number, number, number]) => {
        const bmp = bitmap(W, H);
        const tracker = fakeTracker();
        tracker.photoDetector = 'full-range';
        const calls = record(tracker, (_img, o) => (o.detector === 'camera' ? [face(...user), face(...short)] : [face(...user)]));
        const s = createStillSession(fakeEngine(), tracker, bmp, { handOver: [{ box: boxOf(...A), params: nat, held: true }] });
        return { s, calls };
      };
      const stranger = run([0.66, 0.5, 0.05]);
      expect(stranger.calls.map((c) => c.detector)).toEqual(['photo', 'camera']);
      expect(xs(stranger.s)).toEqual([expect.closeTo(0.25, 6)]);
      expect(xs(run(A).s)).toEqual([expect.closeTo(0.25, 6), expect.closeTo(0.65, 6)]);
    });
    it('D8: a zoom that finds only the neighbour another box claimed found nothing for its box: the short-range pass, which can see it, runs for it', () => {
      const Y = [0.5, 0.5, 0.1] as const; // found at the shutter, claimed by its own box
      const X = [0.63, 0.5, 0.085] as const; // edited, 184 px (12.8 %): zoomed; its centre in Y's padded box, its head behind Y's
      const xb = boxOf(...X);
      const crop = zoomCrop(xb, W, H);
      for (const yParams of [null, nat]) {
        const bmp = bitmap(W, H);
        const tracker = fakeTracker();
        tracker.photoDetector = 'full-range';
        const calls = record(tracker, (img, o) => (o.detector === 'camera' ? [face(...Y), face(...X)] : img === bmp ? [face(...Y)] : [inCrop(...Y, crop)]));
        const s = createStillSession(fakeEngine(), tracker, bmp, { handOver: [{ box: boxOf(...Y), params: yParams }, { box: xb, params: nat }] });
        expect(calls.map((c) => c.detector)).toEqual(['photo', 'photo', 'camera']);
        expect(xs(s)).toEqual([expect.closeTo(0.5, 6), expect.closeTo(0.63, 6)]);
      }
    });
  });
});
