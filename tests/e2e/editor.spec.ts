import { test as bare, type Locator, type Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { debugState, decodeDataUrl, dragSlider, expect, grab, hold, importFixture, mad, SAMPLE_FACE, settled, shot, test, type Pixels } from './fixtures';

/** A face-free photo: a soft grey gradient. */
function noFacePng(width = 600, height = 800): Buffer {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v = 90 + Math.round((70 * (x + y)) / (width + height));
      png.data[i] = v;
      png.data[i + 1] = v;
      png.data[i + 2] = v + 6;
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

test('import → editor: face detected, slider, undo/redo, hold-to-compare, save, history', async ({ page }) => {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /匯入照片/ }).click();
  await (await chooser).setFiles(SAMPLE_FACE);

  const save = page.getByRole('button', { name: '儲存' });
  await expect(save).toBeEnabled({ timeout: 90_000 });
  await expect.poll(async () => (await debugState(page)).screen).toBe('editor');
  expect((await debugState(page)).face).toBe(true);
  await expect(page.getByText('未偵測到臉部')).toHaveCount(0);
  const undo = page.getByRole('button', { name: '復原' });
  const redo = page.getByRole('button', { name: '重做' });
  await expect(undo).toBeDisabled();
  await expect(redo).toBeDisabled();

  const frame = page.locator('.editor-stage .frame');
  const e0 = await settled(frame);
  await shot(page, '10-editor-import');

  // slider: 美白 to 100 visibly changes the photo
  await page.getByRole('tab', { name: '美膚' }).click();
  await page.getByRole('option', { name: '美白', exact: true }).click();
  await dragSlider(page, 400);
  await expect(page.getByRole('slider')).toHaveAttribute('aria-valuenow', '100');
  const e1 = await settled(frame);
  await shot(page, '11-editor-whiten-100');
  const edit = mad(e0, e1);
  expect(edit).toBeGreaterThan(2);

  // undo → back to the import look; redo → the edit again
  await expect(undo).toBeEnabled();
  await undo.click();
  const e2 = await settled(frame);
  expect(mad(e0, e2)).toBeLessThan(0.5);
  await expect(page.getByRole('slider')).not.toHaveAttribute('aria-valuenow', '100');
  await expect(redo).toBeEnabled();
  await redo.click();
  const e3 = await settled(frame);
  expect(mad(e1, e3)).toBeLessThan(0.5);
  await expect(redo).toBeDisabled();

  // hold-to-compare shows the original, labelled 原圖; release restores the edit
  const release = await hold(page, page.getByRole('button', { name: '按住對比' }));
  await expect(page.locator('.corner-label', { hasText: '原圖' })).toBeVisible();
  const held = await settled(frame);
  await shot(page, '12-editor-compare-held');
  await release();
  await expect(page.locator('.corner-label', { hasText: '原圖' })).toHaveCount(0);
  const e4 = await settled(frame);
  expect(mad(e3, e4)).toBeLessThan(0.5);
  expect(mad(held, e3)).toBeGreaterThan(2);

  // keyboard / VoiceOver activation (a click with no pointer events) toggles compare; leaving the button ends it
  const compareBtn = page.getByRole('button', { name: '按住對比' });
  const origLabel = page.locator('.corner-label', { hasText: '原圖' });
  await compareBtn.focus();
  await page.keyboard.press('Space');
  await expect(origLabel).toBeVisible();
  await expect(compareBtn).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Space');
  await expect(origLabel).toHaveCount(0);
  await page.keyboard.press('Space');
  await expect(origLabel).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(origLabel).toHaveCount(0);
  await expect(compareBtn).toHaveAttribute('aria-pressed', 'false');
  await settled(frame);

  // the compare view really is the unprocessed photo: it matches the 原圖 preset render
  await page.getByRole('tab', { name: '一鍵' }).click();
  await page.getByRole('option', { name: '原圖', exact: true }).click();
  const orig = await settled(frame);
  // middle band only: the 原圖 label (top-left) and the held button (bottom) differ by design
  const band = { x: 0, y: Math.round(held.height * 0.15), w: held.width, h: Math.round(held.height * 0.65) };
  const cmp = mad(held, orig, band);
  console.log(`editor: edit ${edit.toFixed(2)}, compare-vs-原圖 ${cmp.toFixed(3)} (0..255, overlay-free band)`);
  expect(cmp).toBeLessThan(0.5);
  await undo.click(); // back to the whitened edit
  await settled(frame);

  // 儲存: Chromium has no file share sheet → long-press fallback with the full-resolution JPEG
  await save.click();
  const fallback = page.getByRole('dialog', { name: '儲存照片' });
  await expect(fallback).toBeVisible({ timeout: 30_000 });
  await expect(fallback.getByText('長按圖片 → 儲存到照片')).toBeVisible();
  const img = fallback.getByRole('img', { name: '編輯結果' });
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBe(1000);
  expect(await img.evaluate((i: HTMLImageElement) => i.naturalHeight)).toBe(1500);
  await shot(page, '13-editor-save-fallback');
  await fallback.getByRole('button', { name: '關閉' }).click();

  // autosaved to 最近編輯
  await page.getByRole('button', { name: '關閉' }).click();
  await expect.poll(async () => (await debugState(page)).screen).toBe('home');
  await expect(page.getByRole('button', { name: '開啟編輯' })).toHaveCount(1, { timeout: 15_000 });
  await shot(page, '14-home-history');

  // reopening the entry restores its params (the whitened edit)
  await page.getByRole('button', { name: '開啟編輯' }).click();
  await expect(save).toBeEnabled({ timeout: 60_000 });
  await page.getByRole('tab', { name: '美膚' }).click();
  await page.getByRole('option', { name: '美白', exact: true }).click();
  await expect(page.getByRole('slider')).toHaveAttribute('aria-valuenow', '100');

  // an edit followed by ✕ inside the 400 ms autosave debounce is still saved (flushed on close)
  await page.getByRole('slider').focus();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('slider')).toHaveAttribute('aria-valuenow', '98');
  await page.getByRole('button', { name: '關閉' }).click();
  await expect.poll(async () => (await debugState(page)).screen).toBe('home');
  await expect(page.getByRole('button', { name: '開啟編輯' })).toHaveCount(1);
  await page.getByRole('button', { name: '開啟編輯' }).click();
  await expect(save).toBeEnabled({ timeout: 60_000 });
  await page.getByRole('tab', { name: '美膚' }).click();
  await page.getByRole('option', { name: '美白', exact: true }).click();
  await expect(page.getByRole('slider')).toHaveAttribute('aria-valuenow', '98');
});

