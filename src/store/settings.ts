// OWNER: store agent. localStorage persistence (every access in try/catch).
//
// Storage can be missing or hostile: Lockdown Mode / private browsing / blocked site data make the
// `localStorage` getter itself throw, setItem throws QuotaExceededError, and stored text may be
// corrupt or from another version. Loads therefore always return a complete, valid object and
// saves never throw.
import { sanitizeParams } from '../engine/params';
import { splitLegacy } from '../edit/legacy';
import { neutralLook, neutralPerson, sanitizePerson, sanitizePhoto } from '../edit/state';
import type { BeautyParams, CameraLook, ExportFormat, ExportSize, Prefs } from '../types';

export const PARAMS_KEY = 'meiyan.params.v1';
export const PREFS_KEY = 'meiyan.prefs.v1';

export const DEFAULT_PREFS: Prefs = {
  mirrorOnSave: true,
  tier: 'auto',
  matchGpupixel: false,
  showLandmarks: false,
  delegate: 'auto',
  installHintDismissed: false,
  exportFormat: 'jpeg',
  exportSize: 'full',
};

const TIERS: readonly Prefs['tier'][] = ['auto', 'H', 'M', 'L'];
const DELEGATES: readonly Prefs['delegate'][] = ['auto', 'CPU'];
const FORMATS: readonly ExportFormat[] = ['jpeg', 'png'];
const SIZES: readonly ExportSize[] = ['full', 'standard'];

export function loadParams(): BeautyParams {
  return sanitizeParams(readJson(PARAMS_KEY));
}

export function saveParams(p: BeautyParams): void {
  writeJson(PARAMS_KEY, sanitizeParams(p));
}

export function loadPrefs(): Prefs {
  return sanitizePrefs(readJson(PREFS_KEY));
}

export function savePrefs(p: Prefs): void {
  writeJson(PREFS_KEY, sanitizePrefs(p));
}

export const LOOK_KEY = 'meiyan.look.v1';

/**
 * Untrusted camera look → valid (RM §3.7): a field it lacks is 原圖's (neutral), as nobody set it; no geometry / spots /
 * strokes in the camera.
 */
export function sanitizeLook(raw: unknown): CameraLook {
  const r = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  return { photo: sanitizePhoto(r.photo), person: sanitizePerson(r.person, neutralPerson()) };
}

/**
 * The live-camera look. The first load without meiyan.look.v1 migrates meiyan.params.v1 (0.3) through splitLegacy and
 * stores the result; meiyan.params.v1 is neither written nor deleted (RM §3.7). Without either key nobody saved a
 * camera look here: a fresh install, or an upgrader who never moved a camera slider or preset (0.3 wrote params.v1
 * only from the camera's own edits, 0.4.0 never wrote its default look). Both start at the 原圖 look (2026-10-18, the
 * user's 「全部都原圖」; 0.3 and 0.4.0 started at 自然) and nothing is written, so hasSavedSettings still tells a fresh
 * install from a returning user (announceUpdate).
 */
export function loadLook(): CameraLook {
  const raw = readJson(LOOK_KEY);
  if (raw !== undefined) return sanitizeLook(raw);
  const legacy = readJson(PARAMS_KEY);
  if (legacy === undefined) return neutralLook();
  const look = splitLegacy(sanitizeParams(legacy));
  writeJson(LOOK_KEY, look);
  return look;
}

export function saveLook(l: CameraLook): void {
  writeJson(LOOK_KEY, sanitizeLook(l));
}

/** Untrusted value → complete Prefs: each field kept only if it has the right type/value, else default. */
export function sanitizePrefs(raw: unknown): Prefs {
  const out: Prefs = { ...DEFAULT_PREFS };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;
  const bool = (k: 'mirrorOnSave' | 'matchGpupixel' | 'showLandmarks' | 'installHintDismissed') => {
    const v = r[k];
    if (typeof v === 'boolean') out[k] = v;
  };
  bool('mirrorOnSave');
  bool('matchGpupixel');
  bool('showLandmarks');
  bool('installHintDismissed');
  if (TIERS.includes(r.tier as Prefs['tier'])) out.tier = r.tier as Prefs['tier'];
  if (DELEGATES.includes(r.delegate as Prefs['delegate'])) out.delegate = r.delegate as Prefs['delegate'];
  if (FORMATS.includes(r.exportFormat as ExportFormat)) out.exportFormat = r.exportFormat as ExportFormat;
  if (SIZES.includes(r.exportSize as ExportSize)) out.exportSize = r.exportSize as ExportSize;
  return out;
}

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function readJson(key: string): unknown {
  try {
    const text = storage()?.getItem(key);
    return text == null ? undefined : (JSON.parse(text) as unknown);
  } catch {
    return undefined;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    storage()?.setItem(key, JSON.stringify(value));
  } catch {
    // quota / disabled storage: persistence is a convenience, never an error
  }
}

// ───────────── the version that last ran here (src/ui/update.ts announceUpdate) ─────────────

