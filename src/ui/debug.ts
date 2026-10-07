// window.__meiyan: debug state read by e2e tests and the on-device checklist.
import type { DebugState } from '../types';

function state(): DebugState {
  if (!window.__meiyan) {
    window.__meiyan = {
      fps: 0,
      detectMs: 0,
      renderMs: 0,
      tier: 'H',
      delegate: null,
      face: false,
      screen: 'home',
      cameraState: 'idle',
      lastError: null,
    };
  }
  return window.__meiyan;
}

/** Mutates in place so other writers (app/live.ts) keep sharing the same object. */
export function debug(patch: Partial<DebugState>): void {
  Object.assign(state(), patch);
}

export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/** Log + record; returns the message so callers can surface it in the UI. */
export function reportError(e: unknown, where: string): string {
  const msg = errorText(e);
  console.error(`[meiyan] ${where}:`, e);
  debug({ lastError: `${where}: ${msg}` });
  return msg;
}

state();
