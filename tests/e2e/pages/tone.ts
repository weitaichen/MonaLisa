// 膚質 engine harness (skin-cleanup spec §8.2): renders the step-4 passes on the dev server with the recorded face of
// sample_face.png and hands raw RGBA8 readbacks (base64) or lossless PNGs to tests/e2e/tone-engine.spec.ts, which
// compares them with the CPU references in Node.
import landmarks from '../../fixtures/landmarks_sample_face.json';
import { HEAL_RING_SAMPLES } from '../../../src/config/limits';
import { patchPlan, readPatch } from '../../../src/edit/patch';
import { planSpot, spotRadius } from '../../../src/edit/spots';
import { defaultPhoto, neutralPerson } from '../../../src/edit/state';
import { createFramebuffer, createTexture, resizeFramebuffer, uploadSource, type Framebuffer } from '../../../src/engine/gl/gl';
import { createEngine } from '../../../src/engine/index';
import { neutralValue, paramDef } from '../../../src/engine/params';
import { createHealPass } from '../../../src/engine/passes/heal';
import { createRetouchPass, createToneFieldPass } from '../../../src/engine/passes/toneField';
import { createToneMaskPass } from '../../../src/engine/passes/toneMask';
import { faceFrame, IDENTITY_WIN, NEUTRAL_TONE, Q_CLEAR, R_CLEAR, toneDrawsQ, toneDrawsR, type ToneDraw, type ToneFaceInput, type ToneValues } from '../../../src/engine/passes/toneGeometry';
import { sigmaLow } from '../../../src/engine/shaders/tone';
import { adapt } from '../../../src/tracking/adapter111';
import type { ParamId, PersonParams, PhotoParams, RenderInput, Spot } from '../../../src/types';

export const W = landmarks.width;
export const H = landmarks.height;
export const ASPECT = W / H;
export const FACE = adapt({ points: new Float32Array(landmarks.points) }, W, H);

export function b64(u8: Uint8Array): string {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
}

/** RGBA8 rows, top first (the gl.ts convention) */
export function readFb(gl: WebGL2RenderingContext, fb: Framebuffer): Uint8Array {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb.fbo);
  const px = new Uint8Array(fb.width * fb.height * 4);
  gl.readPixels(0, 0, fb.width, fb.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return px;
}

export function glOf(): WebGL2RenderingContext {
  const gl = (document.getElementById('gl') as HTMLCanvasElement).getContext('webgl2');
  if (!gl) throw new Error('no webgl2');
  return gl;
}

export const allTools = (warmth: number): ToneValues => ({ ...NEUTRAL_TONE, even: 1, warmth, darkCircle: 1, nasolabial: 1, teeth: 1, eyeBright: 1 });
export const oneFace = (values: ToneValues): ToneFaceInput[] => [{ face: FACE, values, weight: 1, cap: null }];

export async function fixtureBitmap(): Promise<ImageBitmap> {
  const blob = await (await fetch('/tests/fixtures/sample_face_tone.png')).blob();
  return createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}

