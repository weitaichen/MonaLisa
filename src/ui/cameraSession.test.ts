import { describe, expect, it, vi } from 'vitest';

// the app store without deps (as screens/hooks.test.ts mocks it)
vi.mock('./state', () => {
  let s: Record<string, unknown> = { cameraAll: false };
  return { app: { get: () => s, set: (p: Record<string, unknown>) => void (s = { ...s, ...p }) } };
});

import { LivePersons } from '../app/livePersons';
import { CAMERA_NO_FACE_NOTE, CAMERA_OFF_NOTE, LIVE_PERSONS, lensFor } from '../edit/lens';
import { cameraEdit, LIVE, naturalPerson, neutralPerson, neutralPhoto, personFromPreset } from '../edit/state';
import { beginDrag, cameraLensInfo, cameraSession, endCameraSession, keepDrag, panelPerson, writePerson, type CameraDrag } from './cameraSession';
import { activate, INITIAL_SELECTION, itemsFor, sliderFor } from './panelModel';
import { app } from './state';

const at = (cx: number) => ({ x: cx - 0.05, y: 0.35, w: 0.1, h: 0.3 });

describe('the camera session (camera per-person spec §3.11, §5.1)', () => {
  it('cameraSession() is one instance, made on first use', () => {
    expect(cameraSession()).toBe(cameraSession());
  });
  it('endCameraSession clears the one session and turns 全部套用 off', () => {
    const s = cameraSession();
    s.resume(0, 'user');
    s.setAll(true);
    app.set({ cameraAll: true });
    endCameraSession();
    expect([cameraSession() === s, s.all(), app.get().cameraAll]).toEqual([true, false, false]);
  });
});

describe('the panel drag (camera per-person spec §3.2)', () => {
  it('Review Focus #3: a drag keeps writing the person it started on when the target changes mid-drag', () => {
    const s = new LivePersons();
    s.resume(0, 'user');
    const a = s.claim(at(0.3), 16 / 9, 0);
    const b = s.claim(at(0.7), 16 / 9, 0);
    s.sync([a, b], a);
    const d = beginDrag(s, `c${a}:skin.smooth`);
    writePerson(s, naturalPerson(), d); // the first write pins a (K9)
    s.release(a, at(0.3), 100); // a leaves mid-drag
    s.sync([b], b);
    expect(s.target()).toBe(b);
    // the panel keys its slider on the drag's lead while the drag runs (Camera.tsx), so the row still shows the same binding
    expect(keepDrag(d, `c${a}:skin.smooth`)).toBe(d);
    writePerson(s, personFromPreset('refined', 1), d);
    expect([s.params(a), s.params(b)]).toEqual([personFromPreset('refined', 1), null]);
    expect(panelPerson(s, d)).toEqual(personFromPreset('refined', 1));
    expect(panelPerson(s, null)).toEqual(neutralPerson());
  });
  it('C11: a drag that keeps writing its pinned lead while the lead is away keeps their return: re-identified, they are the target again', () => {
    const s = new LivePersons();
    s.resume(0, 'user');
    const a = s.claim(at(0.3), 16 / 9, 0);
    const b = s.claim({ x: 0.6, y: 0.3, w: 0.2, h: 0.4 }, 16 / 9, 0); // the larger face: the auto pick
    s.sync([a, b], b);
    s.pin(a); // tapped
    const d = beginDrag(s, `c${a}:skin.smooth`);
    writePerson(s, naturalPerson(), d);
    s.release(a, at(0.3), 100); // a missed past the hold mid-drag
    s.sync([b], b);
    writePerson(s, personFromPreset('refined', 1), d); // the drag still writes a (§3.2)
    expect(s.claim(at(0.3), 16 / 9, 1500)).toBe(a); // back within the grace
    s.sync([a, b], b);
    expect([s.selection(), s.target()]).toEqual([a, a]);
    expect(panelPerson(s, null)).toEqual(personFromPreset('refined', 1));
  });
  it('C12: under 全部套用 a face that enters mid-drag gets the drag’s later writes, and ends at the committed value with everyone else', () => {
    const s = new LivePersons();
    s.resume(0, 'user');
    const a = s.claim(at(0.2), 16 / 9, 0);
    const b = s.claim(at(0.5), 16 / 9, 0);
    s.sync([a, b], a);
    s.setAll(true);
    const smooth = (v: number) => {
      const p = neutralPerson();
      return { ...p, values: { ...p.values, 'skin.smooth': v }, preset: 'custom' as const };
    };
    const d = beginDrag(s, `c${a}:skin.smooth`);
    writePerson(s, smooth(0.2), d);
    const c = s.claim(at(0.8), 16 / 9, 50); // walks in at 20
    s.sync([a, b, c], a);
    writePerson(s, smooth(0.8), d); // released at 80
    expect([a, b, c].map((id) => s.params(id)?.values['skin.smooth'])).toEqual([0.8, 0.8, 0.8]);
    expect(panelPerson(s, d).values['skin.smooth']).toBe(0.8);
  });
  it('Review Focus #3: a drag the slider row dropped without a commit (no slider shown, or another binding) never carries into the next drag', () => {
    const s = new LivePersons();
    s.resume(0, 'user');
    const a = s.claim(at(0.3), 16 / 9, 0);
    const b = s.claim(at(0.7), 16 / 9, 0);
    s.sync([a, b], a);
    const d = beginDrag(s, `c${a}:skin.smooth`);
    writePerson(s, naturalPerson(), d);
    // the last face left (person items off: no slider), the camera paused or flipped (no row), or the tab changed
    expect([keepDrag(d, null), keepDrag(d, `c${a}:shape.faceSlim`)]).toEqual([null, null]);
    s.pin(b);
    const next = keepDrag(null, `c${b}:skin.smooth`) ?? beginDrag(s, `c${b}:skin.smooth`);
    expect([next.ids, next.lead]).toEqual([[b], b]);
    writePerson(s, personFromPreset('refined', 1), next);
    expect([s.params(a), s.params(b)]).toEqual([naturalPerson(), personFromPreset('refined', 1)]);
  });
});

