// 推臉筆 (push-brush spec §8.3) against the production build: one finger pushes, 恢復 restores, ↶ ↷, persistence,
// two-finger gestures, the 美型 entry and 全部清除, photos without a face or with a person, and the export rules.
// Distances are measured on element screenshots (CSS px × dpr 3) of synthetic photos (fixtures.ts linePng, emptyPng).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { boxCentre, brushDrag, debugState, decodeDataUrl, emptyPng, expect, LINE, linePng, liquifyState, mad, meanLuma, SAMPLE_FACE, savedPixels, settled, test, touch, type Pixels } from './fixtures';

const option = (page: Page, name: string) => page.getByRole('option', { name, exact: true });

async function openPhoto(page: Page, file: string | { name: string; mimeType: string; buffer: Buffer }): Promise<void> {
  await page.goto('/');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /匯入照片/ }).click();
  await (await chooser).setFiles(file);
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 90_000 });
  await expect(page.locator('.toast')).toHaveCount(0, { timeout: 10_000 });
}

/**
 * Select 推臉筆 in a tab and wait until the hint pill has gone (it floats over the frame). The pill mounts in an effect
 * after the brush bar, so it is first awaited: a count of 0 right after the bar shows can be the pill not there yet.
 */
async function enterBrush(page: Page, tab: '美型' | '美體'): Promise<void> {
  await page.getByRole('tab', { name: tab }).click();
  await option(page, '推臉筆').click();
  await expect(page.getByRole('radiogroup', { name: '筆刷模式' })).toBeVisible();
  await expect(page.locator('.brush-hint')).toBeVisible();
  await expect(page.locator('.brush-hint')).toHaveCount(0, { timeout: 5_000 });
}

/** The column (grab px) with the lowest mean luma over rows y0…y1, searched within columns x0…x1. */
function darkestColumn(p: Pixels, [y0, y1]: [number, number], [x0, x1]: [number, number]): number {
  let best = x0;
  let bestV = Infinity;
  for (let x = Math.max(0, x0); x <= Math.min(p.width - 1, x1); x++) {
    let s = 0;
    for (let y = y0; y <= y1; y++) {
      const i = (y * p.width + x) * 4;
      s += 0.299 * p.data[i] + 0.587 * p.data[i + 1] + 0.114 * p.data[i + 2];
    }
    if (s < bestV) {
      bestV = s;
      best = x;
    }
  }
  return best;
}

/** Client point of a photo pixel (identity geometry, zoom 1), and grab px per CSS px. */
async function photoToClient(page: Page, size: { width: number; height: number }) {
  const box = (await page.locator('.editor-stage .frame').boundingBox())!;
  return {
    box,
    at: (px: number, py: number) => ({ x: box.x + (px / size.width) * box.width, y: box.y + (py / size.height) * box.height }),
  };
}

const strokes = async (page: Page) => (await liquifyState(page))?.strokes ?? -1;

/** the 最近編輯 thumbnail of the one history record (IndexedDB meiyan / edits), decoded; null before it is written */
async function historyThumb(page: Page): Promise<Pixels | null> {
  const url = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const q = indexedDB.open('meiyan', 1);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    const all = await new Promise<{ thumb?: Blob; updatedAt?: number }[]>((res, rej) => {
      const q = db.transaction('edits').objectStore('edits').getAll();
      q.onsuccess = () => res(q.result as { thumb?: Blob; updatedAt?: number }[]);
      q.onerror = () => rej(q.error);
    });
    db.close();
    // the entry (a kept source file is a record of its own, without updatedAt)
    const thumb = all.find((r) => typeof r.updatedAt === 'number')?.thumb;
    if (!thumb) return null;
    const bmp = await createImageBitmap(thumb);
    const c = document.createElement('canvas');
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    bmp.close();
    return c.toDataURL('image/png');
  });
  return url ? decodeDataUrl(url) : null;
}

/**
 * How far (thumbnail px) linePng's line sits, in the 最近編輯 thumbnail, at photo row `py` from where it is at row 135
 * (more than two 中 radii above a stroke at row 450); Infinity before a thumbnail is written.
 */
async function thumbLineShift(page: Page, py: number): Promise<number> {
  const t = await historyThumb(page);
  if (!t) return Infinity;
  const band = (y: number): [number, number] => {
    const r = Math.round((y / LINE.height) * t.height);
    return [r - 3, r + 3];
  };
  return Math.abs(darkestColumn(t, band(py), [0, t.width - 1]) - darkestColumn(t, band(135), [0, t.width - 1]));
}

