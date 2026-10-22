// E4 (camera per-person spec §12.2, gate PGR, K17, K20) and 合照模式 (K22): ordinary group shots held upright, 1080 × 1920
// clips. The camera's 合照模式 toggle picks the path: off (the default) one VIDEO pass over the whole frame (the front
// camera's solo path, option C on the back camera), on the group path (§6.6) on both cameras.
import type { Page } from '@playwright/test';
import {
  camBox,
  cpuDelegate,
  debugState,
  expect,
  flipBack,
  groupModeButton,
  open,
  setGroupMode,
  test,
  toastsSeen,
  uprightCamera,
  watchToasts,
  within,
} from './fixtures';

test.beforeEach(async ({ page }) => {
  await uprightCamera(page);
  await cpuDelegate(page, process.env.PGR_DELEGATE ?? 'CPU');
});

/** every face's box hit-tests to itself and selects it (the back camera's preview is not mirrored) */
async function tapEach(page: Page, mirrored: boolean): Promise<void> {
  for (const b of (await debugState(page)).boxes) {
    const g = await camBox(page, b.id, mirrored);
    await page.mouse.click(g.point.x, g.point.y);
    await expect.poll(async () => (await debugState(page)).selected).toBe(b.id);
  }
}

/** the livePath values the debug state shows over the next `ms`, in order (sampled every 50 ms) */
async function pathsFor(page: Page, ms: number): Promise<string[]> {
  const seen: string[] = [];
  for (const end = Date.now() + ms; Date.now() < end; await page.waitForTimeout(50)) {
    const p = (await debugState(page)).livePath;
    if (p && seen.at(-1) !== p) seen.push(p);
  }
  return seen;
}

for (const [tag, n] of [
  ['@row3', 3],
  ['@far10', 10],
] as const) {
  test(`E4 back camera, upright, 合照模式 on: the group path finds all ${n} faces within 2 s of the first live frame, each tappable ${tag}`, async ({ page }) => {
    await open(page);
    // turned on before the flip, so the back camera's stream starts on the group path (PGR's 2 s count from its first frame)
    await setGroupMode(page, true);
    const t0 = await flipBack(page);
    await expect.poll(async () => (await debugState(page)).faces, { timeout: within(t0, 2000), intervals: [100] }).toBe(n);
    expect(await debugState(page)).toMatchObject({ livePath: 'group', liveDetector: 'full-range' });
    await tapEach(page, false);
    expect((await debugState(page)).fps).toBeGreaterThan(0);
  });
}

test('E4 合照模式 off (the default): option C on the same layout, one full-range VIDEO pass, only the faces it finds (§16) @far10', async ({ page }) => {
  await open(page);
  await expect(groupModeButton(page)).toHaveAttribute('aria-pressed', 'false');
  await flipBack(page);
  await page.waitForTimeout(5000);
  const d = await debugState(page);
  console.log(`option C faces on upright_far10: ${d.faces}`);
  expect(d).toMatchObject({ livePath: 'solo', liveDetector: 'full-range', liveViews: [] });
  expect(d.faces).toBeLessThan(10);
  expect(d.boxes.every((b) => b.view === 'video')).toBe(true);
});

test('合照模式 turned on mid-stream on the back camera: option C → the group path on the next frames, all ten far faces found and tappable @far10', async ({ page }) => {
  await open(page);
  await flipBack(page);
  await expect.poll(async () => (await debugState(page)).livePath).toBe('solo');
  await setGroupMode(page, true);
  const t1 = Date.now();
  await expect.poll(async () => (await debugState(page)).faces, { timeout: within(t1, 3000), intervals: [100] }).toBe(10);
  console.log(`far10 after the mid-stream toggle: ten faces ${Date.now() - t1} ms after the tap`);
  expect(await debugState(page)).toMatchObject({ livePath: 'group', liveDetector: 'full-range' });
  await tapEach(page, false);
});

test('合照模式 toggled with a person edited: every face keeps its person and params, the selection stays, nobody swapped, both ways @row3', async ({ page }) => {
  await open(page);
  await setGroupMode(page, true);
  await flipBack(page);
  await expect.poll(async () => (await debugState(page)).faces, { timeout: 30_000, intervals: [100] }).toBe(3);
  // left → right on the unmirrored back-camera preview: the person of each face
  const people = async () => [...(await debugState(page)).boxes].sort((a, b) => a.x - b.x).map((b) => ({ person: b.person, edited: b.edited }));
  const middle = [...(await debugState(page)).boxes].sort((a, b) => a.x - b.x)[1];
  const g = await camBox(page, middle.id, false);
  await page.mouse.click(g.point.x, g.point.y);
  await expect.poll(async () => (await debugState(page)).selected).toBe(middle.id);
  await page.getByRole('tab', { name: '一鍵', exact: true }).click();
  await page.getByRole('option', { name: '自然', exact: true }).click();
  await expect.poll(async () => (await people()).map((p) => p.edited)).toEqual([false, true, false]);
  const before = await people();
  const selectedPerson = async () => {
    const d = await debugState(page);
    return d.boxes.find((b) => b.id === d.selected)?.person;
  };
  expect(await selectedPerson()).toBe(before[1].person);
  for (const on of [false, true]) {
    await setGroupMode(page, on);
    await expect.poll(async () => (await debugState(page)).livePath).toBe(on ? 'group' : 'solo');
    await page.waitForTimeout(2000);
    expect(await people()).toEqual(before);
    expect(await selectedPerson()).toBe(before[1].person);
    // the panel still shows the selected person's 自然
    await expect(page.getByRole('option', { name: '自然', exact: true })).toHaveAttribute('aria-selected', 'true');
  }
});

