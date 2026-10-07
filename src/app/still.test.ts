import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPreset, setParam } from '../engine/params';
import { adapt } from '../tracking/adapter111';
import { createStillSession } from './still';
import { fakeEngine, fakeTracker, makeFace, stubRaf } from './testFakes';

vi.mock('../tracking/adapter111', () => ({
  adapt: vi.fn(() => makeFace(7)),
}));

function bitmap(width = 1536, height = 2048) {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap & { close: ReturnType<typeof vi.fn> };
}

const natural = applyPreset('natural');

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
    expect(tracker.detectImage).toHaveBeenCalledWith(bmp);
    expect(tracker.detectVideo).not.toHaveBeenCalled();
    expect(adapt).toHaveBeenCalledWith(expect.anything(), 1536, 2048);
    expect(s.face).not.toBeNull();
    expect(s.width).toBe(1536);
    expect(s.height).toBe(2048);
    s.render(natural);
    s.render(natural);
    vi.advanceTimersByTime(100);
    expect(tracker.detectImage).toHaveBeenCalledTimes(1);
  });

  it('faceWeight is 1 with a face, 0 without, and no tracker means no face', () => {
    const e1 = fakeEngine();
    const withFace = createStillSession(e1, fakeTracker(), bitmap());
    withFace.render(natural);
    vi.advanceTimersByTime(20);
    expect(e1.lastInput()).toMatchObject({ faceWeight: 1, width: 1536, height: 2048 });
    expect(e1.lastInput()!.face).toBe(withFace.face);

    const e2 = fakeEngine();
    const noFace = createStillSession(e2, fakeTracker(undefined, false), bitmap());
    expect(noFace.face).toBeNull();
    noFace.render(natural);
    vi.advanceTimersByTime(20);
    expect(e2.lastInput()).toMatchObject({ faceWeight: 0, face: null });

    const e3 = fakeEngine();
    const basic = createStillSession(e3, null, bitmap());
    expect(basic.face).toBeNull();
    basic.render(natural);
    vi.advanceTimersByTime(20);
    expect(e3.lastInput()).toMatchObject({ faceWeight: 0, face: null });
  });

  it('a throwing detector degrades to no face', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const tracker = fakeTracker();
    tracker.detectImage.mockImplementation(() => {
      throw new Error('image mode');
    });
    const s = createStillSession(fakeEngine(), tracker, bitmap());
    expect(s.face).toBeNull();
  });

  it('coalesces renders to one per animation frame with the latest params, in still mode, unmirrored', () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, fakeTracker(), bitmap());
    const a = setParam(natural, 'skin.smooth', 0.1);
    const b = setParam(natural, 'skin.smooth', 0.9);
    s.render(natural);
    s.render(a);
    s.render(b);
    expect(engine.render).not.toHaveBeenCalled();
    vi.advanceTimersByTime(16);
    expect(engine.render).toHaveBeenCalledTimes(1);
    expect(engine.render.mock.calls[0][0].params).toBe(b);
    expect(engine.render.mock.calls[0][1]).toEqual({ still: true });
    expect(engine.setOptions).toHaveBeenLastCalledWith({ mirror: false });
    vi.advanceTimersByTime(100);
    expect(engine.render).toHaveBeenCalledTimes(1); // nothing new requested
    s.render(a);
    vi.advanceTimersByTime(16);
    expect(engine.render).toHaveBeenCalledTimes(2);
  });

  it('re-renders once engine.ready resolves (static textures may upload after the first render)', async () => {
    let ready!: () => void;
    const engine = fakeEngine();
    (engine as { ready: Promise<void> }).ready = new Promise<void>((r) => (ready = r));
    const s = createStillSession(engine, fakeTracker(), bitmap());
    s.render(natural);
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
    s.render(glow);
    s.render(glow);
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
    s.render(natural);
    vi.advanceTimersByTime(16);
    s.setCompare(true);
    vi.advanceTimersByTime(16);
    expect(engine.renderOriginal).toHaveBeenCalledTimes(1);
    expect(engine.renderOriginal.mock.calls[0]).toEqual([
      { source: expect.anything(), width: 1536, height: 2048 },
      { still: true },
    ]);
    s.setCompare(false);
    vi.advanceTimersByTime(16);
    expect(engine.render).toHaveBeenCalledTimes(2);
  });

  it('exportImageData renders full resolution, never mirrored, and redraws the display', () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, fakeTracker(), bitmap());
    s.render(natural);
    vi.advanceTimersByTime(16);
    const out = s.exportImageData(natural);
    expect(out.width).toBe(1536);
    const [input, opts] = engine.renderToImageData.mock.calls[0];
    expect(input).toMatchObject({ width: 1536, height: 2048, faceWeight: 1, params: natural });
    expect(opts).toEqual({ mirror: false });
    vi.advanceTimersByTime(16);
    expect(engine.render).toHaveBeenCalledTimes(2);
  });

  it('retries a render while the context is lost', () => {
    const engine = fakeEngine();
    engine.lost = true;
    const s = createStillSession(engine, fakeTracker(), bitmap());
    s.render(natural);
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
    s.render(natural);
    s.dispose();
    expect(bmp.close).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(engine.render).not.toHaveBeenCalled();
    s.render(natural);
    vi.advanceTimersByTime(100);
    expect(engine.render).not.toHaveBeenCalled();
    expect(() => s.exportImageData(natural)).toThrow(/disposed/);
    s.dispose();
    expect(bmp.close).toHaveBeenCalledTimes(1);
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
    s.render(glow);
    await Promise.resolve();
    vi.advanceTimersByTime(16);
    const renders = engine.render.mock.calls.length;
    expect(engine.loadFilter).toHaveBeenCalledTimes(1);
    engine.canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(engine.loadFilter).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(16);
    expect(engine.render.mock.calls.length).toBeGreaterThan(renders);
    expect(engine.lastInput()!.params).toBe(glow);
    // after dispose the listener is gone
    s.dispose();
    engine.canvas.dispatchEvent(new Event('webglcontextrestored'));
    expect(engine.loadFilter).toHaveBeenCalledTimes(2);
  });

  it('prepareExport waits for the filter LUT and never rejects', async () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, fakeTracker(), bitmap());
    await expect(s.prepareExport(natural)).resolves.toBeUndefined();
    let done!: () => void;
    engine.loadFilter.mockImplementationOnce(() => new Promise<void>((r) => (done = r)));
    let settled = false;
    const p = s.prepareExport(applyPreset('glow')).then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    done();
    await p;
    expect(settled).toBe(true);
    engine.loadFilter.mockImplementationOnce(() => Promise.reject(new Error('404')));
    await expect(s.prepareExport(applyPreset('glow'))).resolves.toBeUndefined();
  });

  it('after a restore, redraws once the new engine.ready resolves and prepareExport waits for it', async () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, fakeTracker(), bitmap());
    s.render(natural);
    await Promise.resolve();
    vi.advanceTimersByTime(16);
    // the engine swaps in a fresh `ready` on restore (its listener runs before the session's)
    let ready!: () => void;
    (engine as { ready: Promise<void> }).ready = new Promise<void>((r) => (ready = r));
    engine.canvas.dispatchEvent(new Event('webglcontextrestored'));
    vi.advanceTimersByTime(16);
    const renders = engine.render.mock.calls.length;
    let settled = false;
    const p = s.prepareExport(natural).then(() => (settled = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(s.exportReady(natural)).toBe(false);
    ready();
    await p;
    expect(s.exportReady(natural)).toBe(true);
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
    const p = s.prepareExport(glow).then(() => (settled = true));
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
    expect(s.exportReady(glow)).toBe(true);
  });

  it('prepareExport resolves (no retry) while the context is still lost', async () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, fakeTracker(), bitmap());
    engine.lost = true;
    (engine as { ready: Promise<void> }).ready = Promise.resolve();
    await expect(s.prepareExport(applyPreset('glow'))).resolves.toBeUndefined();
    expect(s.exportReady(applyPreset('glow'))).toBe(false);
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
    s.render(glow);
    expect(s.exportReady(natural)).toBe(false);
    ready();
    await Promise.resolve();
    await Promise.resolve();
    expect(s.exportReady(natural)).toBe(true);
    expect(s.exportReady(glow)).toBe(false);
    lut(new Error('404')); // a failed LUT is skipped by the preview too: the export then matches it
    await Promise.resolve();
    await Promise.resolve();
    expect(s.exportReady(glow)).toBe(true);
  });

  it('stopDisplay: no more display renders, exports still work', () => {
    const engine = fakeEngine();
    const s = createStillSession(engine, fakeTracker(), bitmap());
    s.render(natural);
    s.stopDisplay();
    vi.advanceTimersByTime(100);
    expect(engine.render).not.toHaveBeenCalled();
    expect(s.exportImageData(natural).width).toBe(1536);
    s.render(natural);
    vi.advanceTimersByTime(100);
    expect(engine.render).not.toHaveBeenCalled();
  });

  it('an injected face skips detection; faceKnown is false only when the detector threw', () => {
    const tracker = fakeTracker();
    const known = makeFace(3);
    const s = createStillSession(fakeEngine(), tracker, bitmap(), { face: known });
    expect(tracker.detectImage).not.toHaveBeenCalled();
    expect(s.face).toBe(known);
    expect(s.faceKnown).toBe(true);
    const none = createStillSession(fakeEngine(), tracker, bitmap(), { face: null });
    expect(tracker.detectImage).not.toHaveBeenCalled();
    expect(none.face).toBeNull();
    expect(createStillSession(fakeEngine(), fakeTracker(undefined, false), bitmap()).faceKnown).toBe(true);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    tracker.detectImage.mockImplementation(() => {
      throw new Error('graph');
    });
    const threw = createStillSession(fakeEngine(), tracker, bitmap());
    expect(threw.face).toBeNull();
    expect(threw.faceKnown).toBe(false);
  });

  it('a throwing render is reported, not thrown into rAF', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const engine = fakeEngine();
    engine.render.mockImplementationOnce(() => {
      throw new Error('gl');
    });
    const s = createStillSession(engine, fakeTracker(), bitmap());
    s.render(natural);
    expect(() => vi.advanceTimersByTime(16)).not.toThrow();
    expect(err).toHaveBeenCalled();
    s.render(natural);
    vi.advanceTimersByTime(16);
    expect(engine.render).toHaveBeenCalledTimes(2);
  });
});
