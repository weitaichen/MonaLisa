// Shared e2e fixtures: every test fails on console errors / uncaught exceptions and on any request
// to a non-localhost origin (the privacy guarantee: no photo, telemetry or CDN fetch leaves the
// device). Plus pixel helpers for "did the image actually change" assertions.
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test as base, type Locator, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import type { DebugState } from '../../src/types';

export const SHOTS = resolve(import.meta.dirname, '__shots__');
mkdirSync(SHOTS, { recursive: true });

export const SAMPLE_FACE = resolve(import.meta.dirname, '../fixtures/sample_face.png');
export const GROUP_FACES = resolve(import.meta.dirname, '../fixtures/group_faces.png');
export const GROUP_PEOPLE = resolve(import.meta.dirname, '../fixtures/group_people.jpg');

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Console errors that are not errors. MediaPipe's wasm prints its INFO/WARNING log lines through
 * console.error (glog → stderr), e.g. "INFO: Created TensorFlow Lite XNNPACK delegate for CPU."
 */
const BENIGN_CONSOLE: RegExp[] = [/^INFO: Created TensorFlow Lite XNNPACK delegate for CPU\.$/];

export interface Guard {
  consoleErrors: string[];
  /** console.error lines matched by BENIGN_CONSOLE (reported as a test annotation) */
  benign: string[];
  foreignRequests: string[];
  /** every request URL seen (for debugging) */
  requests: string[];
}

export const test = base.extend<{ guard: Guard }>({
  guard: [
    async ({ page, context }, use, testInfo) => {
      const g: Guard = { consoleErrors: [], benign: [], foreignRequests: [], requests: [] };
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const text = m.text();
        if (BENIGN_CONSOLE.some((r) => r.test(text))) {
          g.benign.push(text);
          return;
        }
        g.consoleErrors.push(text);
      });
      page.on('pageerror', (e) => g.consoleErrors.push(`pageerror: ${e.message}`));
      page.on('websocket', (ws) => {
        const u = new URL(ws.url());
        if (!LOCAL_HOSTS.has(u.hostname)) g.foreignRequests.push(ws.url());
      });
      // context-level: also sees service-worker fetches and new pages
      context.on('request', (r) => {
        const url = r.url();
        g.requests.push(url);
        const u = new URL(url);
        if (u.protocol === 'data:' || u.protocol === 'blob:') return;
        if (!LOCAL_HOSTS.has(u.hostname)) g.foreignRequests.push(url);
      });
      await use(g);
      for (const b of new Set(g.benign)) testInfo.annotations.push({ type: 'benign console.error', description: b });
      if (g.benign.length) console.log(`[guard] filtered benign console.error: ${[...new Set(g.benign)].join(' | ')}`);
      expect(g.foreignRequests, 'requests to non-localhost origins').toEqual([]);
      expect(g.consoleErrors, 'console errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export async function shot(page: Page, name: string): Promise<void> {
  // animations: 'disabled' fast-forwards fade-ins so the shot shows the settled screen
  await page.screenshot({ path: resolve(SHOTS, `${name}.png`), animations: 'disabled' });
}

export interface Pixels {
  width: number;
  height: number;
  data: Uint8Array;
}

export function decodePng(buf: Buffer): Pixels {
  const png = PNG.sync.read(buf);
  return { width: png.width, height: png.height, data: png.data };
}

export function decodeDataUrl(url: string): Pixels {
  return decodePng(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
}

/** Screenshot of an element (CSS px × dpr), decoded. Optionally saved under __shots__. */
export async function grab(target: Locator, save?: string): Promise<Pixels> {
  const buf = await target.screenshot(save ? { path: resolve(SHOTS, `${save}.png`) } : {});
  return decodePng(buf);
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Mean absolute RGB difference (0..255) over the whole image or a rectangle. */
export function mad(a: Pixels, b: Pixels, r?: Rect): number {
  expect([a.width, a.height], 'image sizes differ').toEqual([b.width, b.height]);
  const x0 = r?.x ?? 0;
  const y0 = r?.y ?? 0;
  const x1 = r ? r.x + r.w : a.width;
  const y1 = r ? r.y + r.h : a.height;
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * a.width + x) * 4;
      sum += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
      n += 3;
    }
  }
  return sum / n;
}

/** Mean Rec.601 luma (0..255). */
export function meanLuma(p: Pixels, r?: Rect): number {
  const x0 = r?.x ?? 0;
  const y0 = r?.y ?? 0;
  const x1 = r ? r.x + r.w : p.width;
  const y1 = r ? r.y + r.h : p.height;
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * p.width + x) * 4;
      sum += 0.299 * p.data[i] + 0.587 * p.data[i + 1] + 0.114 * p.data[i + 2];
      n++;
    }
  }
  return sum / n;
}

