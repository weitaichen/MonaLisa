import 'fake-indexeddb/auto';
import { IDBDatabase as FDBDatabase, IDBFactory, IDBObjectStore as FDBObjectStore, forceCloseDatabase } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withBodies } from '../detect/cache';
import { cacheBody, makeCache } from '../detect/testCaches';
import { editFromLegacy, legacyProjection } from '../edit/legacy';
import { openState } from '../edit/migrate';
import { assignPersons, defaultPhoto, naturalPerson, neutralPerson, renamePersons } from '../edit/state';
import { applyPreset, defaultParams, sanitizeParams, setParam } from '../engine/params';
import { cropConstrain } from '../geometry/view';
import type { BodyDetection, DetectionCache, EditState, HistoryEntry } from '../types';
import {
  addEntry,
  closeHistory,
  createId,
  DB_NAME,
  DB_VERSION,
  deleteEntry,
  getEntry,
  HISTORY_LIMIT,
  isQuotaError,
  listEntries,
  normalizeBody,
  normalizeEntry,
  OPEN_TIMEOUT_MS,
  STORE_NAME,
  updateEntry,
  type NewHistoryEntry,
} from './history';
import { stableKey } from './undo';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let factory: IDBFactory;

beforeEach(() => {
  closeHistory();
  factory = new IDBFactory();
  vi.stubGlobal('indexedDB', factory);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  closeHistory();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const jpeg = (s: string) => new Blob([s], { type: 'image/jpeg' });

function entry(tag: string, params = defaultParams()): NewHistoryEntry {
  return { original: jpeg(`orig-${tag}`), thumb: jpeg(`thumb-${tag}`), params, width: 1536, height: 2048 };
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** Second, independent connection for poking at the raw database (schema must exist already). */
async function rawDb(version = DB_VERSION): Promise<IDBDatabase> {
  return req(factory.open(DB_NAME, version));
}

async function rawPut(records: unknown[]): Promise<void> {
  await listEntries(); // creates the schema through the module
  const db = await rawDb();
  const tx = db.transaction(STORE_NAME, 'readwrite');
  for (const r of records) tx.objectStore(STORE_NAME).put(r);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function rawCount(): Promise<number> {
  const db = await rawDb();
  const n = await req(db.transaction(STORE_NAME).objectStore(STORE_NAME).count());
  db.close();
  return n;
}

function validRecord(id: string, updatedAt: number, extra: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id,
    createdAt: updatedAt,
    updatedAt,
    original: jpeg(`orig-${id}`),
    thumb: jpeg(`thumb-${id}`),
    params: defaultParams(),
    width: 10,
    height: 20,
    ...extra,
  };
}

async function addMany(n: number, prefix = 'e'): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(await addEntry(entry(`${prefix}${i}`)));
  return ids;
}

describe('schema', () => {
  it('creates db "meiyan" v1 with store "edits" (keyPath id) and index updatedAt', async () => {
    await listEntries();
    const db = await rawDb();
    expect(db.version).toBe(1);
    expect([...db.objectStoreNames]).toEqual(['edits']);
    const store = db.transaction('edits').objectStore('edits');
    expect(store.keyPath).toBe('id');
    expect([...store.indexNames]).toEqual(['updatedAt']);
    expect(store.index('updatedAt').keyPath).toBe('updatedAt');
    db.close();
  });
});

describe('add / get', () => {
  it('stores the entry with a v4 id and timestamps, and reads it back', async () => {
    const before = Date.now();
    const params = setParam(applyPreset('glow', 0.8), 'shape.chin', 0.7);
    const id = await addEntry({ ...entry('a'), params, width: 1200, height: 1600 });
    expect(id).toMatch(UUID_V4);
    const got = await getEntry(id);
    expect(got).toBeDefined();
    const e = got!;
    expect(e.id).toBe(id);
    expect(e.createdAt).toBe(e.updatedAt);
    expect(e.createdAt).toBeGreaterThanOrEqual(before);
    expect(e.createdAt).toBeLessThan(before + 60_000);
    expect(e.params).toEqual(params);
    expect(e.width).toBe(1200);
    expect(e.height).toBe(1600);
    expect(e.original).toBeInstanceOf(Blob);
    expect(e.original.type).toBe('image/jpeg');
    expect(await e.original.text()).toBe('orig-a');
    expect(await e.thumb.text()).toBe('thumb-a');
  });

  it('getEntry of an unknown id → undefined', async () => {
    await addEntry(entry('a'));
    expect(await getEntry('nope')).toBeUndefined();
  });

  it('ids are unique', async () => {
    const ids = await addMany(10);
    expect(new Set(ids).size).toBe(10);
  });
});

describe('listEntries', () => {
  it('is empty on a fresh database', async () => {
    expect(await listEntries()).toEqual([]);
  });

  it('returns newest first', async () => {
    const [a, b, c] = await addMany(3);
    expect((await listEntries()).map((e) => e.id)).toEqual([c, b, a]);
  });

  it('orders by updatedAt, so an updated entry moves to the front', async () => {
    const [a, b, c] = await addMany(3);
    await updateEntry(a, { params: applyPreset('refined') });
    expect((await listEntries()).map((e) => e.id)).toEqual([a, c, b]);
  });

  it('keeps a total order for writes within the same millisecond', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    const ids = await addMany(5);
    const list = await listEntries();
    expect(list.map((e) => e.id)).toEqual([...ids].reverse());
    for (let i = 1; i < list.length; i++) expect(list[i - 1].updatedAt).toBeGreaterThan(list[i].updatedAt);
  });
});

describe('HISTORY_LIMIT', () => {
  it('is 12', () => {
    expect(HISTORY_LIMIT).toBe(12);
  });

  it('keeps only the 12 newest, deleting the oldest', async () => {
    const ids = await addMany(15);
    const list = await listEntries();
    expect(list.map((e) => e.id)).toEqual(ids.slice(3).reverse());
    expect(await rawCount()).toBe(12);
    for (const gone of ids.slice(0, 3)) expect(await getEntry(gone)).toBeUndefined();
  });

  it('evicts by updatedAt, not createdAt', async () => {
    const ids = await addMany(12);
    await updateEntry(ids[0], { params: applyPreset('refined') }); // oldest created, now newest updated
    const added = await addEntry(entry('new'));
    const left = (await listEntries()).map((e) => e.id);
    expect(left).toHaveLength(12);
    expect(left).toContain(ids[0]);
    expect(left).not.toContain(ids[1]); // the least recently updated is the one evicted
    expect(left[0]).toBe(added);
    expect(left[1]).toBe(ids[0]);
  });

  it('never evicts the entry being added, even when the clock went backwards', async () => {
    const future = Date.now() + 1e9;
    await rawPut(Array.from({ length: 12 }, (_, i) => validRecord(`future-${i}`, future + i)));
    const id = await addEntry(entry('now'));
    const list = await listEntries();
    expect(list).toHaveLength(12);
    expect(list.map((e) => e.id)).toContain(id);
    expect(list.map((e) => e.id)).not.toContain('future-0'); // the oldest of the others went instead
    expect(list[list.length - 1].id).toBe(id); // it sorts by its (older) updatedAt
    expect(await rawCount()).toBe(12);
  });

  it('trims a database that is already over the limit down to 12 on the next add', async () => {
    const base = Date.now() - 1e6;
    await rawPut(Array.from({ length: 20 }, (_, i) => validRecord(`old-${i}`, base + i)));
    const id = await addEntry(entry('x'));
    const list = await listEntries();
    expect(list).toHaveLength(12);
    expect(list[0].id).toBe(id);
    expect(list.slice(1).map((e) => e.id)).toEqual(Array.from({ length: 11 }, (_, i) => `old-${19 - i}`));
    expect(await rawCount()).toBe(12);
  });

  it('concurrent adds still end at exactly 12, keeping the 12 most recent', async () => {
    const ids = await Promise.all(Array.from({ length: 20 }, (_, i) => addEntry(entry(`c${i}`))));
    const list = await listEntries();
    expect(list).toHaveLength(12);
    expect(await rawCount()).toBe(12);
    expect(list.map((e) => e.id)).toEqual(ids.slice(8).reverse());
  });

  it('listEntries never returns more than 12 even if the store holds more', async () => {
    await rawPut(Array.from({ length: 15 }, (_, i) => validRecord(`r-${i}`, 1000 + i)));
    const list = await listEntries();
    expect(list).toHaveLength(12);
    expect(list[0].id).toBe('r-14');
    expect(list[11].id).toBe('r-3');
  });
});

describe('updateEntry', () => {
  it('patches params and thumb, bumps updatedAt, keeps the rest', async () => {
    const id = await addEntry(entry('a'));
    const before = (await getEntry(id))!;
    const params = applyPreset('refined', 0.4);
    await updateEntry(id, { params, thumb: jpeg('thumb-v2') });
    const after = (await getEntry(id))!;
    expect(after.params).toEqual(params);
    expect(await after.thumb.text()).toBe('thumb-v2');
    expect(await after.original.text()).toBe('orig-a');
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.updatedAt).toBeGreaterThan(before.updatedAt);
    expect(after.width).toBe(before.width);
    expect(after.height).toBe(before.height);
  });

  it('a params-only patch keeps the thumb (and vice versa)', async () => {
    const id = await addEntry(entry('a'));
    await updateEntry(id, { params: applyPreset('glow') });
    expect(await (await getEntry(id))!.thumb.text()).toBe('thumb-a');
    await updateEntry(id, { thumb: jpeg('t2') });
    expect((await getEntry(id))!.params).toEqual(applyPreset('glow'));
  });

  it('ignores fields outside the declared patch', async () => {
    const id = await addEntry(entry('a'));
    const sneaky = { id: 'other', original: jpeg('hacked'), createdAt: 1, width: 1 } as unknown as Partial<
      Pick<HistoryEntry, 'params' | 'thumb'>
    >;
    await updateEntry(id, sneaky);
    const e = (await getEntry(id))!;
    expect(e.id).toBe(id);
    expect(await e.original.text()).toBe('orig-a');
    expect(e.width).toBe(1536);
    expect(await getEntry('other')).toBeUndefined();
  });

  it('unknown id → no-op (does not create)', async () => {
    await addEntry(entry('a'));
    await expect(updateEntry('missing', { params: applyPreset('glow') })).resolves.toBeUndefined();
    expect(await listEntries()).toHaveLength(1);
    expect(await getEntry('missing')).toBeUndefined();
  });
});

