// 有新版本 prompt — the wiring. registerSW (src/main.tsx, production only) reports a waiting service worker
// here; the banner (components/UpdateBanner.tsx) reads `updates`. The waiting worker only takes over when the
// user taps 更新 (skipWaiting stays off in vite.config.ts), so nothing ever reloads mid-capture or mid-edit.
// Without a service worker (dev, Lockdown Mode) nothing here runs and the banner never shows.
import { hasSavedSettings, loadSeenVersion, saveSeenVersion } from '../store/settings';
import { APP_VERSION, isVersion } from '../version';
import { debug, reportError } from './debug';
import { app, flushParams, historySettled, toast } from './state';
import { createStore } from './store';
import {
  CHECK_EVERY_MS,
  dismiss,
  gotVersion,
  initialUpdate,
  needRefresh,
  shouldCheck,
  startApply,
  updatedNotice,
  type UpdateState,
} from './updateModel';

export const updates = createStore<UpdateState>(initialUpdate());
updates.subscribe((s) => debug({ update: s.phase }));

type UpdateSW = (reloadPage?: boolean) => Promise<void>;
let updateSW: UpdateSW | null = null;

/** registerSW's return value: posts SKIP_WAITING to the waiting worker. */
export function setUpdateSW(fn: UpdateSW): void {
  updateSW = fn;
}

/** The deployed version (not precached, served no-cache). null when it can not be read. */
async function fetchDeployedVersion(): Promise<string | null> {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store' });
    if (!res.ok) return null;
    const v = ((await res.json()) as { version?: unknown } | null)?.version;
    return isVersion(v) ? v : null;
  } catch {
    return null; // offline: the banner says 有新版本 without a number
  }
}

/** registerSW onNeedRefresh */
export function onNeedRefresh(): void {
  updates.set(needRefresh);
  void fetchDeployedVersion().then((v) => updates.set((s) => gotVersion(s, v, APP_VERSION)));
}

let lastCheck: number | null = null;
function check(reg: ServiceWorkerRegistration): void {
  const now = Date.now();
  if (!shouldCheck(now, lastCheck, navigator.onLine !== false, !!reg.installing)) return;
  lastCheck = now;
  try {
    // rejects offline / on a network error: a missed check is not an error
    reg.update().catch(() => undefined);
  } catch {
    // InvalidStateError when the registration was removed meanwhile
  }
}

/** registerSW onRegisteredSW: look for a new version every 30 min while open and whenever the app comes back. */
export function onRegisteredSW(_url: string, reg: ServiceWorkerRegistration | undefined): void {
  if (!reg) return;
  lastCheck = Date.now(); // register() itself just checked
  window.setInterval(() => check(reg), CHECK_EVERY_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') check(reg);
  });
}

let reloading = false;
function reloadOnce(): void {
  if (reloading) return;
  reloading = true;
  window.location.reload();
}

/**
 * registerSW onNeedReload: the new worker took control of this page because 更新 was tapped here — or in
 * another window of the app, while this one may be mid-capture / mid-edit. Reload only on 首頁, after the
 * editor's closing write (queued when it unmounts, just after the screen change) has landed.
 */
export function onNeedReload(): void {
  const atHome = () => app.get().screen.name === 'home';
  const go = () =>
    window.setTimeout(() => {
      flushParams();
      void historySettled().then(reloadOnce);
    }, 50);
  if (atHome()) return void go();
  const off = app.subscribe(() => {
    if (!atHome()) return;
    off();
    go();
  });
}

/** 更新: flush pending writes, hand over to the waiting worker, reload into the new version. */
export async function applyUpdate(): Promise<void> {
  const before = updates.get();
  if (!updateSW) return;
  updates.set(startApply);
  if (updates.get() === before) return; // nothing offered, or already applying
  // cover the screen until the reload: leaving 首頁 now would start the camera / editor on the old version's
  // code just as the new worker (whose precache no longer has the old lazy chunks) takes over
  app.set({ busy: '正在更新…' });
  // only reachable on 首頁 / 設定: the editor flushed its last edit when it closed; wait for that write and for
  // the debounced camera look so the reload loses nothing
  flushParams();
  await historySettled();
  // the new worker claims this page (clientsClaim) → controllerchange → reload. registerSW reloads on its
  // own only when the page was already controlled at load, so listen here too (the first session after an
  // install is not).
  navigator.serviceWorker?.addEventListener('controllerchange', onNeedReload, { once: true });
  try {
    await updateSW(true);
  } catch (e) {
    reportError(e, 'updateSW');
  }
  // the waiting worker may already be gone (activated by another window): reload anyway
  window.setTimeout(onNeedReload, 6000);
}

/** 稍後 */
export function dismissUpdate(): void {
  updates.set(dismiss);
}

/**
 * At startup: on the first launch of a new version say so once (已更新至 v0.2) — also when it arrived without
 * the banner (a cold launch picked up the waiting worker, or the previous version had no banner), then
 * remember this version.
 */
export function announceUpdate(): void {
  const seen = loadSeenVersion();
  if (seen === APP_VERSION) return;
  const returning = !!navigator.serviceWorker?.controller || hasSavedSettings();
  if (!saveSeenVersion(APP_VERSION)) return; // no storage: every launch would look like the first
  const text = updatedNotice(seen, APP_VERSION, returning);
  if (text) toast(text, 4000);
}
