// B1 visual proofs: apply the body field with the CPU backward sampler and write before | after | grid PNGs.
// Loaded by run.mjs through Vite's SSR module loader (so src/ imports resolve exactly as in the app).
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { PNG } from 'pngjs';
import type { BeautyParams, BodyDetection, BodyField, Face, ParamId } from '../../../src/types';
import { defaultParams, setBodyProtect, setHeightBand, setParam } from '../../../src/engine/params';
import { buildBodyField, fieldMinJacobian } from '../../../src/body/field';
import { measureBody, paramAvailability, type BodyMeasure } from '../../../src/body/measure';
import { warpImage, fieldAt } from '../../../src/body/cpuWarp';
import { syntheticFigure } from '../../../src/body/synthetic';

const OUT = new URL('./out/', import.meta.url);

interface Scene {
  name: string;
  rgba: Uint8Array;
  w: number;
  h: number;
  det: BodyDetection | null;
  face: Face | null;
}

function readPng(path: string): { rgba: Uint8Array; w: number; h: number } {
  const p = PNG.sync.read(readFileSync(path));
  return { rgba: new Uint8Array(p.data), w: p.width, h: p.height };
}

function writePng(name: string, rgba: Uint8Array | Uint8ClampedArray, w: number, h: number): void {
  const p = new PNG({ width: w, height: h });
  p.data.set(rgba);
  writeFileSync(new URL(name, OUT), PNG.sync.write(p));
}

function synthScene(bg: 'room' | 'stripes' | 'checker', opts: Parameters<typeof syntheticFigure>[0] = {}): Scene {
  const f = syntheticFigure(opts);
  const { width: w, height: h } = f;
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const c = f.paint((x + 0.5) / w, (y + 0.5) / h, bg);
      rgba.set([c[0], c[1], c[2], 255], (y * w + x) * 4);
    }
  return { name: `synth_${bg}${opts.armsDown ? '_armsdown' : ''}`, rgba, w, h, det: f.det, face: f.face };
}

/** Grid lines warped by the field, drawn over the warped image (shows the displacement field's shape). */
function gridOverlay(img: Uint8ClampedArray, w: number, h: number, field: BodyField | null, mask?: Uint8ClampedArray): Uint8ClampedArray {
  const step = Math.round(Math.max(w, h) / 48);
  const grid = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) grid[y * w + x] = x % step === 0 || y % step === 0 ? 255 : 0;
  const wg = warpImage(grid, w, h, 1, field);
  const out = new Uint8ClampedArray(img);
  for (let i = 0; i < w * h; i++) {
    const a = wg[i] / 255;
    const inside = mask ? mask[i] / 255 : 0;
    // lime grid, magenta where the (warped) person is
    const c = inside > 0.5 ? [255, 0, 200] : [40, 255, 40];
    for (let k = 0; k < 3; k++) out[i * 4 + k] = out[i * 4 + k] * (1 - 0.8 * a) + c[k] * 0.8 * a;
  }
  return out;
}

function sideBySide(parts: (Uint8Array | Uint8ClampedArray)[], w: number, h: number): { rgba: Uint8Array; w: number } {
  const gap = 6;
  const W = parts.length * w + (parts.length - 1) * gap;
  const rgba = new Uint8Array(W * h * 4).fill(255);
  parts.forEach((p, k) => {
    for (let y = 0; y < h; y++) rgba.set(p.subarray(y * w * 4, (y + 1) * w * 4), (y * W + k * (w + gap)) * 4);
  });
  return { rgba, w: W };
}

/** Max change of field-displacement outside the dilated mask band (UV) — 背景保護 check. */
function farBackgroundMax(field: BodyField | null, m: BodyMeasure | null): number {
  if (!field || !m?.mask) return 0;
  const { width: mw, height: mh, data } = m.mask;
  let mx = 0;
  for (let y = 0; y < field.height; y++)
    for (let x = 0; x < field.width; x++) {
      const u = (x + 0.5) / field.width;
      const v = (y + 0.5) / field.height;
      // far = no person within 15 % of the image height
      let near = false;
      const r = 0.15;
      for (let dy = -r; dy <= r && !near; dy += 0.01)
        for (let dx = -r / m.aspect; dx <= r / m.aspect && !near; dx += 0.01) {
          const uu = u + dx;
          const vv = v + dy;
          if (uu < 0 || vv < 0 || uu >= 1 || vv >= 1) continue;
          if (data[Math.floor(vv * mh) * mw + Math.floor(uu * mw)] > 127) near = true;
        }
      if (!near) {
        const [a, b] = fieldAt(field, u, v);
        mx = Math.max(mx, Math.hypot(a, b));
      }
    }
  return mx;
}

export interface Row {
  scene: string;
  case: string;
  minDet: number;
  maxDispPx: number;
  farBgDispPx: number;
  available: boolean;
  ms: number;
}