export const VERSION_KEY = 'meiyan.version.v1';

/** As stored (untrusted); undefined when never recorded — a fresh install, or 0.1.x which did not record it. */
export function loadSeenVersion(): unknown {
  return readJson(VERSION_KEY);
}

/** false when storage is unavailable (then a launch can not be told from the next one). */
export function saveSeenVersion(v: string): boolean {
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(VERSION_KEY, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
}

/** true when an earlier session left the camera look or settings behind */
export function hasSavedSettings(): boolean {
  try {
    const s = storage();
    return !!s && (s.getItem(PARAMS_KEY) !== null || s.getItem(PREFS_KEY) !== null || s.getItem(LOOK_KEY) !== null);
  } catch {
    return false;
  }
}

// ───────────── the 美妝 part list was opened on this device (face-detail spec §2.3) ─────────────

export const SEEN_MAKEUP_PARTS_KEY = 'meiyan.seen.makeupParts.v1';

/** false until the part list has been opened once (the leading tile shows an accent dot meanwhile) */
export function loadMakeupPartsSeen(): boolean {
  return readJson(SEEN_MAKEUP_PARTS_KEY) === true;
}

export function saveMakeupPartsSeen(): void {
  writeJson(SEEN_MAKEUP_PARTS_KEY, true);
}

// ───────────── one-time hints ─────────────

export const PERSONS_HINT_KEY = 'meiyan.hint.persons.v1';

/** The first group photo ever shows 「點選臉部或下方人物，可個別調整」 once (S §1.1 item 11): true once, then false. */
export function takePersonsHint(): boolean {
  if (readJson(PERSONS_HINT_KEY) !== undefined) return false;
  writeJson(PERSONS_HINT_KEY, 1);
  // storage that silently drops writes (private mode) would repeat the hint on every photo: show it only if it stuck
  return readJson(PERSONS_HINT_KEY) !== undefined;
}

// ───────────── full-resolution export: crash breadcrumb, cap and test knob (step-3 spec §3.7) ─────────────

export const EXPORT_GUARD_KEY = 'meiyan.exportGuard.v1';
export const EXPORT_CAP_KEY = 'meiyan.exportCap.v1';
export const EXPORT_DEBUG_KEY = 'meiyan.debug.export.v1';
/** the long edge exports fall back to after a full export died */
export const EXPORT_CAP_EDGE = 2048;

export interface ExportGuard {
  at: number;
  w: number;
  h: number;
  format: ExportFormat;
}

function removeKey(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // disabled storage: nothing to remove
  }
}

function hasKey(key: string): boolean {
  try {
    return storage()?.getItem(key) != null;
  } catch {
    return false;
  }
}

/** written synchronously right before a tiled export; a launch that finds it knows the page died while saving */
export function writeExportGuard(g: ExportGuard): void {
  writeJson(EXPORT_GUARD_KEY, g);
}

export function clearExportGuard(): void {
  removeKey(EXPORT_GUARD_KEY);
}

export function readExportGuard(): ExportGuard | null {
  const r = readJson(EXPORT_GUARD_KEY);
  if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
  const { at, w, h, format } = r as Record<string, unknown>;
  const n = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  if (!n(at) || !n(w) || !n(h) || (format !== 'jpeg' && format !== 'png')) return null;
  return { at: at as number, w: w as number, h: h as number, format };
}

/** At launch: a breadcrumb found → remove it, cap exports at 2048 and tell the caller to toast once (S §3.7). */
export function consumeExportGuardAtLaunch(): boolean {
  const g = readExportGuard();
  if (hasKey(EXPORT_GUARD_KEY)) removeKey(EXPORT_GUARD_KEY);
  if (!g) return false;
  writeJson(EXPORT_CAP_KEY, EXPORT_CAP_EDGE);
  return true;
}

export function exportCapped(): boolean {
  return readJson(EXPORT_CAP_KEY) === EXPORT_CAP_EDGE;
}

/** choosing 原始解析度 in 設定 lifts the cap (S D8) */
export function clearExportCap(): void {
  removeKey(EXPORT_CAP_KEY);
}

export interface ExportDebugKnob {
  tile?: 256 | 512 | 1024 | 2048;
  slowMs?: number;
  failAt?: 'decode' | 'tile' | 'encode';
}

/** e2e knob (works in the production build): read once per export; it never changes the output */
export function readExportDebug(): ExportDebugKnob {
  const r = readJson(EXPORT_DEBUG_KEY);
  if (!r || typeof r !== 'object' || Array.isArray(r)) return {};
  const { tile, slowMs, failAt } = r as Record<string, unknown>;
  const out: ExportDebugKnob = {};
  if (tile === 256 || tile === 512 || tile === 1024 || tile === 2048) out.tile = tile;
  if (typeof slowMs === 'number' && Number.isFinite(slowMs) && slowMs > 0) out.slowMs = slowMs;
  if (failAt === 'decode' || failAt === 'tile' || failAt === 'encode') out.failAt = failAt;
  return out;
}