function body(people = 1): BodyDetection {
  const points = new Float32Array(33 * 4).map((_, i) => (i % 4 === 3 ? 0.9 : (i % 7) / 10));
  const data = new Uint8Array(6 * 8).map((_, i) => (i * 37) % 256);
  return { pose: { points }, mask: { width: 6, height: 8, data }, people, width: 1536, height: 2048 };
}

describe('美體 detection cache (HistoryEntry.body)', () => {
  it('is stored with the entry and read back with its typed arrays intact', async () => {
    const b = body(2);
    const id = await addEntry({ ...entry('a'), body: b });
    const got = (await getEntry(id))!;
    expect(got.body).toBeTruthy();
    expect(got.body!.pose.points).toBeInstanceOf(Float32Array);
    expect(Array.from(got.body!.pose.points)).toEqual(Array.from(b.pose.points));
    expect(got.body!.mask!.data).toBeInstanceOf(Uint8Array);
    expect(Array.from(got.body!.mask!.data)).toEqual(Array.from(b.mask!.data));
    expect(got.body!.people).toBe(2);
    expect((await listEntries())[0].body).toEqual(got.body);
  });

  it('null ("no person") is kept; older entries have no body at all', async () => {
    const none = await addEntry({ ...entry('n'), body: null });
    const old = await addEntry(entry('o'));
    expect((await getEntry(none))!.body).toBeNull();
    expect('body' in (await getEntry(old))!).toBe(false);
  });

  it('a body-only update caches the detection without reordering 最近編輯', async () => {
    const a = await addEntry(entry('a'));
    await addEntry(entry('b'));
    const before = (await getEntry(a))!;
    await updateEntry(a, { body: body() });
    const after = (await getEntry(a))!;
    expect(after.body?.people).toBe(1);
    expect(after.updatedAt).toBe(before.updatedAt);
    expect((await listEntries())[0].id).not.toBe(a);
    // an edit still moves it to the front and keeps the cached body
    await updateEntry(a, { params: applyPreset('glow') });
    const edited = (await getEntry(a))!;
    expect(edited.updatedAt).toBeGreaterThan(before.updatedAt);
    expect(edited.body?.people).toBe(1);
    expect((await listEntries())[0].id).toBe(a);
  });

  it('a corrupt cached body is dropped (re-detect), the entry survives', async () => {
    await rawPut([{ ...validRecord('c', 5), body: { pose: { points: [1, 2, 3] }, mask: null, people: 1, width: 1, height: 1 } }]);
    const e = (await getEntry('c'))!;
    expect(e).toBeTruthy();
    expect('body' in e).toBe(false);
  });

  it('normalizeBody validates every field', () => {
    const ok = body();
    expect(normalizeBody(ok)).toEqual(ok);
    expect(normalizeBody({ ...ok, mask: null })).toEqual({ ...ok, mask: null });
    const bad: unknown[] = [
      null,
      {},
      { ...ok, width: 0 },
      { ...ok, people: 0 },
      { ...ok, people: Number.NaN },
      { ...ok, pose: { points: new Float32Array(10) } },
      { ...ok, pose: { points: Array.from(ok.pose.points) } },
      { ...ok, pose: { points: new Float32Array(132).fill(Number.NaN) } },
      { ...ok, mask: { width: 6, height: 8, data: new Uint8Array(3) } },
      { ...ok, mask: { width: 6.5, height: 8, data: new Uint8Array(52) } },
      { ...ok, mask: { width: 6, height: 8, data: Array.from(ok.mask!.data) } },
    ];
    for (const b of bad) expect(normalizeBody(b)).toBeNull();
  });
});