export function toPng(img: ImageData): string {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

/** every photo value neutral (no 美白, 銳化, 濾鏡 or 調節), no geometry change, these spots */
export function neutralPhoto(spots: Spot[] = []): PhotoParams {
  const p = defaultPhoto();
  const values = { ...p.values };
  for (const id of Object.keys(values) as (keyof typeof values)[]) values[id] = neutralValue(paramDef(id as ParamId));
  return { ...p, values, filterId: 'none', spots };
}

export function personWith(v: ToneValues, extra: Partial<Record<ParamId, number>> = {}): PersonParams {
  const p = neutralPerson();
  return {
    ...p,
    values: {
      ...p.values,
      'tone.even': v.even,
      'tone.warmth': v.warmth,
      'tone.darkCircle': v.darkCircle,
      'tone.nasolabial': v.nasolabial,
      'tone.teeth': v.teeth,
      'tone.eyeBright': v.eyeBright,
      ...extra,
    },
  };
}

export function inputFor(bmp: ImageBitmap, v: ToneValues, spots: Spot[] = [], extra: Partial<Record<ParamId, number>> = {}): RenderInput {
  return {
    source: bmp,
    width: bmp.width,
    height: bmp.height,
    faces: [{ face: FACE, weight: 1, person: personWith(v, extra), protect: null }],
    obstacles: [],
    globalSkin: null,
    photo: neutralPhoto(spots),
  };
}

export interface ToneFieldRun {
  w: number;
  h: number;
  qw: number;
  qh: number;
  sigmaLowPx: number;
  err: number;
  levels: { level: number; R: string; Q: string; out: string }[];
}

declare global {
  interface Window {
    runToneMasks?: () => { w: number; h: number; err: number; R: string; Qwarm: string; Qcool: string };
    runToneField?: () => Promise<ToneFieldRun>;
    runToneRetouch?: () => { w: number; h: number; qw: number; qh: number; err: number; base: string; R: string; out: string; outNoMn: string };
    runToneEngine?: () => Promise<{
      png: Record<string, string>;
      passes: Record<string, string[]>;
      built: boolean[];
      lossMaxDiff: number;
      releaseBuilt: boolean;
      releaseMaxDiff: number;
    }>;
    runToneHeal?: () => Promise<{ spots: Spot[]; out: string; err: number; passes: { none: string[]; spots: string[] } }>;
  }
}

window.runToneMasks = () => {
  const gl = glOf();
  const pass = createToneMaskPass(gl);
  const w = Math.ceil(W / 4);
  const h = Math.ceil(H / 4);
  const fb = createFramebuffer(gl, w, h);
  pass.draw(fb, toneDrawsR(oneFace(allTools(1)), ASPECT), IDENTITY_WIN, R_CLEAR);
  const R = b64(readFb(gl, fb));
  pass.draw(fb, toneDrawsQ(oneFace(allTools(1)), ASPECT), IDENTITY_WIN, Q_CLEAR);
  const Qwarm = b64(readFb(gl, fb));
  pass.draw(fb, toneDrawsQ(oneFace(allTools(0)), ASPECT), IDENTITY_WIN, Q_CLEAR);
  const Qcool = b64(readFb(gl, fb));
  const err = gl.getError();
  pass.dispose();
  return { w, h, err, R, Qwarm, Qcool };
};

/** the raw passes (R, Q, field, retouch) at levels 0.5 and 1 of every tool, read back for the CPU comparison */
window.runToneField = async () => {
  const gl = glOf();
  const bmp = await fixtureBitmap();
  const src = createTexture(gl, 0, 0);
  uploadSource(gl, src, bmp, bmp.width, bmp.height);
  const masks = createToneMaskPass(gl);
  const field = createToneFieldPass(gl);
  const retouch = createRetouchPass(gl);
  const qw = Math.ceil(W / 4);
  const qh = Math.ceil(H / 4);
  const r = createFramebuffer(gl, qw, qh);
  const q = createFramebuffer(gl, qw, qh);
  const out = createFramebuffer(gl, W, H);
  const fbs = new Map<string, Framebuffer>();
  const fbFor = (name: string, s: { width: number; height: number }): Framebuffer => {
    let f = fbs.get(name);
    if (!f) fbs.set(name, (f = createFramebuffer(gl, s.width, s.height)));
    else resizeFramebuffer(gl, f, s.width, s.height);
    return f;
  };
  const sl = sigmaLow(faceFrame(FACE, ASPECT).fw * W, Math.min(W, H));
  const levels: ToneFieldRun['levels'] = [];
  for (const level of [0.5, 1]) {
    const v: ToneValues = { even: level, warmth: 0.5 + level / 2, darkCircle: level, nasolabial: level, teeth: level, eyeBright: level };
    masks.draw(r, toneDrawsR(oneFace(v), ASPECT), IDENTITY_WIN, R_CLEAR);
    masks.draw(q, toneDrawsQ(oneFace(v), ASPECT), IDENTITY_WIN, Q_CLEAR);
    const t = field.build(src, { width: W, height: H }, q.tex, r.tex, sl, true, fbFor);
    retouch.draw(src, out, t.delta8, t.mn8, r.tex, IDENTITY_WIN, true);
    levels.push({ level, R: b64(readFb(gl, r)), Q: b64(readFb(gl, q)), out: b64(readFb(gl, out)) });
  }
  const err = gl.getError();
  masks.dispose();
  field.dispose();
  retouch.dispose();
  bmp.close();
  return { w: W, h: H, qw, qh, sigmaLowPx: sl, err, levels };
};

/** the real engine: each tool at 100 (PNG), the pass lists, the field cache and a context loss */
window.runToneEngine = async () => {
  const bmp = await fixtureBitmap();
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const engine = createEngine(canvas, { mirror: false });
  await engine.ready;
  const tools: Record<string, ToneValues> = {
    base: NEUTRAL_TONE,
    even: { ...NEUTRAL_TONE, even: 1 },
    warmUp: { ...NEUTRAL_TONE, warmth: 1 },
    warmDown: { ...NEUTRAL_TONE, warmth: 0 },
    darkCircle: { ...NEUTRAL_TONE, darkCircle: 1 },
    nasolabial: { ...NEUTRAL_TONE, nasolabial: 1 },
    teeth: { ...NEUTRAL_TONE, teeth: 1 },
    eyeBright: { ...NEUTRAL_TONE, eyeBright: 1 },
  };
  const png: Record<string, string> = {};
  const passes: Record<string, string[]> = {};
  for (const [name, v] of Object.entries(tools)) {
    passes[name] = engine.render(inputFor(bmp, v), { still: true }).passes;
    png[name] = toPng(engine.renderToImageData(inputFor(bmp, v), { mirror: false }));
  }
  const dark = tools.darkCircle;
  const built = [
    engine.render(inputFor(bmp, tools.even), { still: true }).toneBuilt === true, // another key: rebuilt
    engine.render(inputFor(bmp, tools.even), { still: true }).toneBuilt === true, // same key: cached
    engine.render(inputFor(bmp, tools.even, [], { 'shape.faceSlim': 1 }), { still: true }).toneBuilt === true, // 瘦臉: cached
  ];
  // the field is now cached for 黑眼圈: after the loss the same key must rebuild, never sample the deleted textures
  const before = engine.renderToImageData(inputFor(bmp, dark), { mirror: false });
  // step 3's releaseBuffers (after a tiled export) keeps the field's targets: the same key reuses it and draws the same
  engine.releaseBuffers();
  const releaseBuilt = engine.render(inputFor(bmp, dark), { still: true }).toneBuilt === true;
  const released = engine.renderToImageData(inputFor(bmp, dark), { mirror: false });
  let releaseMaxDiff = 0;
  for (let i = 0; i < before.data.length; i++) releaseMaxDiff = Math.max(releaseMaxDiff, Math.abs(before.data[i] - released.data[i]));
  const lose = (canvas.getContext('webgl2') as WebGL2RenderingContext).getExtension('WEBGL_lose_context')!;
  lose.loseContext();
  for (let i = 0; i < 100 && !engine.lost; i++) await new Promise((r) => setTimeout(r, 10));
  lose.restoreContext();
  for (let i = 0; i < 200 && engine.lost; i++) await new Promise((r) => setTimeout(r, 10));
  await engine.ready;
  built.push(engine.render(inputFor(bmp, dark), { still: true }).toneBuilt === true); // after the loss: rebuilt
  const after = engine.renderToImageData(inputFor(bmp, dark), { mirror: false });
  let lossMaxDiff = 0;
  for (let i = 0; i < before.data.length; i++) lossMaxDiff = Math.max(lossMaxDiff, Math.abs(before.data[i] - after.data[i]));
  engine.dispose();
  bmp.close();
  return { png, passes, built, lossMaxDiff, releaseBuilt, releaseMaxDiff };
};

/** a w × h sweep through the retouch's colour gates: Y along x, a 16 × 16 grid of (Cb, Cr) in [0.35, 0.65] along y */
function gateSweep(w: number, h: number): ImageData {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const Y = (x + 0.5) / w;
      const cb = 0.35 + (0.3 * (y % 16)) / 15;
      const cr = 0.35 + (0.3 * (Math.floor(y / 16) % 16)) / 15;
      const i = (y * w + x) * 4;
      d[i] = Math.round(255 * (Y + 1.402 * (cr - 0.5)));
      d[i + 1] = Math.round(255 * (Y - 0.344136 * (cb - 0.5) - 0.714136 * (cr - 0.5)));
      d[i + 2] = Math.round(255 * (Y + 1.772 * (cb - 0.5)));
      d[i + 3] = 255;
    }
  return new ImageData(d, w, h);
}