test('美體 › 推臉筆: one finger moves the line under the brush, nothing far away; one stroke is one ↶ step', async ({ page }) => {
  await openPhoto(page, { name: 'line.png', mimeType: 'image/png', buffer: linePng() });
  const frame = page.locator('.editor-stage .frame');
  await enterBrush(page, '美體');
  await expect.poll(() => strokes(page)).toBe(0);
  const before = await settled(frame);
  const { box, at } = await photoToClient(page, LINE);
  const k = before.width / box.width;
  const yPhoto = 450;
  const start = at(LINE.x, yPhoto);
  await brushDrag(page, start, { x: start.x + 24, y: start.y });
  await expect.poll(() => strokes(page)).toBe(1);
  const after = await settled(frame);
  const row = Math.round((yPhoto / LINE.height) * before.height);
  const band: [number, number] = [row - 6, row + 6];
  const x0 = darkestColumn(before, band, [0, before.width - 1]);
  const x1 = darkestColumn(after, band, [x0 - Math.round(4 * k), x0 + Math.round(40 * k)]);
  const ratio = (x1 - x0) / (24 * k);
  console.log(`推臉筆: the line moved ${((x1 - x0) / k).toFixed(1)} CSS px for a 24 px drag (${ratio.toFixed(2)}×)`);
  expect(ratio).toBeGreaterThanOrEqual(0.45);
  expect(ratio).toBeLessThanOrEqual(0.85);
  // more than two brush radii away (bottom-left corner) nothing changed
  const far = { x: 0, y: Math.round(before.height * 0.8), w: Math.round(before.width * 0.3), h: Math.round(before.height * 0.2) - 1 };
  expect(mad(before, after, far)).toBeLessThan(0.5);

  await page.getByRole('button', { name: '復原' }).click();
  await expect.poll(() => strokes(page)).toBe(0);
  expect(mad(before, await settled(frame))).toBeLessThanOrEqual(0.5);
  await page.getByRole('button', { name: '重做' }).click();
  await expect.poll(() => strokes(page)).toBe(1);
  expect(mad(after, await settled(frame))).toBeLessThanOrEqual(0.5);
});

test('美體 › 推臉筆: a strip item tapped while a finger draws commits the stroke first, and its edit keeps the stroke', async ({ page }) => {
  await openPhoto(page, { name: 'line.png', mimeType: 'image/png', buffer: linePng() });
  await enterBrush(page, '美體');
  await expect.poll(() => strokes(page)).toBe(0);
  const clear = page.getByRole('button', { name: '全部清除' });
  await expect(clear).toBeDisabled();
  const { at } = await photoToClient(page, LINE);
  const start = at(LINE.x, 450);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(start.x + 3 * i, start.y);
  // a second finger on 背景保護 while the first one draws (a DOM click: the mouse button is still down on the photo).
  // The item's edit was computed from the state without the live stroke
  await option(page, '背景保護').evaluate((el: HTMLElement) => el.click());
  await page.mouse.move(start.x + 40, start.y); // the stroke was committed: the rest of the drag draws nothing
  await page.mouse.up();
  await expect(clear).toBeEnabled();
  await expect.poll(() => strokes(page)).toBe(1);
  // two undo steps: the 背景保護 toggle (the stroke stays), then the stroke
  await page.getByRole('button', { name: '復原' }).click();
  await expect.poll(() => strokes(page)).toBe(1);
  await page.getByRole('button', { name: '復原' }).click();
  await expect.poll(() => strokes(page)).toBe(0);
  await expect(page.getByRole('button', { name: '復原' })).toBeDisabled();
});