describe('瘦臉 background limit (HistoryEntry.faceProtect / faceMask)', () => {
  const faceMask = () => ({ width: 4, height: 3, data: new Uint8Array(12).map((_, i) => i * 20) });

  it('is stored with the entry, mask typed array intact; older entries have neither', async () => {
    const id = await addEntry({ ...entry('a'), faceProtect: true, faceMask: faceMask() });
    const got = (await getEntry(id))!;
    expect(got.faceProtect).toBe(true);
    expect(got.faceMask!.data).toBeInstanceOf(Uint8Array);
    expect(got.faceMask).toEqual(faceMask());
    const old = (await getEntry(await addEntry(entry('o'))))!;
    expect('faceProtect' in old).toBe(false);
    expect('faceMask' in old).toBe(false);
    const unlimited = (await getEntry(await addEntry({ ...entry('u'), faceProtect: false })))!;
    expect('faceProtect' in unlimited).toBe(false);
  });

  it('an edit sets or clears the flag; the stored mask stays; a body-only update keeps both', async () => {
    const id = await addEntry(entry('a'));
    await updateEntry(id, { params: applyPreset('glow'), thumb: jpeg('t2'), faceProtect: true, faceMask: faceMask() });
    expect((await getEntry(id))!.faceProtect).toBe(true);
    await updateEntry(id, { params: applyPreset('glow', 0.5), thumb: jpeg('t3'), faceProtect: true });
    expect((await getEntry(id))!.faceMask).toEqual(faceMask());
    await updateEntry(id, { body: body() });
    const kept = (await getEntry(id))!;
    expect(kept.faceProtect).toBe(true);
    expect(kept.faceMask).toEqual(faceMask());
    await updateEntry(id, { params: applyPreset('glow', 0.4), thumb: jpeg('t4'), faceProtect: false });
    const cleared = (await getEntry(id))!;
    expect('faceProtect' in cleared).toBe(false);
    expect(cleared.faceMask).toEqual(faceMask()); // the photo's segmentation is still valid
  });

  it('a flag / mask-only patch does not reorder 最近編輯', async () => {
    const a = await addEntry(entry('a'));
    await addEntry(entry('b'));
    const before = (await getEntry(a))!;
    await updateEntry(a, { faceProtect: true, faceMask: faceMask() });
    expect((await getEntry(a))!.updatedAt).toBe(before.updatedAt);
  });

  it('a corrupt mask or a non-true flag is dropped, the entry survives', async () => {
    await rawPut([
      { ...validRecord('c', 5), faceProtect: 'yes', faceMask: { width: 4, height: 3, data: new Uint8Array(5) } },
      { ...validRecord('d', 6), faceProtect: true, faceMask: { width: 4, height: 3, data: Array.from(faceMask().data) } },
    ]);
    const c = (await getEntry('c'))!;
    expect('faceProtect' in c).toBe(false);
    expect('faceMask' in c).toBe(false);
    const d = (await getEntry('d'))!;
    expect(d.faceProtect).toBe(true);
    expect('faceMask' in d).toBe(false);
  });
});

