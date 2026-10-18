// Bench 「多臉」 section (S §6.2 rows). Rows D (multi-face detectImage), B (multi-pose body detection) and GL (limits +
// probes) land in Phase 0; later tasks add R, RC, RP (Task 17), F (Task 19), BF (Task 20), PE, M (Task 23), L, J,
// J2 (Task 25) and PC (the slider commit's fold check, S §6.3 PC1). Results join 複製結果 through formatMultiRows.
// /bench.html?fixtures=1 (dev server) loads the group fixtures by URL so scripts/bench-multiface.mjs can drive it; on a
// phone the rows take a picked photo.
import { FaceLandmarker, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { LandmarkSmoother } from '../app/oneEuro';
import { EDIT_DETECT_FACES, LIVE_DETECT_FACES } from '../config/limits';
import { ENGINE_PATHS, loadEngineAssets, loadPhotoDetector, loadPoseModel } from '../engine/assets';
import { withFaceDetector } from '../engine/faceBundle';
import { probeFaceTable, probeR16FArray, readGlLimits } from '../engine/glProbe';
import { ovalBox } from '../engine/passes/faceCap';
import { adapt } from '../tracking/adapter111';
import { downscaleMask } from '../tracking/bodyTracker';
import type { Delegate, Landmarks478, Tracker } from '../types';
import { foldGuardRows } from './foldGuardBench';
import { formatMultiRows, liveRows, type LiveRun, median, type MultiRow } from './report';
// static, like foldGuardBench (which imports it too): a dynamic import here could not split it from the bench chunk
import { placeBenchFace, reshapeBenchLayouts } from './reshapeLayouts';

const rows: MultiRow[] = [];
const now = () => performance.now();
const round = (v: number) => Math.round(v * 10) / 10;

async function decode(blob: Blob, longEdge: number): Promise<ImageBitmap> {
  const probe = await createImageBitmap(blob);
  const s = Math.min(1, longEdge / Math.max(probe.width, probe.height));
  const w = Math.round(probe.width * s);
  const h = Math.round(probe.height * s);
  probe.close();
  return createImageBitmap(blob, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
}

/** what services.ts gives every tracker: the camera bundle, and the full-range detector once it downloaded (null if it failed) */
export async function trackerInputs(): Promise<{ modelBuffer: Uint8Array; detector: Uint8Array | null; fullRangeDetector: () => Uint8Array | null }> {
  const { modelBuffer } = await loadEngineAssets();
  const detector = await loadPhotoDetector().catch(() => null);
  return { modelBuffer, detector, fullRangeDetector: () => detector };
}

/**
 * whether this page already ran a full-range detection: its GPU programs are compiled once per browser session, so a
 * later "first photo" is not the cold one (row D's app rows say so in `cold`)
 */
let fullRangeRan = false;
/** bench/main.ts's still test detects on the app's tracker too */
export function noteFullRangeRun(): void {
  fullRangeRan = true;
}

/**
 * D app (step-1 spec §6.5): the editor's first photo of a session as the app runs it. A fresh tracker as services.ts
 * builds it (the camera bundle in VIDEO, the full-range detector for photos), then its first detectImage at
 * EDIT_DETECT_FACES on the 2048 decode: the switch to the photo bundle plus, on the GPU delegate, the full-range graph's
 * one-time program compile (`first_ms`; cold only as the page's first full-range detection, so tap D right after
 * opening /bench.html). Then a warm photo (`next_ms`), the short-range retry a photo without a usable face makes
 * (`retry_ms`, detector 'camera'), and the photo bundle again (`back_ms`). GPU, then CPU.
 */
export async function rowDApp(photo: Blob): Promise<MultiRow[]> {
  const { createTracker } = await import('../tracking/tracker');
  const inputs = await trackerInputs();
  const bmp = await decode(photo, 2048);
  const out: MultiRow[] = [];
  for (const delegate of ['GPU', 'CPU'] as const) {
    const cold = delegate === 'GPU' ? String(!fullRangeRan && !!inputs.detector) : '—';
    try {
      const t0 = now();
      const t = await createTracker({ modelBuffer: inputs.modelBuffer, fullRangeDetector: inputs.fullRangeDetector, wasmBase: ENGINE_PATHS.wasmBase, delegate });
      const trackerMs = now() - t0;
      const time = (detector: 'photo' | 'camera'): [number, number] => {
        const s = now();
        const n = t.detectImage(bmp, { maxFaces: EDIT_DETECT_FACES, detector }).length;
        return [round(now() - s), n];
      };
      const [firstMs, faces] = time('photo');
      if (t.photoDetector === 'full-range') fullRangeRan = true;
      const [nextMs] = time('photo');
      const [retryMs, retryFaces] = time('camera');
      const [backMs] = time('photo');
      out.push({
        row: 'D',
        config: `app ${t.delegate} 2048 first photo`,
        values: { detector: t.photoDetector, cold, decode: `${bmp.width}x${bmp.height}`, tracker_ms: round(trackerMs), first_ms: firstMs, next_ms: nextMs, retry_ms: retryMs, back_ms: backMs, faces, retry_faces: retryFaces },
      });
      t.close();
    } catch (e) {
      out.push({ row: 'D', config: `app ${delegate} 2048 first photo`, values: { error: e instanceof Error ? e.message : String(e) } });
    }
  }
  bmp.close();
  return out;
}

/**
 * D: the app rows (rowDApp, first: they must be the page's first full-range detection to be cold), then detectImage at
 * numFaces 1/4/6/8/10 and EDIT_DETECT_FACES (12 since S §6.7, PD1) on GPU and CPU, decodes 2048 and 1440: first call,
 * median of 5, faces, order. On an instance built on the photo bundle (the camera bundle with BlazeFace full-range, as
 * photos detect; `detector` says which one ran); its first_ms is the first call after each numFaces change on that
 * instance, not the app's cold first photo (the app rows' first_ms is).
 */
export async function rowD(photo: Blob): Promise<MultiRow[]> {
  const out: MultiRow[] = await rowDApp(photo);
  const { modelBuffer, detector: fullRange } = await trackerInputs();
  const photoModel = fullRange ? withFaceDetector(modelBuffer, fullRange) : modelBuffer;
  const detector = fullRange ? 'full-range' : 'short-range';
  const fileset = await FilesetResolver.forVisionTasks(ENGINE_PATHS.wasmBase);
  for (const delegate of ['GPU', 'CPU'] as const) {
    const canvas = new OffscreenCanvas(1, 1);
    const lm = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: photoModel, delegate },
      runningMode: 'IMAGE',
      numFaces: 1,
      canvas: delegate === 'GPU' ? canvas : undefined,
    });
    const orders: Record<number, string[]> = {};
    for (const edge of [2048, 1440]) {
      const bmp = await decode(photo, edge);
      for (const n of [...new Set([1, 4, 6, 8, 10, EDIT_DETECT_FACES])]) {
        await lm.setOptions({ numFaces: n });
        const t0 = now();
        const first = lm.detect(bmp).faceLandmarks;
        const firstMs = now() - t0;
        const times: number[] = [];
        for (let i = 0; i < 5; i++) {
          const t = now();
          lm.detect(bmp);
          times.push(now() - t);
        }
        const centres = first.map((f) => {
          let lo = 1;
          let hi = 0;
          for (const p of f) {
            lo = Math.min(lo, p.x);
            hi = Math.max(hi, p.x);
          }
          return ((lo + hi) / 2).toFixed(2);
        });
        if (n === EDIT_DETECT_FACES) orders[edge] = centres;
        out.push({
          row: 'D',
          config: `${delegate} ${edge} n${n}`,
          // decode: the bitmap actually detected on (a photo smaller than the decode edge is not upscaled)
          values: { detector, decode: `${bmp.width}x${bmp.height}`, first_ms: round(firstMs), median_ms: round(median(times)), faces: first.length, centres: centres.join(' ') },
        });
      }
      bmp.close();
    }
    out.push({ row: 'D', config: `${delegate} order 2048 vs 1440 (n${EDIT_DETECT_FACES})`, values: { same: String(orders[2048]?.join() === orders[1440]?.join()) } });
    lm.close();
  }
  if (fullRange) fullRangeRan = true;
  return out;
}