/** Wait until two consecutive screenshots of `target` agree (rendering has settled). */
export async function settled(target: Locator, tolerance = 0.5, tries = 20): Promise<Pixels> {
  let prev = await grab(target);
  for (let i = 0; i < tries; i++) {
    await target.page().waitForTimeout(250);
    const cur = await grab(target);
    if (mad(prev, cur) <= tolerance) return cur;
    prev = cur;
  }
  throw new Error(`rendering did not settle within ${tries} tries`);
}

/** Drag a slider thumb by dx CSS px with pointer (mouse) events, in small steps like a finger. */
export async function dragSlider(page: Page, dx: number): Promise<void> {
  const thumb = page.locator('.slider-thumb').first();
  const b = await thumb.boundingBox();
  if (!b) throw new Error('slider thumb not visible');
  const x = b.x + b.width / 2;
  const y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(x + (dx * i) / 12, y);
  await page.mouse.up();
}

/** Press and hold an element; returns the release function. */
export async function hold(page: Page, target: Locator): Promise<() => Promise<void>> {
  const b = await target.boundingBox();
  if (!b) throw new Error('hold target not visible');
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  return () => page.mouse.up();
}

/** window.__meiyan (created by the app at startup). */
export async function debugState(page: Page): Promise<DebugState> {
  const d = await page.evaluate(() => (window.__meiyan ? { ...window.__meiyan } : null));
  if (!d) throw new Error('window.__meiyan is missing');
  return d;
}

/**
 * a camera debug box (unmirrored video UV) → its client point (the box centre) and its rect in fractions of the
 * preview frame. The front camera's preview is mirrored (the default); the back camera's is not (`mirrored` false).
 */
export async function camBox(page: Page, id: string, mirrored = true): Promise<{ point: { x: number; y: number }; rect: Rect }> {
  const b = (await debugState(page)).boxes.find((x) => x.id === id)!;
  return page.evaluate(
    ({ b, mirrored }) => {
      const c = document.querySelector('.cam-stage canvas') as HTMLCanvasElement;
      const v = document.querySelector('video') as HTMLVideoElement;
      const r = c.getBoundingClientRect();
      const s = Math.max(r.width / v.videoWidth, r.height / v.videoHeight);
      const fx = (u: number) => (r.width - v.videoWidth * s) / 2 + (mirrored ? 1 - u : u) * v.videoWidth * s;
      const fy = (y: number) => (r.height - v.videoHeight * s) / 2 + y * v.videoHeight * s;
      const x0 = fx(mirrored ? b.x + b.w : b.x);
      const x1 = fx(mirrored ? b.x : b.x + b.w);
      return {
        point: { x: r.left + (x0 + x1) / 2, y: r.top + fy(b.y + b.h / 2) },
        rect: { x: x0 / r.width, y: fy(b.y) / r.height, w: (x1 - x0) / r.width, h: (fy(b.y + b.h) - fy(b.y)) / r.height },
      };
    },
    { b, mirrored },
  );
}

/**
 * The camera asks for an upright 1080×1920 stream (camera per-person spec §12.2 E4): Chrome's fake camera otherwise
 * centre-crops a portrait clip to the app's landscape request (media/camera.ts cameraConstraints: 1920×1080, §6.1). An
 * init script: call before page.goto.
 */