describe('deleteEntry', () => {
  it('removes the entry', async () => {
    const [a, b] = await addMany(2);
    await deleteEntry(a);
    expect(await getEntry(a)).toBeUndefined();
    expect((await listEntries()).map((e) => e.id)).toEqual([b]);
  });

  it('unknown id → no-op', async () => {
    await addMany(2);
    await expect(deleteEntry('missing')).resolves.toBeUndefined();
    expect(await listEntries()).toHaveLength(2);
  });

  it('frees a slot under the limit', async () => {
    const ids = await addMany(12);
    await deleteEntry(ids[5]);
    await addEntry(entry('x'));
    const left = (await listEntries()).map((e) => e.id);
    expect(left).toHaveLength(12);
    expect(left).toContain(ids[0]); // nothing else had to be evicted
  });
});

describe('corrupt records', () => {
  it('are skipped by listEntries / getEntry and their params are sanitised', async () => {
    const t = Date.now();
    await rawPut([
      { id: 'no-blobs', createdAt: t, updatedAt: t + 1, params: {}, width: 1, height: 1 },
      { ...validRecord('string-blob', t + 2), original: 'not a blob' },
      { ...validRecord('bad-size', t + 3), width: 0 },
      { ...validRecord('nan-created', t + 4), createdAt: 'yesterday' },
      { id: 'no-updated', original: jpeg('x'), thumb: jpeg('y'), params: {}, width: 1, height: 1, createdAt: t },
      { ...validRecord('junk-params', t + 5), params: { values: { 'skin.smooth': 'lots', 'skin.whiten': 0.9 }, filterId: 'zzz' } },
    ]);
    const list = await listEntries();
    expect(list.map((e) => e.id)).toEqual(['junk-params']);
    const p = list[0].params;
    expect(p.values['skin.smooth']).toBe(defaultParams().values['skin.smooth']);
    expect(p.values['skin.whiten']).toBe(0.9);
    expect(p.filterId).toBe('none');
    expect(await getEntry('no-blobs')).toBeUndefined();
    expect(await getEntry('string-blob')).toBeUndefined();
    expect((await getEntry('junk-params'))?.params).toEqual(p);
  });
});