/** B: body detection with numPoses 2 and 4 (GPU + masks): time, readback + downscale per person, persons, peak heap */
export async function rowB(photo: Blob): Promise<MultiRow[]> {
  const out: MultiRow[] = [];
  const buf = await loadPoseModel('full', () => undefined);
  const fileset = await FilesetResolver.forVisionTasks(ENGINE_PATHS.wasmBase);
  const bmp = await decode(photo, 1280);
  const heap = () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
  for (const numPoses of [2, 4]) {
    const lm = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: buf, delegate: 'GPU' },
      runningMode: 'IMAGE',
      numPoses,
      outputSegmentationMasks: true,
      canvas: new OffscreenCanvas(1, 1),
    });
    let peak = heap();
    const t0 = now();
    const r = lm.detect(bmp);
    const detectMs = now() - t0;
    const masks = r.segmentationMasks ?? [];
    // (readonly in the typings) so r.close() cannot reach the masks: one readback alive at a time (P2)
    (r as unknown as { segmentationMasks: unknown[] }).segmentationMasks = [];
    const per: number[] = [];
    for (const m of masks) {
      const t = now();
      downscaleMask(m.getAsFloat32Array(), m.width, m.height);
      peak = Math.max(peak, heap());
      m.close();
      per.push(now() - t);
    }
    r.close();
    lm.close();
    out.push({
      row: 'B',
      config: `numPoses ${numPoses}`,
      values: { detect_ms: round(detectMs), readback_ms_per_person: round(median(per)), persons: r.landmarks.length, peak_heap_mb: round(peak / 2 ** 20) },
    });
  }
  bmp.close();
  return out;
}

