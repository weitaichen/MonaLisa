// E5 (camera per-person spec §12.2): identity through absences and a swap, on group_move.y4m (Task 12's timeline), on both
// paths (K22): 合照模式 off (the default, the solo path) and on (the group path, §6.6, where E5's swap found the crop-edge
// matching bug; round-1 review C20: since K22 it ran on the solo path only).
import type { Page } from '@playwright/test';
import type { DebugState } from '../../src/types';
import { camBox, cpuDelegate, debugState, expect, open, setGroupMode, test } from './fixtures';

type Box = DebugState['boxes'][number];
const boxes = async (page: Page) => (await debugState(page)).boxes;
const of = (bs: Box[], person: string) => bs.find((b) => b.person === person);
const cx = (b: Box) => b.x + b.w / 2;
/** C's person left of B's (true), right of it (false), or null while either is not shown */
const cLeftOfB = (bs: Box[], cp: string, bp: string): boolean | null => {
  const [c, b] = [of(bs, cp), of(bs, bp)];
  return c && b ? cx(c) < cx(b) : null;
};
const P = { timeout: 25_000, intervals: [100] };
/**
 * two faces shown this long is the long absence: C's track is held LOST_HOLD_MS after it leaves, so two show from about
 * 12 s to C's return at 16.5 s (4.5 s), and the short absence (2–3.5 s) shows two for at most 0.5 s
 */
const LONG_ABSENCE_MS = 3000;

/** the clip's long absence (two faces for LONG_ABSENCE_MS), then C back: the 16.5 s mark, so the next steps meet the timeline in order */
async function syncOnLongAbsence(page: Page): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await expect.poll(async () => (await boxes(page)).length, P).toBe(2);
    await page.waitForTimeout(LONG_ABSENCE_MS);
    if ((await boxes(page)).length === 2) break;
  }
  await expect.poll(async () => (await boxes(page)).length, P).toBe(3);
}

/** Home → 拍攝 → the live camera; `group`: 合照模式 turned on at the gate, so the stream starts on the group path */
async function openOn(page: Page, group: boolean): Promise<void> {
  if (!group) return open(page);
  await page.goto('/');
  await page.getByRole('button', { name: /拍攝/ }).click();
  await setGroupMode(page, true);
  await page.getByRole('button', { name: '點擊開啟相機' }).click();
  await expect.poll(async () => (await debugState(page)).cameraState, { timeout: 120_000 }).toBe('live');
}

for (const { suffix, group } of [
  { suffix: '', group: false },
  { suffix: ' (合照模式: the group path)', group: true },
] as const) {
  test(`E5 identity: C away 1.5 s → the same person; B and C swap → each id follows its face; C away 5.5 s → a new person at 原圖, B unchanged${suffix}`, async ({ page }) => {
    test.setTimeout(240_000);
    // the CPU delegate, as the 10-face and upright tests (spec §12.2): SwiftShader's GPU path detects about twice a second
    // with three faces (a call ~100 ms, k = 6), slower than the 1 s hold needs to see C through the swap's occlusion
    await cpuDelegate(page);
    await openOn(page, group);
    await expect.poll(async () => (await boxes(page)).length, { timeout: 120_000 }).toBe(3);
    expect((await debugState(page)).livePath).toBe(group ? 'group' : 'solo');
    await syncOnLongAbsence(page); // C is now present for 3.5 s (16.5–18 s, then 0–2 s of the next loop)
    const at = (bs: Box[]) => {
      const A = [...bs].sort((a, b) => a.y - b.y)[0];
      const [C, B] = bs.filter((b) => b !== A).sort((a, b) => cx(b) - cx(a));
      return { A, B, C };
    };
    const first = at(await boxes(page));
    const home = cx(first.C);
    // select C, then 一鍵 › 自然; one action per poll (a tap on the pinned face would collapse the panel)
    await expect
      .poll(async () => {
        const d = await debugState(page);
        const C = at(d.boxes).C;
        if (d.selected !== C.id) {
          const g = await camBox(page, C.id);
          await page.mouse.click(g.point.x, g.point.y);
          return false;
        }
        if (!C.edited) {
          await page.getByRole('tab', { name: '一鍵', exact: true }).click();
          await page.getByRole('option', { name: '自然', exact: true }).click();
          return false;
        }
        return true;
      }, P)
      .toBe(true);
    const { B, C } = at(await boxes(page));
    const [cp, bp] = [C.person!, B.person!];
    // away 1.5 s, back near: the same person, still edited
    await expect.poll(async () => (await boxes(page)).length, P).toBe(2);
    await expect.poll(async () => (await boxes(page)).length, P).toBe(3);
    expect(of(await boxes(page), cp), 'C back under the same person').toMatchObject({ edited: true });
    // the swap: C's person on B's side, then home again
    await expect.poll(async () => cLeftOfB(await boxes(page), cp, bp), { ...P, message: "C's person on B's side" }).toBe(true);
    await expect.poll(async () => cLeftOfB(await boxes(page), cp, bp), { ...P, message: "C's person home again, right of B's" }).toBe(false);
    // away 5.5 s (over the 4 s grace): whoever returns at C's place is a new person at 原圖
    await expect.poll(async () => (await boxes(page)).length, P).toBe(2);
    await page.waitForTimeout(LONG_ABSENCE_MS);
    expect((await boxes(page)).length).toBe(2);
    await expect.poll(async () => (await boxes(page)).length, P).toBe(3);
    const back = (await boxes(page)).find((b) => Math.abs(cx(b) - home) < 0.05);
    expect(back, "a face back at C's place").toBeTruthy();
    expect([back!.person === cp, back!.edited]).toEqual([false, false]);
    expect(of(await boxes(page), bp), "B's person, unchanged").toMatchObject({ edited: false });
  });
}