test('no face in the photo: 美型 / 美妝 are dimmed with a note and no slider; 美膚 stays available', async ({ page }) => {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /匯入照片/ }).click();
  await (await chooser).setFiles({ name: 'no_face.png', mimeType: 'image/png', buffer: noFacePng() });

  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 90_000 });
  await expect.poll(async () => (await debugState(page)).screen).toBe('editor');
  expect((await debugState(page)).face).toBe(false);
  // a healthy tracker that found nothing: the definite "no face" answer (toast + panel note)
  await expect(page.getByText('未偵測到臉部，臉型、美妝與膚質工具不會套用')).toBeVisible();

  const note = page.getByRole('note');
  const tab = (name: string) => page.getByRole('tab', { name, exact: true });
  await tab('美型').click();
  await expect(note).toHaveText('未偵測到臉部，臉型與美妝不會套用');
  const options = page.getByRole('option');
  expect(await options.count()).toBeGreaterThan(0);
  for (const o of await options.all()) {
    // 推臉筆 is never gated: it stays enabled while the face note dims the rest of 美型 (push-brush spec §2.1)
    if ((await o.locator('.item-label').textContent()) === '推臉筆') await expect(o).not.toHaveAttribute('aria-disabled', 'true');
    else await expect(o).toHaveAttribute('aria-disabled', 'true');
  }
  await expect(tab('美型')).toHaveClass(/\bunavailable\b/);
  await expect(tab('美妝')).toHaveClass(/\bunavailable\b/);
  await expect(tab('美膚')).not.toHaveClass(/\bunavailable\b/);
  await expect(page.getByRole('slider')).toHaveCount(0);
  await shot(page, '15-editor-no-face-shape');

  await tab('美膚').click();
  await expect(note).toHaveCount(0);
  // the 美膚 group stays available; the six 膚質 sliders need a face (v0.4 step 4, skin-cleanup spec §1.2)
  const tone = ['勻膚', '膚色', '黑眼圈', '法令紋', '白牙', '亮眼'];
  for (const o of await options.all()) {
    const label = (await o.locator('.item-label').textContent()) ?? '';
    if (tone.includes(label)) await expect(o, label).toHaveAttribute('aria-disabled', 'true');
    else await expect(o, label).not.toHaveAttribute('aria-disabled', 'true');
  }
  await expect(page.getByRole('slider')).toHaveCount(1);
});