describe('normalizeEntry', () => {
  it.each([null, undefined, 1, 'x', [], {}])('rejects %j', (raw) => {
    expect(normalizeEntry(raw)).toBeNull();
  });

  it('accepts a valid record unchanged', () => {
    const r = validRecord('ok', 5);
    expect(normalizeEntry(r)).toEqual(r);
  });

  it.each([
    ['id not string', { id: 1 }],
    ['thumb missing', { thumb: undefined }],
    ['infinite updatedAt', { updatedAt: Infinity }],
    ['negative height', { height: -3 }],
    ['NaN width', { width: Number.NaN }],
  ])('rejects %s', (_n, patch) => {
    expect(normalizeEntry({ ...validRecord('x', 5), ...patch })).toBeNull();
  });

  it('drops unknown fields', () => {
    const n = normalizeEntry({ ...validRecord('x', 5), evil: true });
    expect(n && Object.keys(n).sort()).toEqual(
      ['createdAt', 'height', 'id', 'original', 'params', 'thumb', 'updatedAt', 'width'].sort(),
    );
  });
});

describe('IndexedDB unavailable', () => {
  async function expectAllFallbacks(): Promise<void> {
    const id = await addEntry(entry('a'));
    expect(id).toMatch(UUID_V4);
    expect(await listEntries()).toEqual([]);
    expect(await getEntry(id)).toBeUndefined();
    await expect(updateEntry(id, { params: defaultParams() })).resolves.toBeUndefined();
    await expect(deleteEntry(id)).resolves.toBeUndefined();
  }

  it('indexedDB global missing', async () => {
    vi.stubGlobal('indexedDB', undefined);
    await expectAllFallbacks();
  });

  it('indexedDB getter throws', async () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      get() {
        throw new DOMException('denied', 'SecurityError');
      },
    });
    await expectAllFallbacks();
  });

  it('open() throws synchronously', async () => {
    vi.stubGlobal('indexedDB', {
      open() {
        throw new DOMException('no', 'InvalidStateError');
      },
    });
    await expectAllFallbacks();
  });

  it('open request fails (VersionError: a newer db version exists)', async () => {
    const newer = await req(factory.open(DB_NAME, DB_VERSION + 1));
    newer.close();
    await expectAllFallbacks();
  });

  it('open request never settles → ops resolve after the timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    vi.stubGlobal('indexedDB', { open: () => ({}) });
    const list = listEntries();
    const add = addEntry(entry('a'));
    const get = getEntry('x');
    await vi.advanceTimersByTimeAsync(OPEN_TIMEOUT_MS + 1);
    expect(await list).toEqual([]);
    expect(await add).toMatch(UUID_V4);
    expect(await get).toBeUndefined();
  });

  it('a slow open that succeeds after the timeout is used by later ops', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const gate: { release?: () => void } = {};
    let opens = 0;
    vi.stubGlobal('indexedDB', {
      open(name: string, version: number) {
        opens++;
        const real = factory.open(name, version);
        const proxy: Partial<IDBOpenDBRequest> & { result?: IDBDatabase } = {};
        Object.defineProperty(proxy, 'result', { get: () => real.result });
        real.onupgradeneeded = (ev) => proxy.onupgradeneeded?.call(real, ev as IDBVersionChangeEvent);
        real.onsuccess = (ev) => {
          gate.release = () => proxy.onsuccess?.call(real, ev);
        };
        real.onerror = (ev) => proxy.onerror?.call(real, ev);
        return proxy;
      },
    });
    const first = listEntries();
    // let the real (setImmediate-driven) open finish while its success event is withheld
    for (let i = 0; i < 100 && !gate.release; i++) await new Promise((r) => setImmediate(r));
    expect(gate.release).toBeDefined();
    await vi.advanceTimersByTimeAsync(OPEN_TIMEOUT_MS + 1);
    expect(await first).toEqual([]);
    gate.release!();
    vi.useRealTimers();
    const id = await addEntry(entry('late'));
    expect((await listEntries()).map((e) => e.id)).toEqual([id]);
    expect(opens).toBe(1); // no second open request piled up
  });

  it('recovers once IndexedDB becomes available (failure is not memoised)', async () => {
    vi.stubGlobal('indexedDB', undefined);
    expect(await listEntries()).toEqual([]);
    vi.stubGlobal('indexedDB', factory);
    const id = await addEntry(entry('a'));
    expect((await listEntries()).map((e) => e.id)).toEqual([id]);
  });
});