test('a reopen whose replay runs in slices: 儲存 during it finishes the rebuild, the photo is drawn, no status is left', async ({ page }) => {
  // 3:4, the frame tests/fixtures/strokes_cap.json was made on (the liquify grid depends on the aspect only)
  await openPhoto(page, { name: 'cap.png', mimeType: 'image/png', buffer: emptyPng(600, 800) });
  const frame = page.locator('.editor-stage .frame');
  const first = await settled(frame);
  await page.getByRole('button', { name: '關閉' }).click();
  const entry = page.getByRole('button', { name: '開啟編輯' });
  await expect(entry).toHaveCount(1, { timeout: 15_000 });
  // the entry gets the cap fixture's strokes: above LIQUIFY_SYNC_WORK, so the reopen replays them in slices
  const cap = (JSON.parse(readFileSync(resolve(import.meta.dirname, '../fixtures/strokes_cap.json'), 'utf8')) as { strokes: unknown[] }).strokes;
  await page.evaluate(async (strokes) => {
    const db = await new Promise<IDBDatabase>((res, rej) => {
      const q = indexedDB.open('meiyan', 1);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
    await new Promise<void>((res, rej) => {
      const tx = db.transaction('edits', 'readwrite');
      const store = tx.objectStore('edits');
      const all = store.getAll();
      all.onsuccess = () => {
        const rec = (all.result as { updatedAt?: number; edit: { photo: { strokes: unknown[] } } }[]).find((r) => typeof r.updatedAt === 'number')!;
        rec.edit.photo.strokes = strokes;
        store.put(rec);
      };
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
    db.close();
  }, cap);
  // 儲存 is tapped in the page, on the first frame where the rebuild is pending and its status already shows (the
  // 300 ms timer fired): the case where nothing but the rebuild's end clears that status
  const tapped = page.evaluate(
    (n) =>
      new Promise<{ tapped: boolean; covered: boolean; pillH: number }>((res) => {
        const t0 = performance.now();
        const step = () => {
          const l = window.__meiyan?.liquify;
          const pill = document.querySelector<HTMLButtonElement>('.topbar .pill');
          // 正在套用推臉筆… is a pill over the frame, never a status card over the stage (push-brush spec §3.5)
          const busy = document.querySelector<HTMLElement>('.liquify-busy');
          if (l?.pending && l.strokes === n && busy?.textContent?.includes('正在套用推臉筆…') && pill && !pill.disabled) {
            const covered = !!document.querySelector('.editor-stage .status');
            const pillH = busy.getBoundingClientRect().height;
            pill.click();
            res({ tapped: true, covered, pillH });
          } else if (performance.now() - t0 > 60_000) res({ tapped: false, covered: false, pillH: 0 });
          else requestAnimationFrame(step);
        };
        step();
      }),
    cap.length,
  );
  await entry.click();
  const seen = await tapped;
  expect(seen.tapped, 'the rebuild was still pending with its status shown while 儲存 was enabled').toBe(true);
  expect(seen.covered, 'no status card hides the stage during the rebuild').toBe(false);
  expect(seen.pillH).toBeLessThan(48);
  const dialog = page.getByRole('dialog', { name: '儲存照片' });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await dialog.getByRole('button', { name: '關閉' }).click();
  await expect.poll(async () => (await liquifyState(page))?.pending).toBe(false);
  expect((await liquifyState(page))!.strokes).toBe(cap.length);
  await expect(page.getByText('正在套用推臉筆…')).toHaveCount(0);
  // the canvas shows the warped photo, not the blank frame of a session that never rendered
  const reopened = await settled(frame);
  const l0 = meanLuma(first);
  const l1 = meanLuma(reopened);
  console.log(`推臉筆 reopen + 儲存: mean luma ${l1.toFixed(1)} (first open ${l0.toFixed(1)})`);
  expect(Math.abs(l1 - l0)).toBeLessThan(12);

  // ↶ after 全部清除 replays the cap's strokes in slices: the previous frame (the cleared photo) stays on screen with
  // the pill over it, not hidden behind an opaque card (step-6 review)
  await enterBrush(page, '美體');
  await page.getByRole('button', { name: '全部清除' }).click();
  await page.getByRole('button', { name: '確定清除？' }).click();
  await expect.poll(async () => (await liquifyState(page))?.strokes).toBe(0);
  await settled(frame);
  // the still session's draws (__meiyan.renderCount) before the ↶: none may follow while the replay is pending, so the
  // canvas keeps the cleared photo, and nothing but the pill lies over it
  const during = page.evaluate(
    () =>
      new Promise<{ seen: boolean; covered: boolean; drawn: number }>((res) => {
        const t0 = performance.now();
        const n0 = window.__meiyan?.renderCount ?? 0;
        const step = () => {
          const busy = document.querySelector('.liquify-busy');
          if (busy && window.__meiyan?.liquify?.pending)
            res({ seen: true, covered: !!document.querySelector('.editor-stage .status'), drawn: (window.__meiyan?.renderCount ?? 0) - n0 });
          else if (performance.now() - t0 > 60_000) res({ seen: false, covered: false, drawn: -1 });
          else requestAnimationFrame(step);
        };
        step();
      }),
  );
  await page.getByRole('button', { name: '復原' }).click();
  const d = await during;
  console.log(`推臉筆 replay after ↶: pill shown, ${d.drawn} frames drawn while pending, card over the stage: ${d.covered}`);
  expect(d.seen, 'the replay ran past 300 ms with its pill').toBe(true);
  expect(d.covered).toBe(false);
  expect(d.drawn).toBe(0);
  await expect.poll(async () => (await liquifyState(page))?.pending, { timeout: 60_000 }).toBe(false);
  expect((await liquifyState(page))!.strokes).toBe(cap.length);
  await expect(page.locator('.liquify-busy')).toHaveCount(0);
});

const GROUP = resolve(import.meta.dirname, '../fixtures/group_faces.png');
const FULLBODY_LINES = resolve(import.meta.dirname, '../fixtures/fullbody_lines.jpg');

/** The row (grab px) with the lowest mean luma over columns x0…x1, searched within rows y0…y1. */
function darkestRow(p: Pixels, [x0, x1]: [number, number], [y0, y1]: [number, number]): number {
  let best = y0;
  let bestV = Infinity;
  for (let y = Math.max(0, y0); y <= Math.min(p.height - 1, y1); y++) {
    let s = 0;
    for (let x = x0; x <= x1; x++) {
      const i = (y * p.width + x) * 4;
      s += 0.299 * p.data[i] + 0.587 * p.data[i + 1] + 0.114 * p.data[i + 2];
    }
    if (s < bestV) {
      bestV = s;
      best = y;
    }
  }
  return best;
}

/** push the line right by 24 CSS px at photo row 450 with the current brush; returns the measurement inputs */
async function pushLine(page: Page) {
  const frame = page.locator('.editor-stage .frame');
  const before = await settled(frame);
  const { box, at } = await photoToClient(page, LINE);
  const k = before.width / box.width;
  const start = at(LINE.x, 450);
  await brushDrag(page, start, { x: start.x + 24, y: start.y });
  await expect.poll(() => strokes(page)).toBeGreaterThan(0);
  const after = await settled(frame);
  const row = Math.round((450 / LINE.height) * before.height);
  const band: [number, number] = [row - 6, row + 6];
  const x0 = darkestColumn(before, band, [0, before.width - 1]);
  const x1 = darkestColumn(after, band, [x0 - Math.round(4 * k), x0 + Math.round(40 * k)]);
  return { frame, before, after, start, k, row, band, x0, x1 };
}

/** the zoom layer's scale (1 = fitted) */
const zoomScale = (page: Page) =>
  page.locator('.zoom-layer').evaluate((el) => {
    const t = getComputedStyle(el).transform;
    return t === 'none' ? 1 : new DOMMatrixReadOnly(t).a;
  });

test('恢復 (大, two passes along the push) brings the photo back; the hint follows the mode', async ({ page }) => {
  await openPhoto(page, { name: 'line.png', mimeType: 'image/png', buffer: linePng() });
  await enterBrush(page, '美體');
  const { frame, before, start, k, row, x0 } = await pushLine(page);
  const pushed = (await liquifyState(page))!.maxDisp;
  expect(pushed).toBeGreaterThan(0);
  await page.getByRole('radio', { name: '恢復' }).click();
  await expect(page.getByText('單指塗抹恢復，雙指縮放')).toBeVisible();
  await expect(page.locator('.brush-hint')).toHaveCount(0, { timeout: 5_000 });
  await page.getByRole('radio', { name: '大' }).click();
  for (let pass = 0; pass < 2; pass++) await brushDrag(page, { x: start.x - 22, y: start.y }, { x: start.x + 24 + 22, y: start.y }, 16);
  await expect.poll(() => strokes(page)).toBe(3);
  const restored = await settled(frame);
  const R = Math.round(2 * 44 * k); // two 大 radii around the push
  const box = { x: Math.max(0, x0 - R), y: Math.max(0, row - R), w: 2 * R, h: 2 * R };
  expect(mad(before, restored, box)).toBeLessThanOrEqual(1);
  expect((await liquifyState(page))!.maxDisp).toBeLessThanOrEqual(0.05 * pushed);
});

test('strokes persist: reopening from 最近編輯 shows them with no detector call and no pending rebuild', async ({ page }) => {
  await openPhoto(page, { name: 'line.png', mimeType: 'image/png', buffer: linePng() });
  await enterBrush(page, '美體');
  const { band, x1, k } = await pushLine(page);
  const calls = (await debugState(page)).detectCalls;
  await page.getByRole('button', { name: '關閉' }).click();
  await expect.poll(async () => (await debugState(page)).screen).toBe('home');
  await page.getByRole('button', { name: '開啟編輯' }).first().click();
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 60_000 });
  await expect.poll(() => strokes(page)).toBe(1);
  expect((await liquifyState(page))!.pending).toBe(false);
  expect((await debugState(page)).detectCalls).toBe(calls);
  const reopened = await settled(page.locator('.editor-stage .frame'));
  // the stored original is a JPEG re-encode, so compare where the line is, not every pixel
  const xr = darkestColumn(reopened, band, [x1 - Math.round(20 * k), x1 + Math.round(20 * k)]);
  expect(Math.abs(xr - x1)).toBeLessThanOrEqual(2);
});

test('two fingers pinch and never draw (second finger 30 ms after the first)', async ({ page }) => {
  await openPhoto(page, { name: 'line.png', mimeType: 'image/png', buffer: linePng() });
  await enterBrush(page, '美體');
  const { at } = await photoToClient(page, LINE);
  const c = at(300, 450);
  const frames = [
    // the first finger already moves (its stamps preview) before the second lands: the stroke is cancelled, not committed
    { type: 'touchStart' as const, points: [{ x: c.x - 52, y: c.y, id: 1 }] },
    { type: 'touchMove' as const, points: [{ x: c.x - 40, y: c.y, id: 1 }], waitMs: 30 },
    { type: 'touchStart' as const, points: [{ x: c.x - 40, y: c.y, id: 1 }, { x: c.x + 40, y: c.y, id: 2 }] },
    ...[1, 2, 3, 4, 5, 6].map((i) => ({
      type: 'touchMove' as const,
      points: [{ x: c.x - 40 - 7 * i, y: c.y, id: 1 }, { x: c.x + 40 + 7 * i, y: c.y, id: 2 }],
      waitMs: 16,
    })),
    { type: 'touchEnd' as const, points: [] },
  ];
  await touch(page, frames);
  await expect.poll(() => zoomScale(page)).toBeGreaterThan(1);
  expect(await strokes(page)).toBe(0);
  await expect(page.getByRole('button', { name: '復原' })).toBeDisabled();
});

test('a second finger after the grace commits the stroke drawn so far (one ↶ step), then pinches', async ({ page }) => {
  await openPhoto(page, { name: 'line.png', mimeType: 'image/png', buffer: linePng() });
  await enterBrush(page, '美體');
  const { at } = await photoToClient(page, LINE);
  const c = at(300, 450);
  const draw = [1, 2, 3, 4, 5, 6].map((i) => ({ type: 'touchMove' as const, points: [{ x: c.x + 4 * i, y: c.y, id: 1 }], waitMs: 50 }));
  const last = { x: c.x + 24, y: c.y, id: 1 };
  await touch(page, [
    { type: 'touchStart', points: [{ x: c.x, y: c.y, id: 1 }], waitMs: 16 },
    ...draw, // 300 ms of drawing
    { type: 'touchStart', points: [last, { x: c.x + 120, y: c.y + 60, id: 2 }] },
    ...[1, 2, 3, 4].map((i) => ({ type: 'touchMove' as const, points: [{ ...last, x: last.x - 8 * i }, { x: c.x + 120 + 8 * i, y: c.y + 60, id: 2 }], waitMs: 16 })),
    { type: 'touchEnd', points: [] },
  ]);
  await expect.poll(() => strokes(page)).toBe(1);
  expect(await zoomScale(page)).not.toBe(1);
  const undo = page.getByRole('button', { name: '復原' });
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect.poll(() => strokes(page)).toBe(0);
  await expect(undo).toBeDisabled();
});

test('美型 › 推臉筆 on a face; 全部清除 needs 確定清除？ and is one ↶ step', async ({ page }) => {
  await openPhoto(page, SAMPLE_FACE);
  await enterBrush(page, '美型');
  const { at } = await photoToClient(page, { width: 1000, height: 1500 });
  const s = at(330, 820); // the left cheek
  await brushDrag(page, s, { x: s.x + 24, y: s.y });
  await expect.poll(() => strokes(page)).toBe(1);
  await expect(option(page, '推臉筆')).toHaveClass(/has-value/);
  await page.getByRole('button', { name: '全部清除' }).click();
  await expect(page.getByRole('button', { name: '確定清除？' })).toBeVisible();
  expect(await strokes(page)).toBe(1); // the first tap only arms it
  await page.getByRole('button', { name: '確定清除？' }).click();
  await expect.poll(() => strokes(page)).toBe(0);
  await expect(page.getByRole('button', { name: '全部清除' })).toBeDisabled();
  await page.getByRole('button', { name: '復原' }).click();
  await expect.poll(() => strokes(page)).toBe(1);
});

test('no face: 推臉筆 stays enabled under the face note and pushes the floor line down', async ({ page }) => {
  await openPhoto(page, { name: 'empty.png', mimeType: 'image/png', buffer: emptyPng() });
  await page.getByRole('tab', { name: '美型' }).click();
  await expect(page.getByText('未偵測到臉部，臉型與美妝不會套用')).toBeVisible();
  await expect(option(page, '推臉筆')).not.toHaveAttribute('aria-disabled', 'true');
  await option(page, '推臉筆').click();
  await expect(page.getByRole('radiogroup', { name: '筆刷模式' })).toBeVisible();
  await expect(page.locator('.brush-hint')).toHaveCount(0, { timeout: 5_000 });
  const frame = page.locator('.editor-stage .frame');
  const before = await settled(frame);
  const size = { width: 600, height: 900 };
  const { box, at } = await photoToClient(page, size);
  const k = before.width / box.width;
  const s = at(300, 650);
  await brushDrag(page, s, { x: s.x, y: s.y + 24 });
  await expect.poll(() => strokes(page)).toBe(1);
  const after = await settled(frame);
  const col = Math.round((300 / size.width) * before.width);
  const cols: [number, number] = [col - 6, col + 6];
  const y0 = darkestRow(before, cols, [0, before.height - 1]);
  const y1 = darkestRow(after, cols, [y0 - Math.round(4 * k), y0 + Math.round(40 * k)]);
  expect((y1 - y0) / (24 * k)).toBeGreaterThanOrEqual(0.45);
});

test('美體 › 推臉筆 on a person works while 美體 detection is still running', async ({ page }) => {
  await openPhoto(page, FULLBODY_LINES);
  await page.getByRole('tab', { name: '美體' }).click();
  // not gated by bodyGate: enabled whatever the detection is doing
  await expect(option(page, '推臉筆')).not.toHaveAttribute('aria-disabled', 'true');
  await option(page, '推臉筆').click();
  await expect(page.getByRole('radiogroup', { name: '筆刷模式' })).toBeVisible();
  await expect(page.locator('.brush-hint')).toHaveCount(0, { timeout: 5_000 });
  const frame = page.locator('.editor-stage .frame');
  const before = await settled(frame);
  const { box, at } = await photoToClient(page, { width: 638, height: 1000 });
  const k = before.width / box.width;
  const s = at(230, 130); // the left door line on the wall
  await brushDrag(page, s, { x: s.x + 24, y: s.y });
  await expect.poll(() => strokes(page)).toBe(1);
  const after = await settled(frame);
  const near = { x: Math.round((s.x - box.x - 30) * k), y: Math.round((s.y - box.y - 30) * k), w: Math.round(84 * k), h: Math.round(60 * k) };
  expect(mad(before, after, near)).toBeGreaterThan(1);
  const far = { x: 0, y: Math.round(before.height * 0.85), w: Math.round(before.width * 0.25), h: Math.round(before.height * 0.15) - 1 };
  expect(mad(before, after, far)).toBeLessThan(0.5);
});

test('half a stroke is never exported: a slow stroke past the 400 ms debounce, then ↶, shares the pre-stroke file', async ({ page }) => {
  await openPhoto(page, { name: 'line.png', mimeType: 'image/png', buffer: linePng() });
  const a = await savedPixels(page);
  await page.getByRole('tab', { name: '美體' }).click();
  const { at } = await photoToClient(page, LINE);
  const s = at(LINE.x, 450);
  // an edit that arms the debounced encode / autosave (背景保護 has no visible effect on a photo without a person) …
  await option(page, '背景保護').click();
  // … and the stroke starts before the 400 ms debounce has fired: without the export gating it would fire mid-stroke
  await option(page, '推臉筆').click();
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  for (let i = 1; i <= 6; i++) await page.mouse.move(s.x + 2 * i, s.y);
  await page.waitForTimeout(700); // finger held still past the encode debounce (ENCODE_DEBOUNCE_MS 400)
  for (let i = 7; i <= 12; i++) await page.mouse.move(s.x + 2 * i, s.y);
  await page.mouse.up();
  await expect.poll(() => strokes(page)).toBe(1);
  await page.getByRole('button', { name: '復原' }).click();
  await expect.poll(() => strokes(page)).toBe(0);
  const b = await savedPixels(page);
  expect([b.width, b.height]).toEqual([a.width, a.height]);
  expect(mad(a, b)).toBeLessThanOrEqual(0.5);
  // … nor saved as the 最近編輯 thumbnail of the pre-stroke params (the commit and the ↶ drop a cached share file, so
  // the thumbnail is where a mid-stroke export would stay): the line in it is straight at the stroke's row
  await expect.poll(() => thumbLineShift(page, 450), { timeout: 10_000 }).toBeLessThanOrEqual(1);
});

test('a press on 按住對比 in brush mode never draws, and nothing is half-committed', async ({ page }) => {
  await openPhoto(page, { name: 'line.png', mimeType: 'image/png', buffer: linePng() });
  await enterBrush(page, '美體');
  const holdBtn = page.getByRole('button', { name: '按住對比' });
  const hb = (await holdBtn.boundingBox())!;
  const { at } = await photoToClient(page, LINE);
  const target = at(LINE.x, 450);
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(hb.x + hb.width / 2 + ((target.x - hb.x - hb.width / 2) * i) / 10, hb.y + hb.height / 2 + ((target.y - hb.y - hb.height / 2) * i) / 10);
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(await strokes(page)).toBe(0);
  await expect(page.getByRole('button', { name: '復原' })).toBeDisabled();
  await expect(page.locator('.brush-ring.hidden')).toHaveCount(1); // the ring is not left on screen
});

test('group photo: brush mode dims the person strip with 整張照片, and a tap selects nobody', async ({ page }) => {
  await openPhoto(page, GROUP);
  await expect.poll(async () => (await debugState(page)).persons).toBeGreaterThanOrEqual(2);
  await enterBrush(page, '美型');
  await expect(page.getByText('整張照片', { exact: true }).first()).toBeVisible();
  const { selected, boxes } = await debugState(page);
  // on the centre of another face's box: outside brush mode this tap selects that person; here a tap is not a stroke
  const other = boxes.find((b) => b.id !== selected)!;
  const p = await boxCentre(page, other.id);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(300);
  expect((await debugState(page)).selected).toBe(selected);
  expect(await strokes(page)).toBe(0);
  // 按住對比 keeps the mode (§2.3): the strip stays dimmed with 整張照片 and the bar stays while it is held
  const hb = (await page.getByRole('button', { name: '按住對比' }).boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await expect(page.locator('.float-btn.held')).toHaveCount(1);
  await expect(page.getByText('整張照片', { exact: true }).first()).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: '筆刷模式' })).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('.float-btn.held')).toHaveCount(0);
});

