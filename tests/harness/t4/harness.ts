// T4 media harness: exposes window.t4 for tests/harness/t4/run.mjs (Playwright, headless Chromium).
import { loadEngineAssets } from '../../../src/engine/assets';
import { createCamera, createCameraWith, maxLuma } from '../../../src/media/camera';
import { canShareFiles, encodeJpeg, saveFile, toJpegBlob } from '../../../src/media/exporter';
import { importPhoto, importViaBitmap, importViaImageElement } from '../../../src/media/importer';
import type { CameraController, CameraSnapshot, EngineAssetsProgress, Facing } from '../../../src/types';

// ───────────── camera ─────────────

const streams: MediaStream[] = [];
const gumCalls: MediaStreamConstraints[] = [];
const wakeEvents: string[] = [];
const snaps: (CameraSnapshot & { t: number })[] = [];
let cam: CameraController | null = null;
const t0 = performance.now();

function instrument(): void {
  const md = navigator.mediaDevices;
  if (md && !('__t4' in md)) {
    const orig = md.getUserMedia.bind(md);
    md.getUserMedia = async (c?: MediaStreamConstraints) => {
      gumCalls.push(c ?? {});
      const s = await orig(c);
      streams.push(s);
      return s;
    };
    Object.defineProperty(md, '__t4', { value: true });
  }
  const wl = 'wakeLock' in navigator ? navigator.wakeLock : undefined;
  if (wl && !('__t4' in wl)) {
    const orig = wl.request.bind(wl);
    wl.request = async (type?: 'screen') => {
      wakeEvents.push('request');
      try {
        const s = await orig(type);
        wakeEvents.push('granted');
        s.addEventListener('release', () => wakeEvents.push('released'));
        return s;
      } catch (e) {
        wakeEvents.push(`rejected:${(e as Error).name}`);
        throw e;
      }
    };
    Object.defineProperty(wl, '__t4', { value: true });
  }
}

function camState() {
  const c = cam!;
  const v = c.video;
  return {
    snap: c.snapshot,
    video: { w: v.videoWidth, h: v.videoHeight, readyState: v.readyState, paused: v.paused, hasSrc: !!v.srcObject },
    tracks: streams.map((s) => s.getTracks().map((t) => `${t.kind}:${t.readyState}`).join(',')),
    gumCalls: gumCalls.map((c) => JSON.stringify(c)),
    wakeEvents: [...wakeEvents],
  };
}

function setVisibility(v: DocumentVisibilityState): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
  document.dispatchEvent(new Event('visibilitychange'));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const camera = {
  init() {
    instrument();
    cam = createCamera();
    cam.subscribe((s) => snaps.push({ ...s, t: Math.round(performance.now() - t0) }));
    const v = cam.video;
    return {
      parentIsBody: v.parentElement === document.body,
      style: v.getAttribute('style'),
      attrs: ['autoplay', 'muted', 'playsinline'].filter((a) => v.hasAttribute(a)),
      props: { autoplay: v.autoplay, muted: v.muted, playsInline: v.playsInline },
      computed: (() => {
        const cs = getComputedStyle(v);
        return { display: cs.display, position: cs.position, width: cs.width, opacity: cs.opacity, pe: cs.pointerEvents };
      })(),
      wakeLockApi: 'wakeLock' in navigator,
      secure: isSecureContext,
    };
  },
  async start(f?: Facing) {
    const t = performance.now();
    await cam!.start(f);
    return { ...camState(), ms: Math.round(performance.now() - t) };
  },
  async flip() {
    await cam!.flip();
    return camState();
  },
  stop() {
    cam!.stop();
    return camState();
  },
  async resume() {
    await cam!.resume();
    return camState();
  },
  state: () => camState(),
  snaps: () => snaps.map((s) => `${s.t}ms ${s.state}/${s.facing}/${s.error ?? '-'}/${s.width}x${s.height}`),
  /** brightest-cell luma of the live frame, sampled exactly like the detector */
  luma() {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(cam!.video, 0, 0, 16, 16);
    return Math.round(maxLuma(ctx.getImageData(0, 0, 16, 16).data));
  },
  /** current live frame as a JPEG data URL (visual check of what the controller delivers) */
  async frame() {
    const v = cam!.video;
    const c = document.createElement('canvas');
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext('2d')!.drawImage(v, 0, 0);
    const blob = await toJpegBlob(c, 640, 0.85);
    return new Promise<string>((res) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result));
      fr.readAsDataURL(blob);
    });
  },
  /** simulate iOS backgrounding: hidden → track killed → visible; the controller must land in 'interrupted' */
  async background() {
    const track = streams.at(-1)!.getVideoTracks()[0];
    setVisibility('hidden');
    track.stop();
    track.dispatchEvent(new Event('ended'));
    const whileHidden = cam!.snapshot.state;
    setVisibility('visible');
    await sleep(400);
    const at400 = cam!.snapshot.state;
    await sleep(600);
    return { whileHidden, at400, at1000: cam!.snapshot.state, ...camState() };
  },
  /** a real 'ended' (e.g. device unplugged) while visible */
  endNow() {
    const track = streams.at(-1)!.getVideoTracks()[0];
    track.stop();
    track.dispatchEvent(new Event('ended'));
    return camState();
  },
  /** real browser rejection objects through the real mapping */
  async errorVia(kind: 'overconstrained' | 'denied-default') {
    const md = navigator.mediaDevices;
    const c =
      kind === 'overconstrained'
        ? createCameraWith({
            ...envFrom(createCamera()),
            mediaDevices: { getUserMedia: () => md.getUserMedia({ video: { deviceId: { exact: 'no-such-camera' } } }) },
          })
        : createCamera();
    await c.start();
    let raw = '';
    try {
      await (kind === 'overconstrained'
        ? md.getUserMedia({ video: { deviceId: { exact: 'no-such-camera' } } })
        : md.getUserMedia({ video: true }));
    } catch (e) {
      raw = (e as Error).name;
    }
    return { snap: c.snapshot, rawErrorName: raw };
  },
  async insecure() {
    const c = createCamera();
    await c.start();
    return { secure: isSecureContext, hasMediaDevices: !!navigator.mediaDevices, snap: c.snapshot };
  },
};

