// T6 store harness: drives src/store/* against the browser's real localStorage + IndexedDB.
// Phases (?phase=…) are orchestrated by run.mjs: write → (reload) read → upgrade (second page) →
// blocked (storage getters throw) → insecure (no crypto.randomUUID).
import { applyPreset, setFilter, setParam, setShade } from '../../../src/engine/params';
import {
  addEntry,
  closeHistory,
  DB_NAME,
  deleteEntry,
  getEntry,
  HISTORY_LIMIT,
  listEntries,
  updateEntry,
} from '../../../src/store/history';
import { DEFAULT_PREFS, loadParams, loadPrefs, saveParams, savePrefs } from '../../../src/store/settings';
import { UndoStack } from '../../../src/store/undo';
import type { BeautyParams, Prefs } from '../../../src/types';

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

interface Result {
  phase: string;
  done: boolean;
  checks: Check[];
  timings: Record<string, number>;
  error?: string;
}

declare global {
  interface Window {
    __t6?: Result;
  }
}

const phase = new URLSearchParams(location.search).get('phase') ?? 'write';
const result: Result = { phase, done: false, checks: [], timings: {} };
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EXPECT_KEY = 't6.expected';

function check(name: string, ok: boolean, detail?: unknown): void {
  result.checks.push({ name, ok, detail: detail === undefined ? undefined : JSON.stringify(detail) });
}

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now();
  const v = await fn();
  result.timings[label] = Math.round((performance.now() - t0) * 100) / 100;
  return v;
}

