// App-level UI state. No router, no history.pushState, no hash (RB §1 #9): the screen is plain state.
import { neutralLook } from '../edit/state';
import { DEFAULT_PREFS } from '../store/settings';
import type { V1Bodies } from '../edit/migrate';
import type { SourceInfo } from '../media/exportPlan';
import type { CameraLook, DetectionCache, EditState, FaceSeed, LiquifyFrame, PersonId, PersonMask, Prefs, Rect } from '../types';
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
  /** unprocessed frame with the same crop / mirror, for 編輯: it opens there at 原圖, the camera look stays behind (2026-10-18) */
  original: ImageBitmap | null;
  /** camera → editor (C2): the beautified face's centre in the saved image, 'all', or null; it picks who is selected */
  faceSeed: FaceSeed;
}

export interface EditorSource {
  /** owned by the editor session afterwards */
  bitmap: ImageBitmap;
  /** the edit to open with: openState for an entry, importEdit (原圖) for a new photo, imported or a camera shot */
  edit: EditState;
  /** existing history entry being re-edited, or null for a new photo */
  historyId: string | null;
  /** the entry's detection cache, trusted as is (openState checked cachedFits); null = none or dropped */
  detect: DetectionCache | null;
  /** a dropped cache: the old persons' face boxes (rematchByIoU, S §5.3) */
  rematch: Record<PersonId, Rect> | null;
  /** a v1 entry's cached bodies (b0), merged at the first face answer (A13) */
  v1Body: V1Bodies | null;
  /** the cache was dropped or lost persons: toast after the re-detect */
  cacheDropped: boolean;
  /** camera → editor: the beautified face (C2) */
  faceSeed: FaceSeed;
  /** the entry was saved with the 瘦臉 background limit requested (HistoryEntry.faceProtect): reopening requests it again */
  faceProtect?: boolean;
  /** the entry's cached segmenter mask for that limit (HistoryEntry.faceMask) */
  faceMask?: PersonMask;
  /** the source to export at full resolution (S §3.7): the entry's kept file on reopen; for a new import blob stays null
   * until the Editor's keep decision; absent = none (camera shots) */
  source?: SourceInfo;
  /** a new import's picked file: kept as HistoryEntry.source only when shouldKeepSource accepts it */
  picked?: File;
  /** the size the 推臉筆 grid is built on: the entry's stored width × height, or the imported bitmap's size (push-brush spec §3.3) */
  frame: LiquifyFrame;
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
  /** live-camera look (persisted as meiyan.look.v1); the editor keeps its own per-photo edit */
  look: CameraLook;
  prefs: Prefs;
  ratio: Ratio;
  timer: TimerSec;
  toast: { id: number; text: string } | null;
  /** object URL shown full-screen for long-press saving when the share sheet is unavailable */
  saveFallback: string | null;
  /** file name of the save-fallback image (the e2e reads the format from it) */
  saveFallbackName: string | null;
  /** blocking work in progress (e.g. decoding an imported photo) */
  busy: string | null;
  /** 全部套用 (S §2.5): in memory only, false at app start, kept across Review and retakes */
  cameraAll: boolean;
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
  look: safeLoad(() => deps.loadLook(), neutralLook, 'loadLook'),
  prefs: safeLoad(() => deps.loadPrefs(), () => ({ ...DEFAULT_PREFS }), 'loadPrefs'),
  ratio: '3:4',
  timer: 0,
  toast: null,
  saveFallback: null,
  saveFallbackName: null,
  busy: null,
  cameraAll: false,
});

export function go(screen: Screen): void {
  app.set({ screen });
  debug({ screen: screen.name });
}

let saveTimer = 0;
let savePending = false;
/** Write the debounced live-camera look now (no-op when nothing is pending). */
export function flushLook(): void {
  if (!savePending) return;
  savePending = false;
  clearTimeout(saveTimer);
  try {
    deps.saveLook(app.get().look);
  } catch (e) {
    reportError(e, 'saveLook');
  }
}
export function setLook(look: CameraLook): void {
  app.set({ look });
  savePending = true;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(flushLook, 300);
}
// iOS: visibilitychange(hidden) is the last reliable event before a backgrounded PWA is suspended or killed;
// pagehide covers real unloads. (Not beforeunload: unreliable on iOS and it disables bfcache.)
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushLook();
  });
  window.addEventListener('pagehide', flushLook);
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
  app.set({ saveFallback: URL.createObjectURL(file), saveFallbackName: file.name });
}

export function closeSaveFallback(): void {
  const prev = app.get().saveFallback;
  if (prev) URL.revokeObjectURL(prev);
  app.set({ saveFallback: null, saveFallbackName: null });
}