export async function uprightCamera(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const md = navigator.mediaDevices;
    if (!md) return;
    const getUserMedia = md.getUserMedia.bind(md);
    md.getUserMedia = (c?: MediaStreamConstraints) => {
      if (!c?.video) return getUserMedia(c);
      const video = { ...(typeof c.video === 'object' ? c.video : {}), width: { ideal: 1080 }, height: { ideal: 1920 } };
      return getUserMedia({ ...c, video });
    };
  });
}

/**
 * Run MediaPipe on `delegate` (CPU by default: SwiftShader's GPU path runs many landmark inferences far slower, §12.2):
 * `meiyan.prefs.v1` `{ delegate }` while the prefs are unset. An init script: call before page.goto.
 */
export async function cpuDelegate(page: Page, delegate: string = 'CPU'): Promise<void> {
  await page.addInitScript((d: string) => {
    try {
      if (localStorage.getItem('meiyan.prefs.v1') === null) localStorage.setItem('meiyan.prefs.v1', JSON.stringify({ delegate: d }));
    } catch {
      // storage blocked: the app runs on its default delegate
    }
  }, delegate);
}

/**
 * The unprocessed frame the camera hands to 編輯 (grabOriginalFrame: createImageBitmap of a 2D canvas), copied to
 * window.__shotOriginal once `window.__armOriginal` is set (the next shot's frame). An init script: call before page.goto.
 */
export async function armShotOriginal(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __armOriginal?: boolean; __shotOriginal?: { width: number; height: number; data: Uint8ClampedArray } };
    const make = window.createImageBitmap.bind(window) as (...a: unknown[]) => Promise<ImageBitmap>;
    (window as unknown as { createImageBitmap: unknown }).createImageBitmap = (src: unknown, ...rest: unknown[]) => {
      if (w.__armOriginal && src instanceof HTMLCanvasElement) {
        const g = src.getContext('2d')!;
        w.__shotOriginal = { width: src.width, height: src.height, data: g.getImageData(0, 0, src.width, src.height).data };
        w.__armOriginal = false;
      }
      return make(src, ...rest);
    };
  });
}

/** after a shot taken armed (armShotOriginal): 預覽's capture against the unprocessed frame (same size, MAD) */
export async function capturedVsOriginal(page: Page): Promise<{ same: boolean; mad: number }> {
  const { same, mads } = await capturedRegions(page, [{ x: 0, y: 0, w: 1, h: 1 }]);
  return { same, mad: mads[0] };
}

/**
 * after a shot taken armed (armShotOriginal): 預覽's capture against the unprocessed frame inside each rect (fractions
 * of the shot, rounded as regionDiff does and clamped to it; MAD, −1 for an empty rect). The camera's preview rects
 * (camBox) are the shot's: the shot is the preview's crop, mirrored as the preview (camera-group.spec.ts's hand-over).
 * `same` false (every MAD −1) when the sizes differ.
 */
export async function capturedRegions(page: Page, rects: Rect[]): Promise<{ same: boolean; mads: number[] }> {
  await expect.poll(async () => (await debugState(page)).screen).toBe('review');
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { __shotOriginal?: unknown }).__shotOriginal)).toBe(true);
  return page.locator('canvas[aria-label="拍攝結果"]').evaluate((c: HTMLCanvasElement, rects: Rect[]) => {
    const s = (window as unknown as { __shotOriginal: { width: number; height: number; data: Uint8ClampedArray } }).__shotOriginal;
    if (c.width !== s.width || c.height !== s.height) return { same: false, mads: rects.map(() => -1) };
    const W = c.width;
    const H = c.height;
    const a = c.getContext('2d')!.getImageData(0, 0, W, H).data;
    const mads = rects.map((r) => {
      const rx = Math.round(r.x * W);
      const ry = Math.round(r.y * H);
      const x0 = Math.max(0, rx);
      const y0 = Math.max(0, ry);
      const x1 = Math.min(W, rx + Math.round(r.w * W));
      const y1 = Math.min(H, ry + Math.round(r.h * H));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const k = (y * W + x) * 4;
          for (let ch = 0; ch < 3; ch++) sum += Math.abs(a[k + ch] - s.data[k + ch]);
          n += 3;
        }
      return n ? sum / n : -1;
    });
    return { same: true, mads };
  }, rects);
}