/** reuse the browser wiring of a real controller (its video element) for a custom env */
function envFrom(c: CameraController) {
  return {
    video: c.video,
    mediaDevices: navigator.mediaDevices,
    isSecureContext,
    doc: document,
    wakeLock: undefined,
    sampleMaxLuma: () => null,
  };
}

// ───────────── importer ─────────────

type Quad = [string, string, string, string];
const PALETTE: Record<string, [number, number, number]> = {
  red: [230, 30, 30],
  green: [30, 200, 60],
  blue: [30, 60, 230],
  white: [245, 245, 245],
};

function classify(r: number, g: number, b: number): string {
  let best = '';
  let bd = Infinity;
  for (const [name, [pr, pg, pb]] of Object.entries(PALETTE)) {
    const d = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
    if (d < bd) [best, bd] = [name, d];
  }
  return best;
}

function readPixels(src: CanvasImageSource, w: number, h: number): Uint8ClampedArray {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
}

function quadrants(bmp: ImageBitmap): Quad {
  const { width: w, height: h } = bmp;
  const px = readPixels(bmp, w, h);
  const at = (x: number, y: number) => {
    const i = (Math.floor(y) * w + Math.floor(x)) * 4;
    return classify(px[i], px[i + 1], px[i + 2]);
  };
  return [at(w / 4, h / 4), at((3 * w) / 4, h / 4), at(w / 4, (3 * h) / 4), at((3 * w) / 4, (3 * h) / 4)];
}

function canvasBlob(c: HTMLCanvasElement, type: string, q?: number): Promise<Blob> {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob null'))), type, q));
}

/** 400×300 landscape, quadrants TL red, TR green, BL blue, BR white */
async function quadrantJpeg(): Promise<Uint8Array> {
  const c = document.createElement('canvas');
  c.width = 400;
  c.height = 300;
  const ctx = c.getContext('2d')!;
  const fill = (name: string, x: number, y: number) => {
    const [r, g, b] = PALETTE[name];
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(x, y, 200, 150);
  };
  fill('red', 0, 0);
  fill('green', 200, 0);
  fill('blue', 0, 150);
  fill('white', 200, 150);
  return new Uint8Array(await (await canvasBlob(c, 'image/jpeg', 0.95)).arrayBuffer());
}

/** APP1 Exif segment, big-endian TIFF, IFD0 with a single Orientation (0x0112) SHORT entry */
function exifApp1(orientation: number): Uint8Array {
  const payload = [
    0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // "MM", 42, IFD0 at 8
    0x00, 0x01, // 1 entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, orientation, 0x00, 0x00, // Orientation SHORT ×1
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ];
  const len = payload.length + 2;
  return new Uint8Array([0xff, 0xe1, len >> 8, len & 255, ...payload]);
}

