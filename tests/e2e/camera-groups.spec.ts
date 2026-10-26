// E4 (camera per-person spec §12.2, gate PGR, K17, K20) and 合照模式 (K22): ordinary group shots held upright, 1080 × 1920
// clips. The camera's 合照模式 toggle picks the path: off (the default) one VIDEO pass over the whole frame (the front
// camera's solo path, option C on the back camera), on the group path (§6.6) on both cameras.
import type { Page } from '@playwright/test';
import { HANDOVER_IOU, SEED_BOX_PAD } from '../../src/config/limits';
import {
  camBox,
  cpuDelegate,
  debugState,
  expect,
  flipBack,
  groupModeButton,
  open,
  selectPerson,
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

// E4d (round-1 review C20): a shot taken with 合照模式 on, handed to 編輯 (U3–U6, K14, K21). At 9:16 the photo is the
// whole 1080 × 1920 frame, where upright_far10's faces are 3–4 % of the long edge: the editor's one full-range pass
// finds none of them (as option C's VIDEO pass on that frame, §10), so each edited person is found by the zoomed retry
// around their camera box (§5.4), or dropped with the toast. (At 3:4 the photo's faces are 4–5 % of its 1440 px long
// edge, which that pass already finds on these crisp synthetic faces: no retry runs.)

type CamBox = Awaited<ReturnType<typeof debugState>>['boxes'][number];
type Ratio = '3:4' | '9:16';
/**
 * a back-camera box's centre in the shot's UV: unmirrored; at 9:16 the whole 1080 × 1920 stream frame, at 3:4 its centre
 * crop (y 240–1680 px)
 */
const inShot = (b: CamBox, ratio: Ratio = '9:16') => {
  const y = b.y + b.h / 2;
  return { x: b.x + b.w / 2, y: ratio === '9:16' ? y : (y * 1920 - 240) / 1440 };
};
/** the camera person each editor face is (the nearest camera box centre in the shot) */
const cameraPersonOf = (cam: { person?: string; x: number; y: number }[], f: CamBox) => {
  const c = { x: f.x + f.w / 2, y: f.y + f.h / 2 };
  return cam.reduce((a, b) => (Math.hypot(b.x - c.x, b.y - c.y) < Math.hypot(a.x - c.x, a.y - c.y) ? b : a)).person;
};
/** the selected person's 磨皮 as the panel shows it (the item first, so the editor's person chips stay selectable, S A11) */
async function smooth(page: Page): Promise<number> {
  await page.getByRole('tab', { name: '美膚', exact: true }).click();
  await page.getByRole('option', { name: '磨皮', exact: true }).click();
  return Number(await page.getByRole('slider').getAttribute('aria-valuenow'));
}
/** an editor face's 磨皮: its 人物 chip (face ids f0… follow the chips' order) */
async function smoothOf(page: Page, face: CamBox): Promise<number> {
  await page.getByRole('tab', { name: '美膚', exact: true }).click();
  await page.getByRole('option', { name: '磨皮', exact: true }).click();
  await selectPerson(page, Number(face.id.slice(1)) + 1);
  await expect.poll(async () => (await debugState(page)).selected).toBe(face.id);
  return Number(await page.getByRole('slider').getAttribute('aria-valuenow'));
}
/** 拍照 → 預覽 → 編輯, once the editor's first face answer is in */
async function shootAndEdit(page: Page): Promise<void> {
  await page.getByRole('button', { name: '拍照' }).click();
  await page.getByRole('button', { name: '編輯' }).click();
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 90_000 });
}
/** the back camera with 合照模式 on, at `ratio` (3:4, the camera's default; 9:16: 比例 3:4 → 1:1 → 9:16), `n` faces found */
async function groupCamera(page: Page, ratio: Ratio, n: number): Promise<void> {
  await open(page);
  await watchToasts(page);
  await setGroupMode(page, true);
  await flipBack(page);
  if (ratio === '9:16') for (let i = 0; i < 2; i++) await page.getByRole('button', { name: /^比例 / }).click();
  await expect(page.getByRole('button', { name: `比例 ${ratio}` })).toBeVisible();
  await expect.poll(async () => (await debugState(page)).faces, { timeout: 30_000, intervals: [100] }).toBe(n);
}
/** groupCamera on upright_far10 (9:16 unless given), all ten far faces found */
const tenFarFaces = (page: Page, ratio: Ratio = '9:16'): Promise<void> => groupCamera(page, ratio, 10);
/**
 * select camera person `person` with a tap on their face: one action per poll (a track's id may change when a far face
 * is dropped and found again, and a second tap on the pinned face would collapse the panel)
 */