/** import a fixture through the home screen's picker and wait for the editor */
export async function importFixture(page: Page, path: string): Promise<void> {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /匯入照片/ }).click();
  await (await chooser).setFiles(path);
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 90_000 });
  await expect.poll(async () => (await debugState(page)).screen).toBe('editor');
}

/**
 * Write a raw record into IndexedDB `meiyan` / `edits` (store/history.ts DB_NAME, STORE_NAME; v0.3-shaped or v2), then
 * reload. Call after `page.goto('/')`. `files.original` / `files.thumb` are local paths read in Node (the production
 * preview does not serve tests/fixtures); typed arrays inside `record` are passed as plain arrays under
 * `typed: { path: 'f32' | 'u8' }` and rebuilt in the page.
 */
export async function seedHistory(page: Page, record: Record<string, unknown>, files: { original: string; thumb?: string }, typed: Record<string, 'f32' | 'u8'> = {}): Promise<void> {
  const b64 = (p: string) => readFileSync(p).toString('base64');
  await page.evaluate(
    async ({ r, original, thumb, typed }) => {
      const blob = (s: string) => new Blob([Uint8Array.from(atob(s), (c) => c.charCodeAt(0))]);
      const rec = structuredClone(r) as Record<string, unknown>;
      for (const [path, kind] of Object.entries(typed)) {
        const keys = path.split('.');
        let o = rec as Record<string, unknown>;
        for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
        const last = keys[keys.length - 1];
        o[last] = kind === 'f32' ? new Float32Array(o[last] as number[]) : new Uint8Array(o[last] as number[]);
      }
      rec.original = blob(original);
      rec.thumb = blob(thumb);
      const db = await new Promise<IDBDatabase>((res, rej) => {
        const q = indexedDB.open('meiyan', 1);
        q.onupgradeneeded = () => q.result.createObjectStore('edits', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
        q.onsuccess = () => res(q.result);
        q.onerror = () => rej(q.error);
      });
      await new Promise<void>((res, rej) => {
        const tx = db.transaction('edits', 'readwrite');
        tx.objectStore('edits').put(rec);
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
      db.close();
    },
    { r: record, original: b64(files.original), thumb: b64(files.thumb ?? files.original), typed },
  );
  await page.reload();
}

/** `updatedAt` of every history record, by id */
export async function historyStamps(page: Page): Promise<Record<string, number>> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const q = indexedDB.open('meiyan', 1);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    const all = await new Promise<{ id: string; updatedAt?: number }[]>((res, rej) => {
      const q = db.transaction('edits').objectStore('edits').getAll();
      q.onsuccess = () => res(q.result as { id: string; updatedAt?: number }[]);
      q.onerror = () => rej(q.error);
    });
    db.close();
    // entries only: a kept source file is a record of its own without updatedAt (store/history.ts SOURCE_PREFIX)
    return Object.fromEntries(all.filter((e) => typeof e.updatedAt === 'number').map((e) => [e.id, e.updatedAt!]));
  });
}

/** person n's chip label: 「人物 {n}」 or 「人物 {n}（…）」, so 1 does not match 10 (S §6.7: ten persons) */
export const personChip = (n: number): RegExp => new RegExp(`^人物 ${n}(（|$)`);

/** click a strip chip: n = 0 is 全部 */
export async function selectPerson(page: Page, n: number): Promise<void> {
  await page.getByRole('radio', { name: n === 0 ? '全部' : personChip(n) }).click();
}

/** the screen point of a normalized source point on the editor's (unmirrored, zoom 1) layer */
export async function layerPoint(page: Page, u: number, v: number): Promise<{ x: number; y: number }> {
  const r = (await page.locator('.editor-stage .zoom-layer').boundingBox())!;
  return { x: r.x + u * r.width, y: r.y + v * r.height };
}