/** insert APP1 after SOI (+ JFIF APP0 if present) of a canvas-encoded JPEG */
function withOrientation(jpeg: Uint8Array, orientation: number): Blob {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) throw new Error('not a JPEG');
  let at = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) at = 4 + ((jpeg[4] << 8) | jpeg[5]);
  const app1 = exifApp1(orientation);
  const out = new Uint8Array(jpeg.length + app1.length);
  out.set(jpeg.subarray(0, at), 0);
  out.set(app1, at);
  out.set(jpeg.subarray(at), at + app1.length);
  return new Blob([out], { type: 'image/jpeg' });
}

function meanAbsDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let s = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    n += 3;
  }
  return s / n;
}

async function jpegDataUrl(bmp: ImageBitmap, maxEdge: number): Promise<string> {
  const blob = await toJpegBlob(bmp, maxEdge, 0.85);
  return new Promise((res) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.readAsDataURL(blob);
  });
}

const importer = {
  async sample(max: number) {
    const blob = await (await fetch('/tests/fixtures/sample_face.png')).blob();
    const t = performance.now();
    const bmp = await importPhoto(blob, max);
    const ms = Math.round(performance.now() - t);
    // reference: full decode drawn at the same size with high-quality smoothing
    const full = await createImageBitmap(blob);
    const ref = readPixels(full, bmp.width, bmp.height);
    full.close();
    const mad = meanAbsDiff(readPixels(bmp, bmp.width, bmp.height), ref);
    const preview = await jpegDataUrl(bmp, 720);
    const out = { w: bmp.width, h: bmp.height, ms, meanAbsDiffVsRef: +mad.toFixed(3), preview };
    bmp.close();
    return out;
  },
  async exif(orientation: number, max: number, path: 'auto' | 'bitmap' | 'img') {
    const blob = withOrientation(await quadrantJpeg(), orientation);
    const fn = path === 'img' ? importViaImageElement : path === 'bitmap' ? importViaBitmap : importPhoto;
    const bmp = await fn(blob, max);
    const out = { w: bmp.width, h: bmp.height, quads: quadrants(bmp) };
    bmp.close();
    return out;
  },
  /** how this engine applies resize* together with imageOrientation (diagnostic for the swap guard) */
  async resizeSemantics() {
    const blob = withOrientation(await quadrantJpeg(), 6);
    const b = await createImageBitmap(blob, {
      imageOrientation: 'from-image',
      resizeWidth: 150,
      resizeHeight: 200,
      resizeQuality: 'high',
    });
    const out = { w: b.width, h: b.height, quads: quadrants(b) };
    b.close();
    return out;
  },
  async large(w: number, h: number, max: number) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#203040');
    g.addColorStop(1, '#f0c0a0');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e01010';
    ctx.fillRect(0, 0, w / 2, h / 2); // red TL quadrant marks orientation
    const blob = await canvasBlob(c, 'image/png');
    c.width = c.height = 0;
    const t = performance.now();
    const bmp = await importPhoto(blob, max);
    const px = readPixels(bmp, bmp.width, bmp.height);
    const i = (Math.floor(bmp.height / 4) * bmp.width + Math.floor(bmp.width / 4)) * 4;
    const out = { w: bmp.width, h: bmp.height, ms: Math.round(performance.now() - t), tl: [px[i], px[i + 1], px[i + 2]] };
    bmp.close();
    return out;
  },
};

// ───────────── exporter ─────────────

function testImage(w: number, h: number): ImageData {
  const img = new ImageData(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      img.data[i] = (x / w) * 255;
      img.data[i + 1] = (y / h) * 255;
      img.data[i + 2] = x < w / 2 ? 40 : 200;
      img.data[i + 3] = 255;
    }
  return img;
}

function markers(bytes: Uint8Array): string[] {
  const out: string[] = [];
  let i = 2;
  while (i + 4 <= bytes.length && bytes[i] === 0xff) {
    const m = bytes[i + 1];
    out.push(m.toString(16));
    if (m === 0xda) break; // start of scan
    i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
  }
  return out;
}

