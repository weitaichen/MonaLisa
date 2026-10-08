// App-level UI state. No router, no history.pushState, no hash (RB §1 #9): the screen is plain state.
import { defaultParams } from '../engine/params';
import { DEFAULT_PREFS } from '../store/settings';
import type { BeautyParams, BodyDetection, Prefs } from '../types';
import { deps } from './deps';
import { debug, reportError } from './debug';
import { createStore } from './store';

export type Ratio = '3:4' | '1:1' | '9:16';
export const RATIOS: readonly Ratio[] = ['3:4', '1:1', '9:16'];
/** width / height of the portrait frame */
export const RATIO_VALUE: Record<Ratio, number> = { '3:4': 3 / 4, '1:1': 1, '9:16': 9 / 16 };

export type TimerSec = 0 | 3 | 10;
export const TIMERS: readonly TimerSec[] = [0, 3, 10];

export interface Shot {
  /** processed result, cropped to the frame ratio, mirrored exactly as it will be saved */
  image: ImageData;
  /** encoding starts right after capture so 儲存 can share synchronously */
  file: Promise<File>;
  /** unprocessed frame with the same crop / mirror, for 編輯 (avoids applying effects twice) */
  original: ImageBitmap | null;
  params: BeautyParams;
}

export interface EditorSource {
  /** owned by the editor session afterwards */
  bitmap: ImageBitmap;
  params: BeautyParams;
  /** existing history entry being re-edited, or null for a new photo */
  historyId: string | null;
  /** the entry's cached 美體 detection (null = checked, nobody in the photo; undefined = never checked / unknown) */
  body?: BodyDetection | null;
  returnTo: 'home' | 'camera';
}

export type Screen =
  | { name: 'home' }
  | { name: 'camera' }
  | { name: 'review'; shot: Shot }
  | { name: 'editor'; source: EditorSource };

export type Sheet = null | 'settings' | 'credits';

export interface AppState {
  screen: Screen;
  sheet: Sheet;
  /** live-camera look (persisted); the editor keeps its own per-photo params */
  params: BeautyParams;
  prefs: Prefs;
  ratio: Ratio;
  timer: TimerSec;
  toast: { id: number; text: string } | null;
  /** object URL shown full-screen for long-press saving when the share sheet is unavailable */
  saveFallback: string | null;
  /** blocking work in progress (e.g. decoding an imported photo) */
  busy: string | null;
}

function safeLoad<T>(load: () => T, fallback: () => T, what: string): T {
  try {
    return load();
  } catch (e) {
    reportError(e, what);
    return fallback();
  }
}

export const app = createStore<AppState>({
  screen: { name: 'home' },
  sheet: null,
  params: safeLoad(() => deps.loadParams(), defaultParams, 'loadParams'),
  prefs: safeLoad(() => deps.loadPrefs(), () => ({ ...DEFAULT_PREFS }), 'loadPrefs'),
  ratio: '3:4',
  timer: 0,
  toast: null,
  saveFallback: null,
  busy: null,
});

export function go(screen: Screen): void {
  app.set({ screen });
  debug({ screen: screen.name });
}

let saveTimer = 0;
let savePending = false;
/** Write the debounced live-camera params now (no-op when nothing is pending). */
export function flushParams(): void {
  if (!savePending) return;
  savePending = false;
  clearTimeout(saveTimer);
  try {
    deps.saveParams(app.get().params);
  } catch (e) {
    reportError(e, 'saveParams');
  }
}
export function setParams(params: BeautyParams): void {
  app.set({ params });
  savePending = true;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flushParams, 300);
}
// iOS: visibilitychange(hidden) is the last reliable event before a backgrounded PWA is suspended or killed;
// pagehide covers real unloads. (Not beforeunload: unreliable on iOS and it disables bfcache.)
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushParams();
  });
  window.addEventListener('pagehide', flushParams);
}

// ───────────── 最近編輯 writes in flight ─────────────

let pendingHistory: Promise<unknown> = Promise.resolve();
/** The editor publishes its history write chain here, so Home can re-read once it lands. */
export function setPendingHistory(p: Promise<unknown>): void {
  pendingHistory = p;
}
/** Settles (never rejects) once every history write queued so far has finished. */
export function historySettled(): Promise<void> {
  return pendingHistory.then(
    () => undefined,
    () => undefined,
  );
}

export function setPrefs(patch: Partial<Prefs>): void {
  const prefs = { ...app.get().prefs, ...patch };
  app.set({ prefs });
  try {
    deps.savePrefs(prefs);
  } catch (e) {
    reportError(e, 'savePrefs');
  }
}

let toastSeq = 0;
let toastTimer = 0;
export function toast(text: string, ms = 2200): void {
  const id = ++toastSeq;
  app.set({ toast: { id, text } });
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    if (app.get().toast?.id === id) app.set({ toast: null });
  }, ms);
}

export function showSaveFallback(file: File): void {
  const prev = app.get().saveFallback;
  if (prev) URL.revokeObjectURL(prev);
  app.set({ saveFallback: URL.createObjectURL(file) });
}

export function closeSaveFallback(): void {
  const prev = app.get().saveFallback;
  if (prev) URL.revokeObjectURL(prev);
  app.set({ saveFallback: null });
}