/** the 儲存 fallback's JPEG, decoded at a quarter of its size (enough to tell a look apart) */
async function savedPhoto(page: Page): Promise<Pixels> {
  await page.getByRole('button', { name: '儲存' }).click();
  const fallback = page.getByRole('dialog', { name: '儲存照片' });
  await expect(fallback).toBeVisible({ timeout: 30_000 });
  const img = fallback.getByRole('img', { name: '編輯結果' });
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  const url = await img.evaluate((i: HTMLImageElement) => {
    const c = document.createElement('canvas');
    c.width = Math.round(i.naturalWidth / 4);
    c.height = Math.round(i.naturalHeight / 4);
    c.getContext('2d')!.drawImage(i, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  });
  await fallback.getByRole('button', { name: '關閉' }).click();
  await expect(fallback).toHaveCount(0);
  return decodeDataUrl(url);
}

// the failed LUT request prints the browser's own "Failed to load resource" line: no shared console guard here, and
// no service worker in between, so page.route sees the LUT request
bare.describe('a 質感 whose LUT failed', () => {
  bare.use({ serviceWorkers: 'block' });

  bare('re-tapping it once it can load redraws the preview and 儲存 exports it (step-2 spec §2.4, §7)', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(e.message));
    const FILM = /\/luts\/looks\/look_film\.png$/;
    await page.route(FILM, (r) => r.abort());
    await importFixture(page, SAMPLE_FACE);
    const frame: Locator = page.locator('.editor-stage .frame');
    await settled(frame);

    await page.getByRole('tab', { name: '一鍵' }).click();
    await page.getByRole('button', { name: '質感', exact: true }).click();
    const film = page.getByRole('option', { name: '膠片', exact: true });
    await film.click();
    const notice = page.locator('.toast', { hasText: '無法載入「膠片」質感，請稍後再試' });
    await expect(notice).toBeVisible();
    await expect(film).toHaveAttribute('aria-selected', 'true');
    // (the toast sits over the stage: the frames are compared without it)
    await expect(notice).toHaveCount(0, { timeout: 10_000 });
    const without = await settled(frame);
    // the share cache (and autosave) for this edit, made without the look
    const savedWithout = await savedPhoto(page);
    await expect(page.locator('.toast')).toHaveCount(0, { timeout: 10_000 });
    expect(mad(without, await settled(frame)), 'nothing redraws the failed look by itself').toBeLessThan(0.5);

    // back online: the re-tap retries the load; the preview and the next 儲存 carry the look
    await page.unroute(FILM);
    const loaded = page.waitForResponse(FILM);
    await film.click();
    expect((await loaded).ok()).toBe(true);
    let preview = 0;
    for (let i = 0; i < 20 && preview <= 1; i++) {
      await page.waitForTimeout(250);
      preview = mad(without, await grab(frame));
    }
    const withLook = await settled(frame);
    preview = mad(without, withLook);
    const savedWith = await savedPhoto(page);
    const saved = mad(savedWithout, savedWith);
    console.log(`look retry: preview mad ${preview.toFixed(2)}, saved photo mad ${saved.toFixed(2)} (0..255)`);
    expect(preview, 'the preview redrew with the look').toBeGreaterThan(1);
    expect(saved, '儲存 re-encoded with the look instead of handing over the look-less file').toBeGreaterThan(1);
    expect(pageErrors).toEqual([]);
  });
});