/** GL: limits and both probes on a fresh WebGL2 context */
export function rowGL(): MultiRow[] {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return [{ row: 'GL', config: 'webgl2', values: { available: 'no' } }];
  const pg1 = probeFaceTable(gl);
  const out: MultiRow[] = [
    { row: 'GL', config: 'limits', values: Object.fromEntries(Object.entries(readGlLimits(gl)).map(([k, v]) => [k, typeof v === 'boolean' ? String(v) : v])) },
    { row: 'GL', config: 'probes', values: { PG1_texture: String(pg1.texture), PG1_ubo: String(pg1.ubo), PG1_float32: String(pg1.float32), PG2: String(probeR16FArray(gl)) } },
  ];
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return out;
}

const RUNNERS: Record<string, (photos: { faces: Blob; people: Blob }) => Promise<MultiRow[]> | MultiRow[]> = {
  D: (p) => rowD(p.faces),
  // row D's app rows alone (scripts and the e2e; the D button runs them first anyway)
  DA: (p) => rowDApp(p.faces),
  B: (p) => rowB(p.people),
  GL: () => rowGL(),
};

/** Register a row runner (later tasks: R, F, BF, PE, L, J, J2). */
export function addRunner(id: string, run: (photos: { faces: Blob; people: Blob }) => Promise<MultiRow[]> | MultiRow[]): void {
  RUNNERS[id] = run;
}

async function fixtures(): Promise<{ faces: Blob; people: Blob }> {
  const get = async (u: string) => (await fetch(u)).blob();
  return { faces: await get('/tests/fixtures/group_faces.png'), people: await get('/tests/fixtures/group_people.jpg') };
}

export function mountMultiFace(parent: HTMLElement): { rows(): readonly MultiRow[] } {
  const section = document.createElement('section');
  // own classes (styled in bench/main.ts STYLE like the 美體偵測 box): tests/harness/b3/bench.mjs locates '.body-bench'
  // and tests/harness/t8/run-bench.mjs '.gate .note', and this section sits in .gate, so reusing either breaks them
  section.className = 'multi-bench';
  section.innerHTML = '<h3>多臉</h3><p class="multi-note">D：多臉偵測（選 group_faces.png）　B：多人美體（選 group_people.jpg）　GL：GPU 上限　R：多臉美型 GPU 時間　F：每張臉的瘦臉限制建構時間　BF：四人美體場建構時間　PE：多臉編輯每格時間　PC：滑桿放開時的摺疊檢查時間（6／8／10 張臉，全部或一人改變；得 PC1）　M：多人美體偵測記憶體（頁面被終止時，下次開啟會回報）　L：相機多臉追蹤時間（GPU／CPU，numFaces 1–3；鏡頭前一張臉得 PL2，三張臉得 PL1）　J／J2：相機平滑的抖動／延遲（L、J、J2 用相機）（R、F、BF、PE、PC、M 需開發伺服器的 /tests/fixtures）</p>';
  // a page killed during M (out of memory) left its breadcrumb: report it first
  const killed = staleKill();
  if (killed) rows.push(killed);
  const note = document.createElement('pre');
  note.className = 'multi-note';
  if (killed) note.textContent = formatMultiRows(rows);
  const pick = (accept: string) =>
    new Promise<Blob | null>((resolve) => {
      const i = document.createElement('input');
      i.type = 'file';
      i.accept = accept;
      // in the document (not display:none) so iOS opens the picker reliably, as bench/main.ts's own inputs
      i.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;opacity:0';
      i.addEventListener('change', () => {
        resolve(i.files?.[0] ?? null);
        i.remove();
      });
      section.append(i);
      i.click();
    });
  const run = async (id: string) => {
    note.textContent = `${id}…`;
    try {
      // only D and B take a picked photo: GL measures the GPU alone, R, F, BF, PE, M and later rows load their own fixtures
      const photo = id === 'D' || id === 'B' ? await pick('image/*') : null;
      const blob = photo ?? new Blob();
      const got = await RUNNERS[id]({ faces: blob, people: blob });
      rows.push(...got);
      note.textContent = formatMultiRows(rows);
    } catch (e) {
      note.textContent = `${id}: ${e instanceof Error ? e.message : String(e)}`;
    }
  };
  for (const id of ['D', 'B', 'GL', 'R', 'F', 'BF', 'PE', 'PC', 'M', 'L', 'J', 'J2']) {
    const b = document.createElement('button');
    b.textContent = id;
    b.addEventListener('click', () => void run(id));
    section.append(b);
  }
  section.append(note);
  parent.append(section);
  if (new URLSearchParams(location.search).has('fixtures')) {
    (window as Window & { __benchMulti?: unknown }).__benchMulti = {
      run: async (ids: string[]) => {
        const photos = await fixtures();
        const out: MultiRow[] = [];
        for (const id of ids) out.push(...(await RUNNERS[id](photos)));
        rows.push(...out);
        return out;
      },
    };
  }
  return { rows: () => rows };
}