test('合照模式 turned off and on again with a far person edited: the person only it finds waits away and comes back edited and selected, past the 4 s grace @far10', async ({ page }) => {
  await open(page);
  await setGroupMode(page, true);
  await flipBack(page);
  await expect.poll(async () => (await debugState(page)).faces, { timeout: 30_000, intervals: [100] }).toBe(10);
  const far = [...(await debugState(page)).boxes].sort((a, b) => a.x - b.x)[0];
  const g = await camBox(page, far.id, false);
  await page.mouse.click(g.point.x, g.point.y);
  await expect.poll(async () => (await debugState(page)).selected).toBe(far.id);
  await page.getByRole('tab', { name: '一鍵', exact: true }).click();
  await page.getByRole('option', { name: '自然', exact: true }).click();
  await expect.poll(async () => (await debugState(page)).boxes.find((b) => b.person === far.person)?.edited).toBe(true);
  // off: option C cannot see the far face; its track is dropped after the hold and the person waits away
  await setGroupMode(page, false);
  await expect.poll(async () => (await debugState(page)).livePath).toBe('solo');
  await expect.poll(async () => (await debugState(page)).boxes.some((b) => b.person === far.person), { timeout: 10_000 }).toBe(false);
  await page.waitForTimeout(5000); // past REID_GRACE_MS (4 s) since the drop
  await setGroupMode(page, true);
  const back = async () => (await debugState(page)).boxes.find((b) => b.person === far.person);
  await expect.poll(async () => (await back())?.edited, { timeout: 10_000, intervals: [100] }).toBe(true);
  await expect.poll(async () => {
    const d = await debugState(page);
    return d.boxes.find((b) => b.id === d.selected)?.person;
  }).toBe(far.person);
  await expect(page.getByRole('option', { name: '自然', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('合照模式 on, a group selfie: the front camera runs the group path from its first frame and finds the back row; the choice survives a reload @selfie', async ({ page }) => {
  await open(page);
  await watchToasts(page);
  const b = groupModeButton(page);
  const box = (await b.boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await setGroupMode(page, true);
  // the first turn-on explains what the mode trades (once per install)
  await expect.poll(() => toastsSeen(page)).toContain('遠處的人也能點選，人多時預覽可能較不順');
  // the toggle moves the stream on its next frame (K22: no wait for a second face)
  const t1 = Date.now();
  await expect.poll(async () => (await debugState(page)).livePath, { timeout: within(t1, 1000), intervals: [50] }).toBe('group');
  await expect.poll(async () => (await debugState(page)).faces, { timeout: within(t1, 2000), intervals: [100] }).toBe(5);
  console.log(`selfie, 合照模式 turned on: five faces ${Date.now() - t1} ms after the tap`);
  await tapEach(page, true);
  // remembered across launches (meiyan.prefs.v1): a reload opens the camera with it on, on the group path from its
  // first frame (never the solo path)
  await page.reload();
  await page.getByRole('button', { name: /拍攝/ }).click();
  await expect(groupModeButton(page)).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '點擊開啟相機' }).click();
  await expect.poll(async () => (await debugState(page)).cameraState, { timeout: 120_000 }).toBe('live');
  expect(await pathsFor(page, 5000)).toEqual(['group']);
  expect((await debugState(page)).faces).toBe(5);
  // turning it on again shows no toast (once per install): the toggle off and on
  await watchToasts(page);
  await setGroupMode(page, false);
  await setGroupMode(page, true);
  await page.waitForTimeout(500);
  expect(await toastsSeen(page)).not.toContain('遠處的人也能點選，人多時預覽可能較不順');
});

test('合照模式 off (the default), a group selfie: the solo path throughout, only the two near faces; the hint about 合照模式 follows the tap hint @selfie', async ({ page }) => {
  await open(page);
  await watchToasts(page);
  await expect(groupModeButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await debugState(page)).faces, { timeout: 60_000, intervals: [100] }).toBe(2);
  expect(await pathsFor(page, 6000)).toEqual(['solo']);
  const d = await debugState(page);
  expect(d).toMatchObject({ livePath: 'solo', liveDetector: 'short-range', faces: 2 });
  expect(d.boxes.every((x) => x.view === 'video')).toBe(true);
  // the tap hint first (§3.1), then the 合照模式 hint (K22), each once
  const hint = '開啟合照模式，遠處的人也能點選';
  await expect.poll(() => toastsSeen(page), { timeout: 10_000 }).toContain(hint);
  const t = await toastsSeen(page);
  expect(t.indexOf('點選畫面中的臉，可個別調整')).toBeGreaterThanOrEqual(0);
  expect(t.indexOf('點選畫面中的臉，可個別調整')).toBeLessThan(t.indexOf(hint));
});

test('bench: back camera, ten far faces, 全部套用 on with 一鍵 › 自然: live fps and frames per detection (spec §12.4) @far10 @bench', async ({ page }) => {
  test.skip(!process.env.BENCH, 'run with BENCH=1 npx playwright test --project chromium-upright-far10 --grep @bench');
  test.setTimeout(240_000);
  await open(page);
  await setGroupMode(page, true);
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
