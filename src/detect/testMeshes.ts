// Test doubles: the recorded sample face as a photo shows it, at its real aspect (never imported by app code).
import { readFileSync } from 'node:fs';
import { FACE_OVAL } from '../tracking/faceOval';
import type { Landmarks478 } from '../types';

const sample = JSON.parse(readFileSync(new URL('../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as {
  width: number;
  height: number;
  points: number[];
};

/** the sample's points in its own pixels (it was taken in a 1000 × 1500 photo), z scaled as x is (MediaPipe's z) */
const pixels = Array.from({ length: 478 }, (_, i) => [sample.points[i * 3] * sample.width, sample.points[i * 3 + 1] * sample.height, sample.points[i * 3 + 2] * sample.width]);

/** the bounds of the FACE_OVAL of `pts`: centre and size */
function ovalBounds(pts: readonly number[][]): { cx: number; cy: number; w: number; h: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const i of FACE_OVAL) {
    x0 = Math.min(x0, pts[i][0]);
    x1 = Math.max(x1, pts[i][0]);
    y0 = Math.min(y0, pts[i][1]);
    y1 = Math.max(y1, pts[i][1]);
  }
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}
const front = ovalBounds(pixels);

/**
 * MIRROR[i]: a mirrored face's landmark i is the unmirrored face's landmark MIRROR[i], mirrored. MediaPipe meshes a
 * mirrored face with its one topology, so its 33 (an outer eye corner) is again the image-left one: the unmirrored
 * face's 263. The pairs are those of MediaPipe's canonical face model (face_landmarker.task,
 * geometry_pipeline_metadata_landmarks: vertex i mirrored, x → −x, is exactly vertex MIRROR[i]): its 28 midline
 * vertices are their own mirrors, and the other vertices under 248, in order, pair with 248, 249, … 467. The irises pair
 * centre with centre (468, 473), the image-right point of one with the image-left point of the other (469–476, 471–474),
 * top with top and bottom with bottom (470–475, 472–477). The sample mirrored so lies within 0.04 eye spans of the
 * detector's landmarks on the flipped photo (landmarks_sample_face.json `mirrored`, testMeshes.test.ts).
 */
const MIDLINE = new Set([0, 1, 2, 4, 5, 6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 94, 151, 152, 164, 168, 175, 195, 197, 199, 200]);
export const MIRROR: readonly number[] = (() => {
  const m = Array.from({ length: 478 }, (_, i) => i);
  let k = 248;
  for (let i = 0; i < 248; i++) {
    if (MIDLINE.has(i)) continue;
    m[i] = k;
    m[k++] = i;
  }
  for (const [a, b] of [
    [468, 473],
    [469, 476],
    [470, 475],
    [471, 474],
    [472, 477],
  ]) {
    m[a] = b;
    m[b] = a;
  }
  return m;
})();

/**
 * the yaw the sample was recorded at, in degrees (positive: the nose to the image right): its outer eye corners' line
 * (33 → 263) turned out of the image plane, about −19° (it looks a little to the image left)
 */
const SAMPLE_YAW = (Math.atan2(pixels[263][2] - pixels[33][2], pixels[263][0] - pixels[33][0]) * 180) / Math.PI;

/**
 * the sample's points turned to `yaw` degrees from a front view about the vertical axis through its FACE_OVAL's 3D
 * centroid (positive: the nose swings to the image right), rigidly, as the mesh MediaPipe fits to that head turned that
 * far: the recorded points when no yaw is asked
 */
function turned(yaw: number | undefined): number[][] {
  if (yaw === undefined) return pixels;
  const t = ((yaw - SAMPLE_YAW) * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const px = FACE_OVAL.reduce((a, i) => a + pixels[i][0], 0) / FACE_OVAL.length;
  const pz = FACE_OVAL.reduce((a, i) => a + pixels[i][2], 0) / FACE_OVAL.length;
  return pixels.map(([x, y, z]) => [px + (x - px) * c - (z - pz) * s, y, pz + (x - px) * s + (z - pz) * c]);
}

/**
 * The recorded sample face (landmarks_sample_face.json: a real face, turned about 19° to the image left, SAMPLE_YAW) in
 * a width × height photo, as MediaPipe gives it (UV): turned to `yaw` degrees from a front view first when asked (a 3/4
 * view at 30–45°), then its FACE_OVAL's bounds centred at (cx, cy), upright, at the scale that makes the recorded oval w
 * wide (a fraction of the photo width; one head keeps its size whatever its yaw) at its real aspect; mirrored left to
 * right when asked, as MediaPipe meshes the mirrored face (x negated and the left and right landmarks swapped, MIRROR:
 * its 33 is again the image-left outer eye corner), then turned `tilt` degrees (clockwise on screen) about that centre.
 */
export function sampleFaceAt(cx: number, cy: number, w: number, o: { tilt?: number; mirror?: boolean; yaw?: number; width?: number; height?: number } = {}): Landmarks478 {
  const width = o.width ?? 1000;
  const height = o.height ?? 1000;
  const pts = turned(o.yaw);
  const at = ovalBounds(pts);
  const k = (w * width) / front.w;
  const t = ((o.tilt ?? 0) * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const out = new Float32Array(478 * 3);
  for (let i = 0; i < 478; i++) {
    const p = pts[o.mirror ? MIRROR[i] : i];
    const dx = (p[0] - at.cx) * k * (o.mirror ? -1 : 1);
    const dy = (p[1] - at.cy) * k;
    out[i * 3] = cx + (dx * c - dy * s) / width;
    out[i * 3 + 1] = cy + (dx * s + dy * c) / height;
    out[i * 3 + 2] = (p[2] * k) / width;
  }
  return { points: out };
}

/**
 * the other detector's mesh of the same head: the landmarks `l` of a width × height photo scaled by `scale` and turned
 * `tilt` degrees about the nose tip (1), then moved by (dx, dy) eye spans (the 3D distance of 33 and 263); z scales too
 */
export function retake(l: Landmarks478, o: { scale?: number; tilt?: number; dx?: number; dy?: number }, width = 1000, height = 1000): Landmarks478 {
  const p = l.points;
  const k = o.scale ?? 1;
  const t = ((o.tilt ?? 0) * Math.PI) / 180;
  const span = Math.hypot((p[33 * 3] - p[263 * 3]) * width, (p[33 * 3 + 1] - p[263 * 3 + 1]) * height, (p[33 * 3 + 2] - p[263 * 3 + 2]) * width);
  const [nx, ny] = [p[3] * width, p[4] * height];
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length / 3; i++) {
    const x = (p[i * 3] * width - nx) * k;
    const y = (p[i * 3 + 1] * height - ny) * k;
    out[i * 3] = (nx + x * Math.cos(t) - y * Math.sin(t) + (o.dx ?? 0) * span) / width;
    out[i * 3 + 1] = (ny + x * Math.sin(t) + y * Math.cos(t) + (o.dy ?? 0) * span) / height;
    out[i * 3 + 2] = p[i * 3 + 2] * k;
  }
  return { points: out };
}

/** `p` inside the ring (x, y interleaved), by its winding number (the tests' own check) */
export function ringHolds(ring: Float32Array, p: readonly [number, number]): boolean {
  const n = ring.length >> 1;
  let turn = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = ring[i * 2] - p[0];
    const ay = ring[i * 2 + 1] - p[1];
    const bx = ring[j * 2] - p[0];
    const by = ring[j * 2 + 1] - p[1];
    turn += Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
  }
  return Math.abs(turn) > Math.PI;
}
