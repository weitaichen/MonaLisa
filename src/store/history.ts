// OWNER: store agent. Recent edits in IndexedDB (max 12, newest first). Every op tolerates IDB being unavailable.
//
// Failure model: IDB may be missing or throw (Lockdown Mode, blocked site data, old private
// modes), the open request may never settle (seen in WebKit), and WebKit drops connections of
// backgrounded pages ("Connection to Indexed Database server lost"). So: the open is raced
// against a timeout, a failed transaction is retried once on a fresh connection, and in the end
// every op resolves to a harmless fallback (no-op / empty list / undefined) instead of rejecting.
import { sanitizeParams } from '../engine/params';
import type { BodyDetection, HistoryEntry, PersonMask } from '../types';

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
  await withStore('readwrite', undefined, (store) => {
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
  });
  return id;
}

/**
 * Patches params / thumb and bumps updatedAt (moves the entry to the front). A body-only patch (caching the
 * 美體 detection) is not an edit: it keeps updatedAt, so merely looking at an entry does not reorder 最近編輯.
 * Missing id → no-op.
 */
export function updateEntry(id: string, patch: Partial<Pick<HistoryEntry, 'params' | 'thumb' | 'body'>>): Promise<void> {
  return withStore('readwrite', undefined, (store) => {
    const req = store.get(id);
    req.onsuccess = () => {
      const cur: unknown = req.result;
      if (!cur || typeof cur !== 'object') return;
      const edit = patch.params !== undefined || patch.thumb !== undefined;
      const next = { ...(cur as HistoryEntry) };
      if (edit) next.updatedAt = stamp();
      if (patch.params !== undefined) next.params = patch.params;
      if (patch.thumb !== undefined) next.thumb = patch.thumb;
      if (patch.body !== undefined) next.body = patch.body;
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
  return entry;
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

function normalizeMask(raw: unknown): PersonMask | null {
  if (!raw || typeof raw !== 'object') return null;
  const { width, height, data } = raw as Record<string, unknown>;
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  const w = width as number;
  const h = height as number;
  if (w <= 0 || h <= 0 || !(data instanceof Uint8Array) || data.length !== w * h) return null;
  return { width: w, height: h, data };
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
 */
async function withStore<T>(
  mode: IDBTransactionMode,
  fallback: T,
  body: (store: IDBObjectStore) => () => T,
): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const db = await getDb();
    if (!db) return fallback;
    try {
      return await runTx(db, mode, body);
    } catch (err) {
      warnOnce(err);
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