/** the one 最近編輯 entry, straight from IndexedDB: its stored 美白 and 濾鏡 and a hash of its thumbnail bytes (null: no entry yet) */
async function storedEntry(page: Page): Promise<{ whiten: number; filter: string; thumb: string } | null> {
  return page.evaluate(async () => {
    if (!(await indexedDB.databases()).some((d) => d.name === 'meiyan')) return null;
    const rows = await new Promise<{ updatedAt?: number; edit?: { photo: { values: Record<string, number>; filterId: string } }; thumb?: Blob }[]>((resolve, reject) => {
      const open = indexedDB.open('meiyan');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        if (!db.objectStoreNames.contains('edits')) {
          db.close();
          return resolve([]);
        }
        const all = db.transaction('edits', 'readonly').objectStore('edits').getAll();
        all.onerror = () => reject(all.error);
        all.onsuccess = () => {
          db.close();
          resolve(all.result);
        };
      };
    });
    const e = rows.find((r) => typeof r.updatedAt === 'number');
    if (!e?.edit || !e.thumb) return null;
    const bytes = new Uint8Array(await e.thumb.arrayBuffer());
    let h = 2166136261;
    for (const b of bytes) h = Math.imul(h ^ b, 16777619) >>> 0;
    return { whiten: e.edit.photo.values['skin.whiten'], filter: e.edit.photo.filterId, thumb: `${bytes.length}:${h.toString(16)}` };
  });
}

/** a no-face photo imported through the home screen, its editor ready */
async function importNoFace(page: Page): Promise<void> {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /匯入照片/ }).click();
  await (await chooser).setFiles({ name: 'no_face.png', mimeType: 'image/png', buffer: noFacePng() });
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 90_000 });
}

interface Hold {
  armed: boolean;
  held: boolean;
  release: (() => void) | null;
}
/** window.__holds (installHolds) */
interface Holds {
  thumb: Hold;
  lut: Hold;
  /** the 400 ms autosave debounce (ENCODE_DEBOUNCE_MS) waits 20 s instead, so a test acts inside it at its own pace */
  debounce: boolean;
  /** the display context's WEBGL_lose_context, for the `lut` hold */
  lose: WEBGL_lose_context | null;
}

/**
 * Test-only holds, installed before the app loads; each waits for its `release()` once armed, then disarms:
 * - `thumb`: the next JPEG encode with a long edge ≤ 360 px (THUMB_EDGE: a history thumbnail), so the first autosave's
 *   addEntry stays pending (`armThumb`: armed from the start);
 * - `lut`: the next decoded 512×512 image (a 濾鏡 LUT) before its upload; once released the LUT is uploaded and the
 *   display context is lost right after (in the bitmap's close()), so the LUT load settles 'ready' and whatever it lets
 *   run reads back with webglcontextlost still queued.
 */
async function installHolds(page: Page, armThumb = false): Promise<void> {
  await page.addInitScript((thumbArmed: boolean) => {
    const hold = (armed: boolean): Hold => ({ armed, held: false, release: null });
    const h: Holds = { thumb: hold(thumbArmed), lut: hold(false), debounce: false, lose: null };
    (window as unknown as { __holds: Holds }).__holds = h;
    const wait = (x: Hold) => {
      x.armed = false;
      x.held = true;
      return new Promise<void>((r) => (x.release = r));
    };
    const convert = OffscreenCanvas.prototype.convertToBlob;
    OffscreenCanvas.prototype.convertToBlob = function (this: OffscreenCanvas, opts?: ImageEncodeOptions) {
      const blob = convert.call(this, opts);
      if (!h.thumb.armed || Math.max(this.width, this.height) > 360) return blob;
      return wait(h.thumb).then(() => blob);
    };
    const decode = window.createImageBitmap.bind(window) as (...a: unknown[]) => Promise<ImageBitmap>;
    window.createImageBitmap = (async (...a: unknown[]) => {
      const bmp = await decode(...a);
      if (!h.lut.armed || !(a[0] instanceof Blob) || bmp.width !== 512 || bmp.height !== 512) return bmp;
      await wait(h.lut);
      const close = bmp.close.bind(bmp);
      bmp.close = () => {
        close();
        h.lose?.loseContext();
      };
      return bmp;
    }) as typeof createImageBitmap;
    const timeout = window.setTimeout.bind(window) as (fn: TimerHandler, ms?: number, ...a: unknown[]) => number;
    window.setTimeout = ((fn: TimerHandler, ms?: number, ...a: unknown[]) => timeout(fn, h.debounce && ms === 400 ? 20_000 : ms, ...a)) as typeof setTimeout;
  }, armThumb);
}

