import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FaceTracks } from '../app/faceTracks';
import { naturalPerson, personFromPreset } from '../edit/state';
import type { Landmarks478, Rect } from '../types';
import { BenchPersons } from './faceScope';

// /bench.html's 美顏對象 (round-2 review D12, Codex #2): 'target' keeps exactly one person edited, the target, with the
// look, wherever the others are (in view, held or away); 'every' edits everyone in view and whoever enters
const natural = naturalPerson();
const refined = personFromPreset('refined', 1);
const box = (cx: number, w = 0.1): Rect => ({ x: cx - w / 2, y: 0.35, w, h: 0.3 });

function session(): BenchPersons {
  const s = new BenchPersons(natural);
  s.resume(0, 'user');
  return s;
}
/** the persons the session holds edited, among `ids` */
const editedOf = (s: BenchPersons, ids: readonly number[]) => ids.filter((id) => s.edited(id));

describe('BenchPersons: 美顏對象 僅選取的人（0.5）, the target only', () => {
  it('from 每張臉, the target alone stays edited, with the look, and is not pinned (it follows the auto pick)', () => {
    const s = session();
    const a = s.take(null);
    const b = s.take(null);
    s.sync([a, b], a);
    expect(editedOf(s, [a, b])).toEqual([a, b]);
    s.setScope('target');
    expect(editedOf(s, [a, b])).toEqual([a]);
    expect(s.params(a)).toBe(natural);
    expect(s.selection()).toBe('auto');
    expect(s.all()).toBe(false);
  });

  it('a person edited under 每張臉 who was away at the switch comes back 原圖', () => {
    const s = session();
    const a = s.take(null);
    const c = s.take(null);
    s.sync([a, c], a);
    s.release(c, box(0.7), 100);
    s.sync([a], a);
    s.setScope('target');
    // c is re-identified from the away pool: still not the target
    expect(s.take(c)).toBe(c);
    s.sync([a, c], a);
    expect(editedOf(s, [a, c])).toEqual([a]);
  });

  it('when the auto pick moves, the last target goes back to 原圖 and the new one gets the look: one face edited', () => {
    const s = session();
    s.setScope('target');
    const a = s.take(null);
    const b = s.take(null);
    s.sync([a, b], a);
    expect(editedOf(s, [a, b])).toEqual([a]);
    s.sync([a, b], b);
    expect(editedOf(s, [a, b])).toEqual([b]);
    expect(s.params(b)).toBe(natural);
    expect(s.target()).toBe(b);
    // the target leaves: away, they are 原圖 too, and the face left in view is the target now
    s.release(b, box(0.7), 200);
    s.sync([a], a);
    expect(editedOf(s, [a, b])).toEqual([a]);
  });

  it('a 參數 change while nobody is in view reaches the target when they come back', () => {
    const s = session();
    s.setScope('target');
    const a = s.take(null);
    s.sync([a], a);
    expect(s.params(a)).toBe(natural);
    s.release(a, box(0.3), 100);
    s.sync([], null);
    s.setLook(refined);
    expect(s.take(a)).toBe(a);
    s.sync([a], a);
    expect(s.params(a)).toBe(refined);
    // and a change with the target in view writes them at once
    s.setLook(natural);
    expect(s.params(a)).toBe(natural);
  });

  it('每張臉 again: everyone in view, a face entering and a person coming back from away get the look', () => {
    const s = session();
    s.setScope('target');
    const a = s.take(null);
    const b = s.take(null);
    s.sync([a, b], a);
    s.setScope('every');
    expect(editedOf(s, [a, b])).toEqual([a, b]);
    s.setLook(refined);
    expect([s.params(a), s.params(b)]).toEqual([refined, refined]);
    const c = s.take(null);
    s.sync([a, b, c], a);
    expect(s.params(c)).toBe(refined);
  });
});

// The same through the live loop's bookkeeping: FaceTracks drives the session as live.ts does (detect + step per frame)
const sample = JSON.parse(readFileSync(new URL('../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as { points: number[] };
function lmAt(cx: number, cy: number, w: number): Landmarks478 {
  const p = sample.points;
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
  for (let i = 0; i < 478; i++) {
    x0 = Math.min(x0, p[i * 3]); x1 = Math.max(x1, p[i * 3]);
    y0 = Math.min(y0, p[i * 3 + 1]); y1 = Math.max(y1, p[i * 3 + 1]);
  }
  const k = w / (x1 - x0);
  const out = new Float32Array(478 * 3);
  for (let i = 0; i < 478; i++) {
    out[i * 3] = cx + (p[i * 3] - (x0 + x1) / 2) * k;
    out[i * 3 + 1] = cy + (p[i * 3 + 1] - (y0 + y1) / 2) * k;
    out[i * 3 + 2] = p[i * 3 + 2] * k;
  }
  return { points: out };
}

describe('BenchPersons through FaceTracks: one face runs the passes, the selected one, as 0.5 drew', () => {
  it('a face away at the switch, its return, the auto pick moving to it and a 參數 change: never two edited', () => {
    const s = session();
    const tracks = new FaceTracks(s);
    let now = 0;
    /** frames at 30 fps; after the switch, each frame: at most one track edited, and with a face shown, the selected one */
    let checked = 0;
    const frames = (n: number, faces: () => Landmarks478[], check = true) => {
      for (let i = 0; i < n; i++) {
        tracks.detect(faces(), (now += 33), 1280, 720);
        tracks.step(33, now);
        if (!check) continue;
        const v = tracks.views();
        const edited = v.filter((x) => x.edited);
        expect(edited.length).toBeLessThanOrEqual(1);
        if (v.some((x) => x.selected)) expect(edited.map((x) => x.selected)).toEqual([true]);
        checked++;
      }
    };
    const A = () => lmAt(0.3, 0.5, 0.2);
    // 每張臉: A and B both edited; then B steps out past the hold, to the away pool, edited
    frames(10, () => [A(), lmAt(0.7, 0.5, 0.15)], false);
    expect(tracks.views().filter((v) => v.edited)).toHaveLength(2);
    const bWas = tracks.views().find((v) => v.box.x > 0.5)!.person;
    frames(40, () => [A()], false);
    expect(tracks.views()).toHaveLength(1);
    s.setScope('target');
    frames(5, () => [A()]);
    // B comes back to their spot (re-identified, not the target), then grows past 1.2 × A for the auto pick's 500 ms
    frames(10, () => [A(), lmAt(0.7, 0.5, 0.15)]);
    const bPerson = tracks.views().find((v) => v.box.x > 0.5)!.person;
    expect(bPerson).toBe(bWas);
    expect(s.edited(bPerson)).toBe(false);
    frames(5, () => [A(), lmAt(0.7, 0.5, 0.2)]);
    frames(30, () => [A(), lmAt(0.7, 0.5, 0.26)]);
    const now2 = tracks.views();
    expect(now2).toHaveLength(2);
    expect(now2.find((v) => v.selected)!.person).toBe(bPerson);
    expect(s.params(bPerson)).toBe(natural);
    s.setLook(refined);
    frames(3, () => [A(), lmAt(0.7, 0.5, 0.26)]);
    expect(s.params(bPerson)).toBe(refined);
    // the target leaves: the face left is the target, with the look
    frames(45, () => [A()]);
    const left = tracks.views();
    expect(left).toHaveLength(1);
    expect(s.params(left[0].person)).toBe(refined);
    expect(s.edited(bPerson)).toBe(false);
    expect(s.selection()).toBe('auto');
    expect(checked).toBe(98);
  });
});