describe('the camera lens (cameraLensInfo, camera per-person spec §3.2, §3.6)', () => {
  const lensOf = (s: LivePersons, drag: CameraDrag | null, o: { shown: number; basic?: boolean; live?: boolean }) =>
    lensFor(cameraEdit(neutralPhoto(), panelPerson(s, drag)), { kind: 'person', id: LIVE }, LIVE_PERSONS, LIVE, {
      camera: cameraLensInfo(s, drag, { shown: o.shown, all: s.all(), basic: o.basic ?? false, live: o.live ?? true }),
    });
  const preset = { ...INITIAL_SELECTION, tab: 'preset' as const };
  it('round-1 review C4: before the stream is live (nobody in view, no target) person items and presets are off: a 一鍵 tap saves nothing', () => {
    const s = new LivePersons();
    s.resume(0, 'user');
    const l = lensOf(s, null, { shown: 0, live: false });
    // the note says to open the camera; live with no face, K11's
    expect([l.personOff, lensOf(s, null, { shown: 0 }).personOff]).toEqual([CAMERA_OFF_NOTE, CAMERA_NO_FACE_NOTE]);
    const natural = itemsFor(l, preset).find((i) => i.key === 'natural')!;
    expect(natural).toMatchObject({ disabled: true, reason: CAMERA_OFF_NOTE });
    // the photo part is not saved alone: the edit is unchanged, the tap only says why
    expect(activate(natural, l, preset)).toMatchObject({ edit: l.edit, changed: false, notice: CAMERA_OFF_NOTE });
    // photo items stay usable
    expect(itemsFor(l, { ...INITIAL_SELECTION, tab: 'skin', skin: 'skin.whiten' }).find((i) => i.key === 'skin.whiten')?.disabled).toBe(false);
    // a face in view: the preset is on and applies whole
    const a = s.claim(at(0.5), 16 / 9, 0);
    s.sync([a], a);
    const live = lensOf(s, null, { shown: 1 });
    const on = itemsFor(live, preset).find((i) => i.key === 'natural')!;
    expect(on.disabled).toBe(false);
    const r = activate(on, live, preset);
    expect(r.edit.photo.presetLink?.id).toBe('natural');
    expect(r.edit.persons[LIVE]?.preset).toMatchObject({ id: 'natural' });
  });
  it('基本模式 edits the ambient person: never off, before the stream too', () => {
    const s = new LivePersons();
    expect([lensOf(s, null, { shown: 0, basic: true }).personOff, lensOf(s, null, { shown: 0, basic: true, live: false }).personOff]).toEqual([null, null]);
  });
  it('round-1 review C13: a photo-level drag begun with no face shown keeps its slider binding when a face appears', () => {
    const s = new LivePersons();
    s.resume(0, 'user');
    const adjust = { ...INITIAL_SELECTION, tab: 'adjust' as const };
    const key0 = sliderFor(lensOf(s, null, { shown: 0 }), adjust)!.key;
    expect(sliderFor(lensOf(s, null, { shown: 0, live: false }), adjust)!.key).toBe(key0);
    const d = beginDrag(s, key0);
    expect(d.lead).toBeNull();
    const a = s.claim(at(0.5), 16 / 9, 0);
    s.sync([a], a);
    const key1 = sliderFor(lensOf(s, d, { shown: 1 }), adjust)!.key;
    expect(keepDrag(d, key1)).toBe(d);
    // after the drag the key is still target-free
    expect(sliderFor(lensOf(s, null, { shown: 1 }), adjust)!.key).toBe(key0);
  });
});
