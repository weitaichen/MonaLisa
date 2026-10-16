import { debugState, expect, shot, test } from './fixtures';

test('bench.html: 開始 → live engine + tracker + camera with fps and face', async ({ page }) => {
  await page.goto('/bench.html');
  await page.getByRole('button', { name: '開始', exact: true }).click();
  await expect
    .poll(async () => {
      const d = await debugState(page);
      return d.cameraState === 'live' && d.face && d.fps > 0;
    }, { timeout: 90_000, intervals: [500] })
    .toBe(true);
  const d = await debugState(page);
  expect(d.lastError).toBeNull();
  expect(d.detectMs).toBeGreaterThan(0);
  expect(d.renderMs).toBeGreaterThan(0);
  await shot(page, '40-bench-live');
});

test('bench.html: 多臉 section keeps its own classes (the 美體偵測 / gate-progress harness locators stay unique)', async ({ page }) => {
  await page.goto('/bench.html');
  await expect(page.locator('.multi-bench')).toHaveCount(1);
  await expect(page.locator('.multi-bench h3')).toHaveText('多臉');
  // tests/harness/b3/bench.mjs reads page.locator('.body-bench') (the 美體偵測 box, mounted only once a body bench
  // runs, so none yet); tests/harness/t8/run-bench.mjs reads '.gate .note' (gateProgress alone)
  await expect(page.locator('.body-bench')).toHaveCount(0);
  await expect(page.locator('.gate .note')).toHaveCount(1);
  // tests/harness/t8/run-bench.mjs and run-bench2.mjs read '.panel .note' (the 複製結果 row's note alone); the 膚質量測
  // output sits in .panel from load, so it keeps its own class (.tone-note)
  await expect(page.locator('.panel .note')).toHaveCount(1);
});

test('bench.html: 調節效能 — base vs 調節 program on the synthetic and the camera frame, compile time, grain hash bit-exact on the GPU', async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto('/bench.html');
  await page.getByRole('button', { name: '調節效能', exact: true }).click();
  const out = page.locator('#adjust-bench');
  await expect(out).toHaveAttribute('data-state', 'done', { timeout: 150_000 });
  const rowsOf = (text: string, label: string) => {
    const block = text.slice(text.indexOf(`${label} `));
    expect(block, label).toMatch(/^\S+( H)? \d+×\d+ → \d+×\d+\nneutral\s+[\d.]+ ms\n調節 ×12\s+[\d.]+ ms 調節\n/);
    for (const id of ['film', 'ccd', 'flash', 'blue', 'cinema']) expect(block).toMatch(new RegExp(`質感 ${id}\\s+[\\d.]+ ms 調節`));
    expect(block).toMatch(/首幀額外 [\d.]+ ms/);
  };
  const text = (await out.textContent()) ?? '';
  console.log(text);
  rowsOf(text, '合成');
  expect(text).toContain('合成 1080×1920 → 1080×1920');
  // the start screen has no camera: the row says so instead of timing a camera frame
  expect(text).toContain('相機 H：未開相機');
  // the compile is timed on its own context, not folded into the first 調節 frame
  expect(text).toMatch(/編譯 [\d.]+ ms（獨立 context，冷）/);
  expect(text).toContain('顆粒雜湊 4096/4096 一致');
  await shot(page, '41-bench-adjust');

  // after 開始, the panel's 調節效能 also times the camera frame at tier H (S §6.4)
  await page.getByRole('button', { name: '開始', exact: true }).click();
  await expect.poll(async () => (await debugState(page)).cameraState, { timeout: 120_000, intervals: [500] }).toBe('live');
  await page.getByRole('button', { name: '調節效能', exact: true }).click();
  await expect(out).toContainText('相機 H ', { timeout: 150_000 });
  await expect(out).toHaveAttribute('data-state', 'done');
  const live = (await out.textContent()) ?? '';
  console.log(live);
  rowsOf(live, '合成');
  rowsOf(live, '相機 H');
  expect(live).not.toContain('未開相機');
});

test('bench.html 推臉筆: liquify.frame is the 2048 editor frame with strokes and every effect on (PB §6.2), GPU-complete without a readback', async ({ page }) => {
  test.setTimeout(240_000);
  // the dev server: it serves /tests/fixtures, so the row draws sample_face.png with its recorded landmarks
  await page.goto('http://127.0.0.1:5190/bench.html');
  await page.getByRole('button', { name: '推臉筆', exact: true }).click();
  const out = page.locator('.liquify-note');
  await expect(out).toContainText('sample_face.png：', { timeout: 200_000 });
  const text = (await out.textContent()) ?? '';
  console.log(text);
  // the budget column says 33 ms; SwiftShader is far slower than a GPU, so only the rows' presence is checked here
  expect(text).toMatch(/liquify\.frame 1365×2048 every effect\t[\d.]+\tms\t33\t/);
  expect(text).toMatch(/liquify\.frame 1365×2048 strokes only\t[\d.]+\tms\t–\t/);
  const passes = text.slice(text.indexOf('sample_face.png：') + 'sample_face.png：'.length).trim().split(' ');
  for (const p of ['mask', 'heal', 'toneField', 'retouch', 'makeup', 'reshape', 'body', 'liquify', 'meanH', 'composite', 'adjust']) expect(passes, p).toContain(p);
});

test('輸出測試 frame: photo-like file sizes through the export encoders (S §4.5 estimates, S §6.4 rows 1 and 3)', async ({ page }) => {
  // the dev server: the harness imports src/bench/exportBench.ts directly
  await page.goto('http://127.0.0.1:5190/tests/e2e/pages/exportBench.html');
  await page.waitForFunction(() => typeof window.runBenchFrame === 'function');
  const r = await page.evaluate(() => window.runBenchFrame!());
  const MB = 1048576;
  console.log(`source ${(r.sourceBytes / MB).toFixed(1)} MB, JPEG q 0.95 ${(r.jpegBytes / MB).toFixed(1)} MB, PNG ${(r.pngBytes / MB).toFixed(1)} MB at ${r.w}×${r.h}`);
  expect([r.w, r.h]).toEqual([4096, 3072]);
  // without the noise overlay these were 0.1, 0.2 and 0.7 MB, and the encodes 3× (JPEG) and 15× (PNG) faster
  expect(r.sourceBytes).toBeGreaterThan(2 * MB);
  expect(r.jpegBytes).toBeGreaterThan(3 * MB);
  expect(r.jpegBytes).toBeLessThan(8 * MB);
  expect(r.pngBytes).toBeGreaterThan(15 * MB);
  expect(r.pngBytes).toBeLessThan(35 * MB);
});
