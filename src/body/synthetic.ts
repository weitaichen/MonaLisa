// Synthetic standing figure (pose + person mask + face anchors + a painter) for unit tests and the B1 harness.
// Not used by the app. Proportions follow a generic adult standing pose, arms slightly away from the body.
import type { BodyDetection, Face } from '../types';
import { segDist, type V2 } from './geom';

export interface SyntheticOptions {
  width?: number;
  height?: number;
  /** mask long edge */
  maskEdge?: number;
  /** arms hanging against the torso (no background gap) */
  armsDown?: boolean;
  /** crop: only the upper body is in frame (legs / feet out) */
  halfBody?: boolean;
  /** visibility for every point */
  vis?: number;
}

export interface SyntheticFigure {
  det: BodyDetection;
  face: Face;
  /** person-ness (0..1) at UV, the exact shape the mask was rasterised from */
  inside(u: number, v: number): number;
  /** RGB at UV for a test photo: door frame + stripes + floor background, striped shirt, jeans */
  paint(u: number, v: number, background?: 'room' | 'stripes' | 'checker'): [number, number, number];
  width: number;
  height: number;
}

type P = [number, number];

export function syntheticFigure(opts: SyntheticOptions = {}): SyntheticFigure {
  const W = opts.width ?? 600;
  const H = opts.height ?? 900;
  const A = W / H;
  const vis = opts.vis ?? 0.98;
  const half = opts.halfBody ?? false;
  // UV keypoints (person faces the camera: their left (11) is on the image right). halfBody zooms 2× on the chest.
  const z = (p: P): P => (half ? [0.5 + (p[0] - 0.5) * 2, 0.1 + (p[1] - 0.1) * 2] : p);
  const armsDown = opts.armsDown ?? false;
  const kpUV: Record<number, P> = {
    0: [0.5, 0.125],
    11: [0.585, 0.25],
    12: [0.415, 0.25],
    13: armsDown ? [0.6, 0.39] : [0.655, 0.385],
    14: armsDown ? [0.4, 0.39] : [0.345, 0.385],
    15: armsDown ? [0.605, 0.52] : [0.7, 0.515],
    16: armsDown ? [0.395, 0.52] : [0.3, 0.515],
    17: armsDown ? [0.61, 0.56] : [0.715, 0.555],
    18: armsDown ? [0.39, 0.56] : [0.285, 0.555],
    19: armsDown ? [0.6, 0.565] : [0.705, 0.56],
    20: armsDown ? [0.4, 0.565] : [0.295, 0.56],
    23: [0.545, 0.53],
    24: [0.455, 0.53],
    25: [0.55, 0.715],
    26: [0.45, 0.715],
    27: [0.552, 0.885],
    28: [0.448, 0.885],
    29: [0.552, 0.905],
    30: [0.448, 0.905],
    31: [0.575, 0.915],
    32: [0.425, 0.915],
  };
  const points = new Float32Array(33 * 4);
  for (let i = 0; i < 33; i++) {
    const p = z(kpUV[i] ?? kpUV[0]);
    points[i * 4] = p[0];
    points[i * 4 + 1] = p[1];
    points[i * 4 + 3] = vis;
  }
  // limbs in Q space with radii (Q units)
  const q = (i: number): V2 => {
    const p = z(kpUV[i]);
    return [p[0] * A, p[1]];
  };
  const s = half ? 2 : 1;
  const caps: [V2, V2, number][] = [
    [q(11), q(13), 0.024 * s],
    [q(13), q(15), 0.019 * s],
    [q(12), q(14), 0.024 * s],
    [q(14), q(16), 0.019 * s],
    [q(15), q(19), 0.016 * s],
    [q(16), q(20), 0.016 * s],
    [q(23), q(25), 0.042 * s],
    [q(25), q(27), 0.03 * s],
    [q(24), q(26), 0.042 * s],
    [q(26), q(28), 0.03 * s],
    [q(27), q(31), 0.017 * s],
    [q(28), q(32), 0.017 * s],
  ];
  const sMid: V2 = [(q(11)[0] + q(12)[0]) / 2, (q(11)[1] + q(12)[1]) / 2];
  const hMid: V2 = [(q(23)[0] + q(24)[0]) / 2, (q(23)[1] + q(24)[1]) / 2];
  const torsoLen = hMid[1] - sMid[1];
  const shoulderHalf = (q(11)[0] - q(12)[0]) / 2;
  // torso half-width profile along t (0 shoulders, 1 hips): chest, waist dip at t≈0.6, hips
  const torsoHalf = (t: number): number => {
    const tt = Math.min(t, 1.05);
    return shoulderHalf * (1.12 + 0.08 * tt - 0.32 * Math.exp(-(((tt - 0.6) / 0.22) ** 2)));
  };
  const headC: V2 = [q(0)[0], q(0)[1] - 0.012 * s];
  const headR: V2 = [0.045 * s, 0.06 * s];
  const insideQ = (x: number, y: number): boolean => {
    const t = (y - sMid[1] + 0.02 * s) / torsoLen;
    if (t >= 0 && t <= 1.12 && Math.abs(x - sMid[0]) < torsoHalf(Math.max(0, t - 0.02))) return true;
    // shoulder caps
    if (t > -0.08 && t < 0.15 && segDist([x, y], q(11), q(12)) < 0.035 * s) return true;
    for (const [a, b, r] of caps) if (segDist([x, y], a, b) < r) return true;
    // neck + head
    if (Math.abs(x - headC[0]) < 0.02 * s && y > headC[1] && y < sMid[1]) return true;
    return ((x - headC[0]) / headR[0]) ** 2 + ((y - headC[1]) / headR[1]) ** 2 < 1;
  };
  const inside = (u: number, v: number): number => {
    // 3×3 supersampling for soft edges
    let n = 0;
    const dx = 0.33 / W;
    const dy = 0.33 / H;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (insideQ((u + i * dx) * A, v + j * dy)) n++;
    return n / 9;
  };

  const me = opts.maskEdge ?? 256;
  const mw = A >= 1 ? me : Math.round(me * A);
  const mh = A >= 1 ? Math.round(me / A) : me;
  const data = new Uint8Array(mw * mh);
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) data[y * mw + x] = Math.round(255 * inside((x + 0.5) / mw, (y + 0.5) / mh));

  const ext = new Float32Array(16);
  const top = z([0.5, 0.075]);
  const chin = z([0.5, 0.163]);
  ext.set([top[0], top[1], top[0], top[1] + 0.01, top[0], top[1] + 0.03, top[0], top[1] + 0.04, chin[0], chin[1], chin[0], chin[1] - 0.01, 0.46, 0.12, 0.54, 0.12]);
  const face: Face = { pts111: new Float32Array(222), ext, oval: new Float32Array(72), yaw: 0 };

  const paint = (u: number, v: number, bg: 'room' | 'stripes' | 'checker' = 'room'): [number, number, number] => {
    const m = inside(u, v);
    const back = background(u, v, bg, W, H);
    if (m <= 0) return back;
    const x = u * A;
    let fg: [number, number, number];
    const rel = (v - sMid[1]) / torsoLen;
    if (((x - headC[0]) / headR[0]) ** 2 + ((v - headC[1]) / headR[1]) ** 2 < 1.05 || (v < sMid[1] && Math.abs(x - headC[0]) < 0.022 * s)) {
      fg = [224, 182, 150]; // skin
      if (v < headC[1] - 0.03 * s) fg = [60, 40, 30]; // hair
    } else if (rel < 1.0 && !(segDist([x, v], q(15), q(19)) < 0.017 * s || segDist([x, v], q(16), q(20)) < 0.017 * s)) {
      // shirt with horizontal stripes so width changes are easy to see
      fg = Math.floor(v * H / 14) % 2 ? [200, 60, 70] : [235, 235, 235];
    } else if (v > q(27)[1] - 0.005) {
      fg = [30, 30, 30]; // shoes
    } else if (rel >= 1.0) {
      fg = Math.floor(v * H / 20) % 2 ? [40, 70, 130] : [55, 90, 155]; // jeans
    } else fg = [224, 182, 150];
    return [fg[0] * m + back[0] * (1 - m), fg[1] * m + back[1] * (1 - m), fg[2] * m + back[2] * (1 - m)];
  };

  return { det: { pose: { points }, mask: { width: mw, height: mh, data }, people: 1, width: W, height: H }, face, inside, paint, width: W, height: H };
}

