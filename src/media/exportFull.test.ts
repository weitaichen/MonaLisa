import { describe, expect, it, vi } from 'vitest';
import { IDENTITY_GEOMETRY } from '../geometry/view';
import { defaultPhoto } from '../edit/state';
import type { ExportPlan } from './exportPlan';
import { ExportError, runTiledExport, type RunnerDeps, type TileInputBase } from './exportFull';

const plan: ExportPlan = {
  mode: 'tiled',
  format: 'jpeg',
  quality: 0.95,
  width: 8,
  height: 4,
  decode: { width: 8, height: 4 },
  fullShortEdge: 4,
  tile: 4,
  tiles: [
    { out: { x: 0, y: 0, w: 4, h: 4 }, buf: { x: 0, y: 0, w: 8, h: 4 }, win: { x: 0, y: 0, w: 8, h: 4 } },
    { out: { x: 4, y: 0, w: 4, h: 4 }, buf: { x: 0, y: 0, w: 8, h: 4 }, win: { x: 0, y: 0, w: 8, h: 4 } },
  ],
  fallback: null,
};
const input = { faces: [], obstacles: [], globalSkin: null, photo: defaultPhoto(), geometry: IDENTITY_GEOMETRY, oAspect: 2 } as unknown as TileInputBase;
const working = { width: 4, height: 2 };

function fakes(decoded = { width: 8, height: 4 }) {
  const log: string[] = [];
  const full = { width: decoded.width, height: decoded.height, close: vi.fn(() => log.push('close full')) };
  const canvas = {
    put: vi.fn((_img: ImageData, x: number) => log.push(`put ${x}`)),
    encode: vi.fn(async (q?: number) => {
      log.push(`encode ${q}`);
      return new Blob(['x']);
    }),
    release: vi.fn(() => log.push('release canvas')),
  };
  const renderer = {
    renderTile: vi.fn((i: { sourceWindow?: unknown; output?: unknown }, read: { w: number; h: number }) => {
      log.push('tile');
      return { width: read.w, height: read.h, data: new Uint8ClampedArray(read.w * read.h * 4), input: i } as unknown as ImageData;
    }),
    releaseBuffers: vi.fn(() => log.push('releaseBuffers')),
  };
  const deps: RunnerDeps = {
    decode: vi.fn(async () => {
      log.push('decode');
      return full as unknown as ImageBitmap;
    }),
    crop: vi.fn(async () => ({ width: 8, height: 4, close: vi.fn() }) as unknown as ImageBitmap),
    createCanvas: vi.fn(() => canvas),
    nextFrame: vi.fn(async () => undefined),
    sleep: vi.fn(async () => undefined),
    writeGuard: vi.fn(() => log.push('guard')),
    clearGuard: vi.fn(() => log.push('clear guard')),
  };
  return { log, full, canvas, renderer, deps };
}

describe('runTiledExport (S §4.4)', () => {
  it('guard → decode → tiles (progress) → close → release → encode → clear guard; a named JPEG File', async () => {
    const f = fakes();
    const progress: number[] = [];
    const file = await runTiledExport(f.renderer, new Blob(['s']), plan, input, { signal: new AbortController().signal, working, onProgress: (p) => progress.push(p) }, f.deps);
    expect(f.log).toEqual(['guard', 'decode', 'tile', 'put 0', 'tile', 'put 4', 'close full', 'releaseBuffers', 'encode 0.95', 'release canvas', 'clear guard']);
    expect(progress).toEqual([0.5, 1]);
    expect(file.type).toBe('image/jpeg');
    expect(file.name).toMatch(/^meiyan-\d{8}-\d{6}\.jpg$/);
    expect(f.deps.writeGuard).toHaveBeenCalledWith(expect.objectContaining({ w: 8, h: 4, format: 'jpeg' }));
    const call = f.renderer.renderTile.mock.calls[1];
    expect(call[0]).toMatchObject({
      sourceWindow: { x: 0, y: 0, w: 1, h: 1 },
      output: { tile: { x: 0, y: 0, w: 1, h: 1 }, pixelSize: { width: 8, height: 4 }, fullShortEdge: 4 },
      oAspect: 2,
    });
    expect(call[1]).toEqual({ x: 4, y: 0, w: 4, h: 4 });
  });

  it('PNG is encoded without a quality', async () => {
    const f = fakes();
    const file = await runTiledExport(f.renderer, new Blob(['s']), { ...plan, format: 'png' }, input, { signal: new AbortController().signal, working }, f.deps);
    expect(f.canvas.encode).toHaveBeenCalledWith(undefined);
    expect(file.type).toBe('image/png');
    expect(f.deps.createCanvas).toHaveBeenCalledWith(8, 4, 'image/png');
  });

  it('an abort frees everything synchronously inside abort(); the pending step rejects with AbortError', async () => {
    const f = fakes();
    let resume!: () => void;
    f.deps.nextFrame = vi.fn(() => new Promise<void>((r) => (resume = r)));
    const ac = new AbortController();
    const p = runTiledExport(f.renderer, new Blob(['s']), plan, input, { signal: ac.signal, working }, f.deps);
    await vi.waitFor(() => expect(f.renderer.renderTile).toHaveBeenCalledTimes(1));
    ac.abort();
    expect(f.full.close).toHaveBeenCalled();
    expect(f.canvas.release).toHaveBeenCalled();
    expect(f.renderer.releaseBuffers).toHaveBeenCalled();
    expect(f.deps.clearGuard).toHaveBeenCalled();
    resume();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect(f.renderer.renderTile).toHaveBeenCalledTimes(1);
    expect(f.canvas.encode).not.toHaveBeenCalled();
  });

  it.each(['decode', 'tile', 'encode'] as const)('the %s knob fails the export; memory and guard are released', async (failAt) => {
    const f = fakes();
    const run = runTiledExport(f.renderer, new Blob(['s']), plan, input, { signal: new AbortController().signal, working, knob: { failAt } }, f.deps);
    await expect(run).rejects.toBeInstanceOf(ExportError);
    expect(f.deps.clearGuard).toHaveBeenCalled();
    expect(f.renderer.releaseBuffers).toHaveBeenCalled();
    expect(f.full.close).toHaveBeenCalled();
  });

  it('a decode whose aspect is off by > 1 % (orientation ignored) throws ExportError aspect', async () => {
    const f = fakes({ width: 4, height: 8 });
    await expect(runTiledExport(f.renderer, new Blob(['s']), plan, input, { signal: new AbortController().signal, working }, f.deps)).rejects.toMatchObject({
      name: 'ExportError',
      kind: 'aspect',
    });
  });

  it('a renderer failure (context lost) rejects with it and releases', async () => {
    const f = fakes();
    f.renderer.renderTile.mockImplementationOnce(() => {
      throw new Error('renderTile: WebGL context unavailable');
    });
    await expect(runTiledExport(f.renderer, new Blob(['s']), plan, input, { signal: new AbortController().signal, working }, f.deps)).rejects.toThrow('context unavailable');
    expect(f.deps.clearGuard).toHaveBeenCalled();
  });

  it('the slow knob waits after the decode', async () => {
    const f = fakes();
    await runTiledExport(f.renderer, new Blob(['s']), plan, input, { signal: new AbortController().signal, working, knob: { slowMs: 4500 } }, f.deps);
    expect(f.deps.sleep).toHaveBeenCalledWith(4500);
  });
});