async function tapPerson(page: Page, person: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const d = await debugState(page);
        const b = d.boxes.find((x) => x.person === person);
        if (!b) return false;
        if (d.selected === b.id) return true;
        try {
          const g = await camBox(page, b.id, false);
          await page.mouse.click(g.point.x, g.point.y);
        } catch {
          // the track went meanwhile: the next poll finds the person's new one
        }
        return false;
      },
      { timeout: 25_000, intervals: [400] },
    )
    .toBe(true);
}

test('E4d 合照模式 shot → 編輯 at 9:16: two far persons edited apart keep each their own result (the zoomed retry finds both, and only the edited are retried), nobody dropped @far10', async ({ page }) => {
  test.setTimeout(300_000);
  await tenFarFaces(page);
  const byX = [...(await debugState(page)).boxes].sort((a, b) => a.x - b.x);
  const want = new Map<string, number>();
  for (const [person, preset] of [
    [byX[0].person!, '自然'],
    [byX[9].person!, '精緻'],
  ] as const) {
    await tapPerson(page, person);
    await page.getByRole('tab', { name: '一鍵', exact: true }).click();
    await page.getByRole('option', { name: preset, exact: true }).click();
    await expect.poll(async () => (await debugState(page)).boxes.find((x) => x.person === person)?.edited).toBe(true);
    want.set(person, await smooth(page));
  }
  const values = [...want.values()];
  console.log(`E4d camera 磨皮: ${values.join(', ')}`);
  expect(values[0]).not.toBe(values[1]);
  const cam = (await debugState(page)).boxes.map((b) => ({ person: b.person, ...inShot(b) }));
  await shootAndEdit(page);
  const ed = (await debugState(page)).boxes;
  const of = new Map(ed.map((f) => [f.id, cameraPersonOf(cam, f)]));
  console.log(`E4d editor faces ${ed.length}, retries ${(await debugState(page)).detectRetries}`);
  // both edited persons found (their faces are under the one pass's floor: the zoomed retry ran), and only they: the
  // eight never edited are under that floor too and never retried (round-2 review D14: the 3:4 test below has them)
  expect(ed).toHaveLength(2);
  expect([...want.keys()].every((p) => [...of.values()].includes(p))).toBe(true);
  expect((await debugState(page)).detectRetries).toBeGreaterThan(0);
  // each face its own camera person's 磨皮
  for (const f of ed) expect(await smoothOf(page, f), `${f.id} (camera ${of.get(f.id)})`).toBe(want.get(of.get(f.id)!));
  expect((await toastsSeen(page)).filter((t) => /未帶入相機效果/.test(t))).toEqual([]);
});

test('E4d 合照模式 shot → 編輯 at 3:4: two neighbours edited apart keep each their own result, and the eight never edited, found beside them by the one pass, stay 原圖 @far10', async ({ page }) => {
  test.setTimeout(300_000);
  // round-2 review D14: at 3:4 the editor's one full-range pass finds all ten (4–5 % of the 1440 px long edge), so every
  // never-edited person's box (handed over without params, round-1 review C7) is paired beside the edited ones. Each
  // edited box pairs with its own face by IoU there, 2.7 face widths from the next, so the scene reads the same without
  // those boxes (round-3 review E7): the @behind test below is the one they decide
  await tenFarFaces(page, '3:4');
  const row = [...(await debugState(page)).boxes]
    .sort((a, b) => a.y - b.y)
    .slice(0, 5)
    .sort((a, b) => a.x - b.x);
  const want = new Map<string, number>();
  for (const [person, preset] of [
    [row[1].person!, '自然'],
    [row[2].person!, '精緻'],
  ] as const) {
    await tapPerson(page, person);
    await page.getByRole('tab', { name: '一鍵', exact: true }).click();
    await page.getByRole('option', { name: preset, exact: true }).click();
    await expect.poll(async () => (await debugState(page)).boxes.find((x) => x.person === person)?.edited).toBe(true);
    want.set(person, await smooth(page));
  }
  const values = [...want.values()];
  console.log(`E4d 3:4 camera 磨皮: ${values.join(', ')}`);
  expect(values[0]).not.toBe(values[1]);
  // the shot once the camera tracks all ten again (a far face's track can drop and come back meanwhile)
  await expect.poll(async () => (await debugState(page)).boxes.length, { timeout: 30_000, intervals: [100] }).toBe(10);
  const cam = (await debugState(page)).boxes.map((b) => ({ person: b.person, ...inShot(b, '3:4') }));
  await shootAndEdit(page);
  const ed = (await debugState(page)).boxes;
  console.log(`E4d 3:4 editor faces ${ed.length}, retries ${(await debugState(page)).detectRetries ?? 0}`);
  expect(ed).toHaveLength(10);
  // the camera person whose box centre lies on the face (within a face's width); none for a face whose track was
  // dropped just then (a far face's track can drop and come back on SwiftShader): the shot handed nobody over for it
  const of = new Map(
    ed.map((f) => {
      const c = { x: f.x + f.w / 2, y: f.y + f.h / 2 };
      const near = cam.filter((b) => Math.hypot(b.x - c.x, b.y - c.y) < f.w);
      return [f.id, near.length === 1 ? near[0].person : undefined] as const;
    }),
  );
  const mapped = [...of.values()].filter((p) => p !== undefined);
  console.log(`E4d 3:4 editor faces on a camera box: ${mapped.length}`);
  // one editor face per camera person, the two edited neighbours among them
  expect(new Set(mapped).size).toBe(mapped.length);
  expect([...want.keys()].every((p) => mapped.includes(p))).toBe(true);
  // each edited neighbour its own 磨皮 (no swap), every face the camera never edited 原圖
  for (const f of ed) expect(await smoothOf(page, f), `${f.id} (camera ${of.get(f.id)})`).toBe((of.get(f.id) && want.get(of.get(f.id)!)) ?? 0);
  expect((await toastsSeen(page)).filter((t) => /未帶入相機效果/.test(t))).toEqual([]);
});

