// OWNER: store agent. Recent edits in IndexedDB (max 12, newest first). Every op tolerates IDB being unavailable.
//
// Failure model: IDB may be missing or throw (Lockdown Mode, blocked site data, old private
// modes), the open request may never settle (seen in WebKit), and WebKit drops connections of
// backgrounded pages ("Connection to Indexed Database server lost"). So: the open is raced
// against a timeout, a failed transaction is retried once on a fresh connection, and in the end
// every op resolves to a harmless fallback (no-op / empty list / undefined) instead of rejecting.
import { normalizeDetect, normalizeMask } from '../detect/cache';
import { isEditStateRecord, sanitizeEditState } from '../edit/state';
import { PARAM_DEFS, sanitizeParams } from '../engine/params';
import type { BodyDetection, HistoryEntry, ParamId, PersonMask } from '../types';
import { stableKey } from './undo';

export const HISTORY_LIMIT = 12;

export type NewHistoryEntry = Omit<HistoryEntry, 'id' | 'createdAt' | 'updatedAt'>;

export const DB_NAME = 'meiyan';
export const DB_VERSION = 1;
export const STORE_NAME = 'edits';
export const UPDATED_INDEX = 'updatedAt';
export const OPEN_TIMEOUT_MS = 3000;

let dbPromise: Promise<IDBDatabase | null> | null = null;
let conn: IDBDatabase | null = null;
let lastStamp = 0;
let warned = false;

/** Stores the entry and evicts the oldest (by updatedAt) beyond HISTORY_LIMIT. Resolves with the id even if not stored. */
export async function addEntry(e: NewHistoryEntry): Promise<string> {
  const id = createId();
  const put = (withSource: boolean) => (store: IDBObjectStore) => {
    const now = stamp();
    const entry: HistoryEntry = {
      id,
      createdAt: now,
      updatedAt: now,
      original: e.original,
      thumb: e.thumb,
      params: e.params,
      width: e.width,
      height: e.height,
    };
    // typed arrays survive IDB's structured clone, so the cached detection is stored as is
    if (e.body !== undefined) entry.body = e.body;
    if (e.faceProtect === true) entry.faceProtect = true;
    if (e.faceMask) entry.faceMask = e.faceMask;
    // step 1's HistoryEntry v2 fields (unchanged)
    if (e.schema === 2) entry.schema = 2;
    if (e.edit) entry.edit = e.edit;
    if (e.paramsKey !== undefined) entry.paramsKey = e.paramsKey;
    if (e.detect) entry.detect = e.detect;
    if (withSource && e.source) entry.source = e.source;
    if (e.sourceWidth !== undefined && e.sourceHeight !== undefined) {
      entry.sourceWidth = e.sourceWidth;
      entry.sourceHeight = e.sourceHeight;
    }
    store.put(entry);
    // Requests in one transaction run in order, so the count already includes the new entry.
    const index = store.index(UPDATED_INDEX);
    const count = index.count();
    count.onsuccess = () => {
      let excess = count.result - HISTORY_LIMIT;
      if (excess <= 0) return;
      const cursor = index.openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) return;
        // never evict what we just added, even if the clock went backwards
        if (c.primaryKey !== id) {
          c.delete();
          excess--;
        }
        if (excess > 0) c.continue();
      };
    };
    return () => undefined;
  };
  // the entry must never be lost because of the file: a quota failure is put once more without it (S §5)
  let quota = false;
  await withStore('readwrite', undefined, put(true), (err) => {
    if (e.source && isQuotaError(err)) {
      quota = true;
      return 'stop';
    }
    return 'retry';
  });
  if (quota) await withStore('readwrite', undefined, put(false));
  return id;
}

export function isQuotaError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: unknown }).name === 'QuotaExceededError';
}

/**
 * Patches an entry. Without `touch` an edit (params, edit or thumb) bumps updatedAt, moving the entry to the front; a
 * cache-only patch (body, detect, faceProtect / faceMask alone) keeps it. `touch: false` never bumps (A17): a
 * detection-driven rebase writes edit + params + thumb, and merely viewing an entry must not reorder 最近編輯.
 * Missing id → no-op. faceProtect false removes the flag.
 */