/**
 * RETOUCH_FS's 白牙 and 亮眼 branches on every colour of the sweep (the fixture's teeth lie below the 白牙 gate, so its
 * mouth crop never enters that branch): R.B 0.7 and R.A 0.9 over the whole target, Mn8 built from the sweep, and once
 * more without Mn8 (a tile whose field was not prepared), read back for retouchCpu
 */
window.runToneRetouch = () => {
  const gl = glOf();
  const w = 256;
  const h = 256;
  const img = gateSweep(w, h);
  const src = createTexture(gl, 0, 0);
  uploadSource(gl, src, img, w, h);
  const masks = createToneMaskPass(gl);
  const field = createToneFieldPass(gl);
  const retouch = createRetouchPass(gl);
  const qw = Math.ceil(w / 4);
  const qh = Math.ceil(h / 4);
  const r = createFramebuffer(gl, qw, qh);
  const q = createFramebuffer(gl, qw, qh);
  const out = createFramebuffer(gl, w, h);
  const fbs = new Map<string, Framebuffer>();
  const fbFor = (name: string, s: { width: number; height: number }): Framebuffer => {
    let f = fbs.get(name);
    if (!f) fbs.set(name, (f = createFramebuffer(gl, s.width, s.height)));
    else resizeFramebuffer(gl, f, s.width, s.height);
    return f;
  };
  const whole: ToneDraw = {
    phase: 0,
    blend: 'max',
    mask: [true, true, true, true],
    off: [0, 0, 0, 0],
    str: [0, 0, 0.7, 0.9],
    verts: Float32Array.of(0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 1, 1),
  };
  masks.draw(r, [whole], IDENTITY_WIN, R_CLEAR);
  masks.draw(q, [], IDENTITY_WIN, Q_CLEAR);
  const t = field.build(src, { width: w, height: h }, q.tex, r.tex, 0, false, fbFor);
  retouch.draw(src, out, t.delta8, t.mn8, r.tex, IDENTITY_WIN, false);
  const withMn = b64(readFb(gl, out));
  retouch.draw(src, out, null, null, r.tex, IDENTITY_WIN, false);
  const outNoMn = b64(readFb(gl, out));
  const R = b64(readFb(gl, r));
  const err = gl.getError();
  masks.dispose();
  field.dispose();
  retouch.dispose();
  return { w, h, qw, qh, err, base: b64(new Uint8Array(img.data.buffer)), R, out: withMn, outNoMn };
};