describe('lost connections', () => {
  function captureDb(): () => IDBDatabase[] {
    const spy = vi.spyOn(FDBDatabase.prototype, 'transaction');
    return () => spy.mock.contexts as IDBDatabase[];
  }

  it('reopens after the browser force-closes the connection (close event)', async () => {
    const dbs = captureDb();
    const a = await addEntry(entry('a'));
    const first = dbs()[0];
    forceCloseDatabase(first as unknown as typeof FDBDatabase);
    const b = await addEntry(entry('b'));
    expect((await listEntries()).map((e) => e.id)).toEqual([b, a]);
    expect(dbs().some((db) => db !== first)).toBe(true);
  });

  it('retries on a fresh connection when a dead one throws InvalidStateError (no close event)', async () => {
    const dbs = captureDb();
    const a = await addEntry(entry('a'));
    dbs()[0].close(); // silently dead from the module's point of view
    const b = await addEntry(entry('b'));
    expect((await listEntries()).map((e) => e.id)).toEqual([b, a]);
  });

  it('retries once when a transaction aborts with UnknownError (WebKit "server lost")', async () => {
    const a = await addEntry(entry('a'));
    const realPut = FDBObjectStore.prototype.put;
    let calls = 0;
    vi.spyOn(FDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, ...args) {
      calls++;
      if (calls === 1) {
        this.transaction.abort();
        throw new DOMException('Connection to Indexed Database server lost', 'UnknownError');
      }
      return realPut.apply(this, args);
    });
    const b = await addEntry(entry('b'));
    expect(calls).toBe(2);
    expect((await listEntries()).map((e) => e.id)).toEqual([b, a]);
  });

  it('persistent transaction failure → fallbacks, never rejects', async () => {
    await addEntry(entry('seed'));
    vi.spyOn(FDBDatabase.prototype, 'transaction').mockImplementation(() => {
      throw new DOMException('dead', 'InvalidStateError');
    });
    const id = await addEntry(entry('a'));
    expect(id).toMatch(UUID_V4);
    expect(await listEntries()).toEqual([]);
    expect(await getEntry(id)).toBeUndefined();
    await expect(updateEntry(id, { thumb: jpeg('t') })).resolves.toBeUndefined();
    await expect(deleteEntry(id)).resolves.toBeUndefined();
  });

  it('quota error on add → resolves with an id, nothing half-written', async () => {
    const a = await addEntry(entry('a'));
    vi.spyOn(FDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    const b = await addEntry(entry('b'));
    expect(b).toMatch(UUID_V4);
    vi.restoreAllMocks();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await listEntries()).map((e) => e.id)).toEqual([a]);
  });

  it('closes on versionchange so a newer version can upgrade instead of blocking', async () => {
    await addEntry(entry('a'));
    const upgraded = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = factory.open(DB_NAME, DB_VERSION + 1);
      r.onblocked = () => reject(new Error('blocked by the history connection'));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    expect(upgraded.version).toBe(DB_VERSION + 1);
    upgraded.close();
    // our v1 open now fails with VersionError → sane fallbacks
    expect(await listEntries()).toEqual([]);
  });

  it('a deleted database is recreated on the next op', async () => {
    await addEntry(entry('a'));
    await new Promise<void>((resolve, reject) => {
      const r = factory.deleteDatabase(DB_NAME);
      r.onblocked = () => reject(new Error('blocked'));
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
    expect(await listEntries()).toEqual([]);
    const id = await addEntry(entry('b'));
    expect((await listEntries()).map((e) => e.id)).toEqual([id]);
  });
});

describe('createId', () => {
  it('uses crypto.randomUUID when present', () => {
    const spy = vi.spyOn(globalThis.crypto, 'randomUUID');
    expect(createId()).toMatch(UUID_V4);
    expect(spy).toHaveBeenCalled();
  });

  it('falls back to getRandomValues in insecure contexts (no randomUUID)', () => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', { getRandomValues: real.getRandomValues.bind(real) });
    const ids = Array.from({ length: 500 }, createId);
    for (const id of ids) expect(id).toMatch(UUID_V4);
    expect(new Set(ids).size).toBe(500);
  });

  it('falls back when randomUUID throws', () => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', {
      randomUUID: () => {
        throw new Error('insecure');
      },
      getRandomValues: real.getRandomValues.bind(real),
    });
    expect(createId()).toMatch(UUID_V4);
  });

  it('falls back to Math.random without any crypto', () => {
    vi.stubGlobal('crypto', undefined);
    const ids = Array.from({ length: 200 }, createId);
    for (const id of ids) expect(id).toMatch(UUID_V4);
    expect(new Set(ids).size).toBe(200);
  });
});

