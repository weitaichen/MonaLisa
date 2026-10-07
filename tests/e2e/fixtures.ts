// Shared e2e fixtures: every test fails on console errors / uncaught exceptions and on any request
// to a non-localhost origin (the privacy guarantee: no photo, telemetry or CDN fetch leaves the
// device). Plus pixel helpers for "did the image actually change" assertions.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test as base, type Locator, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import type { DebugState } from '../../src/types';

export const SHOTS = resolve(import.meta.dirname, '__shots__');
mkdirSync(SHOTS, { recursive: true });

export const SAMPLE_FACE = resolve(import.meta.dirname, '../fixtures/sample_face.png');

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
