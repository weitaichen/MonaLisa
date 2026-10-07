import 'fake-indexeddb/auto';
import { IDBDatabase as FDBDatabase, IDBFactory, IDBObjectStore as FDBObjectStore, forceCloseDatabase } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyPreset, defaultParams, setParam } from '../engine/params';
import type { HistoryEntry } from '../types';
import {
  addEntry,
  closeHistory,
  createId,
  DB_NAME,
  DB_VERSION,
  deleteEntry,
  getEntry,
  HISTORY_LIMIT,
  listEntries,
  normalizeEntry,
  OPEN_TIMEOUT_MS,
  STORE_NAME,
  updateEntry,
  type NewHistoryEntry,
} from './history';

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