// E4d's blocker scene (round-3 review E7: the @far10 scenes above read the same without the never-edited boxes of
// round-1 review C7). upright_behind.y4m: a far face (3.2 % of the long edge) just above a near one's head (15 %), boxed
// apart from it (IoU 0) but its centre inside the near face's box padded by SEED_BOX_PAD. At 9:16 the editor's one pass
// finds the near face only. The near person's box, never edited, takes it by IoU, so the far person's box pairs with
// nothing and is retried, and the zoom finds the far face. Without the near person's box the far one would take the near
// face by the padded-centre rule: the near face would read the far person's 磨皮, and no retry would run.
test('E4d 合照模式 shot → 編輯 at 9:16, a far face just above a near one: the far person edited keeps their result, and the near person, never edited, keeps their own face at 原圖 @behind', async ({ page }) => {
  test.setTimeout(300_000);
  await groupCamera(page, '9:16', 2);
  const [far] = [...(await debugState(page)).boxes].sort((a, b) => a.w - b.w);
  await tapPerson(page, far.person!);
  await page.getByRole('tab', { name: '一鍵', exact: true }).click();
  await page.getByRole('option', { name: '精緻', exact: true }).click();
  await expect.poll(async () => (await debugState(page)).boxes.find((x) => x.person === far.person)?.edited).toBe(true);
  const want = await smooth(page);
  console.log(`E4d behind camera 磨皮: far ${want}`);
  expect(want).toBeGreaterThan(0);
  // the shot once the camera tracks both (the far face's track can drop and come back meanwhile), the near one unedited,
  // taken again (重拍) until the far person goes to 編輯 found at the shutter, the near one with them as a person never
  // edited (C7; debug `shotHandOver`). Round-4 review F5: a far person held or stale at the shutter is a guess, paired by
  // IoU (or the size-gated centre) only, so it never takes the near face, and the scene read the same without the near
  // person's box: the test then passed without the mechanism it is named for. 重拍 re-identifies the far person in place
  // (§7.5); the near one, never edited, may come back as someone new
  let farCam = { x: 0, y: 0 };
  for (let shot = 1; ; shot++) {
    await expect
      .poll(
        async () => {
          const b = (await debugState(page)).boxes;
          return b.length === 2 && b.some((x) => x.person === far.person);
        },
        { timeout: 30_000, intervals: [100] },
      )
      .toBe(true);
    const live = (await debugState(page)).boxes;
    expect(live.find((b) => b.person !== far.person)?.edited).not.toBe(true);
    farCam = inShot(live.find((b) => b.person === far.person)!);
    await page.evaluate(() => {
      if (window.__meiyan) delete window.__meiyan.shotHandOver;
    });
    await page.getByRole('button', { name: '拍照' }).click();
    await expect(page.getByRole('button', { name: '重拍' })).toBeVisible();
    const handed = (await debugState(page)).shotHandOver ?? [];
    console.log(`E4d behind shot ${shot}: ${JSON.stringify(handed.map(({ edited, held, stale }) => ({ edited, held, stale })))}`);
    // the near person, never edited, handed over beside the far one (C7): the box that keeps the near face
    expect(handed.filter((p) => !p.edited && !p.held)).toHaveLength(1);
    const farGoes = handed.filter((p) => p.edited);
    expect(farGoes.length).toBeLessThanOrEqual(1);
    if (farGoes.length === 1 && !farGoes[0].held && !farGoes[0].stale) break;
    expect(shot, 'the far person found at the shutter in one of five shots').toBeLessThan(5);
    // the boxes the camera's new loop publishes, not the last ones before the shot
    await page.evaluate(() => {
      if (window.__meiyan) window.__meiyan.boxes = [];
    });
    await page.getByRole('button', { name: '重拍' }).click();
    await expect.poll(async () => (await debugState(page)).cameraState, { timeout: 60_000 }).toBe('live');
  }
  await page.getByRole('button', { name: '編輯' }).click();
  await expect(page.getByRole('button', { name: '儲存' })).toBeEnabled({ timeout: 90_000 });
  const d = await debugState(page);
  console.log(`E4d behind editor faces ${d.boxes.length}, retries ${d.detectRetries ?? 0}`);
  const [nearFace, farFace] = [...d.boxes].sort((a, b) => b.w - a.w);
  const centre = (b: CamBox) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
  // the scene the never-edited box decides: the far person's box centre inside the near face's box padded by
  // SEED_BOX_PAD (the editor's box, as the padded-centre rule pads it)
  expect(Math.abs(farCam.x - centre(nearFace).x)).toBeLessThan(nearFace.w * (0.5 + SEED_BOX_PAD));
  expect(Math.abs(farCam.y - centre(nearFace).y)).toBeLessThan(nearFace.h * (0.5 + SEED_BOX_PAD));
  // the near face 原圖: the near person's box keeps it (without that box the far one takes it, and it reads the far
  // person's 磨皮; a lone face has no 人物 chips, and the panel is its own)
  expect(d.boxes.length > 1 ? await smoothOf(page, nearFace) : await smooth(page), `near ${nearFace.id}`).toBe(0);
  // both faces: the near one by the one pass, the far one by the zoomed retry around its box (no retry, and the far
  // face missing, without the near person's box)
  expect(d.boxes).toHaveLength(2);
  expect(d.detectRetries).toBeGreaterThan(0);
  // the far face on the far person's box, boxed apart from the near face (box IoU under HANDOVER_IOU: the intersection
  // is under that share of the smaller box)
  expect(Math.hypot(farCam.x - centre(farFace).x, farCam.y - centre(farFace).y)).toBeLessThan(farFace.w);
  const ix = Math.max(0, Math.min(farFace.x + farFace.w, nearFace.x + nearFace.w) - Math.max(farFace.x, nearFace.x));
  const iy = Math.max(0, Math.min(farFace.y + farFace.h, nearFace.y + nearFace.h) - Math.max(farFace.y, nearFace.y));
  expect(ix * iy).toBeLessThan(HANDOVER_IOU * farFace.w * farFace.h);
  // the far face the far person's 磨皮, nobody counted missing
  expect(await smoothOf(page, farFace), `far ${farFace.id}`).toBe(want);
  expect((await toastsSeen(page)).filter((t) => /未帶入相機效果/.test(t))).toEqual([]);
});

