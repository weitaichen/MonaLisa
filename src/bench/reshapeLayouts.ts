// Row R's face layouts (step-1 spec §6.2, §6.7): where the reshape microbench puts its faces on the square bench frame
// (iso = UV). Pure, so the layouts are unit-tested (reshapeLayouts.test.ts); bench/multiFace.ts rowR draws them.
import { MAX_RENDER_FACES } from '../config/limits';
import { ovalBox } from '../engine/passes/faceCap';
import type { Face } from '../types';

export interface BenchLayout {
  /** face centres (UV) */
  centres: [number, number][];
  /** the scale of the fixture face (placeBenchFace) */
  k: number;
}

/** `face` scaled by k about its oval-box centre and moved to (cx, cy), frontal (yaw 0) */
export function placeBenchFace(face: Face, cx: number, cy: number, k: number): Face {
  const b = ovalBox(face);
  const c = [b.x + b.w / 2, b.y + b.h / 2];
  const m = (a: Float32Array) => a.map((v, i) => (i % 2 === 0 ? cx + (v - c[0]) * k : cy + (v - c[1]) * k));
  return { pts111: m(face.pts111), ext: m(face.ext), oval: m(face.oval), yaw: 0, iris: m(face.iris), lids: m(face.lids) };
}

/**
 * N = 1…MAX_RENDER_FACES spread across the frame (k = 0.6 / N), then rows at 1.2 FW and 2-row grids at 1.3 FW of 6, 8
 * and MAX_RENDER_FACES faces, each centred on the frame. `fw1` is the fixture face's faceWidthIso at scale 1. The
 * clustered layouts use FW 0.1 (row 6 and the 2 × 3 grid are the 2026-10-12 rows', 8 the §6.6 rows'), except a row too
 * long for the frame at FW 0.1: it takes the FW that spans 0.95 of it (10 faces: FW 0.081), named in the layout.
 */
export function reshapeBenchLayouts(fw1: number): Record<string, BenchLayout> {
  const layouts: Record<string, BenchLayout> = {};
  for (let n = 1; n <= MAX_RENDER_FACES; n++) layouts[`spread ${n}`] = { centres: Array.from({ length: n }, (_, i): [number, number] => [(i + 0.5) / n, 0.5]), k: 0.6 / n };
  for (const n of [...new Set([6, 8, MAX_RENDER_FACES])]) {
    const fw = Math.min(0.1, 0.95 / (1.2 * (n - 1) + 1));
    const step = 0.12 * (fw / 0.1);
    layouts[`row ${n} @1.2FW${fw < 0.1 ? ` (FW ${fw.toFixed(3)})` : ''}`] = {
      centres: Array.from({ length: n }, (_, i): [number, number] => [0.5 + (i - (n - 1) / 2) * step, 0.5]),
      k: fw / fw1,
    };
    const cols = n / 2;
    layouts[`grid 2×${cols} @1.3FW`] = {
      centres: Array.from({ length: n }, (_, i): [number, number] => [0.5 + ((i % cols) - (cols - 1) / 2) * 0.13, 0.435 + Math.floor(i / cols) * 0.13]),
      k: 0.1 / fw1,
    };
  }
  return layouts;
}