/** the centre of a debug face box (`__meiyan.boxes`) on screen */
export async function boxCentre(page: Page, id: string): Promise<{ x: number; y: number }> {
  const b = (await debugState(page)).boxes.find((x) => x.id === id)!;
  return layerPoint(page, b.x + b.w / 2, b.y + b.h / 2);
}

/** two-finger pinch about `c` from `d0` to `d1` px apart (CDP touch: Chromium turns it into pointer events) */
export async function pinch(page: Page, c: { x: number; y: number }, d0: number, d1: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const pts = (d: number) => [
    { x: c.x - d / 2, y: c.y, id: 0 },
    { x: c.x + d / 2, y: c.y, id: 1 },
  ];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pts(d0) });
  for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pts(d0 + ((d1 - d0) * i) / 8) });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** mean |a − b| inside `r` (fractions of the image) and the max outside it */
export function regionDiff(a: Pixels, b: Pixels, r: Rect): { inside: number; outsideMax: number } {
  const R = { x: Math.round(r.x * a.width), y: Math.round(r.y * a.height), w: Math.round(r.w * a.width), h: Math.round(r.h * a.height) };
  let outsideMax = 0;
  for (let y = 0; y < a.height; y++)
    for (let x = 0; x < a.width; x++) {
      if (x >= R.x && x < R.x + R.w && y >= R.y && y < R.y + R.h) continue;
      const i = (y * a.width + x) * 4;
      outsideMax = Math.max(outsideMax, Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]));
    }
  return { inside: mad(a, b, R), outsideMax };
}

/** A synthetic JPEG made in the page (canvas toBlob, S §8.3): a gradient, sample_face.png centred, a red block at the stored top-left. */
export async function makeJpeg(page: Page, width: number, height: number): Promise<Buffer> {
  const face = readFileSync(SAMPLE_FACE).toString('base64');
  const b64 = await page.evaluate(
    async ([w, h, faceB64]) => {
      const bytes = Uint8Array.from(atob(faceB64), (c) => c.charCodeAt(0));
      const faceBmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const c = new OffscreenCanvas(w, h);
      const ctx = c.getContext('2d')!;
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#d8b49a');
      g.addColorStop(1, '#4a6680');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      const s = Math.min(w / faceBmp.width, h / faceBmp.height) * 0.8;
      ctx.drawImage(faceBmp, (w - faceBmp.width * s) / 2, (h - faceBmp.height * s) / 2, faceBmp.width * s, faceBmp.height * s);
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, Math.round(w * 0.08), Math.round(h * 0.08));
      const out = new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 })).arrayBuffer());
      let bin = '';
      for (let i = 0; i < out.length; i += 0x8000) bin += String.fromCharCode(...out.subarray(i, i + 0x8000));
      return btoa(bin);
    },
    [width, height, face] as const,
  );
  return Buffer.from(b64, 'base64');
}

/** Splice an EXIF APP1 with only an Orientation tag after the JFIF APP0 (or the SOI). */
export function withExifOrientation(jpeg: Buffer, orientation: number): Buffer {
  const tiff = Buffer.from([
    0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00, // "II*\0", IFD0 at 8
    0x01, 0x00, // one entry
    0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00, // 0x0112 Orientation, SHORT, count 1
    orientation, 0x00, 0x00, 0x00, // the value
    0x00, 0x00, 0x00, 0x00, // no next IFD
  ]);
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
  const len = body.length + 2;
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, len >> 8, len & 0xff]), body]);
  const at = jpeg[2] === 0xff && jpeg[3] === 0xe0 ? 4 + jpeg.readUInt16BE(4) : 2;
  return Buffer.concat([jpeg.subarray(0, at), app1, jpeg.subarray(at)]);
}

export interface Diff {
  size: [number, number];
  ref: [number, number];
  mad: number;
  max: number;
}

/**
 * 儲存 → the long-press fallback's PNG, compared in the page with `ref`: a base64 file decoded at the export's size, or
 * the pixels stashed under window.__shotOriginal (the camera's unprocessed frame, armShotOriginal)
 */