/**
 * R: the reshape microbench (S §6.2): every 美型 item at maximum with the caps on, the layouts of reshapeLayouts.ts
 * (N = 1…MAX_RENDER_FACES (10) spread across the frame, 6, 8 and 10 in a row at 1.2 FW, 2×3, 2×4 and 2×5 grids at
 * 1.3 FW), both face-table carriers, at 1080 and 2048: 30 warm-up draws, then 10 batches of 10 draws per 1-px
 * readPixels, the median batch / 10 minus the N = 0 baseline. RC: compile + link (the first draw). RP (GPU vs CPU
 * pin) is tests/e2e/pages/reshape.ts, opened on the device.
 */
export async function rowR(): Promise<MultiRow[]> {
  const { adapt } = await import('../tracking/adapter111');
  const { createReshapePass, faceWidthIso, reshapeUniforms } = await import('../engine/passes/reshape');
  const { attenuate, boxCentre, capsFor, ovalBox, WHOLE } = await import('../engine/passes/faceCap');
  const { applyPreset, PARAM_DEFS, setParam } = await import('../engine/params');
  const { createFramebuffer, createTexture } = await import('../engine/gl/gl');
  const res = await fetch('/tests/fixtures/landmarks_sample_face.json');
  if (!res.ok) throw new Error(`R needs /tests/fixtures/landmarks_sample_face.json (the dev server): ${res.status}`);
  const lm = (await res.json()) as { width: number; height: number; points: number[] };
  const base = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
  const u = reshapeUniforms(PARAM_DEFS.filter((d) => d.group === 'shape').reduce((p, d) => setParam(p, d.id, 1), applyPreset('original', 1)).values, 1);
  // the clustered layouts at FW 0.1 (the row of ten at FW 0.081; the bench frame is square: iso = UV), so their
  // spacing is what their names say
  const layouts = reshapeBenchLayouts(faceWidthIso(base, 1));
  const out: MultiRow[] = [];
  for (const carrier of ['texture', 'ubo'] as const) {
    for (const edge of [1080, 2048]) {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2');
      if (!gl) return [{ row: 'R', config: 'webgl2', values: { available: 'no' } }];
      const t0 = performance.now();
      const pass = createReshapePass(gl, { carrier });
      const src = createTexture(gl, edge, edge);
      const dst = createFramebuffer(gl, edge, edge);
      pass.drawFaces(src, dst, [], {});
      const px = new Uint8Array(4);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      out.push({ row: 'RC', config: `${carrier} ${edge}`, values: { compile_ms: Math.round(performance.now() - t0) } });
      const time = (faces: Parameters<typeof pass.drawFaces>[2]) => {
        for (let i = 0; i < 30; i++) pass.drawFaces(src, dst, faces, { aspect: 1 });
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const batches: number[] = [];
        for (let b = 0; b < 10; b++) {
          const s = performance.now();
          for (let i = 0; i < 10; i++) pass.drawFaces(src, dst, faces, { aspect: 1 });
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
          batches.push((performance.now() - s) / 10);
        }
        return median(batches);
      };
      const baseline = time([]);
      for (const [name, { centres, k }] of Object.entries(layouts)) {
        const faces = centres.map(([x, y]) => placeBenchFace(base, x, y, k));
        const caps = capsFor(faces.map((f) => boxCentre(ovalBox(f))), [], 1);
        const tfs = faces.map((f, i) => ({ face: f, u: attenuate(u, 0), layer: -1, window: WHOLE, centre: boxCentre(ovalBox(f)), cap: caps[i] }));
        out.push({ row: 'R', config: `${carrier} ${edge} ${name}`, values: { ms: Math.round((time(tfs) - baseline) * 100) / 100 } });
      }
      pass.dispose();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
  }
  return out;
}
addRunner('R', () => rowR());

/** F: buildFaceProtect for each face of group6_faces.png at 2048 with a full-frame mask, in its 128² window */
export async function rowF(): Promise<MultiRow[]> {
  const { prepareFaces } = await import('../detect/faces');
  const { buildFaceProtect, protectWindow } = await import('../tracking/faceProtect');
  const { boxCentre, ovalBox } = await import('../engine/passes/faceCap');
  const { createTracker } = await import('../tracking/tracker');
  const res = await fetch('/tests/fixtures/group6_faces.png');
  if (!res.ok) throw new Error(`F needs /tests/fixtures/group6_faces.png (the dev server): ${res.status}`);
  const bmp = await decode(await res.blob(), 2048);
  const { modelBuffer, fullRangeDetector } = await trackerInputs();
  const t = await createTracker({ modelBuffer, fullRangeDetector, wasmBase: ENGINE_PATHS.wasmBase, delegate: 'auto' });
  const p = prepareFaces(t.detectImage(bmp, { maxFaces: EDIT_DETECT_FACES }), bmp.width, bmp.height);
  t.close();
  const mask = { width: 256, height: 192, data: new Uint8Array(256 * 192).fill(255) };
  const out = p.faces.map((f): MultiRow => {
    const others = p.faces.filter((g) => g !== f);
    const t0 = now();
    buildFaceProtect(
      f.face,
      {
        own: mask,
        clipToCell: true,
        otherCentres: others.map((g) => boxCentre(ovalBox(g.face))),
        otherOvals: others.map((g) => g.face.oval),
        otherMasks: [],
        window: protectWindow(f.face, bmp.width, bmp.height),
      },
      bmp.width,
      bmp.height,
    );
    return { row: 'F', config: f.id, values: { ms: round(now() - t0) } };
  });
  bmp.close();
  return out;
}
addRunner('F', () => rowF());

/**
 * BF: buildBodyField with 4 persons (group_people's two measures plus their mirrored copies, masks mirrored too),
 * every person edited: a full build, a draft, and a drag step (one person's value changed, the others' parts reused)
 */
export async function rowBF(): Promise<MultiRow[]> {
  const { buildBodyField } = await import('../body/field');
  const { measureBody } = await import('../body/measure');
  const res = await fetch('/tests/fixtures/group_people.pose.json');
  if (!res.ok) throw new Error(`BF needs /tests/fixtures/group_people.pose.json (the dev server): ${res.status}`);
  type MaskJson = { width: number; height: number; data: string };
  const j = (await res.json()) as { width: number; height: number; poses: { points: number[]; mask: MaskJson | null }[] };
  const dec = (m: MaskJson | null) => (m ? { width: m.width, height: m.height, data: Uint8Array.from(atob(m.data), (c) => c.charCodeAt(0)) } : null);
  const half = j.poses.map((p) => ({ pose: { points: new Float32Array(p.points) }, mask: dec(p.mask) }));
  const mirrored = half.map((b) => {
    const pts = b.pose.points.slice();
    for (let i = 0; i < 33; i++) pts[i * 4] = 1 - pts[i * 4];
    const m = b.mask;
    const data = m ? new Uint8Array(m.data.length) : null;
    if (m && data) for (let y = 0; y < m.height; y++) for (let x = 0; x < m.width; x++) data[y * m.width + x] = m.data[y * m.width + m.width - 1 - x];
    return { pose: { points: pts }, mask: m && data ? { width: m.width, height: m.height, data } : null };
  });
  const all = [...half, ...mirrored].slice(0, 4);
  const measures = all.map((b) => measureBody({ pose: b.pose, mask: b.mask, people: 1, width: j.width, height: j.height }, null));
  const values = { 'body.slim': 0.6, 'body.waist': 0.8, 'body.whr': 0, 'body.hip': 0.5, 'body.legSlim': 0.5, 'body.arms': 0.5, 'body.shoulder': 0, 'body.neck': 0, 'body.head': 0 };
  const input = (waist0: number) => ({
    edited: measures.map((m, i) => ({ id: `b${i}`, measure: m, values: i === 0 ? { ...values, 'body.waist': waist0 } : values })),
    masks: all.flatMap((b, i) => (b.mask ? [{ id: `b${i}`, mask: b.mask }] : [])),
    heightBand: null,
    legs: { value: 0, measure: null },
    bodyProtect: true,
    aspect: j.width / j.height,
  });
  const time = (waist0: number, edge?: number) => {
    const t0 = performance.now();
    buildBodyField(input(waist0), null, edge);
    return Math.round(performance.now() - t0);
  };
  return [{ row: 'BF', config: '4 persons', values: { full_ms: time(0.8), draft_ms: time(0.8, 128), drag_ms: time(0.7, 128) } }];
}
addRunner('BF', () => rowBF());

/** PE: an editor-like drag on group6_faces.png at 2048 — every face item + 磨皮 on every person; p50 frame time */
export async function rowPE(): Promise<MultiRow[]> {
  const { prepareFaces } = await import('../detect/faces');
  const { buildCache } = await import('../detect/cache');
  const { createStillSession } = await import('../app/still');
  const { createEngine } = await import('../engine/index');
  const { createTracker } = await import('../tracking/tracker');
  const { buildFrame } = await import('../edit/frame');
  const { assignPersons } = await import('../edit/state');
  const { editFromLegacy } = await import('../edit/legacy');
  const { applyPreset, paramsInGroup, setParam } = await import('../engine/params');
  const res = await fetch('/tests/fixtures/group6_faces.png');
  if (!res.ok) throw new Error(`PE needs /tests/fixtures/group6_faces.png (the dev server): ${res.status}`);
  const bmp = await decode(await res.blob(), 2048);
  const { modelBuffer, fullRangeDetector } = await trackerInputs();
  const t = await createTracker({ modelBuffer, fullRangeDetector, wasmBase: ENGINE_PATHS.wasmBase, delegate: 'auto' });
  const prepared = prepareFaces(t.detectImage(bmp, { maxFaces: EDIT_DETECT_FACES }), bmp.width, bmp.height);
  t.close();
  const cache = buildCache({ width: bmp.width, height: bmp.height }, prepared, null, { faceScans: [{ quarter: 0, flipH: false }] });
  const canvas = document.createElement('canvas');
  const engine = createEngine(canvas, { mirror: false });
  await engine.ready;
  const s = createStillSession(engine, null, bmp, { faces: cache.faces, obstacles: cache.obstacles });
  const faceItems = ['skin.smooth', ...paramsInGroup('shape').map((d) => d.id)];
  const look = faceItems.reduce((p, id) => setParam(p, id as never, 0.7), applyPreset('natural', 1));
  const ids = cache.persons.map((p) => p.id);
  const gl = engine.canvas.getContext('webgl2')!;
  const px = new Uint8Array(4);
  const times: number[] = [];
  for (let i = 0; i < 40; i++) {
    // every person carries the look (template = the look), the drag moves 大眼 for everyone
    const e0 = editFromLegacy(setParam(look, 'shape.eyeEnlarge', 0.5 + (i % 10) / 20), { primaryInit: true });
    const edit = assignPersons({ ...e0, template: e0.persons.p0 }, ids, cache.primary);
    const frame = buildFrame(edit, s.faces.map((f) => ({ id: f.id, face: f.face, person: f.id })), cache.obstacles, new Map(), cache.primary);
    const t0 = now();
    engine.render({ source: bmp, width: bmp.width, height: bmp.height, ...frame }, { still: true });
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // wait for the GPU (iOS has no timer query)
    times.push(now() - t0);
  }
  const faces = cache.faces.length;
  s.dispose();
  engine.dispose();
  return [{ row: 'PE', config: `${faces} faces 2048`, values: { p50_ms: round(median(times)) } }];
}
addRunner('PE', () => rowPE());

/**
 * PC (S §6.1, §6.3 PC1): the slider commit's fold check (warpGuard through createWarpGuard, as the editor runs it after
 * a contour drag: every face with its 瘦臉 limit) on the fixture face in row R's 2-row grids of 6, 8 and 10 faces, every
 * 美型 item at max: a 全部 commit and one person's change, and the 全部 commit without limits (bench/foldGuardBench.ts,
 * imported statically: in the bench chunk, which the service worker does not precache). CPU only, no GL.
 */
export async function rowPC(): Promise<MultiRow[]> {
  const res = await fetch('/tests/fixtures/landmarks_sample_face.json');
  if (!res.ok) throw new Error(`PC needs /tests/fixtures/landmarks_sample_face.json (the dev server): ${res.status}`);
  const lm = (await res.json()) as { width: number; height: number; points: number[] };
  return foldGuardRows(adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height));
}
addRunner('PC', () => rowPC());