const exporter = {
  async encode(hideOffscreen: boolean) {
    const saved = window.OffscreenCanvas;
    if (hideOffscreen) Object.defineProperty(window, 'OffscreenCanvas', { configurable: true, value: undefined });
    try {
      const img = testImage(640, 480);
      const t = performance.now();
      const file = await encodeJpeg(img);
      const ms = Math.round(performance.now() - t);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const bmp = await createImageBitmap(file);
      const mad = meanAbsDiff(readPixels(bmp, bmp.width, bmp.height), img.data);
      const out = {
        name: file.name,
        type: file.type,
        size: file.size,
        ms,
        soi: bytes[0].toString(16) + bytes[1].toString(16),
        markers: markers(bytes),
        decoded: [bmp.width, bmp.height],
        meanAbsDiff: +mad.toFixed(3),
        offscreenUsed: !hideOffscreen && typeof saved !== 'undefined',
      };
      bmp.close();
      return out;
    } finally {
      if (hideOffscreen) Object.defineProperty(window, 'OffscreenCanvas', { configurable: true, writable: true, value: saved });
    }
  },
  async thumb(kind: 'imagedata' | 'bitmap' | 'canvas', max: number, hideOffscreen = false) {
    const saved = window.OffscreenCanvas;
    if (hideOffscreen) Object.defineProperty(window, 'OffscreenCanvas', { configurable: true, value: undefined });
    try {
      const img = testImage(1280, 720);
      let src: ImageData | ImageBitmap | HTMLCanvasElement = img;
      if (kind === 'bitmap') src = await createImageBitmap(img);
      if (kind === 'canvas') {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        c.getContext('2d')!.putImageData(img, 0, 0);
        src = c;
      }
      const blob = await toJpegBlob(src, max);
      const bmp = await createImageBitmap(blob);
      // compare against a high-quality browser downscale of the same source
      const ref = readPixels(await createImageBitmap(img), bmp.width, bmp.height);
      const out = {
        type: blob.type,
        size: blob.size,
        decoded: [bmp.width, bmp.height],
        meanAbsDiff: +meanAbsDiff(readPixels(bmp, bmp.width, bmp.height), ref).toFixed(3),
      };
      bmp.close();
      return out;
    } finally {
      if (hideOffscreen) Object.defineProperty(window, 'OffscreenCanvas', { configurable: true, writable: true, value: saved });
    }
  },
  async share() {
    const file = await encodeJpeg(testImage(64, 64));
    const can = canShareFiles(file);
    const result = await saveFile(file); // no user activation here → must not hang, must not throw
    return { hasShare: typeof navigator.share === 'function', canShareFiles: can, result };
  },
};

// ───────────── assets ─────────────

function summarize(ev: EngineAssetsProgress[]) {
  const by = (p: EngineAssetsProgress['phase']) => ev.filter((e) => e.phase === p);
  const m = by('model');
  const w = by('wasm');
  const monotone = (a: EngineAssetsProgress[]) => a.every((e, i) => i === 0 || e.loaded >= a[i - 1].loaded);
  return {
    count: ev.length,
    model: { n: m.length, first: m[0], last: m.at(-1), monotone: monotone(m) },
    wasm: { n: w.length, first: w[0], last: w.at(-1), monotone: monotone(w) },
    done: by('done'),
    order: ev.map((e) => e.phase).filter((p, i, a) => p !== a[i - 1]),
  };
}

const assets = {
  async concurrent() {
    const a: EngineAssetsProgress[] = [];
    const b: EngineAssetsProgress[] = [];
    const t = performance.now();
    const pa = loadEngineAssets((p) => a.push(p));
    const pb = loadEngineAssets((p) => b.push(p));
    const [ra, rb] = await Promise.all([pa, pb]);
    const ms = Math.round(performance.now() - t);
    const late: EngineAssetsProgress[] = [];
    const rc = await loadEngineAssets((p) => late.push(p));
    const buf = ra.modelBuffer;
    return {
      ms,
      bytes: buf.byteLength,
      head: Array.from(buf.subarray(0, 4)),
      sameBuffer: ra.modelBuffer === rb.modelBuffer && rc.modelBuffer === buf,
      a: summarize(a),
      b: summarize(b),
      late,
    };
  },
  async once() {
    const ev: EngineAssetsProgress[] = [];
    try {
      const r = await loadEngineAssets((p) => ev.push(p));
      return { ok: true, bytes: r.modelBuffer.byteLength, ev: summarize(ev) };
    } catch (e) {
      return { ok: false, error: String(e), ev: summarize(ev) };
    }
  },
};

declare global {
  interface Window {
    t4: { camera: typeof camera; importer: typeof importer; exporter: typeof exporter; assets: typeof assets };
  }
}

window.t4 = { camera, importer, exporter, assets };
document.getElementById('status')!.textContent = 'ready';