/** the three fixture blemishes planned as the editor plans a tap (中), plus a border spot in fill mode */
window.runToneHeal = async () => {
  const bmp = await fixtureBitmap();
  const fx = (await (await fetch('/tests/fixtures/sample_face_tone.json')).json()) as { defects: { name: string; center: [number, number] }[] };
  const faces = [{ id: 'f0', face: FACE }];
  const work = { width: W, height: H };
  const spots: Spot[] = [];
  for (const name of ['dot1', 'dot2', 'dot3']) {
    const c = fx.defects.find((d) => d.name === name)!.center;
    const o: [number, number] = [c[0] / W, c[1] / H];
    const r = spotRadius(o, 'M', faces, work);
    const res = planSpot(readPatch(bmp, patchPlan(o, r, work)), o, r, { faces, aspect: ASPECT, existing: spots });
    if ('refused' in res) throw new Error(`${name} refused: ${res.refused}`);
    spots.push(res);
  }
  spots.push({ x: 0.004, y: 0.5, r: 0.02, dx: 0, dy: 0, owner: null });
  const gl = glOf();
  const src = createTexture(gl, 0, 0);
  uploadSource(gl, src, bmp, W, H);
  const heal = createHealPass(gl);
  const a = createFramebuffer(gl, W, H);
  const ring = createFramebuffer(gl, HEAL_RING_SAMPLES, spots.length);
  heal.draw(src, a, ring, spots, IDENTITY_WIN, { width: W, height: H });
  const out = b64(readFb(gl, a));
  const err = gl.getError();
  heal.dispose();
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const engine = createEngine(canvas, { mirror: false });
  await engine.ready;
  const passes = { none: engine.render(inputFor(bmp, NEUTRAL_TONE), { still: true }).passes, spots: engine.render(inputFor(bmp, NEUTRAL_TONE, spots), { still: true }).passes };
  engine.dispose();
  bmp.close();
  return { spots, out, err, passes };
};
