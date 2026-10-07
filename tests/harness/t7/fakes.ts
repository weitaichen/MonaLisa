// T7 visual harness: stand-ins for engine / tracker / camera / media / store so every UI screen and
// state can be screenshotted independently of the other phase-1 tasks. Scenario flags come from the
// query string (see SCENARIOS in shoot.mjs). The fake "engine" draws with Canvas 2D and nudges
// brightness / saturation from the params so slider changes are visible.
import type { LiveDeps, LiveLoop } from '../../../src/app/live';
import type { StillSession } from '../../../src/app/still';
import type { Deps, UndoLike } from '../../../src/ui/deps';
import type {
  BeautyParams,
  CameraController,
  CameraErrorKind,
  CameraSnapshot,
  Engine,
  EngineAssetsProgress,
  HistoryEntry,
  Prefs,
  RenderInput,
  Tier,
  Tracker,
} from '../../../src/types';

const q = new URLSearchParams(location.search);
const flag = (k: string) => q.get(k);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function cssFilter(p: BeautyParams): string {
  const v = p.values;
  const parts = [
    `brightness(${(1 + v['skin.whiten'] * 0.18).toFixed(3)})`,
    `saturate(${(1 + v['skin.rosy'] * 0.35).toFixed(3)})`,
    `contrast(${(1 + v['skin.sharpen'] * 0.12 - v['skin.smooth'] * 0.06).toFixed(3)})`,
  ];
  const a = v['filter.amount'];
  switch (p.filterId) {
    case 'mono':
      parts.push(`grayscale(${a})`);
      break;
    case 'warm':
    case 'milktea':
      parts.push(`sepia(${(a * 0.35).toFixed(3)})`);
      break;
    case 'cool':
      parts.push(`hue-rotate(${(-12 * a).toFixed(1)}deg)`);
      break;
    case 'film':
      parts.push(`sepia(${(a * 0.2).toFixed(3)}) contrast(${(1 + a * 0.1).toFixed(3)})`);
      break;
    case 'soft':
    case 'japanese':
    case 'natural':
      parts.push(`brightness(${(1 + a * 0.05).toFixed(3)}) saturate(${(1 - a * 0.12).toFixed(3)})`);
      break;
  }
  return parts.join(' ');
}

function draw(ctx: CanvasRenderingContext2D, src: CanvasImageSource, w: number, h: number, mirror: boolean, filter: string) {
  ctx.save();
  ctx.filter = filter;
  if (mirror) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(src, 0, 0, w, h);
  ctx.restore();
}

// ───────── engine ─────────

class FakeEngine implements Engine {
  readonly ready = Promise.resolve();
  tier: Tier = 'H';
  lost = false;
  mirror = false;
  private ctx: CanvasRenderingContext2D;
  constructor(readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('fake engine: no 2d context');
    this.ctx = ctx;
  }
  setTier(t: Tier) {
    this.tier = t;
  }
  setOptions(o: { mirror?: boolean }) {
    if (o.mirror !== undefined) this.mirror = o.mirror;
  }
  async loadFilter() {
    await sleep(30);
  }
  private size(w: number, h: number, still?: boolean) {
    if (still) return { w, h };
    const short = Math.min(w, h);
    const s = Math.min(1, 1080 / short);
    return { w: Math.round(w * s), h: Math.round(h * s) };
  }
  render(input: RenderInput, opts?: { still?: boolean }) {
    const { w, h } = this.size(input.width, input.height, opts?.still);
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    draw(this.ctx, input.source as CanvasImageSource, w, h, this.mirror, cssFilter(input.params));
    return { cpuMs: 1, width: w, height: h, passes: ['fake'] };
  }
  renderToImageData(input: RenderInput, opts: { mirror: boolean }) {
    const c = document.createElement('canvas');
    c.width = input.width;
    c.height = input.height;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    draw(ctx, input.source as CanvasImageSource, input.width, input.height, opts.mirror, cssFilter(input.params));
    return ctx.getImageData(0, 0, input.width, input.height);
  }
  renderOriginal(input: Pick<RenderInput, 'source' | 'width' | 'height'>, opts?: { still?: boolean }) {
    const { w, h } = this.size(input.width, input.height, opts?.still);
    this.canvas.width = w;
    this.canvas.height = h;
    draw(this.ctx, input.source as CanvasImageSource, w, h, this.mirror, 'none');
  }
  dispose() {}
}

// ───────── camera ─────────