const M_KEY = 'meiyan.bench.m';
/**
 * M (kill test, S §6.2): open group_people.jpg, detect every body (numPoses 4) and measure, 3 times; a breadcrumb left
 * behind by a killed page is reported on the next load (staleKill)
 */
export async function rowM(): Promise<MultiRow[]> {
  const { createBodyTracker } = await import('../tracking/bodyTracker');
  const { measureBody } = await import('../body/measure');
  const res = await fetch('/tests/fixtures/group_people.jpg');
  if (!res.ok) throw new Error(`M needs /tests/fixtures/group_people.jpg (the dev server): ${res.status}`);
  const photo = await res.blob();
  const out: MultiRow[] = [];
  for (let run = 1; run <= 3; run++) {
    localStorage.setItem(M_KEY, String(run));
    const bmp = await decode(photo, 2048);
    const bt = await createBodyTracker({ modelBuffer: await loadPoseModel('full'), wasmBase: ENGINE_PATHS.wasmBase, variant: 'full' });
    const d = bt.detect(bmp);
    for (const b of d?.bodies ?? []) measureBody({ pose: b.pose, mask: b.mask, people: 1, width: bmp.width, height: bmp.height }, null);
    bt.close();
    bmp.close();
    localStorage.removeItem(M_KEY);
    const heap = (performance as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
    out.push({ row: 'M', config: `run ${run}`, values: { persons: d?.bodies.length ?? 0, heapMB: Math.round(heap / 1e6) } });
  }
  return out;
}
addRunner('M', () => rowM());

/** a page killed during M leaves its breadcrumb: report it once (and clear it) */
export function staleKill(): MultiRow | null {
  let run: string | null = null;
  try {
    run = localStorage.getItem(M_KEY);
    if (run !== null) localStorage.removeItem(M_KEY);
  } catch {
    return null;
  }
  return run === null ? null : { row: 'M', config: `killed during run ${run}`, values: { killed: 1 } };
}

const r1 = (v: number) => Math.round(v * 10) / 10;

async function cameraVideo(): Promise<{ video: HTMLVideoElement; stop(): void }> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();
  return { video, stop: () => stream.getTracks().forEach((t) => t.stop()) };
}