type Roi = [number, number, number, number]; // u0, v0, u1, v1
const torsoRoi = (m: BodyMeasure, a: number): Roi | null => {
  if (!m.trunk) return null;
  const t = m.trunk;
  const c = [(t.s[0] + t.h[0]) / 2 / a, (t.s[1] + t.h[1]) / 2];
  const hh = t.len * 0.85;
  return [c[0] - hh / a, c[1] - hh, c[0] + hh / a, c[1] + hh];
};
const headRoi = (m: BodyMeasure, a: number): Roi | null => {
  const s = m.shoulders;
  if (!s) return null;
  const c = [(s.tops[0][0] + s.tops[1][0]) / 2 / a, (s.tops[0][1] + s.tops[1][1]) / 2];
  const hh = s.half * 2.2;
  return [c[0] - hh / a, c[1] - 1.5 * hh, c[0] + hh / a, c[1] + 0.5 * hh];
};
const legsRoi = (m: BodyMeasure, a: number): Roi | null => {
  const t = m.trunk;
  if (!t) return null;
  const c = [t.h[0] / a, t.h[1] + t.len * 0.9];
  const hh = t.len * 1.1;
  return [c[0] - hh / a, c[1] - hh, c[0] + hh / a, c[1] + hh];
};

function crop(img: Uint8Array | Uint8ClampedArray, w: number, h: number, r: Roi, scale: number): { rgba: Uint8Array; w: number; h: number } {
  const x0 = Math.max(0, Math.floor(r[0] * w));
  const y0 = Math.max(0, Math.floor(r[1] * h));
  const x1 = Math.min(w, Math.ceil(r[2] * w));
  const y1 = Math.min(h, Math.ceil(r[3] * h));
  const cw = (x1 - x0) * scale;
  const ch = (y1 - y0) * scale;
  const out = new Uint8Array(cw * ch * 4);
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const sx = x0 + Math.floor(x / scale);
      const sy = y0 + Math.floor(y / scale);
      out.set(img.subarray((sy * w + sx) * 4, (sy * w + sx) * 4 + 4), (y * cw + x) * 4);
    }
  return { rgba: out, w: cw, h: ch };
}

const CASES: { name: string; set: (p: BeautyParams) => BeautyParams; ids?: ParamId[]; roi?: (m: BodyMeasure, a: number) => Roi | null }[] = [
  { name: 'legs', set: (p) => setParam(p, 'body.legs', 1), ids: ['body.legs'] },
  { name: 'slim', roi: torsoRoi, set: (p) => setParam(p, 'body.slim', 1), ids: ['body.slim'] },
  { name: 'waist', roi: torsoRoi, set: (p) => setParam(p, 'body.waist', 1), ids: ['body.waist'] },
  { name: 'whr', roi: torsoRoi, set: (p) => setParam(p, 'body.whr', 1), ids: ['body.whr'] },
  { name: 'hip_plus', roi: torsoRoi, set: (p) => setParam(p, 'body.hip', 1), ids: ['body.hip'] },
  { name: 'hip_minus', roi: torsoRoi, set: (p) => setParam(p, 'body.hip', 0), ids: ['body.hip'] },
  { name: 'legSlim', roi: legsRoi, set: (p) => setParam(p, 'body.legSlim', 1), ids: ['body.legSlim'] },
  { name: 'arms', roi: torsoRoi, set: (p) => setParam(p, 'body.arms', 1), ids: ['body.arms'] },
  { name: 'shoulder', roi: headRoi, set: (p) => setParam(p, 'body.shoulder', 1), ids: ['body.shoulder'] },
  { name: 'neck', roi: headRoi, set: (p) => setParam(p, 'body.neck', 1), ids: ['body.neck'] },
  { name: 'head', roi: headRoi, set: (p) => setParam(p, 'body.head', 1), ids: ['body.head'] },
  { name: 'height_band', set: (p) => setHeightBand(p, { top: 0.55, bottom: 0.85, amount: 1 }) },
  {
    name: 'all_max',
    set: (p) => {
      let q = p;
      for (const id of ['body.legs', 'body.slim', 'body.waist', 'body.whr', 'body.legSlim', 'body.arms', 'body.shoulder', 'body.neck', 'body.head'] as ParamId[])
        q = setParam(q, id, 1);
      return setParam(q, 'body.hip', 1);
    },
  },
  {
    name: 'torso_noprotect',
    roi: torsoRoi,
    set: (p) => setBodyProtect(setParam(setParam(p, 'body.waist', 1), 'body.slim', 1), false),
  },
  {
    name: 'torso_protect',
    roi: torsoRoi,
    set: (p) => setParam(setParam(p, 'body.waist', 1), 'body.slim', 1),
  },
];

