// Bench 「多臉」 section (S §6.2 rows). Rows D (multi-face detectImage), B (multi-pose body detection) and GL (limits +
// probes) land in Phase 0; later tasks add R, RC, RP (Task 17), F (Task 19), BF (Task 20), PE, M (Task 23) and L, J,
// J2 (Task 25). Results join 複製結果 through formatMultiRows. /bench.html?fixtures=1 (dev server) loads the group
// fixtures by URL so scripts/bench-multiface.mjs can drive it; on a phone the rows take a picked photo.
import { FaceLandmarker, FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { ENGINE_PATHS, loadEngineAssets, loadPoseModel } from '../engine/assets';
import { probeFaceTable, probeR16FArray, readGlLimits } from '../engine/glProbe';
import { downscaleMask } from '../tracking/bodyTracker';
import { formatMultiRows, median, type MultiRow } from './report';

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

/** D: detectImage at numFaces 1/4/6/8 on GPU and CPU, decodes 2048 and 1440: first call, median of 5, faces, order */
export async function rowD(photo: Blob): Promise<MultiRow[]> {
  const out: MultiRow[] = [];
  const { modelBuffer } = await loadEngineAssets();
  const fileset = await FilesetResolver.forVisionTasks(ENGINE_PATHS.wasmBase);
  for (const delegate of ['GPU', 'CPU'] as const) {
    const canvas = new OffscreenCanvas(1, 1);
    const lm = await FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: modelBuffer, delegate },
      runningMode: 'IMAGE',
      numFaces: 1,
      canvas: delegate === 'GPU' ? canvas : undefined,
    });
    const orders: Record<number, string[]> = {};
    for (const edge of [2048, 1440]) {
      const bmp = await decode(photo, edge);
      for (const n of [1, 4, 6, 8]) {
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
        if (n === 8) orders[edge] = centres;
        out.push({
          row: 'D',
          config: `${delegate} ${edge} n${n}`,
          // decode: the bitmap actually detected on (a photo smaller than the decode edge is not upscaled)
          values: { decode: `${bmp.width}x${bmp.height}`, first_ms: round(firstMs), median_ms: round(median(times)), faces: first.length, centres: centres.join(' ') },
        });
      }
      bmp.close();
    }
    out.push({ row: 'D', config: `${delegate} order 2048 vs 1440 (n8)`, values: { same: String(orders[2048]?.join() === orders[1440]?.join()) } });
    lm.close();
  }
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
  B: (p) => rowB(p.people),
  GL: () => rowGL(),
};

/** Register a row runner (later tasks: R, F, BF, PE, L, J, J2). */
export function addRunner(id: string, run: (photos: { faces: Blob; people: Blob }) => Promise<MultiRow[]> | MultiRow[]): void {
  RUNNERS[id] = run;
}

/** rows that take no photo */
const NO_PHOTO = new Set(['GL', 'R']);

async function fixtures(): Promise<{ faces: Blob; people: Blob }> {
  const get = async (u: string) => (await fetch(u)).blob();
  return { faces: await get('/tests/fixtures/group_faces.png'), people: await get('/tests/fixtures/group_people.jpg') };
}

export function mountMultiFace(parent: HTMLElement): { rows(): readonly MultiRow[] } {
  const section = document.createElement('section');
  // own classes (styled in bench/main.ts STYLE like the 美體偵測 box): tests/harness/b3/bench.mjs locates '.body-bench'
  // and tests/harness/t8/run-bench.mjs '.gate .note', and this section sits in .gate, so reusing either breaks them
  section.className = 'multi-bench';
  section.innerHTML = '<h3>多臉</h3><p class="multi-note">D：多臉偵測（選 group_faces.png）　B：多人美體（選 group_people.jpg）　GL：GPU 上限　R：多臉美型 GPU 時間（需開發伺服器的 /tests/fixtures）</p>';
  const note = document.createElement('pre');
  note.className = 'multi-note';
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
      // GL and R measure the GPU alone: no photo
      const photo = NO_PHOTO.has(id) ? null : await pick('image/*');
      const blob = photo ?? new Blob();
      const got = await RUNNERS[id]({ faces: blob, people: blob });
      rows.push(...got);
      note.textContent = formatMultiRows(rows);
    } catch (e) {
      note.textContent = `${id}: ${e instanceof Error ? e.message : String(e)}`;
    }
  };
  for (const id of ['D', 'B', 'GL', 'R']) {
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
 * R: the reshape microbench (S §6.2): every 美型 item at maximum with the caps on, N = 1…6 spread across the frame,
 * 6 in a row at 1.2 FW and a 2×3 grid at 1.3 FW, both face-table carriers, at 1080 and 2048: 30 warm-up draws, then
 * 10 batches of 10 draws per 1-px readPixels, the median batch / 10 minus the N = 0 baseline. RC: compile + link (the
 * first draw). RP (GPU vs CPU pin) is tests/e2e/pages/reshape.ts, opened on the device.
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
  /** the fixture face scaled by k about its oval-box centre, moved to (cx, cy), frontal */
  const at = (cx: number, cy: number, k: number) => {
    const b = ovalBox(base);
    const c = [b.x + b.w / 2, b.y + b.h / 2];
    const m = (a: Float32Array) => a.map((v, i) => (i % 2 === 0 ? cx + (v - c[0]) * k : cy + (v - c[1]) * k));
    return { pts111: m(base.pts111), ext: m(base.ext), oval: m(base.oval), yaw: 0 };
  };
  // the clustered layouts at FW 0.1 (the bench frame is square: iso = UV), so their spacing is what their names say
  const kClustered = 0.1 / faceWidthIso(base, 1);
  const layouts: Record<string, { centres: [number, number][]; k: number }> = {};
  for (let n = 1; n <= 6; n++) layouts[`spread ${n}`] = { centres: Array.from({ length: n }, (_, i): [number, number] => [(i + 0.5) / n, 0.5]), k: 0.6 / n };
  layouts['row 6 @1.2FW'] = { centres: Array.from({ length: 6 }, (_, i): [number, number] => [0.2 + i * 0.12, 0.5]), k: kClustered };
  layouts['grid 2×3 @1.3FW'] = {
    centres: Array.from({ length: 6 }, (_, i): [number, number] => [0.37 + (i % 3) * 0.13, 0.435 + Math.floor(i / 3) * 0.13]),
    k: kClustered,
  };
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
        const faces = centres.map(([x, y]) => at(x, y, k));
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