export async function exportDiff(page: Page, ref: { file: string; mime: string } | 'shot'): Promise<Diff> {
  await page.getByRole('button', { name: '儲存' }).click();
  const dlg = page.getByRole('dialog', { name: '儲存照片' });
  await expect(dlg).toBeVisible({ timeout: 60_000 });
  const img = dlg.getByRole('img', { name: '編輯結果' });
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  const arg = ref === 'shot' ? null : { b64: readFileSync(ref.file).toString('base64'), mime: ref.mime };
  const d = await img.evaluate(async (i: HTMLImageElement, f: { b64: string; mime: string } | null) => {
    const w = i.naturalWidth;
    const h = i.naturalHeight;
    const read = (draw: (g: CanvasRenderingContext2D) => void, cw = w, ch = h) => {
      const c = document.createElement('canvas');
      c.width = cw;
      c.height = ch;
      const g = c.getContext('2d', { willReadFrequently: true })!;
      draw(g);
      return g.getImageData(0, 0, cw, ch).data;
    };
    const a = read((g) => g.drawImage(i, 0, 0));
    let b: Uint8ClampedArray;
    let ref: [number, number];
    if (f) {
      const bytes = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
      const src = await createImageBitmap(new Blob([bytes], { type: f.mime }), { imageOrientation: 'from-image' });
      ref = [src.width, src.height];
      b = read((g) => g.drawImage(src, 0, 0, w, h));
    } else {
      const s = (window as unknown as { __shotOriginal: { width: number; height: number; data: Uint8ClampedArray } }).__shotOriginal;
      ref = [s.width, s.height];
      b = s.width === w && s.height === h ? s.data : new Uint8ClampedArray(a.length);
    }
    let sum = 0;
    let max = 0;
    let n = 0;
    for (let k = 0; k < a.length; k += 4)
      for (let ch = 0; ch < 3; ch++) {
        const dv = Math.abs(a[k + ch] - b[k + ch]);
        sum += dv;
        max = Math.max(max, dv);
        n++;
      }
    return { size: [w, h] as [number, number], ref, mad: sum / n, max };
  }, arg);
  await dlg.getByRole('button', { name: '關閉' }).click();
  return d;
}

/** 儲存 → (a second tap when the pill turned 分享) → the long-press fallback's image: size, blob type and file name. */
export async function exportFile(page: Page): Promise<{ width: number; height: number; type: string; name: string | null }> {
  // the CSP (connect-src 'self') blocks fetch() of a blob: URL, so the blob type is read from the object URLs the page
  // makes from now on (the fallback's URL.createObjectURL(file), state.ts)
  await page.evaluate(() => {
    const w = window as unknown as { __blobTypes?: Record<string, string> };
    if (w.__blobTypes) return;
    const types: Record<string, string> = (w.__blobTypes = {});
    const make = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (o: Blob | MediaSource) => {
      const u = make(o);
      if (o instanceof Blob) types[u] = o.type;
      return u;
    };
  });
  await page.locator('.topbar .pill').click();
  return exportResult(page);
}

/** the export a 儲存 tap started: (a second tap when the pill turned 分享 →) the long-press fallback's image */
export async function exportResult(page: Page): Promise<{ width: number; height: number; type: string; name: string | null }> {
  const fallback = page.getByRole('dialog', { name: '儲存照片' });
  const shareAgain = page.locator('.topbar .pill', { hasText: '分享' });
  await expect(fallback.or(shareAgain)).toBeVisible({ timeout: 300_000 });
  if (!(await fallback.isVisible())) await shareAgain.click();
  await expect(fallback).toBeVisible({ timeout: 30_000 });
  const img = fallback.getByRole('img', { name: '編輯結果' });
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth), { timeout: 30_000 }).toBeGreaterThan(0);
  return img.evaluate((i: HTMLImageElement) => ({
    width: i.naturalWidth,
    height: i.naturalHeight,
    type: (window as unknown as { __blobTypes?: Record<string, string> }).__blobTypes?.[i.src] ?? '',
    name: i.dataset.name ?? null,
  }));
}

export async function closeFallback(page: Page): Promise<void> {
  await page.getByRole('dialog', { name: '儲存照片' }).getByRole('button', { name: '關閉' }).click();
}