describe('HistoryEntry v2 (RM §5.1, S §5.2)', () => {
  const v2 = () => {
    const edit = editFromLegacy(applyPreset('refined', 1));
    return { schema: 2 as const, edit, paramsKey: 'k', detect: makeCache() };
  };
  it('round-trips schema, edit, paramsKey and the detection cache with its typed arrays', async () => {
    const id = await addEntry({ ...entry('v2'), ...v2() });
    const got = await getEntry(id);
    expect(got?.schema).toBe(2);
    expect(got?.edit).toEqual(v2().edit);
    expect(got?.paramsKey).toBe('k');
    expect(got?.detect?.faces[0].lm).toBeInstanceOf(Float32Array);
    expect(got?.detect).toEqual(makeCache());
  });
  it('an edit bumps updatedAt like params; touch: false never does, even with an edit and a thumbnail', async () => {
    const id = await addEntry(entry('t'));
    const t0 = (await getEntry(id))!.updatedAt;
    await updateEntry(id, { detect: makeCache(), edit: v2().edit, thumb: new Blob(['t']) }, { touch: false });
    expect((await getEntry(id))!.updatedAt).toBe(t0);
    expect((await getEntry(id))!.detect).toEqual(makeCache());
    await updateEntry(id, { edit: v2().edit });
    expect((await getEntry(id))!.updatedAt).toBeGreaterThan(t0);
  });
  it('a corrupt edit is dropped (the entry opens as v1), a dropped cache leaves its stale boxes', async () => {
    const e = normalizeEntry({ ...validRecord('x', 1), schema: 2, edit: { v: 9 }, detect: { ...makeCache(), v: 3 } });
    expect(e?.edit).toBeUndefined();
    expect(e?.detect).toBeUndefined();
    expect(Object.keys(e?.staleBoxes ?? {})).toEqual(['f0', 'f1']);
  });
});

describe('detection-driven writes keep 最近編輯 (S §5.2, A17)', () => {
  it('reopening a v1 entry, assigning its persons and adding bodies changes neither the order nor updatedAt', async () => {
    const older = await addEntry(entry('older'));
    await addEntry(entry('newer'));
    const before = (await listEntries()).map((e) => [e.id, e.updatedAt]);
    const opened = openState((await getEntry(older))!, { width: 1536, height: 2048 });
    /** the patch rebaseOnDetect writes */
    const write = async (edit: EditState, detect: DetectionCache) => {
      const params = sanitizeParams(legacyProjection(edit, detect.primary));
      await updateEntry(older, { schema: 2, edit, params, paramsKey: stableKey(params), detect }, { touch: false });
    };
    const cache = makeCache({ width: 1536, height: 2048 });
    const assigned = assignPersons(opened.edit, cache.persons.map((p) => p.id), cache.primary);
    await write(assigned, cache);
    const r = withBodies(cache, [{ pose: cacheBody('x', 0.95).pose, mask: null, score: 0.1 }], () => null);
    await write(assignPersons(renamePersons(assigned, r.renamed), r.cache.persons.map((p) => p.id), r.cache.primary), r.cache);
    expect((await listEntries()).map((e) => [e.id, e.updatedAt])).toEqual(before);
    expect((await getEntry(older))!.detect?.bodies).toHaveLength(1);
  });
});

describe('v2 entries with 調節 and 質感 (step-2 spec §5)', () => {
  it('round-trip the 12 values and the look', async () => {
    const photo = { ...defaultPhoto(), look: { id: 'cinema' as const, amount: 0.7 } };
    photo.values = { ...photo.values, 'adjust.exposure': 0.65, 'adjust.grain': 0.35, 'adjust.vignette': 1 };
    const e: EditState = { v: 2, photo, persons: { p0: naturalPerson() }, template: neutralPerson(), primaryInit: null };
    const id = await addEntry({ ...entry('adj'), schema: 2, edit: e });
    const back = (await getEntry(id))!.edit!;
    expect(back.photo.look).toEqual({ id: 'cinema', amount: 0.7 });
    expect(back.photo.values['adjust.exposure']).toBe(0.65);
    expect(back.photo.values['adjust.grain']).toBe(0.35);
    expect(back.photo.values['adjust.vignette']).toBe(1);
  });
});

describe('v2 entries with geometry (step-3 spec §5)', () => {
  it('getEntry and listEntries keep a saved crop and rotation: the stored edit is validated against the entry size', async () => {
    const geometry = cropConstrain({ flipH: false, quarter: 1, straighten: 5, crop: { x: 0.1, y: 0.1, w: 0.7, h: 0.7 } }, { width: 1536, height: 2048 });
    const e: EditState = { v: 2, photo: { ...defaultPhoto(), geometry }, persons: { p0: naturalPerson() }, template: neutralPerson(), primaryInit: null };
    const id = await addEntry({ ...entry('geo'), schema: 2, edit: e });
    expect((await getEntry(id))!.edit!.photo.geometry).toEqual(geometry);
    expect((await listEntries()).find((x) => x.id === id)!.edit!.photo.geometry).toEqual(geometry);
  });
});