/** what iOS does when the user swipes home or a call comes in: the page turns hidden (Editor's flushHistory listener) */
const setVisibility = (page: Page, state: 'hidden' | 'visible') =>
  page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);

test('backgrounding mid-stroke commits and saves the stroke; the rest of the drag draws nothing', async ({ page }) => {
  await openPhoto(page, { name: 'line.png', mimeType: 'image/png', buffer: linePng() });
  await enterBrush(page, '美體');
  const { at } = await photoToClient(page, LINE);
  const s = at(LINE.x, 450);
  await page.mouse.move(s.x, s.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(s.x + 3 * i, s.y);
  await setVisibility(page, 'hidden');
  // committed by the hidden-flush while the finger is still down: one record, one undo step
  await expect.poll(() => strokes(page)).toBe(1);
  for (let i = 9; i <= 16; i++) await page.mouse.move(s.x + 3 * i, s.y); // the finger keeps moving
  await page.mouse.up();
  await setVisibility(page, 'visible');
  await page.waitForTimeout(300);
  expect(await strokes(page)).toBe(1);
  const undo = page.getByRole('button', { name: '復原' });
  await undo.click();
  await expect.poll(() => strokes(page)).toBe(0);
  await expect(undo).toBeDisabled(); // the drag after the flush made no second step
  await page.getByRole('button', { name: '重做' }).click();
  await expect.poll(() => strokes(page)).toBe(1);
  // the flush wrote the entry: a reopen shows the stroke
  await page.getByRole('button', { name: '關閉' }).click();
  await expect.poll(async () => (await debugState(page)).screen).toBe('home');
  await page.getByRole('button', { name: '開啟編輯' }).first().click();
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 60_000 });
  await expect.poll(() => strokes(page)).toBe(1);
});

