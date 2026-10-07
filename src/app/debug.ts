// window.__meiyan (DebugState) access shared by the live loop, still sessions and the bench page.
import type { DebugState } from '../types';

/** The page-wide debug object, created with neutral defaults on first use; null outside a browser. */
export function debugState(): DebugState | null {
  if (typeof window === 'undefined') return null;
  window.__meiyan ??= {
    fps: 0,
    detectMs: 0,
    renderMs: 0,
    tier: 'H',
    delegate: null,
    face: false,
    screen: '',
    cameraState: 'idle',
    lastError: null,
  };
  return window.__meiyan;
}

const warned = new Set<string>();

/** Log an error once per key (per-frame failures must not flood the console) and record it for debugging. */
export function reportError(key: string, err: unknown): void {
  const msg = `${key}: ${err instanceof Error ? err.message : String(err)}`;
  const d = debugState();
  if (d) d.lastError = msg;
  if (warned.has(key)) return;
  warned.add(key);
  console.error(`[meiyan] ${key}`, err);
}
