import { describe, expect, it, vi } from 'vitest';

// the app store without deps (as screens/hooks.test.ts mocks it)
vi.mock('./state', () => {
  let s: Record<string, unknown> = { cameraAll: false };
  return { app: { get: () => s, set: (p: Record<string, unknown>) => void (s = { ...s, ...p }) } };
});

import { cameraSession, endCameraSession } from './cameraSession';
import { app } from './state';

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