function fakeCamera(): CameraController {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none';
  document.body.appendChild(video);
  let snapshot: CameraSnapshot = { state: 'idle', facing: 'user', error: null, width: 0, height: 0 };
  const subs = new Set<(s: CameraSnapshot) => void>();
  const emit = (p: Partial<CameraSnapshot>) => {
    snapshot = { ...snapshot, ...p };
    subs.forEach((cb) => cb(snapshot));
  };
  let stream: MediaStream | null = null;
  const camErr = flag('cam') as CameraErrorKind | 'interrupted' | 'starting' | null;
  const start = async (facing = snapshot.facing) => {
    emit({ state: 'starting', facing, error: null });
    if (camErr === 'starting') return;
    await sleep(250);
    if (camErr && camErr !== 'interrupted') {
      emit({ state: 'error', error: camErr });
      return;
    }
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    video.srcObject = stream;
    await video.play();
    if (!video.videoWidth) await new Promise((r) => video.addEventListener('loadedmetadata', r, { once: true }));
    emit({ state: 'live', width: video.videoWidth, height: video.videoHeight });
    if (camErr === 'interrupted') setTimeout(() => emit({ state: 'interrupted' }), 1200);
  };
  return {
    video,
    get snapshot() {
      return snapshot;
    },
    start,
    resume: () => start(snapshot.facing),
    async flip() {
      stream?.getTracks().forEach((t) => t.stop());
      await start(snapshot.facing === 'user' ? 'environment' : 'user');
    },
    stop() {
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      emit({ state: 'idle' });
    },
    subscribe(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };
}

function fakeLiveLoop(d: LiveDeps): LiveLoop {
  const e = d.engine as FakeEngine;
  let compare = false;
  let raf = 0;
  let n = 0;
  const v = d.camera.video;
  const tick = () => {
    raf = requestAnimationFrame(tick);
    if (d.camera.snapshot.state !== 'live' || !v.videoWidth) return;
    e.setOptions({ mirror: d.camera.snapshot.facing === 'user' });
    const input = { source: v, width: v.videoWidth, height: v.videoHeight };
    if (compare) e.renderOriginal(input);
    else e.render({ ...input, face: null, faceWeight: 1, params: d.getParams() });
    if (++n % 15 === 0) {
      const s = { fps: 30, detectMs: 6.2, renderMs: 3.1, tier: e.tier, face: flag('face') !== '0' };
      window.__meiyan && Object.assign(window.__meiyan, s);
      d.onStats?.(s);
    }
  };
  raf = requestAnimationFrame(tick);
  return {
    stop: () => cancelAnimationFrame(raf),
    setCompare: (on) => {
      compare = on;
    },
    capture: () => {
      if (!v.videoWidth) return null;
      const mirror = d.getPrefs().mirrorOnSave && d.camera.snapshot.facing === 'user';
      return e.renderToImageData(
        { source: v, width: v.videoWidth, height: v.videoHeight, face: null, faceWeight: 1, params: d.getParams() },
        { mirror },
      );
    },
  };
}

function fakeStill(engine: Engine, _t: Tracker | null, bitmap: ImageBitmap, opts: { ownsBitmap?: boolean } = {}): StillSession {
  let raf = 0;
  let last: BeautyParams | null = null;
  let compare = false;
  const input = (p: BeautyParams) => ({ source: bitmap, width: bitmap.width, height: bitmap.height, face: null, faceWeight: 1, params: p });
  const paint = () => {
    raf = 0;
    if (!last) return;
    if (compare) engine.renderOriginal(input(last), { still: true });
    else engine.render(input(last), { still: true });
  };
  return {
    width: bitmap.width,
    height: bitmap.height,
    face: flag('face') === '0' ? null : ({} as StillSession['face']),
    render(p) {
      last = p;
      if (!raf) raf = requestAnimationFrame(paint);
    },
    setCompare(on) {
      compare = on;
      if (!raf) raf = requestAnimationFrame(paint);
    },
    prepareExport: (p) => (p.filterId === 'none' ? Promise.resolve() : engine.loadFilter(p.filterId).catch(() => undefined)),
    exportImageData: (p) => engine.renderToImageData(input(p), { mirror: false }),
    dispose() {
      cancelAnimationFrame(raf);
      if (opts.ownsBitmap ?? true) bitmap.close();
    },
  };
}

// ───────── media / store ─────────

async function toBlob(src: ImageData | ImageBitmap | HTMLCanvasElement, maxEdge: number, q = 0.9): Promise<Blob> {
  const w = src.width;
  const h = src.height;
  const s = Math.min(1, maxEdge / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * s);
  c.height = Math.round(h * s);
  const ctx = c.getContext('2d')!;
  if (src instanceof ImageData) {
    const tmp = document.createElement('canvas');
    tmp.width = w;
    tmp.height = h;
    tmp.getContext('2d')!.putImageData(src, 0, 0);
    ctx.drawImage(tmp, 0, 0, c.width, c.height);
  } else ctx.drawImage(src, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/jpeg', q));
}

class FakeUndo<T> implements UndoLike<T> {
  private stack: T[] = [];
  private i = -1;
  reset(s: T) {
    this.stack = [structuredClone(s)];
    this.i = 0;
  }
  push(s: T) {
    if (JSON.stringify(s) === JSON.stringify(this.stack[this.i])) return;
    this.stack = this.stack.slice(0, this.i + 1);
    this.stack.push(structuredClone(s));
    this.i++;
  }
  undo() {
    if (this.i <= 0) return null;
    return structuredClone(this.stack[--this.i]);
  }
  redo() {
    if (this.i >= this.stack.length - 1) return null;
    return structuredClone(this.stack[++this.i]);
  }
  get current() {
    return this.stack[this.i] ?? null;
  }
  get canUndo() {
    return this.i > 0;
  }
  get canRedo() {
    return this.i < this.stack.length - 1;
  }
}

const history: HistoryEntry[] = [];
let prefsStore: Prefs | null = null;

async function seedHistory(n: number, params: BeautyParams) {
  const img = new Image();
  img.src = '/tests/fixtures/sample_face.png';
  await img.decode();
  const filters = ['none', 'warm', 'mono', 'cool', 'film', 'soft', 'milktea', 'japanese'];
  for (let i = 0; i < n; i++) {
    const c = document.createElement('canvas');
    c.width = 270;
    c.height = 360;
    const ctx = c.getContext('2d')!;
    ctx.filter = cssFilter({ ...params, filterId: filters[i % filters.length], values: { ...params.values, 'filter.amount': 0.8 } });
    // vary the crop a little so thumbnails differ
    const sy = 120 + (i % 3) * 60;
    ctx.drawImage(img, 60, sy, 880, 1173, 0, 0, 270, 360);
    const thumb = await toBlob(c, 360);
    const t = Date.now() - i * 3600_000;
    history.push({ id: `h${i}`, createdAt: t, updatedAt: t, original: await toBlob(img as unknown as HTMLCanvasElement, 1200), thumb, params, width: 1000, height: 1500 });
  }
}

export async function installFakes(deps: Deps, defaults: { params: BeautyParams; prefs: Prefs }): Promise<void> {
  if (flag('history')) await seedHistory(Number(flag('history')), defaults.params);
  const assets = flag('assets'); // fail | slow | instant
  Object.assign(deps, {
    isWebGL2Supported: () => flag('webgl') !== '0',
    loadEngineAssets: async (onProgress?: (p: EngineAssetsProgress) => void) => {
      const total = 3_758_596;
      const steps = assets === 'instant' ? 1 : 24;
      for (let i = 1; i <= steps; i++) {
        if (assets === 'slow' && i > steps * 0.42) await new Promise(() => undefined);
        await sleep(assets === 'instant' ? 0 : 90);
        if (assets === 'fail' && i > steps * 0.6) throw new Error('HTTP 404 /models/face_landmarker/float16-1/face_landmarker.task');
        onProgress?.({ loaded: Math.round((total * i) / steps), total, phase: 'model' });
      }
      onProgress?.({ loaded: total, total, phase: 'wasm' });
      await sleep(assets === 'instant' ? 0 : 200);
      onProgress?.({ loaded: total, total, phase: 'done' });
      return { modelBuffer: new Uint8Array(4) };
    },
    createEngine: (canvas: HTMLCanvasElement) => {
      if (flag('engine') === 'throw') throw new Error('createEngine: not implemented');
      return new FakeEngine(canvas);
    },
    createTracker: async () => {
      await sleep(150);
      if (flag('tracker') === 'fail') throw new Error('FaceLandmarker: GPU and CPU delegates both failed');
      return { delegate: 'GPU', detectVideo: () => null, detectImage: () => null, close() {} } satisfies Tracker;
    },
    createCamera: fakeCamera,
    startLiveLoop: fakeLiveLoop,
    createStillSession: fakeStill,
    importPhoto: (f: Blob) => createImageBitmap(f),
    encodeJpeg: async (img: ImageData) => {
      await sleep(flag('slowencode') ? 4000 : 120);
      const b = await toBlob(img, 99999, 0.92);
      return new File([b], 'meiyan-20261007-120000.jpg', { type: 'image/jpeg' });
    },
    toJpegBlob: toBlob,
    saveFile: async () => (flag('save') === 'shared' ? 'shared' : 'fallback'),
    addEntry: async (e: Omit<HistoryEntry, 'id' | 'createdAt' | 'updatedAt'>) => {
      const id = `n${Date.now()}`;
      history.unshift({ ...e, id, createdAt: Date.now(), updatedAt: Date.now() });
      return id;
    },
    updateEntry: async (id: string, patch: Partial<HistoryEntry>) => {
      const e = history.find((x) => x.id === id);
      if (e) Object.assign(e, patch, { updatedAt: Date.now() });
    },
    listEntries: async () => [...history],
    getEntry: async (id: string) => history.find((x) => x.id === id),
    deleteEntry: async (id: string) => {
      const i = history.findIndex((x) => x.id === id);
      if (i >= 0) history.splice(i, 1);
    },
    loadParams: () => defaults.params,
    saveParams: () => undefined,
    loadPrefs: () => prefsStore ?? defaults.prefs,
    savePrefs: (p: Prefs) => {
      prefsStore = p;
    },
    createUndo: <T,>() => new FakeUndo<T>(),
  } satisfies Partial<Deps>);
}