describe('source file (HistoryEntry.source, step 3)', () => {
  const source = new Blob([new Uint8Array(64)], { type: 'image/jpeg' });

  it('round-trips the source and its oriented size; updateEntry never touches them', async () => {
    const id = await addEntry({ ...entry('s'), source, sourceWidth: 4032, sourceHeight: 3024 });
    const got = await getEntry(id);
    expect(got?.source).toBeInstanceOf(Blob);
    expect(got?.source?.size).toBe(64);
    expect([got?.sourceWidth, got?.sourceHeight]).toEqual([4032, 3024]);
    await updateEntry(id, { thumb: jpeg('t2') });
    expect((await getEntry(id))?.source?.size).toBe(64);
  });

  it('sizes are recorded without a kept file (the "only 2048 kept" note)', async () => {
    const id = await addEntry({ ...entry('n'), sourceWidth: 8064, sourceHeight: 6048 });
    const got = await getEntry(id);
    expect(got?.source).toBeUndefined();
    expect(got?.sourceWidth).toBe(8064);
  });

  it('invalid fields are dropped and the entry kept', () => {
    const raw = {
      id: 'x',
      createdAt: 1,
      updatedAt: 1,
      original: jpeg('o'),
      thumb: jpeg('t'),
      params: defaultParams(),
      width: 10,
      height: 10,
      source: new Blob([]),
      sourceWidth: 4032.5,
      sourceHeight: -1,
    };
    const e = normalizeEntry(raw);
    expect(e).not.toBeNull();
    expect(e?.source).toBeUndefined();
    expect(e?.sourceWidth).toBeUndefined();
    expect(e?.sourceHeight).toBeUndefined();
  });

  it('a QuotaExceededError add is put once more without the source, with the same id', async () => {
    const put = FDBObjectStore.prototype.put;
    const calls: { id: string; source?: Blob }[] = [];
    vi.spyOn(FDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      calls.push(value as { id: string; source?: Blob });
      if ((value as { source?: Blob }).source) throw new DOMException('quota', 'QuotaExceededError');
      return put.call(this, value, key);
    });
    const id = await addEntry({ ...entry('q'), source, sourceWidth: 4032, sourceHeight: 3024 });
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.id)).toEqual([id, id]);
    expect(calls[1].source).toBeUndefined();
    const got = await getEntry(id);
    expect(got).toBeDefined();
    expect(got?.source).toBeUndefined();
    expect(got?.sourceWidth).toBe(4032);
  });

  it("other errors keep today's reconnect retry (the file is not dropped)", async () => {
    const put = FDBObjectStore.prototype.put;
    let failed = false;
    vi.spyOn(FDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (!failed) {
        failed = true;
        throw new DOMException('lost', 'UnknownError');
      }
      return put.call(this, value, key);
    });
    const id = await addEntry({ ...entry('r'), source, sourceWidth: 4032, sourceHeight: 3024 });
    expect((await getEntry(id))?.source?.size).toBe(64);
  });

  it('isQuotaError recognises only a QuotaExceededError', () => {
    expect(isQuotaError(new DOMException('full', 'QuotaExceededError'))).toBe(true);
    expect(isQuotaError({ name: 'QuotaExceededError' })).toBe(true);
    for (const other of [new DOMException('lost', 'UnknownError'), new Error('QuotaExceededError'), null, undefined, 'QuotaExceededError', 22]) {
      expect(isQuotaError(other)).toBe(false);
    }
  });
});

describe('step 4: a v2 entry keeps spots and tone values (§5)', () => {
  it('round-trips edit.photo.spots and person tone values', async () => {
    const p = neutralPerson();
    const edit = {
      v: 2 as const,
      photo: { ...defaultPhoto(), spots: [{ x: 0.25, y: 0.5, r: 0.02, dx: 0.06, dy: 0, owner: 'f0' }] },
      persons: { f0: { ...p, values: { ...p.values, 'tone.even': 0.5, 'tone.warmth': 0.3 } } },
      template: neutralPerson(),
      primaryInit: null,
    };
    const id = await addEntry({ ...entry('tone'), schema: 2, edit });
    const back = await getEntry(id);
    expect(back?.edit?.photo.spots).toEqual(edit.photo.spots);
    expect(back?.edit?.persons.f0.values['tone.warmth']).toBe(0.3);
  });

  it('loading sanitizes stored spots: a corrupt one goes, a valid one stays with its owner (kept for the rematch)', async () => {
    const good = { x: 0.4, y: 0.4, r: 0.02, dx: 0, dy: 0, owner: 'f3' };
    await rawPut([
      {
        ...validRecord('spots', 5),
        schema: 2,
        edit: {
          v: 2,
          photo: { ...defaultPhoto(), spots: [good, { x: Infinity, y: 0, r: 0.02, dx: 0, dy: 0, owner: null }] },
          persons: { f3: neutralPerson() },
          template: neutralPerson(),
          primaryInit: null,
        },
      },
    ]);
    expect((await getEntry('spots'))?.edit?.photo.spots).toEqual([good]);
  });
});