function background(u: number, v: number, kind: 'room' | 'stripes' | 'checker', W: number, H: number): [number, number, number] {
  const x = u * W;
  const y = v * H;
  if (kind === 'stripes') {
    const vs = Math.floor(x / 12) % 2 === 0;
    const hs = Math.floor(y / 12) % 2 === 0;
    return vs !== hs ? [30, 30, 30] : [240, 240, 240];
  }
  if (kind === 'checker') return (Math.floor(x / 24) + Math.floor(y / 24)) % 2 ? [90, 90, 90] : [200, 200, 200];
  // room: wall, two door-frame verticals, thin vertical pin-stripes, baseboard + tiled floor
  if (v > 0.83) {
    const tile = (Math.floor(x / 40) + Math.floor((y - 0.83 * H) / 20)) % 2;
    if (Math.abs(((x + 0.6 * (y - 0.83 * H)) % 40) - 20) < 1.2) return [70, 60, 50]; // diagonal tile seams
    return tile ? [150, 120, 90] : [170, 140, 110];
  }
  if (v > 0.8) return [50, 45, 40]; // baseboard
  for (const fx of [0.2, 0.8]) if (Math.abs(u - fx) * W < 6) return [120, 80, 50]; // door frames
  if (Math.abs((x % 30) - 15) < 0.8) return [190, 190, 200];
  if (Math.abs((y % 60) - 30) < 0.8) return [200, 195, 205];
  return [225, 222, 230];
}
