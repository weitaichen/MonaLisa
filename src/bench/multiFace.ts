// Bench 「多臉」 section (S §6.2 rows). Rows D (multi-face detectImage), B (multi-pose body detection) and GL (limits +
// probes) land in Phase 0; later tasks add R, RC, RP (Task 17), F (Task 19), BF (Task 20), PE, M (Task 23), L, J,
// J2 (Task 25) and PC (the slider commit's fold check, S §6.3 PC1); v0.6 (camera per-person spec §12.4) extends L
// (counts 1/3/10, both detectors, the group path's calls) and adds LF, LFC, GS, WB and JG. Results join 複製結果
// through formatMultiRows. /bench.html?fixtures=1 (dev server) loads the group fixtures by URL so
// scripts/bench-multiface.mjs can drive it (its --upright adds upright=1, --option-c GPU=<ms>,CPU=<ms>
// optionC=GPU:<ms>,CPU:<ms>); on a phone the rows take a picked photo.
import { FaceLandmarker, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { debugState } from '../app/debug';
import { type LiveLoop, liveRoute, resetAutoTierSession, startLiveLoop } from '../app/live';
import { LivePersons } from '../app/livePersons';
import { layoutViews, type LiveView, mapLandmarks, tileFor } from '../app/liveViews';
import { LandmarkSmoother } from '../app/oneEuro';
import { EDIT_DETECT_FACES, LIVE_DETECT_FACES, LIVE_DETECTOR } from '../config/limits';
import { neutralPerson, neutralPhoto } from '../edit/state';
import { ENGINE_PATHS, loadEngineAssets, loadPhotoDetector, loadPoseModel } from '../engine/assets';
import { withFaceDetector } from '../engine/faceBundle';
import { probeFaceTable, probeR16FArray, readGlLimits } from '../engine/glProbe';
import { createEngine } from '../engine/index';
import { ovalBox } from '../engine/passes/faceCap';
import { createCamera } from '../media/camera';
import { adapt } from '../tracking/adapter111';
import { downscaleMask } from '../tracking/bodyTracker';
import type { CameraController, Delegate, Engine, FaceDetectorKind, Landmarks478, Prefs, Rect, Tracker } from '../types';
import { centerCropRect, normalizedCropRect } from '../ui/imaging';
import { foldGuardRows } from './foldGuardBench';
import {
  formatMultiRows,
  gsRows,
  type JgRun,
  jgRows,
  jitterRms,
  lagMs,
  type LfRun,
  type LfSample,
  lfRows,
  liveRows,
  type LiveRun,
  median,
  type MultiRow,
  type OptionCBounds,
  parseOptionC,
  summarizeLf,
  viewCallRows,
  type ViewRun,
  type WbFlip,
  wbRows,
} from './report';
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
  section.innerHTML = '<h3>多臉</h3><p class="multi-note">D：多臉偵測（選 group_faces.png）　B：多人美體（選 group_people.jpg）　GL：GPU 上限　R：多臉美型 GPU 時間　F：每張臉的瘦臉限制建構時間　BF：四人美體場建構時間　PE：多臉編輯每格時間　PC：滑桿放開時的摺疊檢查時間（6／8／10 張臉，全部或一人改變；得 PC1）　M：多人美體偵測記憶體（頁面被終止時，下次開啟會回報）　L：相機多臉追蹤時間（GPU／CPU，numFaces 1／3／10，短距與全距偵測器，及群組路徑每種畫面的呼叫時間；鏡頭前一張臉得 PL2，三張臉得 PL1）　J／J2：相機平滑的抖動／延遲　LF：後鏡頭即時預覽（群組路徑，每張臉都美顏，10 秒；兩張臉以上得 PGN，一張臉得 PLB）　LFC：同 LF，單次 VIDEO（選項 C，PGN 的比較）　GS：前鏡頭在單人與群組路徑間切換的最長一格（PGS）　WB：翻到後鏡頭後的第一格，冷／熱（PWB）　JG：群組路徑的抖動／延遲，整個畫面與小格（PJ1G）（L、J、J2、LF、LFC、GS、WB、JG 用相機）（R、F、BF、PE、PC、M 需開發伺服器的 /tests/fixtures）</p>';
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
  for (const id of ['D', 'B', 'GL', 'R', 'F', 'BF', 'PE', 'PC', 'M', 'L', 'J', 'J2', 'LF', 'LFC', 'GS', 'WB', 'JG']) {
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

const query = () => new URLSearchParams(location.search);
/**
 * bench-multiface.mjs --upright (camera per-person spec §12.2 E4, §12.4): the camera rows ask for an upright 1080 × 1920
 * stream, since Chrome's fake camera centre-crops a portrait clip to the aspect of a landscape request (§6.1)
 */
const upright = () => query().get('upright') === '1';
/**
 * bench-multiface.mjs --option-c GPU=<ms>,CPU=<ms>: PGN's longest-frame bound per delegate, row LFC's longest_ms on
 * that delegate (§10); null (or a delegate left out) → not judged
 */
const optionCBounds = (): OptionCBounds | null => parseOptionC(query().get('optionC') ?? '');
/** the camera rows' stream size: 1280 × 720, or 1080 × 1920 with --upright */
const streamSize = (): MediaTrackConstraints => (upright() ? { width: { ideal: 1080 }, height: { ideal: 1920 } } : { width: { ideal: 1280 }, height: { ideal: 720 } });

async function cameraVideo(): Promise<{ video: HTMLVideoElement; stop(): void }> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: streamSize(), audio: false });
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
/** row L's VIDEO graphs (camera per-person spec §12.4): the detectors in this order, each at these counts */
const L_DETECTORS = ['camera', 'photo'] as const;
const L_COUNTS = [1, 3, 10];
/** the app's default ratio (ui/state.ts, 3:4): the visible crop the group path's views lie in */
const APP_RATIO = 3 / 4;