test('↶ and 全部清除 wait while a finger draws; finger-up makes exactly one undo step', async ({ page }) => {
  await openPhoto(page, { name: 'line.png', mimeType: 'image/png', buffer: linePng() });
  await enterBrush(page, '美體');
  const { at } = await photoToClient(page, LINE);
  const a = at(LINE.x, 300);
  await brushDrag(page, a, { x: a.x + 24, y: a.y });
  await expect.poll(() => strokes(page)).toBe(1);
  const undo = page.getByRole('button', { name: '復原' });
  const clear = page.getByRole('button', { name: '全部清除' });
  await expect(undo).toBeEnabled();
  await expect(clear).toBeEnabled();
  const b = at(LINE.x, 600);
  await page.mouse.move(b.x, b.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(b.x + 3 * i, b.y);
  // a stroke is live: nothing may undo or clear a half-built stroke
  await expect(undo).toBeDisabled();
  await expect(page.getByRole('button', { name: '重做' })).toBeDisabled();
  await expect(clear).toBeDisabled();
  await page.mouse.up();
  await expect.poll(() => strokes(page)).toBe(2);
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect.poll(() => strokes(page)).toBe(1); // only the second stroke went
  await undo.click();
  await expect.poll(() => strokes(page)).toBe(0);
});

// ── v0.4 cleanup (step-6 review) ──

test('按住對比 in brush mode keeps the mode: the bar stays, a second finger draws nothing, the hint does not come back', async ({ page }) => {
  await openPhoto(page, { name: 'line.png', mimeType: 'image/png', buffer: linePng() });
  await enterBrush(page, '美體');
  const hb = (await page.getByRole('button', { name: '按住對比' }).boundingBox())!;
  const holdPt = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2, id: 1 };
  const { at } = await photoToClient(page, LINE);
  const c = at(LINE.x, 450);
  // what the page shows on every frame while the hold is down (one touch sequence: no assertion can run inside it)
  await page.evaluate(() => {
    const w = window as unknown as { __hold: { frames: number; bar: number; ring: number; hint: number } };
    w.__hold = { frames: 0, bar: 0, ring: 0, hint: 0 };
    const tick = () => {
      if (document.querySelector('.float-btn.held')) {
        w.__hold.frames++;
        if (document.querySelector('.brush-bar [role="radiogroup"][aria-label="筆刷模式"]')) w.__hold.bar++;
        if (document.querySelector('.brush-ring:not(.hidden)')) w.__hold.ring++;
      }
      if (document.querySelector('.brush-hint')) w.__hold.hint++;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await touch(page, [
    { type: 'touchStart', points: [holdPt], waitMs: 200 },
    // a second finger on the photo while the hold is down
    { type: 'touchStart', points: [holdPt, { x: c.x, y: c.y, id: 2 }], waitMs: 16 },
    ...[1, 2, 3, 4, 5, 6].map((i) => ({ type: 'touchMove' as const, points: [holdPt, { x: c.x + 4 * i, y: c.y, id: 2 }], waitMs: 16 })),
    { type: 'touchEnd', points: [holdPt], waitMs: 200 },
    { type: 'touchEnd', points: [], waitMs: 600 },
  ]);
  const seen = await page.evaluate(() => (window as unknown as { __hold: { frames: number; bar: number; ring: number; hint: number } }).__hold);
  console.log(`按住對比 in brush mode: ${seen.frames} held frames, the bar in ${seen.bar}, the ring in ${seen.ring}; hint frames ${seen.hint}`);
  expect(seen.frames).toBeGreaterThan(5);
  expect(seen.bar).toBe(seen.frames); // the brush bar never left
  expect(seen.ring).toBe(0);
  expect(seen.hint).toBe(0); // the release is no re-entry: no hint pill
  await expect(page.locator('.float-btn.held')).toHaveCount(0);
  expect(await strokes(page)).toBe(0);
  await expect(page.getByRole('button', { name: '復原' })).toBeDisabled();
  // the mode draws at once after the release
  await brushDrag(page, c, { x: c.x + 24, y: c.y });
  await expect.poll(() => strokes(page)).toBe(1);
});

test('the debounced export fired after a stroke’s first stamps but before the drawing flip snapshots nothing of it', async ({ page }) => {
  await openPhoto(page, { name: 'line.png', mimeType: 'image/png', buffer: linePng() });
  const a = await savedPixels(page);
  await expect.poll(() => thumbLineShift(page, 450), { timeout: 10_000 }).toBeLessThanOrEqual(1);
  await page.getByRole('tab', { name: '美體' }).click();
  // the editor's 400 ms debounced encode / autosave is held back, so the test fires it at the moment of the race;
  // synthetic pointers (setPointerCapture is a no-op for them) give the exact order within one frame
  await page.evaluate(() => {
    type Held = { fn: () => void; cancelled: boolean };
    const w = window as unknown as { __held: Held[] };
    const st = window.setTimeout.bind(window);
    const ct = window.clearTimeout.bind(window);
    const held = new Map<number, Held>();
    let fake = 1e9;
    w.__held = [];
    window.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
      if (ms === 400 && typeof fn === 'function' && fn.constructor.name === 'AsyncFunction') {
        const rec: Held = { fn: fn as () => void, cancelled: false };
        held.set(++fake, rec);
        w.__held.push(rec);
        return fake;
      }
      return st(fn, ms, ...args);
    }) as typeof window.setTimeout;
    window.clearTimeout = ((id?: number) => {
      const r = id === undefined ? undefined : held.get(id);
      if (r) r.cancelled = true;
      else ct(id);
    }) as typeof window.clearTimeout;
    Element.prototype.setPointerCapture = () => undefined;
  });
  await option(page, '背景保護').click(); // an edit: arms the (held) debounced export
  await option(page, '推臉筆').click();
  await expect(page.getByRole('radiogroup', { name: '筆刷模式' })).toBeVisible();
  const { at } = await photoToClient(page, LINE);
  const s = at(LINE.x, 450);
  const r = await page.evaluate(
    ({ x, y }) =>
      new Promise<{ armed: boolean }>((resolve) => {
        const w = window as unknown as { __held: { fn: () => void; cancelled: boolean }[] };
        const timer = w.__held.filter((h) => !h.cancelled).at(-1);
        const target = document.querySelector('.editor-stage canvas') ?? document.querySelector('.editor-stage')!;
        const ev = (type: string, id: number, px: number) =>
          target.dispatchEvent(
            new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: px, clientY: y, button: 0, buttons: 1 }),
          );
        ev('pointerdown', 1, x);
        for (let i = 1; i <= 8; i++) ev('pointermove', 1, x + 3 * i);
        // after the queue's frame (its stamps are applied), before Preact's effect flush (the drawing flip's cleanup)
        requestAnimationFrame(() => {
          const armed = !!timer && !timer.cancelled;
          if (armed) timer!.fn();
          // a second finger within PINCH_GRACE_MS cancels the stroke: no undo step, the pre-stroke params stay
          ev('pointerdown', 2, x + 80);
          ev('pointerup', 2, x + 80);
          ev('pointerup', 1, x + 24);
          resolve({ armed });
        });
      }),
    s,
  );
  expect(r.armed, 'the export armed before the stroke was still pending when the stamps landed').toBe(true);
  await page.waitForTimeout(1500); // a mid-stroke encode and its history write would land by now
  expect(await strokes(page)).toBe(0);
  const b = await savedPixels(page);
  const row = Math.round((450 / LINE.height) * a.height);
  const band: [number, number] = [row - 4, row + 4];
  const shift = Math.abs(darkestColumn(b, band, [0, b.width - 1]) - darkestColumn(a, band, [0, a.width - 1]));
  console.log(`a debounced export at the race: the shared file's line moved ${shift} px at the stroke row`);
  expect(shift).toBeLessThanOrEqual(1);
  expect(await thumbLineShift(page, 450)).toBeLessThanOrEqual(1);
});
