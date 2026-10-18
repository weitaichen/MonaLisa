// Photo face detection and its detectors (step-1 spec §6.5). BlazeFace full-range, which finds a group photo's small
// faces, misses a face that fills the frame or is cut off by its edge; the camera's short-range detector finds it, so a
// photo whose full-range answer has no usable face asks the short-range one once more (app/still.ts). The fixtures are
// sample_face.png composed in a blank page (canvas, then PNG): a 3:4 close-up whose face is 1.1 × the frame's height, a
// 3:4 portrait with the face's top 35 % above the frame (the forehead cut at the brows), and a 4:3 landscape whose face
// (0.3 of the height) is 35 % past the left edge. Full-range finds none of them on SwiftShader and on CPU (and on D3D11),
// short-range finds each. The detector is also off the camera's critical path, and a failed download is retried (C4).
// Round 2: a photo waits for the detector's first download for 3 s at most, once, and never for a retry (D1); a camera
// shot whose selected face full-range misses gains it from short-range (D2); a photo detected short-range because the
// detector was missing gains its missing faces at a later open (D3). Round 3: that completion runs in the open the
// detector is in, after the cached faces are drawn (also when the detector lands while the photo is open), and a faceless
// sideways answer is scanned again full-range in its turned up-frame. Round 4: what holds the completion (裁切, a slider
// drag, a working-size 儲存 in 準備中, also one tapped inside its paint), what brings the detector (the link's 'online',
// a request the editor never made), what it leaves (no 「未偵測到臉部」 for an up-frame asked again, no scan of one
// full-range answered, no session rebuilt and no field texture released when it adds no face). Round 5: a return to the
// app (visibilitychange) asks for the detector again, and a completion whose detection throws leaves the scan it held
// back to run.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { test as bare, type Page, type Route } from '@playwright/test';
import { brushDrag, debugState, dragSlider, emptyPng, expect, liquifyState, personChip, SAMPLE_FACE, test } from './fixtures';

/** sample_face.png's face: the oval bbox of its landmarks, x 193–813, y 270–992 px (centre 503, 631; 620 × 722) */
const FACE = { cx: 503, cy: 631, w: 620, h: 722 };

interface Shot {
  /** width / height of the photo */
  aspect: number;
  /** the face's height as a fraction of the photo's */
  f: number;
  /** the face centre, fractions of the photo's width and height */
  cx: number;
  cy: number;
  /** turned 90° clockwise after composing (a sideways photo) */
  sideways?: boolean;
}

const SHOTS: Record<string, Shot> = {
  closeup: { aspect: 3 / 4, f: 1.1, cx: 0.5, cy: 0.5 },
  browcut: { aspect: 3 / 4, f: 0.55, cx: 0.5, cy: 0.15 * 0.55 },
  sidecut: { aspect: 4 / 3, f: 0.3, cx: (0.15 * FACE.w * 0.3) / FACE.h / (4 / 3), cy: 0.5 },
};

/** a photo of sample_face.png as `s` says, 2048 px on its long edge, PNG */
async function compose(page: Page, s: Shot): Promise<Buffer> {
  const blank = await page.context().newPage();
  try {
    await blank.setContent('<!doctype html><meta charset="utf-8"><body></body>');
    const url = await blank.evaluate(
      async ({ src, s, face }) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const outH = s.aspect <= 1 ? 2048 : Math.round(2048 / s.aspect);
        const outW = Math.round(outH * s.aspect);
        const c = document.createElement('canvas');
        c.width = outW;
        c.height = outH;
        const g = c.getContext('2d')!;
        g.fillStyle = 'rgb(128,128,128)';
        g.fillRect(0, 0, outW, outH);
        const k = (s.f * outH) / face.h;
        g.drawImage(img, s.cx * outW - face.cx * k, s.cy * outH - face.cy * k, img.naturalWidth * k, img.naturalHeight * k);
        if (!s.sideways) return c.toDataURL('image/png');
        const r = document.createElement('canvas');
        r.width = outH;
        r.height = outW;
        const rg = r.getContext('2d')!;
        rg.setTransform(0, 1, -1, 0, outH, 0);
        rg.drawImage(c, 0, 0);
        return r.toDataURL('image/png');
      },
      { src: `data:image/png;base64,${readFileSync(SAMPLE_FACE).toString('base64')}`, s, face: FACE },
    );
    return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  } finally {
    await blank.close();
  }
}

async function useDelegate(page: Page, delegate: 'auto' | 'CPU'): Promise<void> {
  await page.goto('/');
  if (delegate === 'CPU') {
    await page.evaluate(() => localStorage.setItem('meiyan.prefs.v1', JSON.stringify({ delegate: 'CPU' })));
    await page.reload();
  }
}

/** import a photo through the picker and wait for the editor, recording every toast */
async function importPhoto(page: Page, name: string, buffer: Buffer): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __toasts: string[] };
    w.__toasts = [];
    new MutationObserver(() => {
      for (const el of document.querySelectorAll('.toast')) {
        const t = (el.textContent ?? '').trim();
        if (t && w.__toasts.at(-1) !== t) w.__toasts.push(t);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /匯入照片/ }).click();
  await (await chooser).setFiles({ name, mimeType: 'image/png', buffer });
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 90_000 });
}
const toasts = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts);
const NO_FACE = '未偵測到臉部，臉型、美妝與膚質工具不會套用';

for (const delegate of ['auto', 'CPU'] as const) {
  for (const [name, shot] of Object.entries(SHOTS)) {
    test(`${name}: full-range finds no face, the short-range retry finds it, and its face tools apply (${delegate})`, async ({ page }) => {
      const png = await compose(page, shot);
      await useDelegate(page, delegate);
      await importPhoto(page, `${name}.png`, png);
      await expect.poll(async () => (await debugState(page)).faces, { timeout: 30_000 }).toBe(1);
      const d = await debugState(page);
      expect(d.delegate).toBe(delegate === 'CPU' ? 'CPU' : 'GPU');
      // one answer, one retry inside it
      expect(d.detectCalls).toBe(1);
      expect(d.detectRetries).toBe(1);
      // the box is the composed face (centre within 0.15 of the photo)
      const b = d.boxes[0];
      const [ex, ey] = [Math.min(1, Math.max(0, shot.cx)), Math.min(1, Math.max(0, shot.cy))];
      expect(Math.hypot(b.x + b.w / 2 - ex, b.y + b.h / 2 - ey), JSON.stringify(b)).toBeLessThan(0.2);
      await page.waitForTimeout(1000);
      expect(await toasts(page)).not.toContain(NO_FACE);
      await expect(page.getByText(NO_FACE)).toHaveCount(0);
    });
  }

  test(`a sideways close-up: nobody upright; the scan of the turned photo retries on short-range like an upright detection (${delegate})`, async ({ page }) => {
    const png = await compose(page, { ...SHOTS.closeup, sideways: true });
    await useDelegate(page, delegate);
    await importPhoto(page, 'closeup_sideways.png', png);
    // upright: full-range and the retry both find nobody (the face lies on its side)
    await expect.poll(async () => (await debugState(page)).detectCalls, { timeout: 30_000 }).toBe(1);
    const before = await debugState(page);
    expect(before.faces).toBe(0);
    // 裁切 › 旋轉 turns it upright; leaving 裁切 scans the new up-frame once (S §3.6): full-range misses, short-range finds it
    await page.getByRole('tab', { name: '裁切', exact: true }).click();
    await page.getByRole('option', { name: '旋轉', exact: true }).click();
    await page.getByRole('tab', { name: '美膚', exact: true }).click();
    await expect.poll(async () => (await debugState(page)).detectCalls, { timeout: 60_000 }).toBe(2);
    await expect.poll(async () => (await debugState(page)).faces, { timeout: 30_000 }).toBe(1);
    // a retry upright (nobody) and one in the scan (the face)
    expect((await debugState(page)).detectRetries).toBe(2);
    expect((await debugState(page)).lastError).toBeNull();
  });
}

