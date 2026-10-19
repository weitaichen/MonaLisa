import { describe, expect, it, vi } from 'vitest';

// the app store without deps (as screens/hooks.test.ts mocks it)
vi.mock('./state', () => {
  let s: Record<string, unknown> = { cameraAll: false };
  return { app: { get: () => s, set: (p: Record<string, unknown>) => void (s = { ...s, ...p }) } };
});

import { LivePersons } from '../app/livePersons';
import { naturalPerson, neutralPerson, personFromPreset } from '../edit/state';
import { beginDrag, cameraSession, endCameraSession, keepDrag, panelPerson, writePerson } from './cameraSession';
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