/** the delegate a tracker asked for, and the one it runs if 'auto' or a fallback changed it */
const ran = (d: Delegate, t: Tracker) => (t.delegate === d ? d : `${d}→${t.delegate}`);

/**
 * L: detectVideo at numFaces 1, 3 and 10 with the camera detector (short-range, the front solo path) and the photo
 * detector (full-range once downloaded, the back camera's option C) on the camera, on the GPU and the CPU delegate,
 * then the group path's call per view kind (viewCalls); then the §6.3 verdicts from the camera detector's runs (report.ts
 * liveRows): PL2 with one face in view (phone: point it at one face; desktop: --video face.y4m), PL1 with three
 * (group_faces.png on a second screen; desktop: --video group.y4m). One tracker per delegate switches its count and
 * bundle in place, as the camera's single instance would (tracker.ts setMode). Rounds camera 1 3 10, photo 1 3 10, then
 * the reverse put any drift (heat, other tabs) on every configuration alike.
 */
export async function rowL(): Promise<MultiRow[]> {
  const cam = await cameraVideo();
  const runs: LiveRun[] = [];
  const views: ViewRun[] = [];
  try {
    for (const d of ['GPU', 'CPU'] as const) {
      let t: Tracker;
      try {
        t = await liveTracker(d);
      } catch {
        runs.push({ delegate: `${d} (unavailable)`, numFaces: 1, times: [], fps: 0, faces: 0 });
        continue;
      }
      const configs = L_DETECTORS.flatMap((detector) => L_COUNTS.map((n) => ({ detector, n, key: `${detector} ${n}` })));
      const acc = new Map(configs.map((c) => [c.key, { times: [] as number[], fps: [] as number[], faces: 0, switchMs: [] as number[] }]));
      // the tracker is built on the camera bundle at LIVE_DETECT_FACES; its very first inferences (graph start, about 1.6 s
      // on the desktop's GPU) run untimed here, so every switch_ms is a count or bundle switch on a running graph, as the
      // camera would make
      let current = `camera ${LIVE_DETECT_FACES}`;
      const skip = (now: number) => {
        try {
          t.detectVideo(cam.video, now, { maxFaces: LIVE_DETECT_FACES, detector: 'camera' });
        } catch {
          /* skipped */
        }
      };
      try {
        await eachFrame(cam.video, L_WARM_MS, skip);
        for (const order of [configs, [...configs].reverse()]) {
          for (const { detector, n, key } of order) {
            const a = acc.get(key)!;
            let first = key !== current;
            current = key;
            // a throw inside the frame callback would end eachFrame's chain: a failed inference is skipped (the tracker
            // rebuilds its graph on the next call), never timed
            await eachFrame(cam.video, L_WARM_MS, (now) => {
              try {
                const t0 = performance.now();
                const r = t.detectVideo(cam.video, now, { maxFaces: n, detector });
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
                  const r = t.detectVideo(cam.video, now, { maxFaces: n, detector });
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
        views.push(...(await viewCalls(cam.video, t, ran(d, t))));
        if (t.photoDetector === 'full-range') fullRangeRan = true;
      } finally {
        t.close();
      }
      for (const { detector, n, key } of configs) {
        const a = acc.get(key)!;
        runs.push({
          delegate: ran(d, t),
          detector,
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
  const l = liveRows(runs);
  return [...l.filter((r) => r.row === 'L'), ...viewCallRows(views), ...l.filter((r) => r.row !== 'L')];
}

/**
 * Row L's group-path calls (camera per-person spec §12.4): detectView, the call the app makes (live.ts viewCall), on a
 * copy of one view of the app's 3:4 crop, at EDIT_DETECT_FACES: the whole view and the first tile of the back camera's
 * layout (layoutViews 'environment', 'photo') with the photo detector, then of the front camera's ('user', 'camera')
 * with the camera detector. Each view: L_WARM_MS untimed (the mode and bundle switch, the first IMAGE inferences), then
 * L_ROUND_MS timed, the copy (drawImage of the view's rect) and the call apart.
 */
async function viewCalls(video: HTMLVideoElement, t: Tracker, delegate: string): Promise<ViewRun[]> {
  const w = video.videoWidth;
  const h = video.videoHeight;
  const c = centerCropRect(w, h, APP_RATIO);
  const crop = { x: c.x, y: c.y, w: c.width, h: c.height };
  const plan: { detector: FaceDetectorKind; view: LiveView }[] = [];
  for (const [facing, detector] of [
    ['environment', 'photo'],
    ['user', 'camera'],
  ] as const) {
    const lay = layoutViews(w, h, crop, facing, detector);
    plan.push({ detector, view: lay.whole }, { detector, view: lay.tiles[0] });
  }
  const out: ViewRun[] = [];
  for (const { detector, view } of plan) {
    const copy = new OffscreenCanvas(view.copy.w, view.copy.h);
    const ctx = copy.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('L: no OffscreenCanvas 2D context for the view copies');
    const r = view.rect;
    const times: number[] = [];
    const copyTimes: number[] = [];
    let faces = 0;
    const call = (timed: boolean) => {
      try {
        const c0 = performance.now();
        ctx.drawImage(video, r.x, r.y, r.w, r.h, 0, 0, view.copy.w, view.copy.h);
        const c1 = performance.now();
        const lms = t.detectView(copy, { maxFaces: EDIT_DETECT_FACES, detector });
        if (!timed || lms === null) return; // no inference (throttled rebuild): nothing to time
        times.push(performance.now() - c1);
        copyTimes.push(c1 - c0);
        faces = Math.max(faces, lms.length);
      } catch {
        /* skipped, as the VIDEO rows */
      }
    };
    await eachFrame(video, L_WARM_MS, () => call(false));
    await eachFrame(video, L_ROUND_MS, () => call(true));
    out.push({ delegate, detector, view: view.id, size: `${view.copy.w}x${view.copy.h}`, times, copyTimes, faces });
  }
  return out;
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
// ───────────────────── the live loop as the app runs it (camera per-person spec §10, §12.4) ─────────────────────

const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

let uprightAsked = false;
/**
 * The app's camera controller (media/camera.ts, its own 1920 × 1080 request) for rows LF, LFC, GS and WB. With
 * --upright every video request of the page asks for 1080 × 1920 instead, as tests/e2e/fixtures.ts uprightCamera does.
 */
function appCamera(): CameraController {
  const md = navigator.mediaDevices;
  if (upright() && md && !uprightAsked) {
    uprightAsked = true;
    const getUserMedia = md.getUserMedia.bind(md);
    md.getUserMedia = (c?: MediaStreamConstraints) =>
      c?.video ? getUserMedia({ ...c, video: { ...(typeof c.video === 'object' ? c.video : {}), ...streamSize() } }) : getUserMedia(c);
  }
  return createCamera();
}

/** the app's default prefs (store/settings.ts DEFAULT_PREFS): the auto tier, 合照模式 off (runLoop's phases set it) */
const LIVE_PREFS: Prefs = {
  mirrorOnSave: true,
  tier: 'auto',
  matchGpupixel: false,
  showLandmarks: false,
  delegate: 'auto',
  installHintDismissed: true,
  exportFormat: 'jpeg',
  exportSize: 'full',
  groupMode: false,
};
const NEUTRAL_PHOTO = neutralPhoto();

/** every shown face edited (§12.4 LF): 全部套用 on, its person at 磨皮 0.6, 大眼 0.5, 瘦臉 0.5 and 口紅 0.5 */
function editedSession(): LivePersons {
  const s = new LivePersons();
  s.setAll(true);
  const n = neutralPerson();
  s.edit({ ...n, values: { ...n.values, 'skin.smooth': 0.6, 'shape.eyeEnlarge': 0.5, 'shape.faceSlim': 0.5, 'makeup.lip': 0.5 }, preset: 'custom' });
  return s;
}

/** a call's start (performance.now()) and duration, ms */
interface Timed {
  at: number;
  ms: number;
}

/** the tracker with each answered detection timed (the loop's D, §6.4); everything else passes through */
function timedTracker(t: Tracker, calls: Timed[]): Tracker {
  const time = <R>(f: () => R | null): R | null => {
    const at = performance.now();
    const r = f();
    if (r !== null) calls.push({ at, ms: performance.now() - at });
    return r;
  };
  return {
    get delegate() {
      return t.delegate;
    },
    get photoDetector() {
      return t.photoDetector;
    },
    detectVideo: (video, ts, o) => time(() => t.detectVideo(video, ts, o)),
    detectImage: (image, o) => t.detectImage(image, o),
    detectView: (view, o) => time(() => t.detectView(view, o)),
    warm: (mode, detector) => t.warm(mode, detector),
    close: () => t.close(),
  };
}

/** the engine with each live render timed (§6.4's R: the frame's render as the loop counts it) */
function timedEngine(e: Engine, renders: Timed[]): Engine {
  return new Proxy(e, {
    get(target, prop) {
      if (prop === 'render') {
        return (...a: Parameters<Engine['render']>) => {
          const at = performance.now();
          try {
            return target.render(...a);
          } finally {
            renders.push({ at, ms: performance.now() - at });
          }
        };
      }
      const v: unknown = Reflect.get(target, prop, target);
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  });
}

/**
 * Every video frame's reading of window.__meiyan (report.ts LfSample), from an rVFC of its own beside the live loop's:
 * started after the loop, it runs after the loop's callback in each frame, so it reads that frame's state.
 */
function sampleFrames(video: HTMLVideoElement): { samples: LfSample[]; stop(): void } {
  const samples: LfSample[] = [];
  let on = true;
  const tick = (t: number, meta: VideoFrameCallbackMetadata) => {
    if (!on) return;
    const d = debugState();
    samples.push({
      t,
      presented: meta.presentedFrames,
      every: d?.liveEvery ?? 1,
      views: [...(d?.liveViews ?? [])],
      path: d?.livePath,
      faces: d?.faces ?? 0,
      boxes: (d?.boxes ?? []).flatMap((b) => (b.seen === undefined ? [] : [{ id: b.id, seen: b.seen }])),
    });
    video.requestVideoFrameCallback(tick);
  };
  video.requestVideoFrameCallback(tick);
  return {
    samples,
    stop: () => {
      on = false;
    },
  };
}

/**
 * The live loop as the app runs it (Camera.tsx: the camera session, the photo look, the prefs, the 3:4 crop as
 * getFrame), one loop through every phase in turn (a phase: 合照模式 on or off, `group`, for `ms`; a change of phase is
 * the toggle tapped mid-stream, K22), on the timed tracker and engine, sampled on every frame from the loop's start (t0)
 * to its stop.
 */
async function runLoop(
  camera: CameraController,
  engine: Engine,
  t: Tracker,
  persons: LivePersons,
  phases: readonly { group: boolean; ms: number }[],
): Promise<{ samples: LfSample[]; calls: Timed[]; renders: Timed[]; t0: number }> {
  const calls: Timed[] = [];
  const renders: Timed[] = [];
  const tracker = timedTracker(t, calls);
  const eng = timedEngine(engine, renders);
  const video = camera.video;
  let sampler: ReturnType<typeof sampleFrames> | null = null;
  let prefs: Prefs = { ...LIVE_PREFS, groupMode: phases[0]?.group ?? false };
  const t0 = performance.now();
  try {
    const loop = startLiveLoop({
      camera,
      engine: eng,
      tracker,
      persons,
      getPhoto: () => NEUTRAL_PHOTO,
      getPrefs: () => prefs,
      getFrame: () => normalizedCropRect(video.videoWidth, video.videoHeight, APP_RATIO),
    });
    sampler = sampleFrames(video);
    try {
      for (const p of phases) {
        prefs = { ...prefs, groupMode: p.group };
        await sleep(p.ms);
      }
    } finally {
      loop.stop();
    }
  } finally {
    sampler?.stop();
  }
  return { samples: sampler?.samples ?? [], calls, renders, t0 };
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** row LF: the warm-up after the loop starts (the first GPU frames, the auto tier's first steps), then the measured window */
const LF_WARM_MS = 2000;
const LF_MEASURE_MS = 10_000;

/**
 * LF (camera per-person spec §12.4; gates PGN with ≥ 2 faces, PLB with one): the live loop as the app runs it on the
 * back camera, GPU then CPU. An engine on a hidden canvas, the app's camera controller, a fresh tracker per delegate
 * warmed as Camera.tsx does before the first frame, every shown face edited, the group path (`group`; row LFC: false,
 * option C, a VIDEO pass per frame whose longest_ms on each delegate is that delegate's PGN bound, given back through
 * --option-c GPU=<ms>,CPU=<ms> and read for the delegate asked for, `d`, as the configs' first word). 2 s warm-up, then
 * 10 s measured: every frame samples window.__meiyan (fps, the longest frame, the max gap, k, the cycle, each face's
 * refreshes), and the tracker's calls and the engine's renders are timed. LFC gives the LF row only (the comparison,
 * not a gate). With --upright the stream is 1080 × 1920 (upright_far10: PGN; face.y4m without it: PLB).
 */
export async function rowLF(group: boolean): Promise<MultiRow[]> {
  const optionC = group ? optionCBounds() : null;
  const engine = createEngine(document.createElement('canvas'), { mirror: false, matchGpupixel: false, showLandmarks: false });
  const camera = appCamera();
  const out: MultiRow[] = [];
  try {
    await engine.ready;
    await camera.start('environment');
    if (camera.snapshot.state !== 'live') throw new Error(`LF: camera ${camera.snapshot.state} (${camera.snapshot.error ?? '—'})`);
    for (const d of ['GPU', 'CPU'] as const) {
      let t: Tracker;
      try {
        t = await liveTracker(d);
      } catch (e) {
        out.push({ row: 'LF', config: `${d} back (unavailable)`, values: { error: errText(e) } });
        continue;
      }
      try {
        resetAutoTierSession();
        // Camera.tsx warmAfterPaint: the back camera's first graph (the full-range compile) lands before the first frame
        const first = liveRoute('environment', group);
        t.warm(first.mode, first.detector);
        if (t.photoDetector === 'full-range') fullRangeRan = true;
        const r = await runLoop(camera, engine, t, editedSession(), [{ group, ms: LF_WARM_MS + LF_MEASURE_MS }]);
        const from = r.t0 + LF_WARM_MS;
        const p50 = (xs: readonly Timed[]) => median(xs.filter((x) => x.at >= from).map((x) => x.ms));
        const run: LfRun = {
          // the stream's size: --upright took effect (PGN's upright_far10 needs 1080 × 1920)
          config: `${ran(d, t)} back ${group ? 'group' : 'option C'} ${camera.video.videoWidth}x${camera.video.videoHeight}`,
          ...summarizeLf(r.samples.filter((s) => s.t >= from)),
          detectP50: p50(r.calls),
          renderP50: p50(r.renders),
          tier: engine.tier,
        };
        // PGN on d against d's option C (a GPU run against the GPU's LFC, the CPU's against the CPU's)
        const rows = lfRows(run, optionC?.[d] ?? null);
        out.push(...(group ? rows : rows.slice(0, 1)));
      } finally {
        t.close();
      }
    }
  } finally {
    camera.stop();
    engine.dispose();
  }
  return out;
}

/** row GS: 合照模式 off first (the solo path's VIDEO graph and the engine warm), then turned on */
const GS_SOLO_MS = 2000;
const GS_GROUP_MS = 6000;

/**
 * GS (camera per-person spec §12.4, PGS): the front camera's move between its paths when 合照模式 is turned on
 * mid-stream (§6.6, K22), GPU then CPU, as row LF runs the loop (selfie_group.y4m with --upright). With the mode off the
 * solo path's VIDEO call runs (the camera bundle at LIVE_DETECT_FACES) for 2 s, so the move is measured on a running
 * graph and a warm engine, not on the tracker's first inferences; then the mode is turned on, on the same loop, for 6 s.
 * For each livePath change, the longest frame within ±1 s (report.ts gsRows). (Until K22 the move was K18's, on the
 * second face; measured 2026-10-22 as two loops, the second starting on the solo path.)
 */
export async function rowGS(): Promise<MultiRow[]> {
  const engine = createEngine(document.createElement('canvas'), { mirror: true, matchGpupixel: false, showLandmarks: false });
  const camera = appCamera();
  const out: MultiRow[] = [];
  try {
    await engine.ready;
    await camera.start('user');
    if (camera.snapshot.state !== 'live') throw new Error(`GS: camera ${camera.snapshot.state} (${camera.snapshot.error ?? '—'})`);
    for (const d of ['GPU', 'CPU'] as const) {
      let t: Tracker;
      try {
        t = await liveTracker(d);
      } catch (e) {
        out.push({ row: 'GS', config: `${d} front (unavailable)`, values: { error: errText(e) } });
        continue;
      }
      try {
        resetAutoTierSession();
        t.warm('VIDEO', LIVE_DETECTOR.user);
        const r = await runLoop(camera, engine, t, editedSession(), [
          { group: false, ms: GS_SOLO_MS },
          { group: true, ms: GS_GROUP_MS },
        ]);
        out.push(...gsRows(`${ran(d, t)} front ${camera.video.videoWidth}x${camera.video.videoHeight}`, r.samples));
      } finally {
        t.close();
      }
    }
  } finally {
    camera.stop();
    engine.dispose();
  }
  return out;
}

/** row WB: the front camera before each flip (its solo path running, as in the app), the back camera after the first frame */
const WB_FRONT_MS = 2000;
const WB_BACK_MS = 1000;
/** row WB: a back-camera frame not drawn this long after `live` is none (first_ms n/a) */
const WB_FIRST_TIMEOUT_MS = 5000;

/** the first timed call that started at or after `from`, waiting up to `ms` for it */
async function firstFrom(calls: readonly Timed[], from: number, ms: number): Promise<Timed | null> {
  const end = performance.now() + ms;
  for (;;) {
    const c = calls.find((x) => x.at >= from);
    if (c || performance.now() > end) return c ?? null;
    await sleep(20);
  }
}

/**
 * WB (camera per-person spec §12.4, PWB): the first back-camera frame after a flip, GPU then CPU, each on a fresh
 * tracker under one live loop, as the app flips: the front camera's solo path runs, then `flip()` and right after it
 * the warm-up of liveRoute (Camera.tsx's: with 合照模式 off, the default, warm('VIDEO', 'photo'); on, warm('IMAGE',
 * 'photo'); on the GPU the page's first full-range graph compiles there, warm_ms), then the time from `live` to the end
 * of the first rendered frame (first_ms; that frame's detection: first_detect_ms). A cold flip, back to the front camera, then a warm one. The GPU's cold flip is the page's first
 * full-range work only on a fresh page with WB run alone (page_cold says so).
 */
export async function rowWB(): Promise<MultiRow[]> {
  const engine = createEngine(document.createElement('canvas'), { mirror: true, matchGpupixel: false, showLandmarks: false });
  const camera = appCamera();
  const video = camera.video;
  const out: MultiRow[] = [];
  try {
    await engine.ready;
    for (const d of ['GPU', 'CPU'] as const) {
      let t: Tracker;
      try {
        t = await liveTracker(d);
      } catch (e) {
        out.push({ row: 'WB', config: `${d} (unavailable)`, values: { error: errText(e) } });
        continue;
      }
      const calls: Timed[] = [];
      const renders: Timed[] = [];
      const flips: WbFlip[] = [];
      let loop: LiveLoop | null = null;
      try {
        await camera.start('user');
        if (camera.snapshot.state !== 'live') throw new Error(`WB: camera ${camera.snapshot.state} (${camera.snapshot.error ?? '—'})`);
        resetAutoTierSession();
        t.warm('VIDEO', LIVE_DETECTOR.user);
        loop = startLiveLoop({
          camera,
          engine: timedEngine(engine, renders),
          tracker: timedTracker(t, calls),
          persons: new LivePersons(),
          getPhoto: () => NEUTRAL_PHOTO,
          getPrefs: () => LIVE_PREFS,
          getFrame: () => normalizedCropRect(video.videoWidth, video.videoHeight, APP_RATIO),
        });
        await sleep(WB_FRONT_MS);
        for (const kind of ['cold', 'warm'] as const) {
          const pageCold = !fullRangeRan;
          let liveAt: number | null = null;
          const unsubscribe = camera.subscribe((s) => {
            if (liveAt === null && s.state === 'live' && s.facing === 'environment') liveAt = performance.now();
          });
          const flipped = camera.flip();
          const w0 = performance.now();
          const route = liveRoute('environment', LIVE_PREFS.groupMode);
          t.warm(route.mode, route.detector);
          const warmMs = performance.now() - w0;
          if (t.photoDetector === 'full-range') fullRangeRan = true;
          await flipped;
          unsubscribe();
          const at = liveAt;
          const first = at === null ? null : await firstFrom(renders, at, WB_FIRST_TIMEOUT_MS);
          const detect = at === null ? undefined : calls.find((c) => c.at >= at);
          flips.push({ kind, warmMs, firstMs: first && at !== null ? first.at + first.ms - at : null, detectMs: detect?.ms ?? null, pageCold });
          await sleep(WB_BACK_MS);
          await camera.flip();
          t.warm('VIDEO', LIVE_DETECTOR.user);
          await sleep(WB_FRONT_MS);
        }
      } finally {
        loop?.stop();
        t.close();
      }
      out.push(...wbRows(ran(d, t), flips));
    }
  } finally {
    camera.stop();
    engine.dispose();
  }
  return out;
}

/** row JG: each run after a warm-up of its three graphs; jitter over 2 s, lag over 4 s (S rows J, J2) */
const JG_WARM_MS = 1500;
const JG_JITTER_MS = 2000;
const JG_LAG_MS = 4000;

interface Series {
  pts: Float32Array[];
  t: number[];
}

/** the pts111 centroid (UV) */
function centroid(p: Float32Array): [number, number] {
  let x = 0;
  let y = 0;
  for (let i = 0; i < 111; i++) {
    x += p[i * 2] / 111;
    y += p[i * 2 + 1] / 111;
  }
  return [x, y];
}

/**
 * One JG measurement: on every video frame MediaPipe's own smoothing (VIDEO numFaces 1, `mp`), its raw counterpart
 * (VIDEO numFaces 3, `rawV`: row J2's reference), and the group path's IMAGE call (detectView at EDIT_DETECT_FACES on
 * the back camera's detector) on `kind`'s view of the whole frame, mapped to stream UV: raw, and through the app smoother
 * (a fresh LandmarkSmoother, as FaceTracks gives each track). 'tile': the tile of layoutViews holding the followed face
 * whole (tileFor, nearest centre), found from the face's last box (the whole view finds it first, and while no tile
 * holds it, measuring nothing). Every series follows the face MediaPipe's numFaces-1 graph picked (the nearest pts111
 * centroid) and is recorded on the same frames.
 */
async function groupJitterLag(
  video: HTMLVideoElement,
  tr: { mp: Tracker; rawV: Tracker; group: Tracker },
  kind: 'whole' | 'tile',
  ms: number,
): Promise<{ mediapipe: Series; rawVideo: Series; raw: Series; app: Series; tiles: Set<string> }> {
  const w = video.videoWidth;
  const h = video.videoHeight;
  const detector: FaceDetectorKind = tr.group.photoDetector === 'full-range' ? 'photo' : 'camera';
  const lay = layoutViews(w, h, { x: 0, y: 0, w, h }, 'environment', detector);
  const copies = new Map<string, { canvas: OffscreenCanvas; ctx: OffscreenCanvasRenderingContext2D }>();
  const copyOf = (v: LiveView): OffscreenCanvas => {
    const key = `${v.copy.w}x${v.copy.h}`;
    let c = copies.get(key);
    if (!c) {
      const canvas = new OffscreenCanvas(v.copy.w, v.copy.h);
      const ctx = canvas.getContext('2d', { alpha: false });
      if (!ctx) throw new Error('JG: no OffscreenCanvas 2D context for the view copies');
      c = { canvas, ctx };
      copies.set(key, c);
    }
    c.ctx.drawImage(video, v.rect.x, v.rect.y, v.rect.w, v.rect.h, 0, 0, v.copy.w, v.copy.h);
    return c.canvas;
  };
  const smoother = new LandmarkSmoother();
  const out = { mediapipe: { pts: [], t: [] }, rawVideo: { pts: [], t: [] }, raw: { pts: [], t: [] }, app: { pts: [], t: [] }, tiles: new Set<string>() } as {
    mediapipe: Series;
    rawVideo: Series;
    raw: Series;
    app: Series;
    tiles: Set<string>;
  };
  let box: Rect | null = null;
  const frame = (now: number, measure: boolean) => {
    const m = largestFace(tr.mp.detectVideo(video, now, { maxFaces: 1 }), w, h);
    const rv = tr.rawV.detectVideo(video, now, { maxFaces: 3 });
    const tile = kind === 'tile' && box ? tileFor(box, lay) : null;
    const view = tile ?? lay.whole;
    if (!m) return;
    const lms = tr.group.detectView(copyOf(view), { maxFaces: EDIT_DETECT_FACES, detector });
    if (!lms?.length) return;
    const [mx, my] = centroid(m);
    const near = (ls: readonly Landmarks478[]) =>
      ls.reduce((a, l) => {
        const [ax, ay] = centroid(adapt(a, w, h).pts111);
        const [lx, ly] = centroid(adapt(l, w, h).pts111);
        return Math.hypot(lx - mx, ly - my) < Math.hypot(ax - mx, ay - my) ? l : a;
      });
    const g = near(lms.map((l) => mapLandmarks(l, view.rect, w, h)));
    const gf = adapt(g, w, h);
    box = ovalBox(gf);
    if (!measure || (kind === 'tile' && !tile) || !rv?.length) return;
    const smoothed = adapt({ points: smoother.apply(g.points, w, h, now) }, w, h).pts111;
    const add = (s: Series, p: Float32Array) => {
      s.pts.push(p);
      s.t.push(now);
    };
    add(out.mediapipe, m);
    add(out.rawVideo, adapt(near(rv), w, h).pts111);
    add(out.raw, gf.pts111);
    add(out.app, smoothed);
    out.tiles.add(view.id);
  };
  // a throw inside the frame callback would end eachFrame's chain: a failed inference skips the frame
  const safe = (measure: boolean) => (now: number) => {
    try {
      frame(now, measure);
    } catch {
      /* skipped */
    }
  };
  await eachFrame(video, JG_WARM_MS, safe(false));
  await eachFrame(video, ms, safe(true));
  return out;
}

/**
 * JG (camera per-person spec §12.4, PJ1G): jitter (2 s; a still clip, tile_face.y4m) and lag (4 s; a pan clip,
 * group_pan.y4m) of the group path's IMAGE landmarks through the app smoother, refreshed by the whole view and by a tile
 * holding the face, beside MediaPipe's own numFaces-1 VIDEO smoothing on the same frames and the same face (as rows J
 * and J2, jitterLag), GPU then CPU, three trackers per delegate (MediaPipe's, its raw reference, the group path's).
 * PJ1G per refresh kind (report.ts jgRows): a still clip judges the jitter only. A followed face no tile holds whole (one
 * wider than the tiles' overlap that straddles it, or wider than a tile) gives the tile kind no frame (n/a), as on
 * group_noise.y4m whenever MediaPipe follows its face A (225 px; which of the three faces it follows varies by run),
 * which no 480 px tile holds. tile_face.y4m (gen-y4m.mjs TILE_FACE) holds its one face in a tile for either detector.
 */
export async function rowJG(): Promise<MultiRow[]> {
  const cam = await cameraVideo();
  const runs: JgRun[] = [];
  try {
    const aspect = cam.video.videoWidth / cam.video.videoHeight;
    const cx = (s: Series) => s.pts.map((p) => centroid(p)[0]);
    for (const d of ['GPU', 'CPU'] as const) {
      const made: Tracker[] = [];
      try {
        for (let i = 0; i < 3; i++) made.push(await liveTracker(d));
      } catch {
        made.forEach((t) => t.close());
        runs.push({ config: `${d} (unavailable)`, rms: null, rms1: null, lag: null, lag1: null, frames: 0, lagSamples: 0 });
        continue;
      }
      const [mp, rawV, group] = made;
      try {
        if (group.photoDetector === 'full-range') fullRangeRan = true;
        for (const kind of ['whole', 'tile'] as const) {
          const jit = await groupJitterLag(cam.video, { mp, rawV, group }, kind, JG_JITTER_MS);
          const lag = await groupJitterLag(cam.video, { mp, rawV, group }, kind, JG_LAG_MS);
          const app = lagMs(cx(lag.raw), cx(lag.app), lag.app.t);
          const own = lagMs(cx(lag.rawVideo), cx(lag.mediapipe), lag.mediapipe.t);
          const tiles = kind === 'tile' && (jit.tiles.size || lag.tiles.size) ? ` ${[...new Set([...jit.tiles, ...lag.tiles])].join('/')}` : '';
          const frames = jit.app.pts.length;
          runs.push({
            config: `${ran(d, group)} ${kind}${tiles}`,
            rms: frames >= 2 ? jitterRms(jit.app.pts, aspect) : null,
            rms1: frames >= 2 ? jitterRms(jit.mediapipe.pts, aspect) : null,
            lag: app.lag,
            lag1: own.lag,
            frames,
            lagSamples: app.n,
          });
        }
      } finally {
        made.forEach((t) => t.close());
      }
    }
  } finally {
    cam.stop();
  }
  return jgRows(runs);
}

addRunner('L', () => rowL());
addRunner('J', () => rowJ());
addRunner('J2', () => rowJ2());
addRunner('LF', () => rowLF(true));
addRunner('LFC', () => rowLF(false));
addRunner('GS', () => rowGS());
addRunner('WB', () => rowWB());
addRunner('JG', () => rowJG());