export function updateEntry(
  id: string,
  patch: Partial<Pick<HistoryEntry, 'params' | 'thumb' | 'body' | 'faceProtect' | 'faceMask' | 'schema' | 'edit' | 'paramsKey' | 'detect'>>,
  opts: { touch?: boolean } = {},
): Promise<void> {
  return withStore('readwrite', undefined, (store) => {
    const req = store.get(id);
    req.onsuccess = () => {
      const cur: unknown = req.result;
      if (!cur || typeof cur !== 'object') return;
      const edit = patch.params !== undefined || patch.thumb !== undefined || patch.edit !== undefined;
      const next = { ...(cur as HistoryEntry) };
      if (edit && opts.touch !== false) next.updatedAt = stamp();
      if (patch.params !== undefined) next.params = patch.params;
      if (patch.thumb !== undefined) next.thumb = patch.thumb;
      if (patch.body !== undefined) next.body = patch.body;
      if (patch.faceProtect === true) next.faceProtect = true;
      else if (patch.faceProtect === false) delete next.faceProtect;
      if (patch.faceMask) next.faceMask = patch.faceMask;
      if (patch.schema === 2) next.schema = 2;
      if (patch.edit !== undefined) next.edit = patch.edit;
      if (patch.paramsKey !== undefined) next.paramsKey = patch.paramsKey;
      if (patch.detect !== undefined) next.detect = patch.detect;
      store.put(next);
    };
    return () => undefined;
  });
}

/** Newest (updatedAt) first, at most HISTORY_LIMIT; corrupt records are skipped. */
export function listEntries(): Promise<HistoryEntry[]> {
  return withStore('readonly', [] as HistoryEntry[], (store) => {
    const out: HistoryEntry[] = [];
    const req = store.index(UPDATED_INDEX).openCursor(null, 'prev');
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return;
      const entry = normalizeEntry(c.value);
      if (entry) out.push(entry);
      if (out.length < HISTORY_LIMIT) c.continue();
    };
    return () => out;
  });
}

export function getEntry(id: string): Promise<HistoryEntry | undefined> {
  return withStore('readonly', undefined, (store) => {
    const req = store.get(id);
    return () => normalizeEntry(req.result) ?? undefined;
  });
}

export function deleteEntry(id: string): Promise<void> {
  return withStore('readwrite', undefined, (store) => {
    store.delete(id);
    return () => undefined;
  });
}

/** Drop the cached connection (next op reopens). Used by tests; harmless to call any time. */
export function closeHistory(): void {
  const db = conn;
  conn = null;
  dbPromise = null;
  try {
    db?.close();
  } catch {
    // already closed
  }
}

/** RFC 4122 v4 id. crypto.randomUUID is secure-context only (absent on http:// LAN dev), hence the fallback. */
export function createId(): string {
  const c: Crypto | undefined = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') {
    try {
      return c.randomUUID();
    } catch {
      // fall through
    }
  }
  const b = new Uint8Array(16);
  if (typeof c?.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Untrusted stored record → valid entry (params sanitised) or null. */
export function normalizeEntry(raw: unknown): HistoryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const { id, createdAt, updatedAt, original, thumb, width, height } = r;
  if (typeof id !== 'string' || !isBlob(original) || !isBlob(thumb)) return null;
  if (!isFiniteNumber(createdAt) || !isFiniteNumber(updatedAt)) return null;
  if (!isFiniteNumber(width) || !isFiniteNumber(height) || width <= 0 || height <= 0) return null;
  const entry: HistoryEntry = { id, createdAt, updatedAt, original, thumb, params: sanitizeParams(r.params), width, height };
  // a corrupt cached detection only costs a re-detect: drop it (undefined), keep the entry
  if (r.body === null) entry.body = null;
  else {
    const body = normalizeBody(r.body);
    if (body) entry.body = body;
  }
  // a corrupt mask only costs a segmentation on the next contour edit / reopen
  if (r.faceProtect === true) entry.faceProtect = true;
  const faceMask = normalizeMask(r.faceMask);
  if (faceMask) entry.faceMask = faceMask;
  if (r.schema === 2) entry.schema = 2;
  // persons unfiltered here: openState filters them against the cache (or keeps them all for a rematch); the geometry is
  // validated against the entry's own size (step-3 spec D13), or every read would reset a saved crop to identity
  if (isEditStateRecord(r.edit)) entry.edit = sanitizeEditState(r.edit, null, { width, height });
  if (typeof r.paramsKey === 'string') {
    entry.paramsKey = r.paramsKey;
    const ids = legacyEditOf(r.params, r.paramsKey);
    if (ids) entry.legacyEdited = ids;
  }
  const d = normalizeDetect(r.detect);
  if (d.cache) entry.detect = d.cache;
  if (d.stale) entry.staleBoxes = d.stale;
  if (d.lost) entry.detectLost = true;
  // a missing or unreadable source only costs this entry's 原始解析度 export
  if (isBlob(r.source) && r.source.size > 0) entry.source = r.source;
  if (isPositiveInt(r.sourceWidth) && isPositiveInt(r.sourceHeight)) {
    entry.sourceWidth = r.sourceWidth;
    entry.sourceHeight = r.sourceHeight;
  }
  return entry;
}

