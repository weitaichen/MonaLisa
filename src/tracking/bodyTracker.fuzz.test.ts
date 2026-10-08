// Randomized model check of createBodyTracker's recovery state machine (the bodyTracker.ts header) against a fake
// MediaPipe whose failure modes follow that header: an aborted module throws on every later call, a lost GPU
// context never comes back, a creation can fail per delegate (OOM, WebGL refused), the GPU mask copy / readback
// can throw. Seeded PRNG: every run explores the same sequences; a failure prints the shortest trace per kind.
//
// Invariants, checked over every sequence:
//  - LIVENESS: once the environment heals (memory back, a healthy GPU) and the backoff has elapsed, detect
//    returns a result within a few calls (no BodyTrackerRecovering or BodyTrackerUnavailable forever).
//  - at most one creation in flight; a creation never starts while another instance is still open (a dead
//    instance is released BEFORE its replacement is allocated); no instance is used after close, none closed twice;
//    after close() every created instance has been closed exactly once.
//  - a dead (aborted) instance is never called again: 'Aborted(dead)' never reaches the caller.
//  - LEAK CAP: between two completed inferences at most MAX_ESCALATIONS creations start without a backoff window
//    (CREATE_RETRY_MS) since the previous one.
//  - the CPU graph (no masks) replaces the GPU graph only on detect-time evidence (≥ 2 failed inferences of a GPU
//    mask graph before any GPU mask was read back) or after ≥ 2 consecutive failed GPU creations (the
//    non-sticky degraded fallback); never because of a single creation failure.
//  - the CPU graph is never created with masks (it aborts in 0.10.35).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Beh = 'mask' | 'nomask' | 'noperson' | 'throw' | 'abort' | 'readback';

interface FakeLm {
  opts: { canvas?: FakeCanvas; baseOptions: { delegate: string }; outputSegmentationMasks: boolean };
  delegate: string;
  masks: boolean;
  dead: boolean;
  closed: number;
  detect: () => unknown;
  detectForVideo: () => unknown;
  setOptions: () => Promise<void>;
  close: () => void;
}

const h = vi.hoisted(() => ({
  created: [] as FakeLm[],
  inflight: 0,
  canGPU: true,
  canCPU: true,
  gpu: 'mask' as Beh,
  cpu: 'nomask' as Beh,
  startup: true,
  clock: 0,
  /** GPU mask graph inference failures before any GPU mask was read back */
  gpuFailsBeforeProof: 0,
  gpuProof: false,
  /** failed GPU creations since the last successful creation */
  gpuCreateFails: 0,
  lastCreateAt: -Infinity,
  /** creations started < CREATE_RETRY_MS after the previous one, since the last completed inference */
  fastCreates: 0,
  log: [] as string[],
  problems: [] as string[],
}));

const MAX_ESCALATIONS = 2;
const CREATE_RETRY_MS = 5000;