// page.route needs the service worker out of the way, and a blocked request logs Chromium's own "Failed to load resource"
// console error: the fixtures' guard would fail on it, so these two check the console themselves (as faceProtect.spec.ts)
bare.describe('the photo detector download (C4)', () => {
  bare.use({ serviceWorkers: 'block' });
  /** console errors other than the blocked request's own */
  const watchConsole = (page: Page) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' && !/^Failed to load resource/.test(m.text()) && !/^INFO: Created TensorFlow Lite XNNPACK delegate/.test(m.text())) errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    return errors;
  };
  const DETECTOR = '**/models/face_detector/full-range-float16-1/blaze_face_full_range.tflite';

  bare('the camera starts while the photo detector is still downloading', async ({ page }) => {
    const errors = watchConsole(page);
    // the detector request never answers (a stalled link): the engine must not wait for it (its stall abort is 30 s)
    await page.route(DETECTOR, () => undefined);
    let aborted = Number.POSITIVE_INFINITY;
    const t0 = Date.now();
    page.on('requestfailed', (r) => {
      if (r.url().includes('blaze_face_full_range')) aborted = Math.min(aborted, Date.now() - t0);
    });
    await page.goto('/');
    await page.getByRole('button', { name: /拍攝/ }).click();
    await page.getByRole('button', { name: '點擊開啟相機' }).click();
    await expect
      .poll(async () => {
        const d = await debugState(page);
        return d.cameraState === 'live' && d.face === true && d.fps > 0;
      }, { timeout: 90_000, intervals: [500] })
      .toBe(true);
    const live = Date.now() - t0;
    console.log(`camera live after ${live} ms; detector request failed after ${aborted} ms`);
    expect(live).toBeLessThan(aborted);
    expect(errors).toEqual([]);
  });

  const group = readFileSync(new URL('../fixtures/small_faces.jpg', import.meta.url));
  /** import small_faces.jpg (or `buffer`, a JPEG unless `mimeType` says); resolves once its face answer is in, with the ms from the file pick */
  const openGroup = async (page: Page, name = 'small_faces.jpg', buffer: Buffer = group, mimeType = 'image/jpeg') => {
    const calls = (await debugState(page)).detectCalls;
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /匯入照片/ }).click();
    const t0 = Date.now();
    await (await chooser).setFiles({ name, mimeType, buffer });
    await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 90_000 });
    await expect.poll(async () => (await debugState(page)).detectCalls, { timeout: 60_000 }).toBeGreaterThan(calls);
    return { ms: Date.now() - t0, faces: (await debugState(page)).faces };
  };
  const closeEditor = async (page: Page) => {
    await page.getByRole('button', { name: '關閉' }).click();
    await expect(page.getByRole('button', { name: /匯入照片/ })).toBeVisible({ timeout: 15_000 });
  };
  /**
   * every change of the debug state's delegate and face count, polled every 5 ms in the page, and every toast: what the
   * editor showed and when (a synchronous detection blocks the poll, so a count drawn before one is seen only if it was
   * drawn before it)
   */
  const record = (page: Page) =>
    page.evaluate(() => {
      type Entry = { t: number; delegate: string | null; faces: number };
      const w = window as unknown as { __shown: Entry[]; __toasts: string[]; __meiyan?: { delegate: string | null; faces: number } };
      w.__shown = [];
      w.__toasts = [];
      let last = '';
      setInterval(() => {
        const d = w.__meiyan;
        const key = `${d?.delegate ?? ''}|${d?.faces ?? 0}`;
        if (key === last) return;
        last = key;
        w.__shown.push({ t: performance.now(), delegate: d?.delegate ?? null, faces: d?.faces ?? 0 });
      }, 5);
      new MutationObserver(() => {
        for (const el of document.querySelectorAll('.toast')) {
          const t = (el.textContent ?? '').trim();
          if (t && w.__toasts.at(-1) !== t) w.__toasts.push(t);
        }
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
  const shown = (page: Page) => page.evaluate(() => (window as unknown as { __shown: { t: number; delegate: string | null; faces: number }[] }).__shown);
  /** the face counts the editor showed, in order */
  const counts = async (page: Page) => (await shown(page)).map((x) => x.faces);
  /** 裁切 › 旋轉 `taps` times, then back to 美膚: the scan of the new up-frame (S §3.6) runs; resolves with its faces */
  const turnUpright = async (page: Page, taps: number) => {
    const calls = (await debugState(page)).detectCalls;
    await page.getByRole('tab', { name: '裁切', exact: true }).click();
    for (let i = 0; i < taps; i++) await page.getByRole('option', { name: '旋轉', exact: true }).click();
    await page.getByRole('tab', { name: '美膚', exact: true }).click();
    await expect.poll(async () => (await debugState(page)).detectCalls, { timeout: 60_000 }).toBe(calls + 1);
    return (await debugState(page)).faces;
  };
  /** the stored entries' detection caches and person params (IndexedDB meiyan / edits) */
  const stored = (page: Page) =>
    page.evaluate(
      () =>
        new Promise<{ id: string; mark: unknown; faces: string[]; persons: string[]; scans: number[]; eye: Record<string, number> }[]>((resolve, reject) => {
          const open = indexedDB.open('meiyan', 1);
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const req = open.result.transaction('edits', 'readonly').objectStore('edits').getAll();
            req.onsuccess = () => {
              type Row = {
                id: string;
                updatedAt?: number;
                detect?: { photoDetector?: string; faces: { id: string }[]; persons: { id: string }[]; faceScans: { quarter: number }[] };
                edit?: { persons: Record<string, { values: Record<string, number> }> };
              };
              resolve(
                (req.result as Row[])
                  .filter((r) => typeof r.updatedAt === 'number')
                  .map((r) => ({
                    id: r.id,
                    mark: r.detect?.photoDetector,
                    faces: (r.detect?.faces ?? []).map((f) => f.id),
                    persons: (r.detect?.persons ?? []).map((p) => p.id),
                    scans: (r.detect?.faceScans ?? []).map((x) => x.quarter),
                    eye: Object.fromEntries(Object.entries(r.edit?.persons ?? {}).map(([id, p]) => [id, p.values['shape.eyeEnlarge']])),
                  })),
              );
              open.result.close();
            };
          };
        }),
    );

  bare('D1: a photo opened while the detector download hangs shows its faces within the wait cap, not after the stall timeout', async ({ page }) => {
    bare.setTimeout(180_000);
    const errors = watchConsole(page);
    // the request never answers (lie-fi): the download's own stall abort comes only after 30 s of silence
    await page.route(DETECTOR, () => undefined);
    let aborted = Number.POSITIVE_INFINITY;
    const t0 = Date.now();
    page.on('requestfailed', (r) => {
      if (r.url().includes('blaze_face_full_range')) aborted = Math.min(aborted, Date.now() - t0);
    });
    await page.goto('/');
    const first = await openGroup(page);
    const at = Date.now() - t0;
    console.log(`first photo: faces ${first.faces} after ${first.ms} ms from the pick (${at} ms from load); detector aborted after ${aborted} ms`);
    // short-range answered (the detector never came), well before the download gave up
    expect(first.faces).toBeGreaterThan(0);
    expect(first.faces).toBeLessThan(7);
    expect(at).toBeLessThan(aborted);
    expect(first.ms).toBeLessThan(20_000);
    // it waited once, for the engine download's own request (the session's first download)
    expect((await debugState(page)).detectorWaits).toBe(1);
    // the cap is spent once per session: the next photo waits for nothing (its answer is in about as fast as a detection)
    await closeEditor(page);
    const second = await openGroup(page, 'small_faces_2.jpg');
    console.log(`second photo: faces ${second.faces} after ${second.ms} ms`);
    expect(second.ms).toBeLessThan(first.ms);
    expect((await debugState(page)).detectorWaits).toBe(1);
    expect(Date.now() - t0).toBeLessThan(aborted);
    // both are marked as short-range answers in 最近編輯 (D3)
    await closeEditor(page);
    await expect.poll(async () => (await stored(page)).map((e) => e.mark)).toEqual(['short-range', 'short-range']);
    expect(errors).toEqual([]);
  });

  bare('D1: no wait on a retry after a failed download; D3: a reopen draws the short-range cache at once and gains the missing faces when the detector lands, the edited person untouched', async ({ page }) => {
    bare.setTimeout(240_000);
    const errors = watchConsole(page);
    // the first request fails at once, every retry hangs until the link comes back
    let requests = 0;
    let release = false;
    const hanging: Route[] = [];
    await page.route(DETECTOR, (r) => {
      requests++;
      if (requests === 1) return r.abort();
      if (release) return r.continue();
      hanging.push(r);
      return undefined;
    });
    await page.goto('/');
    await record(page);
    // short-range finds only the larger faces of the seven
    const first = await openGroup(page);
    expect(first.faces).toBeLessThan(7);
    expect(first.faces).toBeGreaterThan(0);
    // the failed request was the engine download's own, the session's first download: the first photo waits for no
    // retry, though the one the engine's 'done' started hangs (round 2 took that retry for the first download and held
    // this photo on it for DETECTOR_WAIT_MS)
    const firstLog = await shown(page);
    const firstReady = firstLog.find((x) => x.delegate !== null)!;
    const firstDrawn = firstLog.find((x) => x.faces === first.faces)!;
    console.log(`first photo after a failed download: faces ${first.faces} after ${first.ms} ms, ${firstDrawn.t - firstReady.t} ms after the engine was ready; detector requests ${requests}`);
    expect(requests).toBeGreaterThanOrEqual(2);
    expect((await debugState(page)).detectorWaits ?? 0).toBe(0);
    // the engine ready to the faces drawn is the detection alone (1.6–1.8 s on SwiftShader, its first IMAGE-mode graph
    // build included): a wait for that retry would add DETECTOR_WAIT_MS (3 s), 4.7 s in all
    expect(firstDrawn.t - firstReady.t).toBeLessThan(3500);
    // 大眼 to the top on the selected (primary) person
    const primary = (await debugState(page)).selected!;
    await page.getByRole('tab', { name: '美型' }).click();
    await page.getByRole('option', { name: '大眼', exact: true }).click();
    const s = page.getByRole('slider');
    await s.focus();
    for (let i = 0; i < 100; i++) await page.keyboard.press('ArrowRight');
    await expect.poll(async () => (await stored(page))[0]?.eye[primary] ?? 0, { timeout: 15_000 }).toBe(1);
    await closeEditor(page);
    const before = (await stored(page))[0];
    expect(before.mark).toBe('short-range');
    expect(before.faces).toHaveLength(first.faces);
    // a second photo while a retry hangs: no wait for it (on a 30 s stall), short-range at once
    const second = await openGroup(page, 'small_faces_2.jpg');
    console.log(`photo after a failed download: faces ${second.faces} after ${second.ms} ms (first photo ${first.ms} ms)`);
    expect(requests).toBeGreaterThanOrEqual(2);
    expect(second.ms).toBeLessThan(15_000);
    expect(second.faces).toBeLessThan(7);
    await closeEditor(page);
    // a relaunch while the link still hangs: the engine's own detector request is the session's first download, in
    // flight. Reopening the first entry (the older one, last in 最近編輯) draws its cached faces at once: a session from the
    // cache waits for no download, a short-range one included (§6.5; round 2 waited DETECTOR_WAIT_MS here for nothing)
    for (const r of hanging.splice(0)) await r.abort().catch(() => undefined);
    await page.reload();
    await expect(page.getByRole('button', { name: /匯入照片/ })).toBeVisible({ timeout: 30_000 });
    await record(page);
    const calls = (await debugState(page)).detectCalls;
    await page.getByRole('button', { name: '開啟編輯' }).last().click();
    await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 60_000 });
    await expect.poll(async () => (await debugState(page)).faces, { timeout: 30_000 }).toBe(before.faces.length);
    const log = await shown(page);
    const ready = log.find((x) => x.delegate !== null)!;
    const drawn = log.find((x) => x.faces === before.faces.length)!;
    console.log(`reopen: cached faces ${drawn.t - ready.t} ms after the engine was ready; detector requests hanging ${hanging.length}`);
    expect(drawn.t - ready.t).toBeLessThan(1500);
    expect(hanging.length).toBeGreaterThan(0);
    expect((await debugState(page)).detectCalls).toBe(calls);
    // the link comes back while the photo is open: the download lands, and the photo is completed in this open: one
    // full-range detection, its new faces beside the cached ones (round 2 left that to the next open)
    release = true;
    for (const r of hanging.splice(0)) await r.continue().catch(() => undefined);
    await expect.poll(async () => (await debugState(page)).faces, { timeout: 60_000 }).toBe(7);
    expect((await debugState(page)).detectCalls).toBe(calls + 1);
    // the cached faces were drawn first, and stayed until the completion added the rest
    const seen = await counts(page);
    expect(seen.indexOf(before.faces.length)).toBeGreaterThanOrEqual(0);
    expect(seen.indexOf(before.faces.length)).toBeLessThan(seen.indexOf(7));
    await closeEditor(page);
    const after = (await stored(page)).find((e) => e.id === before.id)!;
    expect(after.mark).toBeUndefined();
    expect(after.faces).toHaveLength(7);
    // every cached face and person kept its id; the new ones start at 原圖 (the template)
    expect(after.persons.slice(0, before.persons.length)).toEqual(before.persons);
    expect(after.eye[primary]).toBe(1);
    for (const id of after.persons.filter((p) => !before.persons.includes(p))) expect(after.eye[id]).toBe(0);
    // and it stays that way: a further open detects nothing
    const settled = (await debugState(page)).detectCalls;
    await page.getByRole('button', { name: '開啟編輯' }).last().click();
    await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 60_000 });
    await expect.poll(async () => (await debugState(page)).faces, { timeout: 30_000 }).toBe(7);
    expect((await debugState(page)).detectCalls).toBe(settled);
    expect(errors).toEqual([]);
  });

  /**
   * small_faces.jpg's three large cells (px, 8 px of margin), as scripts/gen-group-fixture.mjs lays them out
   * (SMALL_FACES' faces of 10 % of the width or more, smallFaceCell), in its order: 0 the 14 % face, 1 the 12.5 %, 2 the
   * 10.5 %
   */
  const largeCells = async () => {
    type Spec = { fw: number; cx: number; cy: number; mirror: boolean };
    const { SMALL_FACES, smallFaceCell } = (await import(new URL('../../scripts/gen-group-fixture.mjs', import.meta.url).href)) as {
      SMALL_FACES: { faces: Spec[] };
      smallFaceCell(spec: Spec): { x: number; y: number; size: number };
    };
    const cells = SMALL_FACES.faces.filter((f) => f.fw >= 0.1).map((f) => smallFaceCell(f));
    expect(cells).toHaveLength(3);
    return cells.map((c) => ({ x: c.x - 8, y: c.y - 8, w: c.size + 16, h: c.size + 16 }));
  };
  /**
   * small_faces.jpg with its large cells erased to the background except `keep`, turned `turns` × 90° clockwise, as a
   * JPEG (drawn on `page` before it loads the app). The four small faces (6–7.8 % of the width) are what short-range
   * misses
   */
  const smallFaces = async (page: Page, keep: number[], turns: number): Promise<Buffer> => {
    const large = await largeCells();
    await page.setContent('<!doctype html><meta charset="utf-8"><body></body>');
    const url = await page.evaluate(
      async ({ src, erase, turns }) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        let c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const g = c.getContext('2d')!;
        g.drawImage(img, 0, 0);
        const p = g.getImageData(5, 5, 1, 1).data;
        g.fillStyle = `rgb(${p[0]},${p[1]},${p[2]})`;
        for (const r of erase) g.fillRect(r.x, r.y, r.w, r.h);
        for (let k = 0; k < turns; k++) {
          const r = document.createElement('canvas');
          r.width = c.height;
          r.height = c.width;
          const rg = r.getContext('2d')!;
          rg.setTransform(0, 1, -1, 0, c.height, 0);
          rg.drawImage(c, 0, 0);
          c = r;
        }
        return c.toDataURL('image/jpeg', 0.92);
      },
      { src: `data:image/jpeg;base64,${group.toString('base64')}`, erase: large.filter((_, i) => !keep.includes(i)), turns },
    );
    return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  };
  const NO_FACE_TOAST = '未偵測到臉部，臉型、美妝與膚質工具不會套用';

  bare('a short-range answer is completed in the open the detector is in: faceless upright, faceless sideways (its turned up-frame scanned again, full-range), faces found sideways (completed where they were found)', async ({ page }) => {
    bare.setTimeout(420_000);
    const errors = watchConsole(page);
    // the detector is missing (every request fails at once) until the link comes back
    let release = false;
    await page.route(DETECTOR, (r) => (release ? r.continue() : r.abort()));
    // probed on SwiftShader: short-range finds none of the four small faces upright or turned, full-range 4 upright;
    // turned 270° full-range finds none upright and 4 once turned back; with the 10.5 % face kept and turned 90°,
    // short-range finds that face alone once turned back, full-range none upright and 4 turned back
    const small = await smallFaces(page, [], 0);
    const smallSide = await smallFaces(page, [], 3);
    const oneSide = await smallFaces(page, [2], 1);
    await page.goto('/');
    const ids = async () => (await stored(page)).map((e) => e.id);
    const added = async (known: string[]) => (await stored(page)).find((e) => !known.includes(e.id))!;

    // A: upright, nobody short-range
    expect((await openGroup(page, 'small.jpg', small)).faces).toBe(0);
    await closeEditor(page);
    const a = await added([]);
    expect([a.mark, a.faces, a.scans]).toEqual(['short-range', [], [0]]);
    // B: turned 270°: nobody upright, nobody short-range once turned upright either (旋轉 is a quarter turn left: × 3
    // shows quarter 1)
    let known = await ids();
    expect((await openGroup(page, 'small_side.jpg', smallSide)).faces).toBe(0);
    expect(await turnUpright(page, 3)).toBe(0);
    await closeEditor(page);
    const b = await added(known);
    expect([b.mark, b.faces, b.scans]).toEqual(['short-range', [], [0, 1]]);
    // C: turned 90°: nobody upright, the 10.5 % face short-range once turned upright (quarter 3)
    known = await ids();
    expect((await openGroup(page, 'one_side.jpg', oneSide)).faces).toBe(0);
    expect(await turnUpright(page, 1)).toBe(1);
    await closeEditor(page);
    const c = await added(known);
    expect([c.mark, c.faces.length, c.scans]).toEqual(['short-range', 1, [0, 3]]);

    // the link comes back. 最近編輯 lists C, B, A, and a completion (a touch: false write) does not reorder it
    release = true;
    const reopen = async (nth: number) => {
      // (a toast of the last editor gone first: only this open's count)
      await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 });
      await record(page);
      const calls = (await debugState(page)).detectCalls;
      await page.getByRole('button', { name: '開啟編輯' }).nth(nth).click();
      await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 60_000 });
      return calls;
    };
    // A: the cached "nobody" is a definite answer (no toast), and the completion asks upright, full-range, which finds
    // the small faces: they merge as into a 基本模式 cache (A15), the mark goes
    let calls = await reopen(2);
    await expect.poll(async () => (await debugState(page)).detectCalls, { timeout: 60_000 }).toBe(calls + 1);
    await expect.poll(async () => (await debugState(page)).faces, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
    const aFaces = (await debugState(page)).faces;
    await page.waitForTimeout(1000);
    expect(await toasts(page)).not.toContain(NO_FACE_TOAST);
    await closeEditor(page);
    const aAfter = (await stored(page)).find((e) => e.id === a.id)!;
    expect([aAfter.mark, aAfter.faces.length, aAfter.scans]).toEqual([undefined, aFaces, [0]]);
    // B (Codex round 3): the completion asks upright and finds nobody; that answer replaces the upright record alone, and
    // the turned one is still owed its full-range look (round 4), so the turned photo is scanned again, full-range, and
    // finds the faces. Round 2 kept the turned short-range "nobody" and cleared the mark: no scan, never any face
    calls = await reopen(1);
    await expect.poll(async () => (await debugState(page)).detectCalls, { timeout: 90_000 }).toBe(calls + 2);
    await expect.poll(async () => (await debugState(page)).faces, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
    const bFaces = (await debugState(page)).faces;
    await page.waitForTimeout(1000);
    expect(await toasts(page)).not.toContain(NO_FACE_TOAST);
    await closeEditor(page);
    const bAfter = (await stored(page)).find((e) => e.id === b.id)!;
    expect([bAfter.mark, bAfter.faces.length, bAfter.scans]).toEqual([undefined, bFaces, [0, 1]]);
    // C: the cached face is drawn at once, then the completion runs where it was found (quarter 3; upright full-range
    // finds none), and adds the small faces beside it; the cached person keeps its id and stays first
    calls = await reopen(0);
    await expect.poll(async () => (await debugState(page)).detectCalls, { timeout: 60_000 }).toBe(calls + 1);
    await expect.poll(async () => (await debugState(page)).faces, { timeout: 30_000 }).toBeGreaterThanOrEqual(3);
    const cFaces = (await debugState(page)).faces;
    const seen = await counts(page);
    expect(seen.lastIndexOf(1)).toBeGreaterThanOrEqual(0);
    expect(seen.lastIndexOf(1)).toBeLessThan(seen.lastIndexOf(cFaces));
    await closeEditor(page);
    const cAfter = (await stored(page)).find((e) => e.id === c.id)!;
    expect([cAfter.mark, cAfter.faces.length, cAfter.scans]).toEqual([undefined, cFaces, [0, 3]]);
    expect(cAfter.persons[0]).toBe(c.persons[0]);
    // nothing is left to complete: a further open of B detects nothing
    calls = await reopen(1);
    await expect.poll(async () => (await debugState(page)).faces, { timeout: 30_000 }).toBe(bFaces);
    await page.waitForTimeout(1000);
    expect((await debugState(page)).detectCalls).toBe(calls);
    expect(errors).toEqual([]);
  });

  /**
   * The face tracker's GPU context is lost as soon as each of its instances is built (as body.spec.ts killFaceTracker:
   * the first caller past MediaPipe's getContext wrapper is the tracker chunk), so it stays 'lost' until faceTrackerLives
   * lets the next replacement live
   */
  const killFaceTracker = (page: Page) =>
    page.addInitScript(() => {
      const w = window as unknown as { __faceKill: boolean };
      w.__faceKill = true;
      const get = OffscreenCanvas.prototype.getContext as (this: OffscreenCanvas, type: string, ...rest: unknown[]) => unknown;
      (OffscreenCanvas.prototype as unknown as { getContext: typeof get }).getContext = function (this: OffscreenCanvas, type: string, ...rest: unknown[]) {
        const ctx = get.call(this, type, ...rest) as WebGL2RenderingContext | null;
        if (w.__faceKill && type === 'webgl2' && ctx) {
          const caller = (new Error().stack ?? '').split('\n').slice(1).find((l) => !/<anonymous>|fixedGetContext/.test(l)) ?? '';
          if (/\/assets\/tracker-[^/]*\.js/.test(caller)) ctx.getExtension('WEBGL_lose_context')?.loseContext();
        }
        return ctx;
      };
    });
  const faceTrackerLives = (page: Page) => page.evaluate(() => ((window as unknown as { __faceKill: boolean }).__faceKill = false));

  bare('E4: a faceless short-range entry reopened while the face tracker cannot answer stays a definite "no face" (祛痘 on); its completion waits for the tracker', async ({ page }) => {
    bare.setTimeout(300_000);
    const errors = watchConsole(page);
    let release = false;
    await page.route(DETECTOR, (r) => (release ? r.continue() : r.abort()));
    const small = await smallFaces(page, [], 0);
    await page.goto('/');
    // nobody, short-range (the detector is missing)
    expect((await openGroup(page, 'small.jpg', small)).faces).toBe(0);
    await closeEditor(page);
    const [a] = await stored(page);
    expect([a.mark, a.faces, a.scans]).toEqual(['short-range', [], [0]]);
    // a relaunch with the detector served again (it is in before the photo opens), and a face tracker that cannot answer
    // (iOS back from the background: its instance is being replaced)
    release = true;
    await killFaceTracker(page);
    const loaded = page.waitForResponse((r) => r.url().includes('blaze_face_full_range') && r.ok(), { timeout: 60_000 });
    await page.reload();
    await expect(page.getByRole('button', { name: /匯入照片/ })).toBeVisible({ timeout: 30_000 });
    await loaded;
    const calls = (await debugState(page)).detectCalls;
    await page.getByRole('button', { name: '開啟編輯' }).first().click();
    await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 90_000 });
    // the cached "nobody" is the answer, a definite one: no 「臉部偵測重新啟動中」 note, and 祛痘 works (round 2 asked
    // the dead tracker again instead: unsure, and all seven 膚質 tools gated)
    await page.getByRole('tab', { name: '美型' }).click();
    await expect(page.getByText('未偵測到臉部，臉型與美妝不會套用')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/臉部偵測(重新啟動中|暫停|失敗)/)).toHaveCount(0);
    await page.getByRole('tab', { name: '美膚' }).click();
    await expect(page.getByRole('option', { name: '祛痘', exact: true })).not.toHaveAttribute('aria-disabled', 'true');
    // the completion waits for a tracker that can answer: nothing is detected meanwhile
    await page.waitForTimeout(3000);
    expect((await debugState(page)).detectCalls).toBe(calls);
    expect((await debugState(page)).faces).toBe(0);
    // the tracker is back: the completion runs once, upright, full-range, and finds the small faces
    await faceTrackerLives(page);
    await expect.poll(async () => (await debugState(page)).detectCalls, { timeout: 90_000 }).toBe(calls + 1);
    await expect.poll(async () => (await debugState(page)).faces, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
    const n = (await debugState(page)).faces;
    await closeEditor(page);
    const after = (await stored(page)).find((e) => e.id === a.id)!;
    expect([after.mark, after.faces.length, after.scans]).toEqual([undefined, n, [0]]);
    // MediaPipe's own log of the graphs killFaceTracker killed (body.spec.ts forgiveKilledGraphs) is the only error
    expect(errors.filter((t) => !/tensor\.cc:\d+\] The tensor can't fit into OpenGL Texture2D View\.$|^Aborted\(\)$/.test(t))).toEqual([]);
  });

  // ── round 4: what holds the completion back, what it hands back, what brings the detector, and what it leaves ──

  /**
   * The detector's requests: aborted while `mode` is 'fail' (offline, a 5xx), held while 'hang' (lie-fi) until `land`,
   * served while 'serve'. `requests` counts them all
   */
  const routeDetector = async (page: Page) => {
    const r = {
      mode: 'fail' as 'fail' | 'hang' | 'serve',
      requests: 0,
      hanging: [] as Route[],
      async land() {
        r.mode = 'serve';
        for (const h of r.hanging.splice(0)) await h.continue().catch(() => undefined);
      },
    };
    await page.route(DETECTOR, (route) => {
      r.requests++;
      if (r.mode === 'serve') return route.continue();
      if (r.mode === 'fail') return route.abort();
      r.hanging.push(route);
      return undefined;
    });
    return r;
  };
  const landed = (page: Page) => page.waitForResponse((r) => r.url().includes('blaze_face_full_range') && r.ok(), { timeout: 30_000 });
  /** the link comes back (E6: the editor asks again on it) */
  const online = (page: Page) => page.evaluate(() => window.dispatchEvent(new Event('online')));
  /**
   * the 「正在重新偵測臉部…」 overlay's states in order: 'complete' (the completion's scrim over the drawn photo) or 'scan'
   * (a face scan's); Preact reuses one element for both. `tap`: 儲存 is tapped the moment the completion's scrim shows,
   * inside its 60 ms paint, before its detection (the hand-back, §6.5)
   */
  const watchRescan = (page: Page, tap = false) =>
    page.evaluate((tap) => {
      const w = window as unknown as { __rescan: string[]; __tapped?: boolean };
      w.__rescan = [];
      let last = 'none';
      const check = () => {
        const el = [...document.querySelectorAll('.status')].find((s) => s.querySelector('.status-title')?.textContent === '正在重新偵測臉部…');
        const now = !el ? 'none' : el.classList.contains('scrim') ? 'complete' : 'scan';
        if (now === last) return;
        last = now;
        if (now !== 'none') w.__rescan.push(now);
        if (tap && now === 'complete' && !w.__tapped) {
          w.__tapped = true;
          (document.querySelector('.topbar .pill') as HTMLButtonElement).click();
        }
      };
      new MutationObserver(check).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
    }, tap);
  const rescans = (page: Page) => page.evaluate(() => (window as unknown as { __rescan: string[] }).__rescan);
  /**
   * every toast shown from now on, one entry per toast() (app.tsx keys each one, so a repeat is a new element; one moved
   * among its siblings is the same element, counted once)
   */
  const watchToastNodes = (page: Page) =>
    page.evaluate(() => {
      const w = window as unknown as { __toastNodes: string[] };
      w.__toastNodes = [];
      const seen = new WeakSet<Element>();
      new MutationObserver((ms) => {
        for (const m of ms)
          for (const n of m.addedNodes) {
            if (!(n instanceof HTMLElement)) continue;
            for (const el of [n, ...n.querySelectorAll('.toast')]) {
              if (!el.classList.contains('toast') || seen.has(el)) continue;
              seen.add(el);
              w.__toastNodes.push((el.textContent ?? '').trim());
            }
          }
      }).observe(document.body, { subtree: true, childList: true });
    });
  const noFaceToasts = async (page: Page) => (await page.evaluate(() => (window as unknown as { __toastNodes: string[] }).__toastNodes)).filter((t) => t === NO_FACE_TOAST).length;
  const pill = (page: Page) => page.locator('.topbar .pill');

  bare('round 4: a completion due while 裁切 is open waits until it closes (no detection, no overlay), then runs before the turned up-frame’s scan, which it saves; only the link coming back (online) asks again', async ({ page }) => {
    bare.setTimeout(240_000);
    const errors = watchConsole(page);
    const det = await routeDetector(page);
    // the small faces upright: short-range finds none, full-range 4 upright and none on the turned photo
    const small = await smallFaces(page, [], 0);
    await page.goto('/');
    expect((await openGroup(page, 'small.jpg', small)).faces).toBe(0);
    // 裁切 › 旋轉: the photo is shown in an up-frame no scan has asked (none runs in 裁切)
    await page.getByRole('tab', { name: '裁切', exact: true }).click();
    await page.getByRole('option', { name: '旋轉', exact: true }).click();
    await watchRescan(page);
    const calls = (await debugState(page)).detectCalls;
    // the link is back, and nothing asks yet (no detection runs in 裁切 to switch the tracker)
    det.mode = 'serve';
    const asked = det.requests;
    await page.waitForTimeout(2000);
    expect(det.requests).toBe(asked);
    // its 'online' does: the detector lands
    const done = landed(page);
    await online(page);
    await done;
    expect(det.requests).toBe(asked + 1);
    // due now, the completion waits for 裁切 (its synchronous detection would freeze 旋轉 and 拉直): no detection, and its
    // overlay never shows (a hold that only complete() checked would start it and hand it back every 60 ms)
    await page.waitForTimeout(3000);
    expect((await debugState(page)).detectCalls).toBe(calls);
    expect(await rescans(page)).toEqual([]);
    // 裁切 closes: the completion goes first, upright, and finds the faces, so the turned up-frame needs no scan (one first
    // would ask the turned photo full-range, find nobody, and cost a detection more)
    await page.getByRole('tab', { name: '美膚', exact: true }).click();
    await expect.poll(async () => (await debugState(page)).faces, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
    await page.waitForTimeout(2000);
    expect((await debugState(page)).detectCalls).toBe(calls + 1);
    expect(await rescans(page)).toEqual(['complete']);
    await closeEditor(page);
    const [after] = await stored(page);
    expect([after.mark, after.faces.length >= 2, after.scans]).toEqual([undefined, true, [0]]);
    expect(errors).toEqual([]);
  });

  bare('round 4: a completion due during a slider drag waits for its commit (the finger still down: no detection)', async ({ page }) => {
    bare.setTimeout(240_000);
    const errors = watchConsole(page);
    const det = await routeDetector(page);
    const small = await smallFaces(page, [], 0);
    await page.goto('/');
    expect((await openGroup(page, 'small.jpg', small)).faces).toBe(0);
    await page.getByRole('tab', { name: '美膚', exact: true }).click();
    await page.getByRole('option', { name: '美白', exact: true }).click();
    await page.waitForTimeout(250);
    await watchRescan(page);
    const calls = (await debugState(page)).detectCalls;
    // a drag under way: the finger down, the thumb moved, not let go
    const thumb = (await page.locator('.slider-thumb').first().boundingBox())!;
    const at = { x: thumb.x + thumb.width / 2, y: thumb.y + thumb.height / 2 };
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    for (let i = 1; i <= 6; i++) await page.mouse.move(at.x + i * 8, at.y);
    // the detector lands meanwhile: due, held (its synchronous detection would freeze the drag)
    det.mode = 'serve';
    const done = landed(page);
    await online(page);
    await done;
    await page.waitForTimeout(3000);
    expect((await debugState(page)).detectCalls).toBe(calls);
    expect(await rescans(page)).toEqual([]);
    // the commit: it runs once, upright, full-range
    await page.mouse.up();
    await expect.poll(async () => (await debugState(page)).faces, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
    expect((await debugState(page)).detectCalls).toBe(calls + 1);
    expect(await rescans(page)).toEqual(['complete']);
    expect(errors).toEqual([]);
  });

  bare('round 4: a working-size 儲存 in 準備中 holds the completion, also one tapped inside its paint (handed back): the file is delivered, then the completion runs', async ({ page }) => {
    bare.setTimeout(360_000);
    const errors = watchConsole(page);
    const det = await routeDetector(page);
    // a 質感 LUT held while `held` names it, so 儲存 waits in 準備中 (as crop.spec.ts's working-size test does)
    const held = new Map<string, () => void>();
    const gates = new Map<string, Promise<void>>();
    const hold = (id: string) => gates.set(id, new Promise<void>((r) => held.set(id, r)));
    const release = (id: string) => {
      held.get(id)?.();
      gates.delete(id);
    };
    await page.route(/\/luts\/looks\/look_(film|ccd)\.png$/, async (r) => {
      const id = /look_(\w+)\.png$/.exec(r.request().url())![1];
      await gates.get(id);
      await r.continue();
    });
    const look = async (name: string) => {
      await page.getByRole('tab', { name: '一鍵', exact: true }).click();
      await page.getByRole('button', { name: '質感', exact: true }).click();
      await page.getByRole('option', { name, exact: true }).click();
    };
    await page.goto('/');
    // B, for the hand-back below: short-range faces, 膠片 (its LUT served now)
    expect((await openGroup(page, 'b.jpg')).faces).toBeLessThan(7);
    await look('膠片');
    await page.waitForTimeout(1500);
    await closeEditor(page);
    // A: short-range faces, CCD with its LUT held
    await record(page);
    expect((await openGroup(page, 'a.jpg')).faces).toBeLessThan(7);
    hold('ccd');
    const ccd = page.waitForRequest(/look_ccd\.png$/);
    await look('CCD');
    await ccd;
    await watchRescan(page);
    const calls = (await debugState(page)).detectCalls;
    await pill(page).click();
    await expect(pill(page)).toHaveText('準備中');
    // the detector lands during 準備中: the completion is due, and waits for the export (round 3 ran its detection here,
    // delaying the file past the share window, and the new persons' rebase made it look edited: dropped)
    det.mode = 'serve';
    const done = landed(page);
    await online(page);
    await done;
    await page.waitForTimeout(4500);
    expect((await debugState(page)).detectCalls).toBe(calls);
    expect(await rescans(page)).toEqual([]);
    await expect(pill(page)).toHaveText('準備中');
    // the LUT lands, the export finishes past the 4 s window: its file is kept for 分享, then the completion runs
    release('ccd');
    await expect(pill(page)).toHaveText('分享', { timeout: 60_000 });
    expect(await toasts(page)).toContain('已準備好，點一下分享');
    await expect.poll(async () => (await debugState(page)).faces, { timeout: 60_000 }).toBe(7);
    expect((await debugState(page)).detectCalls).toBe(calls + 1);
    await expect(pill(page)).toHaveText('分享');
    await pill(page).click();
    const fallback = page.getByRole('dialog', { name: '儲存照片' });
    await expect(fallback).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => fallback.getByRole('img', { name: '編輯結果' }).evaluate((i: HTMLImageElement) => i.naturalWidth), { timeout: 30_000 }).toBeGreaterThan(0);
    await fallback.getByRole('button', { name: '關閉' }).click();
    await closeEditor(page);

    // a relaunch with the detector in: B's completion starts as it opens; 儲存 is tapped inside its 60 ms paint, while
    // 膠片's LUT is held. The completion sees the export and hands its try back: no detection during 準備中, the file is
    // delivered, and the completion runs once the export is done
    hold('film');
    const relaunched = landed(page);
    await page.reload();
    await expect(page.getByRole('button', { name: /匯入照片/ })).toBeVisible({ timeout: 30_000 });
    await relaunched;
    await record(page);
    await watchRescan(page, true);
    const again = (await debugState(page)).detectCalls;
    await page.getByRole('button', { name: '開啟編輯' }).last().click();
    await expect(pill(page)).toHaveText('準備中', { timeout: 60_000 });
    expect(await page.evaluate(() => (window as unknown as { __tapped?: boolean }).__tapped)).toBe(true);
    await page.waitForTimeout(4500);
    expect((await debugState(page)).detectCalls).toBe(again);
    // shown once, for the paint it handed back; not again while the export ran
    expect(await rescans(page)).toEqual(['complete']);
    release('film');
    await expect(pill(page)).toHaveText('分享', { timeout: 60_000 });
    await expect.poll(async () => (await debugState(page)).faces, { timeout: 60_000 }).toBe(7);
    expect((await debugState(page)).detectCalls).toBe(again + 1);
    expect(await rescans(page)).toEqual(['complete', 'complete']);
    await pill(page).click();
    await expect(fallback).toBeVisible({ timeout: 30_000 });
    await fallback.getByRole('button', { name: '關閉' }).click();
    await closeEditor(page);
    expect((await stored(page)).map((e) => e.mark)).toEqual([undefined, undefined]);
    expect(errors).toEqual([]);
  });

  bare('round 4: the detector a request the editor never made brings (a scan switching the tracker to its photo model) completes the open photo', async ({ page }) => {
    bare.setTimeout(240_000);
    const errors = watchConsole(page);
    const det = await routeDetector(page);
    const small = await smallFaces(page, [], 0);
    await page.goto('/');
    expect((await openGroup(page, 'small.jpg', small)).faces).toBe(0);
    // the link is back, with no 'online' event (lie-fi, a captive portal signed in): the editor does not ask again
    det.mode = 'serve';
    const asked = det.requests;
    await page.waitForTimeout(2000);
    expect(det.requests).toBe(asked);
    // the scan of the turned photo switches the tracker to its photo model, which asks for the missing detector by
    // itself (services.ts fullRangeDetector): this scan still runs short-range, and finds nobody; the bytes land
    const done = landed(page);
    const calls = (await debugState(page)).detectCalls;
    expect(await turnUpright(page, 1)).toBe(0);
    await done;
    // the editor hears it from services (round 3 heard only its own asks): the completion asks upright, full-range
    await expect.poll(async () => (await debugState(page)).faces, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
    expect((await debugState(page)).detectCalls).toBe(calls + 2);
    await closeEditor(page);
    const [after] = await stored(page);
    expect(after.mark).toBeUndefined();
    expect(after.faces.length).toBeGreaterThanOrEqual(2);
    expect(errors).toEqual([]);
  });

  bare('round 4: a sideways photo with nobody anywhere: 「未偵測到臉部」 only for a fresh answer, and an up-frame answered full-range is not scanned again', async ({ page }) => {
    bare.setTimeout(300_000);
    const errors = watchConsole(page);
    const det = await routeDetector(page);
    const blank = emptyPng();
    await page.goto('/');
    await watchToastNodes(page);
    const added = async (known: string[]) => (await stored(page)).find((e) => !known.includes(e.id))!;
    // E: nobody upright, nobody turned (q1), both short-range; each a fresh answer, each says so
    expect((await openGroup(page, 'e.png', blank, 'image/png')).faces).toBe(0);
    expect(await turnUpright(page, 3)).toBe(0);
    await closeEditor(page);
    const e = await added([]);
    expect([e.mark, e.scans]).toEqual(['short-range', [0, 1]]);
    expect(await noFaceToasts(page)).toBe(2);
    // F: nobody upright, short-range
    expect((await openGroup(page, 'f.png', blank, 'image/png')).faces).toBe(0);
    await closeEditor(page);
    const f = await added([e.id]);
    expect([f.mark, f.scans]).toEqual(['short-range', [0]]);

    // a relaunch on lie-fi: the engine's detector request hangs. F reopened (its cached "nobody": no toast) and turned:
    // the scan of q1 waits for that first download, which lands within the wait, so q1 is answered full-range (a fresh
    // answer: it says so). The completion then asks upright, full-range, nobody: q1's record stays a full-range answer,
    // and q1 is not scanned again (round 3 dropped it: a third detection, and the toast again)
    det.mode = 'hang';
    await page.reload();
    await expect(page.getByRole('button', { name: /匯入照片/ })).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => det.hanging.length, { timeout: 30_000 }).toBeGreaterThan(0);
    await watchToastNodes(page);
    let calls = (await debugState(page)).detectCalls;
    await page.getByRole('button', { name: '開啟編輯' }).first().click();
    await expect(pill(page)).toBeEnabled({ timeout: 60_000 });
    await page.getByRole('tab', { name: '裁切', exact: true }).click();
    for (let i = 0; i < 3; i++) await page.getByRole('option', { name: '旋轉', exact: true }).click();
    await page.getByRole('tab', { name: '美膚', exact: true }).click();
    await expect.poll(async () => (await debugState(page)).detectorWaits ?? 0, { timeout: 30_000 }).toBe(1);
    await det.land();
    await expect.poll(async () => (await debugState(page)).detectCalls, { timeout: 60_000 }).toBe(calls + 2);
    await page.waitForTimeout(3000);
    expect((await debugState(page)).detectCalls).toBe(calls + 2);
    expect(await noFaceToasts(page)).toBe(1);
    await closeEditor(page);
    const fAfter = (await stored(page)).find((x) => x.id === f.id)!;
    expect([fAfter.mark, [...fAfter.scans].sort()]).toEqual([undefined, [0, 1]]);

    // E reopened with the detector in, shown turned: the completion asks upright, nobody; the scan asks q1 again, full-range,
    // nobody. Both answered "nobody" before, short-range, and said so then: nothing says it again (round 3 did, on a reopen)
    await expect(page.locator('.toast')).toHaveCount(0, { timeout: 15_000 });
    await watchToastNodes(page);
    calls = (await debugState(page)).detectCalls;
    await page.getByRole('button', { name: '開啟編輯' }).nth(1).click();
    await expect(pill(page)).toBeEnabled({ timeout: 60_000 });
    await expect.poll(async () => (await debugState(page)).detectCalls, { timeout: 90_000 }).toBe(calls + 2);
    await page.waitForTimeout(3000);
    expect((await debugState(page)).detectCalls).toBe(calls + 2);
    expect(await noFaceToasts(page)).toBe(0);
    await closeEditor(page);
    const eAfter = (await stored(page)).find((x) => x.id === e.id)!;
    expect([eAfter.mark, [...eAfter.scans].sort()]).toEqual([undefined, [0, 1]]);
    expect(errors).toEqual([]);
  });

  bare('round 4: a completion that adds no face rebuilds no session, and the 美體 and 推臉筆 field textures stay uploaded', async ({ page }) => {
    bare.setTimeout(420_000);
    const errors = watchConsole(page);
    const det = await routeDetector(page);
    // every RG16F allocation on a WebGL2 context: the 美體 and 推臉筆 field textures (pipeline.ts; texSubImage2D refills)
    await page.addInitScript(() => {
      const w = window as unknown as { __fieldUploads: number };
      w.__fieldUploads = 0;
      const proto = WebGL2RenderingContext.prototype as unknown as { texImage2D: (...a: unknown[]) => void };
      const tex = proto.texImage2D;
      proto.texImage2D = function (this: WebGL2RenderingContext, ...a: unknown[]) {
        if (a[2] === 0x822f) w.__fieldUploads++;
        return tex.apply(this, a);
      };
    });
    const uploads = () => page.evaluate(() => (window as unknown as { __fieldUploads: number }).__fieldUploads);
    await page.goto('/');
    // the full-body fixture, short-range: its masked face, which full-range misses on the GPU delegate (§6.5), so the
    // completion finds nothing to add
    const body = readFileSync(new URL('../fixtures/fullbody.jpg', import.meta.url));
    const first = await openGroup(page, 'fullbody.jpg', body);
    // 美體 › 細腰 at the top: a 美體 field
    await page.getByRole('tab', { name: '美體', exact: true }).click();
    await expect(page.locator('.body-note.progress')).toHaveCount(0, { timeout: 150_000 });
    await expect(page.locator('[role="option"][aria-description="美體偵測完成後即可調整"]')).toHaveCount(0, { timeout: 150_000 });
    await page.getByRole('option', { name: '細腰', exact: true }).click();
    await page.waitForTimeout(250);
    await dragSlider(page, 400);
    await expect(page.locator('.slider-row [role="slider"]')).toHaveAttribute('aria-valuenow', '100');
    // 推臉筆: one stroke across the waist, a 推臉筆 field
    await page.getByRole('option', { name: '推臉筆', exact: true }).click();
    await expect(page.getByRole('radiogroup', { name: '筆刷模式' })).toBeVisible();
    await expect(page.locator('.brush-hint')).toHaveCount(0, { timeout: 10_000 });
    const box = (await page.locator('.editor-stage .frame').boundingBox())!;
    await brushDrag(page, { x: box.x + box.width * 0.45, y: box.y + box.height * 0.5 }, { x: box.x + box.width * 0.52, y: box.y + box.height * 0.5 });
    await expect.poll(async () => (await liquifyState(page))?.strokes ?? 0).toBe(1);
    await expect.poll(async () => (await liquifyState(page))?.pending ?? true).toBe(false);
    // both fields drawn, and settled (a draft field's size may differ from the full one's)
    let u = -1;
    await expect
      .poll(
        async () => {
          const now = await uploads();
          const still = now === u;
          u = now;
          return still;
        },
        { timeout: 30_000, intervals: [1500] },
      )
      .toBe(true);
    expect(u).toBeGreaterThanOrEqual(2);
    const before = await debugState(page);
    // the detector lands: one full-range detection, nothing to add
    det.mode = 'serve';
    const done = landed(page);
    await online(page);
    await done;
    await expect.poll(async () => (await debugState(page)).detectCalls, { timeout: 60_000 }).toBe(before.detectCalls + 1);
    await page.waitForTimeout(3000);
    const after = await debugState(page);
    console.log(`fields: ${u} uploads before the completion, ${await uploads()} after; faces ${first.faces} → ${after.faces}; sessions ${before.stillSessions} → ${after.stillSessions}`);
    expect(after.faces).toBe(before.faces);
    // the bound session stays (round 3 rebuilt it, and its probe session's dispose released both field textures, so the
    // next frame uploaded them again, 1.5 MB for the 推臉筆 field)
    expect(after.stillSessions).toBe(before.stillSessions);
    expect(await uploads()).toBe(u);
    await closeEditor(page);
    const [entry] = await stored(page);
    expect(entry.mark).toBeUndefined();
    expect(errors).toEqual([]);
  });

  // ── round 5: what a return to the app asks, and what a completion that merged nothing leaves to the scan ──

  /** the app sent to the background or brought back: document.visibilityState as given, then its event */
  const visibility = (page: Page, state: 'hidden' | 'visible') =>
    page.evaluate((state) => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
      document.dispatchEvent(new Event('visibilitychange'));
    }, state);

  bare('round 5: a return to the app (visibilitychange) asks for the missing detector once, which completes the open photo; going to the background asks nothing', async ({ page }) => {
    bare.setTimeout(240_000);
    const errors = watchConsole(page);
    const det = await routeDetector(page);
    const small = await smallFaces(page, [], 0);
    await page.goto('/');
    expect((await openGroup(page, 'small.jpg', small)).faces).toBe(0);
    // the link is back (a captive portal signed in elsewhere: no 'online'), and nothing asks meanwhile
    det.mode = 'serve';
    const asked = det.requests;
    await page.waitForTimeout(2000);
    expect(det.requests).toBe(asked);
    // the app goes to the background: nothing asks (a hidden page cannot show what it would bring)
    await visibility(page, 'hidden');
    await page.waitForTimeout(2000);
    expect(det.requests).toBe(asked);
    // it comes back: one request, the detector lands, and the completion asks upright, full-range, and finds the faces
    const calls = (await debugState(page)).detectCalls;
    const done = landed(page);
    await visibility(page, 'visible');
    await done;
    expect(det.requests).toBe(asked + 1);
    await expect.poll(async () => (await debugState(page)).faces, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
    expect((await debugState(page)).detectCalls).toBe(calls + 1);
    await page.waitForTimeout(2000);
    expect(det.requests).toBe(asked + 1);
    await closeEditor(page);
    const [after] = await stored(page);
    expect([after.mark, after.faces.length >= 2, after.scans]).toEqual([undefined, true, [0]]);
    expect(errors).toEqual([]);
  });

  bare('round 5: a completion held by 裁切 whose detection throws merges nothing, and the turned up-frame it held back is scanned, full-range, in that open', async ({ page }) => {
    bare.setTimeout(300_000);
    const errors = watchConsole(page);
    const det = await routeDetector(page);
    // while armed, the next ImageBitmap the face tracker's chunk reads throws, once: Tracker.detectImage reads its size
    // before any MediaPipe call, so it throws out of the detection and leaves the tracker as it was (still.ts
    // detectOnce: not definite). Armed below, it is the completion's (upright, on the photo's bitmap; a turned scan
    // reads a canvas)
    await page.addInitScript(() => {
      const w = window as unknown as { __probeThrows: boolean; __probeThrown: number };
      w.__probeThrows = false;
      w.__probeThrown = 0;
      const width = Object.getOwnPropertyDescriptor(ImageBitmap.prototype, 'width')!;
      Object.defineProperty(ImageBitmap.prototype, 'width', {
        configurable: true,
        get(this: ImageBitmap) {
          if (w.__probeThrows) {
            const caller = (new Error().stack ?? '').split('\n').slice(1).find((l) => !/<anonymous>/.test(l)) ?? '';
            if (/\/assets\/tracker-[^/]*\.js/.test(caller)) {
              w.__probeThrows = false;
              w.__probeThrown++;
              throw new Error('detectImage threw (e2e)');
            }
          }
          return width.get!.call(this) as number;
        },
      });
    });
    const thrown = () => page.evaluate(() => (window as unknown as { __probeThrown: number }).__probeThrown);
    // the small faces turned 270°: short-range finds nobody upright or turned back, full-range none upright and 4
    // turned back
    const smallSide = await smallFaces(page, [], 3);
    await page.goto('/');
    expect((await openGroup(page, 'small_side.jpg', smallSide)).faces).toBe(0);
    // 裁切 › 旋轉 × 3: the faces stand up (quarter 1); no scan runs in 裁切
    await page.getByRole('tab', { name: '裁切', exact: true }).click();
    for (let i = 0; i < 3; i++) await page.getByRole('option', { name: '旋轉', exact: true }).click();
    await watchRescan(page);
    const calls = (await debugState(page)).detectCalls;
    // the detector lands meanwhile: the completion is due and held by 裁切, and the turned up-frame's scan waits for it
    det.mode = 'serve';
    const done = landed(page);
    await online(page);
    await done;
    await page.waitForTimeout(2000);
    expect((await debugState(page)).detectCalls).toBe(calls);
    expect(await rescans(page)).toEqual([]);
    // 裁切 closes: the completion goes first, and its detection throws: nothing is merged, the mark stays
    await page.evaluate(() => ((window as unknown as { __probeThrows: boolean }).__probeThrows = true));
    await page.getByRole('tab', { name: '美膚', exact: true }).click();
    await expect.poll(thrown, { timeout: 60_000 }).toBe(1);
    // then the scan it held back runs, on the turned photo, full-range, and finds the faces (round 4: nothing the
    // completion left changed, so nothing checked the scan again: no face in this open, the face tools gated)
    await expect.poll(async () => (await debugState(page)).faces, { timeout: 60_000 }).toBeGreaterThanOrEqual(2);
    expect((await debugState(page)).detectCalls).toBe(calls + 1);
    expect(await rescans(page)).toEqual(['complete', 'scan']);
    await page.waitForTimeout(2000);
    expect((await debugState(page)).detectCalls).toBe(calls + 1);
    expect(await thrown()).toBe(1);
    await closeEditor(page);
    const [after] = await stored(page);
    expect([after.mark, after.faces.length >= 2, [...after.scans].sort()]).toEqual([undefined, true, [0, 1]]);
    // the thrown detection is logged once (still.ts detectOnce), and nothing else
    expect(errors.filter((t) => /^\[meiyan\] still detect/.test(t))).toHaveLength(1);
    expect(errors.filter((t) => !/^\[meiyan\] still detect/.test(t))).toEqual([]);
  });

  /**
   * a group of eleven, 2000 × 1500 (fractions of the width and height): ten copies of sample_face.png's face, 0.165 of
   * the width in the back row and 0.175 in the front row, five each, 0.195 apart, each cut 1.1 × 1.35 face widths around
   * the face; and an eleventh 0.1 wide, cut 1.3 × 1.3, 0.23 of the height below the front row's middle face (nearer to it
   * than any other face). Probed on SwiftShader: short-range finds the ten and never the eleventh (up to 0.11 wide),
   * full-range all eleven from 0.09 wide
   */
  const ELEVEN: { cx: number; cy: number; fw: number; cell?: [number, number] }[] = [
    ...[0.11, 0.305, 0.5, 0.695, 0.89].map((cx) => ({ cx, cy: 0.25, fw: 0.165 })),
    ...[0.11, 0.305, 0.5, 0.695, 0.89].map((cx) => ({ cx, cy: 0.6, fw: 0.175 })),
    { cx: 0.5, cy: 0.83, fw: 0.1, cell: [1.3, 1.3] },
  ];
  const elevenFaces = async (page: Page): Promise<Buffer> => {
    await page.setContent('<!doctype html><meta charset="utf-8"><body></body>');
    const url = await page.evaluate(
      async ({ src, faces, face }) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const [W, H] = [2000, 1500];
        const c = document.createElement('canvas');
        c.width = W;
        c.height = H;
        const g = c.getContext('2d')!;
        g.fillStyle = 'rgb(128,128,128)';
        g.fillRect(0, 0, W, H);
        for (const f of faces) {
          const [cw, ch] = [(f.cell?.[0] ?? 1.1) * face.w, (f.cell?.[1] ?? 1.35) * face.w];
          const k = (f.fw * W) / face.w;
          g.drawImage(img, face.cx - cw / 2, face.cy - ch / 2, cw, ch, f.cx * W - (cw / 2) * k, f.cy * H - (ch / 2) * k, cw * k, ch * k);
        }
        return c.toDataURL('image/jpeg', 0.92);
      },
      { src: `data:image/png;base64,${readFileSync(SAMPLE_FACE).toString('base64')}`, faces: ELEVEN, face: FACE },
    );
    return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
  };
  /** the stored entry's thumbnail bytes, as a string to compare (IndexedDB meiyan / edits) */
  const thumbOf = (page: Page) =>
    page.evaluate(
      () =>
        new Promise<string>((resolve, reject) => {
          const open = indexedDB.open('meiyan', 1);
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const req = open.result.transaction('edits', 'readonly').objectStore('edits').getAll();
            req.onsuccess = async () => {
              const row = (req.result as { updatedAt?: number; thumb?: Blob }[]).find((r) => typeof r.updatedAt === 'number');
              open.result.close();
              const bytes = row?.thumb ? new Uint8Array(await row.thumb.arrayBuffer()) : new Uint8Array(0);
              let h = 0;
              for (const b of bytes) h = (Math.imul(h, 31) + b) | 0;
              resolve(`${bytes.length}:${h}`);
            };
          };
        }),
    );
  const OVER_CAP = '偵測到超過 10 張臉，只會美化最大的 10 張';

  bare('round 5: a completion that finds an eleventh face adds nobody, but its obstacle bounds the nearest face’s warp: the thumbnail is rewritten and 「偵測到超過 10 張臉」 shows', async ({ page }) => {
    bare.setTimeout(300_000);
    const errors = watchConsole(page);
    const det = await routeDetector(page);
    const group = await elevenFaces(page);
    await page.goto('/');
    await watchToastNodes(page);
    // short-range finds the ten, not the eleventh: no face over the cap, no obstacle
    expect((await openGroup(page, 'eleven.jpg', group)).faces).toBe(10);
    const d = await debugState(page);
    expect([d.obstacles, d.dropped]).toEqual([[], { tooSmall: 0, overCap: 0 }]);
    // 下頜線 at the top on the front row's middle face, the one the eleventh is nearest to: a jaw warp the face cap bounds
    // (S §4.1) and no 瘦臉 limit follows (a limit is built from the obstacles too, protectRequests, and a new one re-arms
    // the history write itself, which would redraw the thumbnail anyway)
    const at = (b: { x: number; y: number; w: number; h: number }) => Math.hypot(b.x + b.w / 2 - 0.5, b.y + b.h / 2 - 0.6);
    const i = d.boxes.reduce((m, b, j) => (at(b) < at(d.boxes[m]) ? j : m), 0);
    await page.getByRole('tab', { name: '美型', exact: true }).click();
    await page.getByRole('radio', { name: personChip(i + 1) }).click();
    await expect.poll(async () => (await debugState(page)).selected).toBe(d.boxes[i].id);
    await page.getByRole('option', { name: '下頜線', exact: true }).click();
    await page.waitForTimeout(250);
    await dragSlider(page, 400);
    await expect(page.locator('.slider-row [role="slider"]')).toHaveAttribute('aria-valuenow', '100');
    // the edit and its thumbnail written, and settled
    let last = '';
    await expect
      .poll(
        async () => {
          const now = await thumbOf(page);
          const still = now === last && !now.startsWith('0:');
          last = now;
          return still;
        },
        { timeout: 60_000, intervals: [2000] },
      )
      .toBe(true);
    const before = last;
    // the detector lands: one full-range detection, which finds the eleventh: no room, so it is an obstacle, over the cap
    const calls = (await debugState(page)).detectCalls;
    det.mode = 'serve';
    const done = landed(page);
    await online(page);
    await done;
    await expect.poll(async () => (await debugState(page)).detectCalls, { timeout: 60_000 }).toBe(calls + 1);
    const after = await debugState(page);
    console.log(`eleven: faces ${after.faces}, obstacles ${JSON.stringify(after.obstacles)}, dropped ${JSON.stringify(after.dropped)}`);
    expect(after.faces).toBe(10);
    expect(after.boxes.map((b) => b.id)).toEqual(d.boxes.map((b) => b.id));
    expect(after.obstacles).toHaveLength(1);
    expect(after.dropped!.overCap).toBeGreaterThan(0);
    // it says so (round 4: only a completion that added a face did), and the thumbnail, which no longer shows the
    // render (the obstacle bounds that face's cap), is rewritten (round 4 owed it only when a face was added)
    await expect.poll(async () => page.evaluate(() => (window as unknown as { __toastNodes: string[] }).__toastNodes), { timeout: 15_000 }).toContain(OVER_CAP);
    await expect.poll(() => thumbOf(page), { timeout: 30_000 }).not.toBe(before);
    await closeEditor(page);
    const [entry] = await stored(page);
    expect([entry.mark, entry.faces.length]).toEqual([undefined, 10]);
    expect(errors).toEqual([]);
  });
});

