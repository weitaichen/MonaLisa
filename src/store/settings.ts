// OWNER: store agent. localStorage persistence (every access in try/catch).
//
// Storage can be missing or hostile: Lockdown Mode / private browsing / blocked site data make the
// `localStorage` getter itself throw, setItem throws QuotaExceededError, and stored text may be
// corrupt or from another version. Loads therefore always return a complete, valid object and
// saves never throw.
import { sanitizeParams } from '../engine/params';
import type { BeautyParams, Prefs } from '../types';

export const PARAMS_KEY = 'meiyan.params.v1';
export const PREFS_KEY = 'meiyan.prefs.v1';

export const DEFAULT_PREFS: Prefs = {
  mirrorOnSave: true,
  tier: 'auto',
  matchGpupixel: false,
  showLandmarks: false,
  delegate: 'auto',
  installHintDismissed: false,
};

const TIERS: readonly Prefs['tier'][] = ['auto', 'H', 'M', 'L'];
const DELEGATES: readonly Prefs['delegate'][] = ['auto', 'CPU'];

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
    return !!s && (s.getItem(PARAMS_KEY) !== null || s.getItem(PREFS_KEY) !== null);
  } catch {
    return false;
  }
}