class FakeCanvas {
  width: number;
  height: number;
  lost = false;
  private listeners = new Map<string, (() => void)[]>();
  constructor(w: number, hh: number) {
    this.width = w;
    this.height = hh;
  }
  addEventListener(type: string, fn: () => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  getContext(type: string) {
    if (type === '2d') return { drawImage: () => {} };
    if (type === 'webgl2') return { isContextLost: () => this.lost };
    return null;
  }
  fire(type: string) {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }
}

vi.mock('@mediapipe/tasks-vision', () => {
  const person = () =>
    Array.from({ length: 33 }, (_, i) => ({ x: 0.3 + 0.1 * (i % 5), y: 0.1 + (0.8 * i) / 32, z: 0, visibility: 0.9 }));
  const full = new Float32Array(64 * 100).fill(1);
  const problem = (s: string) => h.problems.push(s);
  return {
    FilesetResolver: { forVisionTasks: async () => ({}) },
    PoseLandmarker: {
      createFromOptions: async (_fs: unknown, o: FakeLm['opts']) => {
        const d = o.baseOptions.delegate;
        if (++h.inflight > 1) problem('two creations in flight');
        const open = h.created.filter((lm) => !lm.closed).length;
        if (open) problem(`creation started with ${open} instance(s) still open`);
        if (!h.startup) {
          if (h.clock - h.lastCreateAt < CREATE_RETRY_MS && ++h.fastCreates > MAX_ESCALATIONS) {
            problem(`leak cap: ${h.fastCreates} unthrottled creations without a completed inference`);
          }
          if (d === 'CPU' && h.gpuFailsBeforeProof < 2 && h.gpuCreateFails < 2) {
            problem('CPU fallback without GPU detect-time evidence or repeated GPU creation failures');
          }
        }
        if (d === 'CPU' && o.outputSegmentationMasks) problem('CPU graph with masks');
        h.lastCreateAt = h.clock;
        // settles a few microtasks later: the test's flush step, never inside a synchronous detect
        for (let i = 0; i < 3; i++) await Promise.resolve();
        h.inflight--;
        const can = d === 'GPU' ? h.canGPU : h.canCPU;
        h.log.push(`create ${d}${can ? '' : ' FAIL'}`);
        if (!can) {
          if (d === 'GPU') h.gpuCreateFails++;
          throw new Error(`create ${d} failed`);
        }
        h.gpuCreateFails = 0;
        const lm: FakeLm = {
          opts: o,
          delegate: d,
          masks: o.outputSegmentationMasks,
          dead: false,
          closed: 0,
          detect: () => run(),
          detectForVideo: () => run(),
          setOptions: async () => {
            if (lm.dead) throw new Error('dead');
          },
          close: () => {
            if (++lm.closed > 1) problem('closed twice');
          },
        };
        const gpuMaskFail = () => {
          if (lm.delegate === 'GPU' && lm.masks && !h.gpuProof) h.gpuFailsBeforeProof++;
        };
        const run = () => {
          if (lm.closed) {
            problem('used after close');
            throw new Error('use after close');
          }
          if (lm.dead) throw new WebAssembly.RuntimeError('Aborted(dead)');
          let b: Beh = d === 'GPU' ? h.gpu : h.cpu;
          if (b === 'readback' && !lm.masks) b = 'nomask';
          if (b === 'abort') {
            lm.dead = true;
            gpuMaskFail();
            throw new WebAssembly.RuntimeError('Aborted(OOM)');
          }
          if (b === 'throw') {
            gpuMaskFail();
            throw new Error('GPU does not fully support 4-channel float32 or float16 formats');
          }
          if (b === 'noperson') return { landmarks: [], close() {} };
          if (b === 'readback') {
            const getAsFloat32Array = () => {
              gpuMaskFail();
              throw new Error('readPixels: FLOAT not supported');
            };
            return { landmarks: [person()], segmentationMasks: [{ width: 64, height: 100, getAsFloat32Array }], close() {} };
          }
          if (b === 'nomask' || !lm.masks) return { landmarks: [person()], close() {} };
          if (d === 'GPU') h.gpuProof = true;
          return { landmarks: [person()], segmentationMasks: [{ width: 64, height: 100, getAsFloat32Array: () => full }], close() {} };
        };
        h.created.push(lm);
        return lm;
      },
    },
  };
});

const OPTS = { modelBuffer: new Uint8Array([1]), wasmBase: '/x', variant: 'full' as const, delegate: 'CPU' as const };
const img = { width: 100, height: 100 } as unknown as ImageBitmap;
const video = img as unknown as HTMLVideoElement;
const flush = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

/** mulberry32: small, fast, deterministic */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

beforeEach(() => {
  vi.stubGlobal('OffscreenCanvas', FakeCanvas);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(performance, 'now').mockImplementation(() => h.clock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SEEDS = 2000;
const GPU_BEHS: Beh[] = ['mask', 'nomask', 'noperson', 'throw', 'abort', 'readback'];
const CPU_BEHS: Beh[] = ['nomask', 'abort', 'throw', 'noperson'];

describe('bodyTracker recovery (randomized)', () => {
  it(`${SEEDS} seeded sequences keep every invariant and always recover once the environment heals`, async () => {
    const { createBodyTracker } = await import('./bodyTracker');
    const failures: string[] = [];
    let healedOnGpu = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      Object.assign(h, {
        inflight: 0,
        canGPU: true,
        canCPU: true,
        gpu: 'mask',
        cpu: 'nomask',
        startup: true,
        clock: 0,
        gpuFailsBeforeProof: 0,
        gpuProof: false,
        gpuCreateFails: 0,
        lastCreateAt: -Infinity,
        fastCreates: 0,
      });
      h.created.length = 0;
      h.log.length = 0;
      h.problems.length = 0;
      const r = rng(seed);
      const t = await createBodyTracker(OPTS);
      h.startup = false;
      const trace: string[] = [];
      const call = (v: boolean): string => {
        try {
          const det = v ? t.detectVideo(video, h.clock) : t.detect(img);
          h.fastCreates = 0; // a completed inference
          return det ? (det.mask ? 'ok+mask' : 'ok') : 'null';
        } catch (e) {
          const err = e as Error;
          if (/Aborted\(dead\)/.test(err.message)) h.problems.push('a dead (aborted) instance was called again');
          return err.name === 'BodyTrackerRecovering' || err.name === 'BodyTrackerUnavailable' ? err.name.slice(11) : `${err.name}(${err.message.slice(0, 12)})`;
        }
      };
      const steps = 6 + Math.floor(r() * 30);
      for (let s = 0; s < steps; s++) {
        const x = r();
        if (x < 0.4) trace.push(`d:${call(false)}`);
        else if (x < 0.45) trace.push(`v:${call(true)}`);
        else if (x < 0.6) {
          await flush();
          trace.push('flush');
          const open = h.created.filter((lm) => !lm.closed).length;
          if (open > 1) h.problems.push(`${open} instances open`);
        } else if (x < 0.7) {
          const dt = [100, 500, 5000, 20000, 61000][Math.floor(r() * 5)];
          h.clock += dt;
          trace.push(`+${dt}`);
        } else if (x < 0.75) {
          const lm = h.created.at(-1);
          if (lm?.opts.canvas && lm.delegate === 'GPU' && !lm.closed && !lm.opts.canvas.lost) {
            lm.opts.canvas.lost = true;
            if (r() < 0.5) lm.opts.canvas.fire('webglcontextlost');
            trace.push('ctxlost');
          }
        } else if (x < 0.85) {
          h.gpu = GPU_BEHS[Math.floor(r() * GPU_BEHS.length)];
          trace.push(`gpu=${h.gpu}`);
        } else if (x < 0.9) {
          h.cpu = CPU_BEHS[Math.floor(r() * CPU_BEHS.length)];
          trace.push(`cpu=${h.cpu}`);
        } else if (x < 0.95) {
          h.canGPU = r() < 0.5;
          trace.push(`canGPU=${h.canGPU}`);
        } else {
          h.canCPU = r() < 0.5;
          trace.push(`canCPU=${h.canCPU}`);
        }
      }
      await flush();
      // the environment heals: memory back, a GPU that reads masks fine. Each call (a 重試) comes after the longest
      // backoff; a lost context noticed by the first call may still cost one window, a replacement one call.
      Object.assign(h, { canGPU: true, canCPU: true, gpu: 'mask', cpu: 'nomask' });
      let healed = '';
      const tail: string[] = [];
      for (let i = 0; i < 4 && !/^(ok|null)/.test(healed); i++) {
        h.clock += 61000;
        healed = call(false);
        tail.push(healed);
        await flush();
      }
      if (!/^ok/.test(healed)) h.problems.push(`no recovery after healing: ${tail.join(', ')}`);
      else if (t.delegate === 'GPU') healedOnGpu++;
      t.close();
      await flush();
      const unclosed = h.created.filter((lm) => lm.closed !== 1).length;
      if (unclosed) h.problems.push(`${unclosed} instance(s) not closed exactly once after close()`);
      for (const p of new Set(h.problems)) failures.push(`${p} :: seed ${seed}: ${trace.join(' ')} || ${h.log.join(', ')}`);
    }
    // the shortest example per kind of violation
    const byKind = new Map<string, string>();
    for (const f of failures) {
      const kind = f.split(' :: ')[0].replace(/\d+/g, 'N');
      if (!byKind.has(kind) || byKind.get(kind)!.length > f.length) byKind.set(kind, f);
    }
    expect([...byKind.values()], `${failures.length} violations`).toEqual([]);
    // sanity: the generator reaches both outcomes, i.e. the GPU graph is not abandoned in most sequences
    expect(healedOnGpu).toBeGreaterThan(SEEDS / 2);
  }, 120000);
});