// D2: a camera hand-over whose seed face the full-range detector misses. The fake camera plays a clip composed at test
// time (test-results/, nothing committed): two copies of sample_face.png's face inside the preview's 3:4 window (x 370–910
// of the 1280 × 720 frame, which is the shot): A whole, 150 px wide, low on the left, and B, 200 px wide, on the right
// with the top 35 % of its face above the frame. The live tracker (short-range) tracks both and the user selects B. In
// the shot full-range finds A only on SwiftShader and on CPU, short-range finds B too, so the editor must find B and
// select it. (Probed 2026-10-18 through this flow: B 160 px with 30 % cut off passes too; 200 px with 30 % full-range
// still finds, with 40 % short-range misses as well, and a face 35–55 % past the side edge full-range still finds.)
bare.describe('a camera shot whose seed face is cut by the frame edge (D2)', () => {
  /** frame px: the face centres and widths (B's centre 0.15 of its face height below the frame's top) */
  const CAM = { A: { x: 480, y: 520, fw: 150 }, B: { x: 800, y: 0.15 * ((200 * 722) / 620), fw: 200 } };
  const root = resolve(import.meta.dirname, '../..');

  /** the clip's frame as a PNG (a blank page's canvas), then the y4m through scripts/gen-y4m.mjs (fitted 1280 → 1280) */
  async function clip(page: Page, dir: string): Promise<string> {
    const png = await page.evaluate(
      async ({ src, cam, face }) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = 1280;
        c.height = 720;
        const g = c.getContext('2d')!;
        g.fillStyle = 'rgb(128,128,128)';
        g.fillRect(0, 0, 1280, 720);
        for (const p of [cam.A, cam.B]) {
          const k = p.fw / face.w;
          g.drawImage(img, p.x - face.cx * k, p.y - face.cy * k, img.naturalWidth * k, img.naturalHeight * k);
        }
        return c.toDataURL('image/png');
      },
      { src: `data:image/png;base64,${readFileSync(SAMPLE_FACE).toString('base64')}`, cam: CAM, face: FACE },
    );
    mkdirSync(dir, { recursive: true });
    const pngPath = resolve(dir, 'two_faces.png');
    const y4m = resolve(dir, 'two_faces.y4m');
    writeFileSync(pngPath, Buffer.from(png.slice(png.indexOf(',') + 1), 'base64'));
    execFileSync(process.execPath, [resolve(root, 'scripts/gen-y4m.mjs'), '--src', relative(root, pngPath), '--out', relative(root, y4m)], { cwd: root });
    return y4m;
  }

  for (const delegate of ['auto', 'CPU'] as const) {
    bare(`the editor finds the selected face full-range missed at the edge, and selects it (${delegate})`, async ({ browser, playwright }, testInfo) => {
      bare.setTimeout(240_000);
      const scratch = await browser.newPage();
      const y4m = await clip(scratch, testInfo.outputPath('clip'));
      await scratch.close();
      const use = testInfo.project.use;
      const args = (use.launchOptions?.args ?? []).filter((a) => !a.startsWith('--use-file-for-fake-video-capture='));
      const cam = await playwright.chromium.launch({ args: [...args, `--use-file-for-fake-video-capture=${y4m}`] });
      try {
        const context = await cam.newContext({
          baseURL: use.baseURL,
          viewport: use.viewport,
          deviceScaleFactor: use.deviceScaleFactor,
          isMobile: use.isMobile,
          hasTouch: use.hasTouch,
          colorScheme: use.colorScheme,
          locale: use.locale,
        });
        const page = await context.newPage();
        const errors: string[] = [];
        page.on('console', (m) => {
          if (m.type() === 'error' && !/^INFO: Created TensorFlow Lite XNNPACK delegate/.test(m.text())) errors.push(m.text());
        });
        page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
        await useDelegate(page, delegate);
        await page.getByRole('button', { name: /拍攝/ }).click();
        await page.getByRole('button', { name: '點擊開啟相機' }).click();
        await expect.poll(async () => (await debugState(page)).faces, { timeout: 120_000, intervals: [500] }).toBe(2);
        // select B: the track whose box centre is nearer B's (unmirrored video UV)
        const boxes = (await debugState(page)).boxes;
        const near = (p: { x: number; y: number }) => [...boxes].sort((a, b) => Math.hypot(a.x + a.w / 2 - p.x / 1280, a.y + a.h / 2 - p.y / 720) - Math.hypot(b.x + b.w / 2 - p.x / 1280, b.y + b.h / 2 - p.y / 720))[0].id;
        const B = near(CAM.B);
        expect(near(CAM.A)).not.toBe(B);
        // tapped in the middle of its part inside the frame (its box may reach past the top)
        const at = await page.evaluate((b) => {
          const c = document.querySelector('.cam-stage canvas') as HTMLCanvasElement;
          const v = document.querySelector('video') as HTMLVideoElement;
          const r = c.getBoundingClientRect();
          const s = Math.max(r.width / v.videoWidth, r.height / v.videoHeight);
          const y = (Math.max(0, b.y) + b.y + b.h) / 2;
          // the front camera preview is mirrored
          return { x: r.left + (r.width - v.videoWidth * s) / 2 + (1 - (b.x + b.w / 2)) * v.videoWidth * s, y: r.top + (r.height - v.videoHeight * s) / 2 + y * v.videoHeight * s };
        }, boxes.find((b) => b.id === B)!);
        await page.mouse.click(at.x, at.y);
        await expect.poll(async () => (await debugState(page)).selected).toBe(B);
        await page.getByRole('button', { name: '拍照' }).click();
        await page.getByRole('button', { name: '編輯' }).click();
        await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 90_000 });
        await expect.poll(async () => (await debugState(page)).detectCalls, { timeout: 60_000 }).toBe(1);
        const d = await debugState(page);
        console.log(`D2 ${delegate}: faces ${d.faces}, retries ${d.detectRetries}, selected ${d.selected}, boxes ${JSON.stringify(d.boxes)}`);
        // the shot is the window, mirrored as the preview: B's part in it lies about x 1 − (800 − 370) / 540, y 0 … 0.21
        const bShot = { x: 1 - (CAM.B.x - 370) / 540, y: (CAM.B.y + (CAM.B.fw * FACE.h) / FACE.w / 2) / 720 / 2 };
        const dist = (b: { x: number; y: number; w: number; h: number }) => Math.hypot(b.x + b.w / 2 - bShot.x, b.y + b.h / 2 - bShot.y);
        // full-range found A only; the seed in no box of its answer asked the short-range detector, which added B
        expect(d.faces).toBe(2);
        expect(d.detectRetries).toBe(1);
        const atB = [...d.boxes].sort((a, b) => dist(a) - dist(b))[0];
        expect(dist(atB), JSON.stringify(atB)).toBeLessThan(0.2);
        expect(d.selected).toBe(atB.id);
        expect(errors).toEqual([]);
        await context.close();
      } finally {
        await cam.close();
      }
    });
  }
});