/**
 * the raw 最近編輯 entries (IndexedDB meiyan / edits): what the source fields hold. The file is in its own record,
 * `source:<id>` without updatedAt (store/history.ts SOURCE_PREFIX); `sourceInline` = a copy in the entry record itself.
 */
export async function readHistory(page: Page): Promise<{ sourceSize: number; sourceInline: boolean; sourceWidth?: number; sourceHeight?: number }[]> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('meiyan', 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction('edits', 'readonly').objectStore('edits').getAll();
          req.onsuccess = () => {
            type Row = { id: string; updatedAt?: number; source?: Blob; sourceWidth?: number; sourceHeight?: number };
            const rows = req.result as Row[];
            const files = new Map(rows.filter((r) => typeof r.updatedAt !== 'number').map((r) => [r.id, r.source]));
            resolve(
              rows
                .filter((r) => typeof r.updatedAt === 'number')
                .map((r) => ({
                  sourceSize: (r.source ?? files.get(`source:${r.id}`))?.size ?? 0,
                  sourceInline: r.source !== undefined,
                  sourceWidth: r.sourceWidth,
                  sourceHeight: r.sourceHeight,
                })),
            );
            open.result.close();
          };
        };
      }),
  );
}

/** A person-free photo: a soft gradient with a straight dark row band at y 640–660 (moved from body.spec.ts). */
export function emptyPng(width = 600, height = 900): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = y > 640 && y < 660 ? 40 : 120 + Math.round((80 * (x + y)) / (width + height));
      png.data[i] = v;
      png.data[i + 1] = v;
      png.data[i + 2] = v + 4;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

/** A person-free photo with one dark vertical line at x = 298…302: the 推臉筆 tests measure where it moves. */
export const LINE = { width: 600, height: 900, x: 300 } as const;
export function linePng(): Buffer {
  const { width, height } = LINE;
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = Math.abs(x - LINE.x) <= 2 ? 40 : 130 + Math.round((60 * (x + y)) / (width + height));
      png.data[i] = v;
      png.data[i + 1] = v;
      png.data[i + 2] = v + 4;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

/** The editor's 推臉筆 debug state (window.__meiyan.liquify); null before the editor published one. */
export async function liquifyState(page: Page): Promise<NonNullable<DebugState['liquify']> | null> {
  return page.evaluate(() => window.__meiyan?.liquify ?? null);
}

/** A one-finger (mouse: the primary button draws) brush drag between two client points. */
export async function brushDrag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 12): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
  await page.mouse.up();
}

export interface TouchFrame {
  type: 'touchStart' | 'touchMove' | 'touchEnd';
  /** every finger still down after this event (touchEnd lists the ones that remain) */
  points: { x: number; y: number; id: number }[];
  /** wait after dispatching, ms */
  waitMs?: number;
}

/** Multi-touch through CDP (Chromium turns it into pointer events with pointerType 'touch'). */
export async function touch(page: Page, frames: TouchFrame[]): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  for (const f of frames) {
    await cdp.send('Input.dispatchTouchEvent', { type: f.type, touchPoints: f.points });
    if (f.waitMs) await page.waitForTimeout(f.waitMs);
  }
  await cdp.detach();
}

/** The file 儲存 shares, decoded: Chromium has no share sheet, so it is the long-press fallback image (editor.spec.ts:98-107). */
export async function savedPixels(page: Page): Promise<Pixels> {
  await page.getByRole('button', { name: '儲存' }).click();
  const dialog = page.getByRole('dialog', { name: '儲存照片' });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  const img = dialog.getByRole('img', { name: '編輯結果' });
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  const url = await img.evaluate((i: HTMLImageElement) => {
    const c = document.createElement('canvas');
    c.width = i.naturalWidth;
    c.height = i.naturalHeight;
    c.getContext('2d')!.drawImage(i, 0, 0);
    return c.toDataURL('image/png');
  });
  await dialog.getByRole('button', { name: '關閉' }).click();
  return decodeDataUrl(url);
}
