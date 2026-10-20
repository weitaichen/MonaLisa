// E4 (camera per-person spec §12.2, gate PGR, K17, K20): ordinary group shots held upright, 1080 × 1920 clips.
import { camBox, cpuDelegate, debugState, expect, flipBack, open, test, uprightCamera, within } from './fixtures';

test.beforeEach(async ({ page }) => {
  await uprightCamera(page);
  await cpuDelegate(page, process.env.PGR_DELEGATE ?? 'CPU');
});

for (const [tag, n] of [
  ['@row3', 3],
  ['@far10', 10],
] as const) {
  test(`E4 back camera, upright: the group path finds all ${n} faces within 2 s of the first live frame, each tappable ${tag}`, async ({ page }) => {
    await open(page);
    const t0 = await flipBack(page);
    await expect.poll(async () => (await debugState(page)).faces, { timeout: within(t0, 2000), intervals: [100] }).toBe(n);
    expect(await debugState(page)).toMatchObject({ livePath: 'group', liveDetector: 'full-range' });
    for (const b of (await debugState(page)).boxes) {
      const g = await camBox(page, b.id, false);
      await page.mouse.click(g.point.x, g.point.y);
      await expect.poll(async () => (await debugState(page)).selected).toBe(b.id);
    }
    expect((await debugState(page)).fps).toBeGreaterThan(0);
  });
}

test('E4 option C on the same layout: one full-range VIDEO pass, the faces it finds recorded for §16 @far10', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('meiyan.debug.live.v1', JSON.stringify({ group: false })));
  await open(page);
  await flipBack(page);
  await page.waitForTimeout(5000);
  const d = await debugState(page);
  console.log(`option C faces on upright_far10: ${d.faces}`);
  expect(d).toMatchObject({ livePath: 'solo', liveDetector: 'full-range' });
});

test('E4 front camera, a group selfie: the group path starts with the second near face; the back row found within 2 s of the move @selfie', async ({ page }) => {
  await open(page);
  const seen: string[] = [];
  await expect
    .poll(async () => {
      const p = (await debugState(page)).livePath;
      if (p && seen.at(-1) !== p) seen.push(p);
      return p;
    }, { timeout: 60_000, intervals: [50] })
    .toBe('group');
  const t1 = Date.now();
  console.log(`selfie paths seen: ${seen.join(' → ')}`); // 'solo → group' (the move can land before the first sample)
  await expect.poll(async () => (await debugState(page)).faces, { timeout: within(t1, 2000), intervals: [100] }).toBe(5);
});

test('bench: back camera, ten far faces, 全部套用 on with 一鍵 › 自然: live fps and frames per detection (spec §12.4) @far10 @bench', async ({ page }) => {
  test.skip(!process.env.BENCH, 'run with BENCH=1 npx playwright test --project chromium-upright-far10 --grep @bench');
  test.setTimeout(240_000);
  await open(page);
  await flipBack(page);
  await expect.poll(async () => (await debugState(page)).faces, { timeout: 30_000 }).toBe(10);
  // the chip waits for ChipGate's debounce (camera-group.spec.ts's 全部套用 case)
  await page.addStyleTag({ content: '.all-chip { display: inline-flex !important; }' });
  await page.getByRole('button', { name: '全部套用' }).click();
  await expect.poll(async () => (await debugState(page)).selected).toBe('all');
  await page.getByRole('tab', { name: '一鍵', exact: true }).click();
  await page.getByRole('option', { name: '自然', exact: true }).click();
  await page.waitForTimeout(10_000);
  const d = await debugState(page);
  console.log(`E4 bench, upright_far10, back camera, 全部套用 自然: fps ${d.fps.toFixed(1)}, liveEvery ${d.liveEvery}, faces ${d.faces}`);
});