test('E4d 合照模式 shot → 編輯 under 全部套用 › 自然: all ten far persons found and carrying the camera result, no toast @far10', async ({ page }) => {
  test.setTimeout(300_000);
  await tenFarFaces(page);
  // the chip waits for ChipGate's debounce (camera-group.spec.ts's 全部套用 case)
  await page.addStyleTag({ content: '.all-chip { display: inline-flex !important; }' });
  await page.getByRole('button', { name: '全部套用' }).click();
  await expect.poll(async () => (await debugState(page)).selected).toBe('all');
  await page.getByRole('tab', { name: '一鍵', exact: true }).click();
  await page.getByRole('option', { name: '自然', exact: true }).click();
  await expect.poll(async () => (await debugState(page)).boxes.every((b) => b.edited)).toBe(true);
  const v = await smooth(page);
  expect(v).toBeGreaterThan(0);
  await shootAndEdit(page);
  await expect.poll(async () => (await debugState(page)).faces, { timeout: 60_000 }).toBe(10);
  expect((await debugState(page)).detectRetries).toBeGreaterThan(0);
  for (const f of (await debugState(page)).boxes) expect(await smoothOf(page, f), f.id).toBe(v);
  expect((await toastsSeen(page)).filter((t) => /未帶入相機效果/.test(t))).toEqual([]);
});