/** call `frame` on every video frame for `ms`; resolves with the frame rate */
function eachFrame(video: HTMLVideoElement, ms: number, frame: (now: number) => void): Promise<number> {
  return new Promise((done) => {
    const t0 = performance.now();
    let n = 0;
    const tick = (now: number) => {
      frame(now);
      n++;
      if (now - t0 < ms) video.requestVideoFrameCallback(tick);
      else done(n / ((now - t0) / 1000));
    };
    video.requestVideoFrameCallback(tick);
  });
}

async function liveTracker(delegate: 'auto' | Delegate = 'auto'): Promise<Tracker> {
  const { createTracker } = await import('../tracking/tracker');
  const { modelBuffer, fullRangeDetector } = await trackerInputs();
  return createTracker({ modelBuffer, fullRangeDetector, wasmBase: ENGINE_PATHS.wasmBase, delegate });
}

/** warm-up after each numFaces switch: setOptions rebuilds the graph and the first GPU inferences take about a second */
const L_WARM_MS = 2000;
/** measured time per (delegate, count) and round; two rounds, the second in reverse order */
const L_ROUND_MS = 5000;

/**
 * L: detectVideo at numFaces 1, 2 and 3 on the camera, on the GPU and the CPU delegate, then the §6.3 verdicts
 * (report.ts liveRows): PL2 with one face in view (phone: point it at one face; desktop: --video face.y4m), PL1 with
 * three (group_faces.png on a second screen; desktop: --video group.y4m). One tracker per delegate switches its count in
 * place, as the camera's single instance would (tracker.ts setMode). Rounds 1 2 3 then 3 2 1 put any drift (heat,
 * other tabs) on every count alike.
 */