/**
 * The rollback check (S §5.3): 0.4 writes `paramsKey = stableKey(params)` with every params write and 0.3 does not, so
 * stored params that no longer give that key were rewritten by 0.3. The key is checked against the params as stored,
 * never against sanitizeParams' output: that fills in every param added since the write (steps 2 and 4 added 18, step 5
 * adds more) and re-derives the preset id, so an entry saved by any earlier build would read as a 0.3 edit and lose its
 * v2 edit. A non-object is no 0.3 write (0.3 always writes a whole params object). Returns the param ids the stored
 * values hold (what 0.3 can have changed), or undefined when 0.3 did not edit the entry.
 */
function legacyEditOf(raw: unknown, key: string): ParamId[] | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || stableKey(raw) === key) return undefined;
  const values = (raw as { values?: unknown }).values;
  const v = values && typeof values === 'object' ? (values as Record<string, unknown>) : {};
  return PARAM_DEFS.filter((d) => isFiniteNumber(v[d.id])).map((d) => d.id);
}

/** Untrusted stored 美體 detection → a valid one, or null when anything is off. */
export function normalizeBody(raw: unknown): BodyDetection | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const { pose, mask, people, width, height } = r;
  if (!isFiniteNumber(width) || !isFiniteNumber(height) || width <= 0 || height <= 0) return null;
  if (!isFiniteNumber(people) || people < 1) return null;
  if (!pose || typeof pose !== 'object') return null;
  const points = (pose as Record<string, unknown>).points;
  if (!(points instanceof Float32Array) || points.length !== 33 * 4 || !points.every(Number.isFinite)) return null;
  let m: PersonMask | null = null;
  if (mask !== null) {
    m = normalizeMask(mask);
    if (!m) return null;
  }
  return { pose: { points }, mask: m, people: Math.floor(people), width, height };
}

// ───────────────────────── internals ─────────────────────────

/** Strictly increasing within a session so same-millisecond writes still have a total order. */
function stamp(): number {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return lastStamp;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isPositiveInt(v: unknown): v is number {
  return Number.isInteger(v) && (v as number) > 0;
}

function isBlob(v: unknown): v is Blob {
  return typeof Blob !== 'undefined' && v instanceof Blob;
}

function warnOnce(err: unknown): void {
  if (warned) return;
  warned = true;
  console.warn('[history] IndexedDB unavailable or failing; recent edits may not be saved.', err);
}

/**
 * Run `body` in one transaction; resolve with its result getter once the transaction commits.
 * `body` must issue all requests synchronously or from request callbacks (IDB auto-commits).
 * `onError` decides what a failed attempt does: 'retry' (the default: reconnect and run once more) or 'stop'.
 */
async function withStore<T>(
  mode: IDBTransactionMode,
  fallback: T,
  body: (store: IDBObjectStore) => () => T,
  onError?: (err: unknown) => 'retry' | 'stop',
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const db = await getDb();
    if (!db) return fallback;
    try {
      return await runTx(db, mode, body);
    } catch (err) {
      warnOnce(err);
      if (onError?.(err) === 'stop') return fallback;
      dropConnection(db);
    }
  }
  return fallback;
}

function runTx<T>(db: IDBDatabase, mode: IDBTransactionMode, body: (store: IDBObjectStore) => () => T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    // Synchronous throws (InvalidStateError on a dead connection, DataCloneError from put…)
    // reject the promise via the executor. Events fire asynchronously, so attaching the
    // handlers after `body` has queued its requests is safe.
    const tx = db.transaction(STORE_NAME, mode);
    const result = body(tx.objectStore(STORE_NAME));
    tx.oncomplete = () => {
      try {
        resolve(result());
      } catch (err) {
        reject(err);
      }
    };
    tx.onabort = () => reject(tx.error ?? new DOMException('transaction aborted', 'AbortError'));
  });
}

function getDb(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    const p = openDb();
    dbPromise = p;
    void p.then((db) => {
      if (dbPromise !== p) {
        db?.close(); // superseded by closeHistory() while opening
        return;
      }
      if (db) conn = db;
      else dbPromise = null; // allow a later retry
    });
  }
  return withTimeout(dbPromise, OPEN_TIMEOUT_MS, null);
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      const idb = globalThis.indexedDB;
      if (!idb) {
        warnOnce('indexedDB missing');
        resolve(null);
        return;
      }
      req = idb.open(DB_NAME, DB_VERSION);
    } catch (err) {
      warnOnce(err);
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' }).createIndex(UPDATED_INDEX, 'updatedAt');
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // let a newer version (another tab / future deploy) upgrade instead of being blocked by us
      db.onversionchange = () => dropConnection(db);
      // closed by the browser (site data cleared, WebKit IDB server lost)
      db.onclose = () => forget(db);
      resolve(db);
    };
    req.onerror = () => {
      warnOnce(req.error);
      resolve(null);
    };
  });
}

function forget(db: IDBDatabase): void {
  if (conn === db) {
    conn = null;
    dbPromise = null;
  }
}

function dropConnection(db: IDBDatabase): void {
  forget(db);
  try {
    db.close();
  } catch {
    // already closed
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}