export function render(only?: string[]): Row[] {
  mkdirSync(OUT, { recursive: true });
  const scenes: Scene[] = [synthScene('room'), synthScene('stripes'), synthScene('room', { armsDown: true })];
  const fb = new URL('./out/fullbody.png', import.meta.url);
  const poseJson = new URL('../../fixtures/pose_fullbody.json', import.meta.url);
  if (existsSync(fb) && existsSync(poseJson)) scenes.push(fixtureScene('fullbody', fb, poseJson));
  const fb2 = new URL('./out/fullbody_yoga.png', import.meta.url);
  const poseJson2 = new URL('../../fixtures/fullbody_yoga.pose.json', import.meta.url);
  if (existsSync(fb2) && existsSync(poseJson2)) scenes.push(fixtureScene('fullbody_yoga', fb2, poseJson2));

  const rows: Row[] = [];
  for (const sc of scenes) {
    if (only && !only.some((o) => sc.name.includes(o))) continue;
    const m = sc.det ? measureBody(sc.det, sc.face) : null;
    const maskW = sc.det?.mask ? warpMaskToImage(sc.det.mask, sc.w, sc.h) : undefined;
    for (const c of CASES) {
      const p = c.set(defaultParams());
      const t0 = performance.now();
      const field = buildBodyField(m, p, sc.w / sc.h);
      const ms = performance.now() - t0;
      const after = warpImage(sc.rgba, sc.w, sc.h, 4, field);
      const maskAfter = maskW ? warpImage(maskW, sc.w, sc.h, 1, field) : undefined;
      const grid = gridOverlay(after, sc.w, sc.h, field, maskAfter);
      const { rgba, w } = sideBySide([sc.rgba, after, grid], sc.w, sc.h);
      writePng(`${sc.name}__${c.name}.png`, rgba, w, sc.h);
      if (c.roi && m) {
        const r = c.roi(m, sc.w / sc.h);
        if (r) {
          const parts = [sc.rgba, after, grid].map((im) => crop(im, sc.w, sc.h, r, 2));
          const cw = parts[0].w;
          const ch = parts[0].h;
          const sb = sideBySide(parts.map((x) => x.rgba), cw, ch);
          writePng(`${sc.name}__${c.name}__zoom.png`, sb.rgba, sb.w, ch);
        }
      }
      let maxD = 0;
      if (field) for (let i = 0; i < field.data.length; i += 2) maxD = Math.max(maxD, Math.hypot(field.data[i] * sc.w, field.data[i + 1] * sc.h));
      rows.push({
        scene: sc.name,
        case: c.name,
        minDet: field ? +fieldMinJacobian(field).toFixed(3) : 1,
        maxDispPx: +maxD.toFixed(1),
        farBgDispPx: +(farBackgroundMax(field, m) * sc.h).toFixed(2),
        available: (c.ids ?? []).every((id) => paramAvailability(m, id).ok),
        ms: +ms.toFixed(1),
      });
    }
  }
  return rows;
}

function warpMaskToImage(mask: { width: number; height: number; data: Uint8Array }, w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const mx = Math.min(mask.width - 1, Math.floor(((x + 0.5) / w) * mask.width));
      const my = Math.min(mask.height - 1, Math.floor(((y + 0.5) / h) * mask.height));
      out[y * w + x] = mask.data[my * mask.width + mx];
    }
  return out;
}

interface PoseJson {
  width: number;
  height: number;
  people: number;
  points: number[];
  mask: { width: number; height: number; data: string } | null;
}

function fixtureScene(name: string, png: URL, json: URL): Scene {
  const img = readPng(png.pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const j = JSON.parse(readFileSync(json, 'utf8')) as PoseJson;
  const det: BodyDetection = {
    pose: { points: new Float32Array(j.points) },
    mask: j.mask ? { width: j.mask.width, height: j.mask.height, data: new Uint8Array(Buffer.from(j.mask.data, 'base64')) } : null,
    people: j.people,
    width: j.width,
    height: j.height,
  };
  return { name, rgba: img.rgba, w: img.w, h: img.h, det, face: null };
}

/** Field + image for the GL parity check (gl.mjs): fixture photo at all sliders max. */
export function glCase(): { w: number; h: number; rgba: number[]; cpu: number[]; field: { width: number; height: number; data: number[] } } | null {
  const fb = new URL('./out/fullbody.png', import.meta.url);
  const poseJson = new URL('../../fixtures/pose_fullbody.json', import.meta.url);
  if (!existsSync(fb) || !existsSync(poseJson)) return null;
  const sc = fixtureScene('fullbody', fb, poseJson);
  const p = CASES.find((c) => c.name === 'all_max')!.set(defaultParams());
  const field = buildBodyField(measureBody(sc.det!, null), p, sc.w / sc.h)!;
  return { w: sc.w, h: sc.h, rgba: Array.from(sc.rgba), cpu: Array.from(warpImage(sc.rgba, sc.w, sc.h, 4, field)), field: { width: field.width, height: field.height, data: Array.from(field.data) } };
}
