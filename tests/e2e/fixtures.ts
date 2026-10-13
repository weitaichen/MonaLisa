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
    const all = await new Promise<{ id: string; updatedAt: number }[]>((res, rej) => {
      const q = db.transaction('edits').objectStore('edits').getAll();
      q.onsuccess = () => res(q.result as { id: string; updatedAt: number }[]);
      q.onerror = () => rej(q.error);
    });
    db.close();
    return Object.fromEntries(all.map((e) => [e.id, e.updatedAt]));
  });
}

/** click a strip chip: n = 0 is 全部 */
export async function selectPerson(page: Page, n: number): Promise<void> {
  await page.getByRole('radio', { name: n === 0 ? '全部' : new RegExp(`^人物 ${n}`) }).click();
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

/** the raw 最近編輯 records (IndexedDB meiyan / edits): what the source fields hold */
export async function readHistory(page: Page): Promise<{ sourceSize: number; sourceWidth?: number; sourceHeight?: number }[]> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('meiyan', 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const req = open.result.transaction('edits', 'readonly').objectStore('edits').getAll();
          req.onsuccess = () => {
            resolve(
              (req.result as { source?: Blob; sourceWidth?: number; sourceHeight?: number }[]).map((r) => ({
                sourceSize: r.source?.size ?? 0,
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