export async function rowL(): Promise<MultiRow[]> {
  const cam = await cameraVideo();
  const runs: LiveRun[] = [];
  try {
    for (const d of ['GPU', 'CPU'] as const) {
      let t: Tracker;
      try {
        t = await liveTracker(d);
      } catch {
        runs.push({ delegate: `${d} (unavailable)`, numFaces: 1, times: [], fps: 0, faces: 0 });
        continue;
      }
      const counts = [1, 2, 3];
      const acc = new Map(counts.map((n) => [n, { times: [] as number[], fps: [] as number[], faces: 0, switchMs: [] as number[] }]));
      // the tracker is built at LIVE_DETECT_FACES; its very first inferences (graph start, about 1.6 s on the desktop's GPU)
      // run untimed here, so every switch_ms is a count switch on a running graph, as the camera would make
      let current = LIVE_DETECT_FACES;
      const skip = (now: number, n: number) => {
        try {
          t.detectVideo(cam.video, now, { maxFaces: n });
        } catch {
          /* skipped */
        }
      };
      try {
        await eachFrame(cam.video, L_WARM_MS, (now) => skip(now, current));
        for (const order of [counts, [...counts].reverse()]) {
          for (const n of order) {
            const a = acc.get(n)!;
            let first = n !== current;
            current = n;
            // a throw inside the frame callback would end eachFrame's chain: a failed inference is skipped (the tracker
            // rebuilds its graph on the next call), never timed
            await eachFrame(cam.video, L_WARM_MS, (now) => {
              try {
                const t0 = performance.now();
                const r = t.detectVideo(cam.video, now, { maxFaces: n });
                if (first && r !== null) {
                  a.switchMs.push(performance.now() - t0);
                  first = false;
                }
              } catch {
                /* skipped */
              }
            });
            a.fps.push(
              await eachFrame(cam.video, L_ROUND_MS, (now) => {
                try {
                  const t0 = performance.now();
                  const r = t.detectVideo(cam.video, now, { maxFaces: n });
                  if (r === null) return; // no inference (throttled rebuild): nothing to time
                  a.times.push(performance.now() - t0);
                  a.faces = Math.max(a.faces, r.length);
                } catch {
                  /* skipped */
                }
              }),
            );
          }
        }
      } finally {
        t.close();
      }
      for (const n of counts) {
        const a = acc.get(n)!;
        runs.push({
          delegate: t.delegate === d ? d : `${d}→${t.delegate}`,
          numFaces: n,
          times: a.times,
          fps: a.fps.reduce((x, y) => x + y, 0) / a.fps.length,
          faces: a.faces,
          switchMs: a.switchMs,
        });
      }
    }
  } finally {
    cam.stop();
  }
  return liveRows(runs);
}