/** a hold's state, or its release */
const held = (page: Page, k: 'thumb' | 'lut') => page.evaluate((key) => (window as unknown as { __holds: Holds }).__holds[key].held, k);
const release = (page: Page, k: 'thumb' | 'lut') => page.evaluate((key) => (window as unknown as { __holds: Holds }).__holds[key].release!(), k);

/** the display context back (the extension kept by the loss) and the app visible again, the debounce as usual */
async function restoreVisible(page: Page): Promise<void> {
  await page.evaluate(() => {
    const h = (window as unknown as { __holds?: Holds }).__holds;
    if (h) h.debounce = false;
    (window as unknown as { __lose: WEBGL_lose_context }).__lose.restoreContext();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/**
 * A no-face photo with its entry, a 美白 drag that ends inside the 400 ms autosave debounce, then, in one task, the display
 * context is lost and the editor flushes (`via`: the app going to the background, or ✕, whose unmount runs in a
 * microtask of the click). WebGL calls then do nothing and readPixels leaves zeros while webglcontextlost is only
 * queued, so the engine does not know yet and the flush's own read-back finds the loss (checkReadBack throws). Returns
 * the entry before the drag and the debug lastError before the flush. `inside`: a step between the drag and the loss,
 * with the debounce stretched (installHolds first).
 */
async function loseInsideFlush(page: Page, via: 'hidden' | 'close', inside?: () => Promise<void>): Promise<{ before: { whiten: number; thumb: string }; errorBefore: unknown }> {
  await importNoFace(page);
  // the import autosave created the entry (a flush while lost can only keep the params of an existing one)
  await expect.poll(() => storedEntry(page), { timeout: 30_000 }).not.toBeNull();
  await page.getByRole('tab', { name: '美膚', exact: true }).click();
  await page.getByRole('option', { name: '美白', exact: true }).click();
  await page.waitForTimeout(1000);
  const before = (await storedEntry(page))!;
  if (inside) await page.evaluate(() => ((window as unknown as { __holds: Holds }).__holds.debounce = true));
  await dragSlider(page, 120);
  if (inside) await inside();
  const r = await page.evaluate((how) => {
    const c = document.querySelector('.editor-stage canvas') as HTMLCanvasElement;
    const gl = c.getContext('webgl2') as WebGL2RenderingContext;
    // kept: a lost context's getExtension returns null, and a restore needs it
    const ext = ((window as unknown as { __lose?: WEBGL_lose_context }).__lose = gl.getExtension('WEBGL_lose_context')!);
    ext.loseContext();
    const known = (window as unknown as { __meiyan?: { lastError?: unknown } }).__meiyan?.lastError ?? null;
    if (how === 'hidden') {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    } else (document.querySelector('.topbar button[aria-label="關閉"]') as HTMLButtonElement).click();
    return { lost: gl.isContextLost(), errorBefore: known };
  }, via);
  expect(r.lost).toBe(true);
  return { before, errorBefore: r.errorBefore };
}

test('a ✕ flush whose read-back finds the context lost (its event still queued) keeps the params', async ({ page }) => {
  const { before, errorBefore } = await loseInsideFlush(page, 'close');
  await expect.poll(async () => (await debugState(page)).screen).toBe('home');
  await expect.poll(async () => (await storedEntry(page))!.whiten, { timeout: 10_000 }).toBeGreaterThan(before.whiten);
  expect((await storedEntry(page))!.thumb, 'no thumbnail of a lost context (zeros) was written').toBe(before.thumb);
  expect((await debugState(page)).lastError).toEqual(errorBefore); // a context loss is no bug report
});

test('a background flush whose read-back finds the context lost (its event still queued) keeps the params; the thumbnail follows once restored', async ({ page }) => {
  const { before, errorBefore } = await loseInsideFlush(page, 'hidden');
  // the params reach the entry while the context is still lost (no autosave can run meanwhile: it waits for the restore)
  await expect.poll(async () => (await storedEntry(page))!.whiten, { timeout: 10_000 }).toBeGreaterThan(before.whiten);
  const flushed = (await storedEntry(page))!;
  expect(flushed.thumb, 'no thumbnail of a lost context (zeros) was written').toBe(before.thumb);
  expect((await debugState(page)).lastError).toEqual(errorBefore); // a context loss is no bug report
  // back: once the context is restored the owed thumbnail is drawn and written
  await page.evaluate(() => {
    (window as unknown as { __lose: WEBGL_lose_context }).__lose.restoreContext();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(async () => (await storedEntry(page))!.thumb, { timeout: 30_000 }).not.toBe(before.thumb);
  expect((await storedEntry(page))!.whiten).toBe(flushed.whiten);
});

test('a ✕ flush that finds the context lost while the first autosave is still creating the entry keeps the last edit', async ({ page }) => {
  await installHolds(page, true);
  await importNoFace(page);
  // the first autosave's thumbnail encode waits, so its addEntry has not run: no entry yet
  await expect.poll(() => held(page, 'thumb'), { timeout: 30_000 }).toBe(true);
  expect(await storedEntry(page)).toBeNull();
  await page.getByRole('tab', { name: '美膚', exact: true }).click();
  await page.getByRole('option', { name: '美白', exact: true }).click();
  await page.waitForTimeout(1000);
  const start = await page.getByRole('slider').getAttribute('aria-valuenow');
  await page.evaluate(() => ((window as unknown as { __holds: Holds }).__holds.debounce = true));
  await dragSlider(page, 120);
  const r = await page.evaluate(() => {
    const value = document.querySelector('[role="slider"]')!.getAttribute('aria-valuenow');
    const c = document.querySelector('.editor-stage canvas') as HTMLCanvasElement;
    const gl = c.getContext('webgl2') as WebGL2RenderingContext;
    gl.getExtension('WEBGL_lose_context')!.loseContext();
    const known = (window as unknown as { __meiyan?: { lastError?: unknown } }).__meiyan?.lastError ?? null;
    (document.querySelector('.topbar button[aria-label="關閉"]') as HTMLButtonElement).click();
    return { lost: gl.isContextLost(), value, errorBefore: known };
  });
  expect(r.lost).toBe(true);
  expect(r.value, 'the drag changed 美白').not.toBe(start);
  await expect.poll(async () => (await debugState(page)).screen).toBe('home');
  // the first addEntry runs only now, after the flush: the flush's params write follows it on the history queue
  await release(page, 'thumb');
  await expect.poll(() => storedEntry(page), { timeout: 30_000 }).not.toBeNull();
  await expect.poll(async () => Math.round((await storedEntry(page))!.whiten * 100), { timeout: 10_000 }).toBe(Number(r.value));
  expect((await debugState(page)).lastError).toEqual(r.errorBefore); // a context loss is no bug report
});

test('a 儲存 inside the debounce, then a background flush that finds the context lost: the owed thumbnail follows once restored, though the share file is fresh', async ({ page }) => {
  await installHolds(page);
  const { before, errorBefore } = await loseInsideFlush(page, 'hidden', async () => {
    // (the debounce is stretched: 儲存 makes the share file for these params before any autosave of them)
    await page.getByRole('button', { name: '儲存' }).click();
    const fallback = page.getByRole('dialog', { name: '儲存照片' });
    await expect(fallback).toBeVisible({ timeout: 30_000 });
    await fallback.getByRole('button', { name: '關閉' }).click();
    await expect(fallback).toHaveCount(0);
  });
  await expect.poll(async () => (await storedEntry(page))!.whiten, { timeout: 10_000 }).toBeGreaterThan(before.whiten);
  const flushed = (await storedEntry(page))!;
  expect(flushed.thumb, 'no thumbnail of a lost context (zeros) was written').toBe(before.thumb);
  expect((await debugState(page)).lastError).toEqual(errorBefore);
  await restoreVisible(page);
  await expect.poll(async () => (await storedEntry(page))!.thumb, { timeout: 30_000 }).not.toBe(before.thumb);
  expect((await storedEntry(page))!.whiten).toBe(flushed.whiten);
});

/** the next 濾鏡 LUT decode held (installHolds), with the display context's extension kept for the loss and the restore */
async function holdNextLut(page: Page, stretch: boolean): Promise<void> {
  await page.evaluate((longDebounce) => {
    const h = (window as unknown as { __holds: Holds }).__holds;
    const c = document.querySelector('.editor-stage canvas') as HTMLCanvasElement;
    h.lose = (c.getContext('webgl2') as WebGL2RenderingContext).getExtension('WEBGL_lose_context');
    (window as unknown as { __lose: WEBGL_lose_context }).__lose = h.lose!;
    h.debounce = longDebounce;
    h.lut.armed = true;
  }, stretch);
  await page.getByRole('tab', { name: '濾鏡', exact: true }).click();
  await page.getByRole('option', { name: '暖調', exact: true }).click();
  // its LUT is decoded and waits before the upload: not resident
  await expect.poll(() => held(page, 'lut'), { timeout: 10_000 }).toBe(true);
}

test('a background flush whose corrected thumbnail (the 濾鏡 LUT was loading) finds the context lost is no bug report; the thumbnail follows once restored', async ({ page }) => {
  await installHolds(page);
  await importNoFace(page);
  await expect.poll(() => storedEntry(page), { timeout: 30_000 }).not.toBeNull();
  const before = (await storedEntry(page))!;
  // (the debounce stretched: no autosave of the 濾鏡 runs before the flush)
  await holdNextLut(page, true);
  const errorBefore = (await debugState(page)).lastError ?? null;
  // the app goes to the background: the flush writes the 濾鏡 with a thumbnail without its LUT (the same pixels as
  // before) and queues the corrected one, which waits for the LUT (FLUSH_LUT_WAIT_MS = 3 s)
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(async () => (await storedEntry(page))!.filter, { intervals: [50], timeout: 2_500 }).not.toBe(before.filter);
  const flushed = (await storedEntry(page))!;
  // the LUT lands and the context is lost right after its upload: the corrected thumbnail's read-back finds the loss
  // with webglcontextlost still queued
  await release(page, 'lut');
  await expect(page.getByRole('button', { name: '儲存' })).toBeDisabled(); // the engine knows it is lost
  await page.waitForTimeout(500);
  expect((await debugState(page)).lastError, 'a context loss is no bug report').toEqual(errorBefore);
  expect((await storedEntry(page))!.thumb, 'no corrected thumbnail of a lost context').toBe(flushed.thumb);
  // back: the stored thumbnail still lacks the LUT, so it is owed; once restored it is drawn with the LUT and written
  await restoreVisible(page);
  await expect.poll(async () => (await storedEntry(page))!.thumb, { timeout: 30_000 }).not.toBe(flushed.thumb);
});

test('an autosave whose read-back (PNG output, the 濾鏡 LUT loading) finds the context lost is no bug report; it is written once restored', async ({ page }) => {
  await installHolds(page);
  await page.goto('/');
  // PNG output: no share file, so the autosave renders its own image (step-3 spec §2.3)
  await page.evaluate(() =>
    localStorage.setItem(
      'meiyan.prefs.v1',
      JSON.stringify({ mirrorOnSave: true, tier: 'auto', matchGpupixel: false, showLandmarks: false, delegate: 'auto', installHintDismissed: true, exportFormat: 'png', exportSize: 'full' }),
    ),
  );
  await importNoFace(page);
  await expect.poll(() => storedEntry(page), { timeout: 30_000 }).not.toBeNull();
  const before = (await storedEntry(page))!;
  await holdNextLut(page, false);
  const errorBefore = (await debugState(page)).lastError ?? null;
  // the debounce (400 ms) has run out: the autosave waits in prepareExport for the LUT
  await page.waitForTimeout(1_500);
  await release(page, 'lut');
  await expect(page.getByRole('button', { name: '儲存' })).toBeDisabled();
  await page.waitForTimeout(500);
  expect((await debugState(page)).lastError, 'a context loss is no bug report').toEqual(errorBefore);
  expect((await storedEntry(page))!.thumb, 'nothing written from a lost context').toBe(before.thumb);
  // restored: the autosave re-arms and writes the 濾鏡 edit
  await restoreVisible(page);
  await expect.poll(async () => (await storedEntry(page))!.thumb, { timeout: 30_000 }).not.toBe(before.thumb);
});

test('at 320 pt the 8 editor tabs keep 44 pt targets: the tab bar scrolls, the page does not; the camera tabs still fit', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /匯入照片/ }).click();
  await (await chooser).setFiles(SAMPLE_FACE);
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 90_000 });
  const measure = () =>
    page.evaluate(() => {
      const bar = document.querySelector<HTMLElement>('.tabs')!;
      const b = bar.getBoundingClientRect();
      const tabs = [...bar.querySelectorAll<HTMLElement>('.tab')].map((t) => t.getBoundingClientRect());
      return {
        vw: window.innerWidth,
        doc: document.documentElement.scrollWidth,
        n: tabs.length,
        minW: Math.min(...tabs.map((r) => r.width)),
        minH: Math.min(...tabs.map((r) => r.height)),
        scroll: bar.scrollWidth,
        client: bar.clientWidth,
        bar: { left: b.left, right: b.right },
        last: { left: tabs[tabs.length - 1].left, right: tabs[tabs.length - 1].right },
      };
    });
  const m = await measure();
  console.log(`editor tabs at 320: ${JSON.stringify(m)}`);
  expect(m.vw).toBe(320);
  expect(m.n).toBe(8);
  expect(m.minW).toBeGreaterThanOrEqual(44);
  expect(m.minH).toBeGreaterThanOrEqual(44);
  expect(m.scroll, 'the 8 tabs do not fit: the bar scrolls').toBeGreaterThan(m.client);
  expect(m.doc).toBeLessThanOrEqual(320);
  // the last tab is reached by scrolling the bar; once selected it sits clear of the bar's fading right edge
  const crop = page.getByRole('tab', { name: '裁切' });
  await crop.click();
  await expect(crop).toHaveAttribute('aria-selected', 'true');
  await expect.poll(async () => (await measure()).last.right).toBeLessThanOrEqual(m.bar.right - 16);
  expect((await measure()).doc).toBeLessThanOrEqual(320);
  // the camera's 7 tabs are exactly 44 pt at 320 pt ((320 − 12) / 7) and need no scroll
  await page.getByRole('button', { name: '關閉' }).click();
  await page.getByRole('button', { name: /拍攝/ }).click();
  await page.getByRole('button', { name: '點擊開啟相機' }).click();
  await expect(page.getByRole('tab', { name: '美膚' })).toBeVisible({ timeout: 90_000 });
  const c = await measure();
  console.log(`camera tabs at 320: ${JSON.stringify(c)}`);
  expect(c.n).toBe(7);
  expect(c.minW).toBeGreaterThanOrEqual(44);
  expect(c.minH).toBeGreaterThanOrEqual(44);
  expect(c.scroll).toBeLessThanOrEqual(c.client);
  expect(c.doc).toBeLessThanOrEqual(320);
});