/** A noisy gradient JPEG so sizes resemble a real photo (~hundreds of KB at 1536×2048). */
async function makeJpeg(w: number, h: number, hue: number): Promise<Blob> {
  const c = new OffscreenCanvas(w, h);
  const g = c.getContext('2d');
  if (!g) throw new Error('2d context');
  const grad = g.createLinearGradient(0, 0, w, h);
  grad.addColorStop(0, `hsl(${hue} 60% 75%)`);
  grad.addColorStop(1, `hsl(${(hue + 140) % 360} 45% 30%)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, w, h);
  const img = g.getImageData(0, 0, w, h);
  let seed = hue * 7919 + 1;
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const n = (seed >> 16) % 24;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  return c.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
}

async function decodeSize(b: Blob): Promise<[number, number]> {
  const bmp = await createImageBitmap(b);
  const s: [number, number] = [bmp.width, bmp.height];
  bmp.close();
  return s;
}

function deleteDb(): Promise<string> {
  return new Promise((resolve) => {
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = () => resolve('deleted');
    r.onerror = () => resolve(`error ${String(r.error)}`);
    r.onblocked = () => resolve('blocked');
  });
}

function editedParams(): BeautyParams {
  let p = applyPreset('glow', 0.8);
  p = setParam(p, 'shape.chin', 0.62);
  p = setFilter(p, 'japanese');
  p = setShade(p, 'lip', 'rose');
  return p;
}

const PREFS: Prefs = { ...DEFAULT_PREFS, tier: 'M', mirrorOnSave: false, delegate: 'CPU', installHintDismissed: true };

async function phaseWrite(): Promise<void> {
  closeHistory();
  localStorage.clear();
  check('deleteDatabase', (await deleteDb()) === 'deleted');

  // settings
  check('loadParams on empty storage = 自然', JSON.stringify(loadParams()) === JSON.stringify(applyPreset('natural')));
  check('loadPrefs on empty storage = defaults', JSON.stringify(loadPrefs()) === JSON.stringify(DEFAULT_PREFS));
  saveParams(editedParams());
  savePrefs(PREFS);
  check('params round-trip', JSON.stringify(loadParams()) === JSON.stringify(editedParams()));
  check('prefs round-trip', JSON.stringify(loadPrefs()) === JSON.stringify(PREFS));
  localStorage.setItem('meiyan.prefs.v1', '{"tier": "H", "mirrorOnSave": "nope"');
  check('corrupt prefs JSON → defaults', JSON.stringify(loadPrefs()) === JSON.stringify(DEFAULT_PREFS));
  savePrefs(PREFS);

  // history with real JPEG blobs
  const originals = await timed('encode 15 originals 1536x2048', () =>
    Promise.all(Array.from({ length: 15 }, (_, i) => makeJpeg(1536, 2048, i * 24))),
  );
  const thumb = await makeJpeg(192, 256, 300);
  result.timings['original jpeg bytes'] = originals[0].size;
  const ids: string[] = [];
  const t0 = performance.now();
  for (let i = 0; i < 15; i++) {
    ids.push(await addEntry({ original: originals[i], thumb, params: applyPreset('natural', i / 14), width: 1536, height: 2048 }));
  }
  result.timings['15 x addEntry (avg ms)'] = Math.round(((performance.now() - t0) / 15) * 100) / 100;
  check('ids are v4 UUIDs (secure context → randomUUID)', ids.every((id) => UUID_V4.test(id)), ids[0]);

  const list = await timed('listEntries (12 entries)', () => listEntries());
  check(`list capped at HISTORY_LIMIT=${HISTORY_LIMIT}`, list.length === 12, list.length);
  check('list = 12 newest, newest first', JSON.stringify(list.map((e) => e.id)) === JSON.stringify(ids.slice(3).reverse()));
  check('oldest 3 evicted', (await Promise.all(ids.slice(0, 3).map((id) => getEntry(id)))).every((e) => e === undefined));

  await updateEntry(ids[3], { params: editedParams(), thumb: await makeJpeg(192, 256, 10) });
  const afterUpdate = await listEntries();
  check('updated entry moves to front', afterUpdate[0].id === ids[3]);
  check('updated params stored', JSON.stringify(afterUpdate[0].params) === JSON.stringify(editedParams()));

  const got = await getEntry(ids[14]);
  check('getEntry returns Blob originals', got?.original instanceof Blob && got.original.type === 'image/jpeg');
  check('original bytes preserved', got?.original.size === originals[14].size, [got?.original.size, originals[14].size]);
  if (got) check('stored original decodes at 1536x2048', JSON.stringify(await decodeSize(got.original)) === '[1536,2048]');
  if (got) check('stored thumb decodes at 192x256', JSON.stringify(await decodeSize(got.thumb)) === '[192,256]');

  // concurrent adds keep the limit
  await Promise.all(Array.from({ length: 6 }, (_, i) => addEntry({ original: originals[i], thumb, params: applyPreset('refined'), width: 1536, height: 2048 })));
  check('concurrent adds keep exactly 12', (await listEntries()).length === 12);

  // undo stack sanity with structuredClone in a real browser
  const u = new UndoStack<BeautyParams>(3);
  u.reset(applyPreset('natural'));
  for (let i = 1; i <= 5; i++) u.push(setParam(applyPreset('natural'), 'skin.smooth', i / 10));
  u.push(setParam(applyPreset('natural'), 'skin.smooth', 0.5)); // duplicate of current
  let steps = 0;
  while (u.undo()) steps++;
  check('undo limit 3 + duplicate ignored', steps === 3 && u.current?.values['skin.smooth'] === 0.2, steps);

  localStorage.setItem(EXPECT_KEY, JSON.stringify((await listEntries()).map((e) => e.id)));
}

async function phaseRead(): Promise<void> {
  const expected = JSON.parse(localStorage.getItem(EXPECT_KEY) ?? '[]') as string[];
  check('precondition: write phase recorded 12 ids', expected.length === 12, expected.length);
  check('params persisted across reload',JSON.stringify(loadParams()) === JSON.stringify(editedParams()));
  check('prefs persisted across reload', JSON.stringify(loadPrefs()) === JSON.stringify(PREFS));
  const list = await timed('listEntries after reload', () => listEntries());
  check('history persisted across reload (same order)', JSON.stringify(list.map((e) => e.id)) === JSON.stringify(expected), list.length);
  if (list[0]) check('persisted original still decodes', JSON.stringify(await decodeSize(list[0].original)) === '[1536,2048]');
  await deleteEntry(expected[0]);
  check('deleteEntry', (await listEntries()).length === 11 && (await getEntry(expected[0])) === undefined);
  // keep this page's connection open: run.mjs opens a newer version from another page next
}

async function phaseUpgrade(): Promise<void> {
  const outcome = await new Promise<string>((resolve) => {
    const r = indexedDB.open(DB_NAME, 2);
    const timer = setTimeout(() => resolve('timeout'), 3000);
    r.onblocked = () => resolve('blocked');
    r.onsuccess = () => {
      clearTimeout(timer);
      r.result.close();
      resolve('opened');
    };
    r.onerror = () => resolve(`error ${String(r.error)}`);
  });
  check('newer version opens while another page holds the history db (versionchange → close)', outcome === 'opened', outcome);
  check('cleanup deleteDatabase', (await deleteDb()) === 'deleted');
}

async function phaseBlocked(): Promise<void> {
  // run.mjs installs an init script making the localStorage / indexedDB getters throw
  let threw = false;
  try {
    void window.localStorage;
  } catch {
    threw = true;
  }
  check('precondition: storage getters throw', threw);
  check('loadParams → defaults', JSON.stringify(loadParams()) === JSON.stringify(applyPreset('natural')));
  check('loadPrefs → defaults', JSON.stringify(loadPrefs()) === JSON.stringify(DEFAULT_PREFS));
  saveParams(editedParams());
  savePrefs(PREFS);
  check('saves do not throw', true);
  const id = await timed('addEntry without IDB', () =>
    addEntry({ original: new Blob(['x']), thumb: new Blob(['y']), params: applyPreset('natural'), width: 1, height: 1 }),
  );
  check('addEntry still returns an id', UUID_V4.test(id), id);
  check('listEntries → []', (await listEntries()).length === 0);
  check('getEntry → undefined', (await getEntry(id)) === undefined);
  await updateEntry(id, { params: applyPreset('glow') });
  await deleteEntry(id);
  check('update/delete resolve', true);
}

async function phaseInsecure(): Promise<void> {
  check('precondition: insecure context without crypto.randomUUID', !isSecureContext && typeof crypto.randomUUID !== 'function', {
    isSecureContext,
    randomUUID: typeof crypto.randomUUID,
  });
  const id = await addEntry({ original: new Blob(['x']), thumb: new Blob(['y']), params: applyPreset('natural'), width: 1, height: 1 });
  check('fallback id is a v4 UUID', UUID_V4.test(id), id);
  const got = await getEntry(id);
  check('entry stored and readable over plain http', got?.id === id);
  await deleteEntry(id);
  closeHistory();
  check('cleanup deleteDatabase', (await deleteDb()) === 'deleted');
}

const phases: Record<string, () => Promise<void>> = {
  write: phaseWrite,
  read: phaseRead,
  upgrade: phaseUpgrade,
  blocked: phaseBlocked,
  insecure: phaseInsecure,
};

(async () => {
  try {
    const fn = phases[phase];
    if (!fn) throw new Error(`unknown phase ${phase}`);
    await fn();
  } catch (err) {
    result.error = err instanceof Error ? `${err.name}: ${err.message}\n${err.stack ?? ''}` : String(err);
  }
  result.done = true;
  window.__t6 = result;
  const out = document.getElementById('out');
  if (out) out.textContent = JSON.stringify(result, null, 2);
})();