/** the largest face's pts111 (UV) of a detection */
function largestFace(lms: readonly Landmarks478[] | null, w: number, h: number): Float32Array | null {
  if (!lms?.length) return null;
  const faces = lms.map((l) => adapt(l, w, h));
  const best = faces.reduce((a, f) => (ovalBox(f).w * ovalBox(f).h > ovalBox(a).w * ovalBox(a).h ? f : a));
  return best.pts111;
}

/**
 * J (jitter, static scene, 2 s) and J2 (lag, panning, 4 s): MediaPipe's own smoothing (VIDEO, numFaces 1), the raw
 * landmarks (VIDEO, numFaces 3) and the app's smoother on the raw ones, on the same frames. Jitter: RMS of every
 * pts111 point's deviation from its mean, px at a 1080-px frame height. Lag: the mean of (raw − smoothed) / raw velocity
 * of the pts111 centroid x, ms. All three runs follow one face: the one MediaPipe's numFaces-1 graph picked (not
 * necessarily the largest of a group), so the smoothers are compared on the same face. Both graphs warm up first (the
 * first GPU inferences take about a second).
 */
async function jitterLag(ms: number): Promise<Record<string, { pts: Float32Array[]; t: number[] }>> {
  const cam = await cameraVideo();
  const mp = await liveTracker();
  const raw = await liveTracker();
  const smoother = new LandmarkSmoother();
  const runs: Record<string, { pts: Float32Array[]; t: number[] }> = { mediapipe: { pts: [], t: [] }, raw: { pts: [], t: [] }, app: { pts: [], t: [] } };
  try {
    const w = cam.video.videoWidth;
    const h = cam.video.videoHeight;
    await eachFrame(cam.video, 1500, (now) => {
      mp.detectVideo(cam.video, now, { maxFaces: 1 });
      raw.detectVideo(cam.video, now, { maxFaces: 3 });
    });
    const centre = (p: Float32Array): [number, number] => {
      let x = 0;
      let y = 0;
      for (let i = 0; i < 111; i++) {
        x += p[i * 2] / 111;
        y += p[i * 2 + 1] / 111;
      }
      return [x, y];
    };
    await eachFrame(cam.video, ms, (now) => {
      const m = largestFace(mp.detectVideo(cam.video, now, { maxFaces: 1 }), w, h);
      const rl = raw.detectVideo(cam.video, now, { maxFaces: 3 });
      if (!m || !rl?.length) return;
      // the raw face MediaPipe's graph follows: the nearest pts111 centroid
      const [mx, my] = centre(m);
      const dist = (l: Landmarks478) => {
        const [x, y] = centre(adapt(l, w, h).pts111);
        return Math.hypot(x - mx, y - my);
      };
      const big = rl.reduce((a, l) => (dist(l) < dist(a) ? l : a));
      const r = adapt(big, w, h).pts111;
      const a = adapt({ points: smoother.apply(big.points, w, h, now) }, w, h).pts111;
      for (const [k, p] of [['mediapipe', m], ['raw', r], ['app', a]] as const) {
        runs[k].pts.push(p);
        runs[k].t.push(now);
      }
    });
  } finally {
    mp.close();
    raw.close();
    cam.stop();
  }
  return runs;
}

export async function rowJ(): Promise<MultiRow[]> {
  const runs = await jitterLag(2000);
  const h = 1080;
  return Object.entries(runs).map(([k, r]) => {
    const n = r.pts.length;
    let s = 0;
    let c = 0;
    for (let i = 0; i < 111; i++) {
      let mx = 0;
      let my = 0;
      for (const p of r.pts) {
        mx += p[i * 2] / n;
        my += p[i * 2 + 1] / n;
      }
      for (const p of r.pts) {
        s += ((p[i * 2] - mx) * h * (16 / 9)) ** 2 + ((p[i * 2 + 1] - my) * h) ** 2;
        c++;
      }
    }
    return { row: 'J', config: k, values: { rms_px1080: r1(Math.sqrt(s / Math.max(1, c))), frames: n } };
  });
}

export async function rowJ2(): Promise<MultiRow[]> {
  const runs = await jitterLag(4000);
  const cx = (p: Float32Array) => {
    let s = 0;
    for (let i = 0; i < 111; i++) s += p[i * 2];
    return s / 111;
  };
  const raw = runs.raw.pts.map(cx);
  const t = runs.raw.t;
  return (['mediapipe', 'app'] as const).map((k) => {
    const sm = runs[k].pts.map(cx);
    let sum = 0;
    let n = 0;
    for (let i = 3; i < raw.length; i++) {
      const v = (raw[i] - raw[i - 3]) / (t[i] - t[i - 3]); // UV per ms
      if (Math.abs(v) < 1e-5) continue;
      sum += (raw[i] - sm[i]) / v;
      n++;
    }
    return { row: 'J2', config: k, values: { lag_ms: n ? r1(sum / n) : 'n/a', samples: n } };
  });
}
addRunner('L', () => rowL());
addRunner('J', () => rowJ());
addRunner('J2', () => rowJ2());
