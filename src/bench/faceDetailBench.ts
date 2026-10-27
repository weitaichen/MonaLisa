// Step-5 bench rows (face-detail spec §6.2): reshape with every new warp at ±max, P1 with every makeup part, and the
// PMAKEUP compile time, at N = 1, 3, 6 and 10 (the face cap) faces and 1080 / 2048. Timings use a gl.finish() fence;
// medians of 20 frames.
import { MAX_RENDER_FACES } from '../config/limits';
import { defaultPhoto, emptyShades, neutralPerson } from '../edit/state';
import { createEngine } from '../engine/index';
import { MAKEUP_PARAM, paramsInGroup, SPLIT_IDS } from '../engine/params';
import { scaleFace } from '../engine/passes/syntheticFaces';
import type { Engine, Face, MakeupPart, PersonParamId, PersonParams, RenderFace, RenderInput } from '../types';

/** every 美型 item at its extreme (bidirectional ones at `end`); the six split items at the opposite extreme on the right */
export function warpBenchPerson(end: 0 | 1): PersonParams {
  const p = neutralPerson();
  const values = { ...p.values };
  for (const d of paramsInGroup('shape')) values[d.id as PersonParamId] = d.bidirectional ? end : 1;
  const right = Object.fromEntries(SPLIT_IDS.map((id) => [id, 0]));
  return { ...p, values, right };
}

/** every 美妝 part at 100, with a shade where the part has shades */
export function makeupBenchPerson(): PersonParams {
  const p = neutralPerson();
  const values = { ...p.values };
  for (const part of Object.keys(MAKEUP_PARAM) as MakeupPart[]) values[MAKEUP_PARAM[part]] = 1;
  return { ...p, values, shades: { ...emptyShades(), lip: 'rose', blush: 'peach', brow: 'black', eyeshadow: 'earth', liner: 'black', lens: 'blue' } };
}

/** the face counts the rows run at: 1, 3, 6 and the face cap (MAX_RENDER_FACES = 10, step-1 spec §6.7) */
export const BENCH_FACE_COUNTS: readonly number[] = [1, 3, 6, MAX_RENDER_FACES];

/** n copies of `face`, shrunk into a 1 × 1, 3 × 1, 3 × 2 … 3 × 4 grid of cells so they never overlap */
export function benchFaces(face: Face, n: number, person: PersonParams): RenderFace[] {
  if (n <= 1) return [{ face, weight: 1, person, protect: null }];
  const cols = 3;
  const rows = Math.ceil(n / cols);
  const xs = Array.from(face.oval).filter((_, i) => i % 2 === 0);
  const ys = Array.from(face.oval).filter((_, i) => i % 2 === 1);
  const fc: [number, number] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const s = 0.9 / Math.max(cols, rows) / span;
  return Array.from({ length: n }, (_, k) => {
    const t: [number, number] = [((k % cols) + 0.5) / cols, (Math.floor(k / cols) + 0.5) / rows];
    // scaleFace scales about c; choose c so the face centre lands on the cell centre t
    const c: [number, number] = [(t[0] - s * fc[0]) / (1 - s), (t[1] - s * fc[1]) / (1 - s)];
    return { face: scaleFace(face, s, c), weight: 1, person, protect: null };
  });
}

export function medianMs(xs: readonly number[]): number {
  const a = [...xs].sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** rows 1–3 of S5 §6.2 on one photo and its face; resolves with one text line per measurement */
export async function runFaceDetailRows(engine: Engine, bitmap: ImageBitmap, face: Face): Promise<string[]> {
  const gl = engine.canvas.getContext('webgl2');
  if (!gl) throw new Error('no webgl2');
  const photo = defaultPhoto();
  const input = (source: ImageBitmap, faces: RenderFace[]): RenderInput => ({ source, width: source.width, height: source.height, faces, globalSkin: null, photo });
  const time = (e: Engine, g: WebGL2RenderingContext, inp: RenderInput, n = 20) => {
    e.render(inp, { still: true });
    g.finish();
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const t = performance.now();
      e.render(inp, { still: true });
      g.finish();
      xs.push(performance.now() - t);
    }
    return medianMs(xs);
  };
  const rows: string[] = [];
  for (const edge of [1080, 2048]) {
    const k = edge / Math.max(bitmap.width, bitmap.height);
    const src = await createImageBitmap(bitmap, { resizeWidth: Math.round(bitmap.width * k), resizeHeight: Math.round(bitmap.height * k), resizeQuality: 'high' });
    for (const n of BENCH_FACE_COUNTS) {
      const base = time(engine, gl, input(src, benchFaces(face, n, neutralPerson())));
      for (const end of [1, 0] as const) {
        const ms = time(engine, gl, input(src, benchFaces(face, n, warpBenchPerson(end)))) - base;
        rows.push(`step5 reshape ${end ? '+' : '−'}max N=${n} @${edge}: ${ms.toFixed(2)} ms`);
      }
      const mk = time(engine, gl, input(src, benchFaces(face, n, makeupBenchPerson()))) - base;
      rows.push(`step5 P1 makeup all parts N=${n} @${edge}: ${mk.toFixed(2)} ms`);
    }
    src.close();
  }
  // PMAKEUP compiles lazily on the first procedural frame: first frame minus the warm median, on a fresh engine
  const c2 = document.createElement('canvas');
  const e2 = createEngine(c2, { mirror: false });
  await e2.ready;
  const g2 = c2.getContext('webgl2');
  if (g2) {
    const inp = input(bitmap, benchFaces(face, 1, makeupBenchPerson()));
    const t0 = performance.now();
    e2.render(inp, { still: true });
    g2.finish();
    const first = performance.now() - t0;
    rows.push(`step5 PMAKEUP compile (first frame − warm median): ${(first - time(e2, g2, inp, 5)).toFixed(1)} ms`);
  }
  e2.dispose();
  return rows;
}
