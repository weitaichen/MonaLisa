// Procedural makeup checks (face-detail spec §8.3 items 2–4, §8.4 contact sheet), on the dev server (imports src/):
//  - runMakeupPin: every kind drawn by the real PMAKEUP program on a quad whose attributes are affine ramps, over a
//    known target ramp, against the CPU port (makeupProcCpu.ts) at every pixel centre;
//  - runMakeupRegions / runMakeupBlink / runMakeupContextLoss / runMakeupSheet: the real engine on sample_face.png with
//    the recorded landmarks;
//  - runMakeupLashesFail: the makeup pass with a lashes URL that cannot load.
import landmarks from '../../fixtures/landmarks_sample_face.json';
import { defaultPhoto, emptyShades, neutralPerson } from '../../../src/edit/state';
import { createEngine } from '../../../src/engine/index';
import { createFramebuffer, createTexture, loadImageTexture, type Texture } from '../../../src/engine/gl/gl';
import { isShadePart, MAKEUP_PARAM, neutralValue, paramDef, SHADES } from '../../../src/engine/params';
import { createMakeupPass } from '../../../src/engine/passes/makeup';
import { eyeFrames, eyeToUv, STATION_XS } from '../../../src/engine/passes/eyeFrame';
import {
  buildMakeupGeometry,
  createProcMakeupPass,
  FLOATS_PER_VERTEX,
  KIND,
  LAYER_MODE,
  LAYER_ORDER,
  type MakeupGeometry,
  type MakeupLayer,
} from '../../../src/engine/passes/makeupProc';
import { blend, fragment } from '../../../src/engine/passes/makeupProcCpu';
import { closeEye } from '../../../src/engine/passes/syntheticFaces';
import { adapt } from '../../../src/tracking/adapter111';
import type { Face, MakeupPart, ParamId, PersonParams, PhotoParams, RenderInput } from '../../../src/types';

export interface MakeupPinCase {
  name: string;
  mode: number;
  n: number;
  /** pixels the draw changed by more than 2/255 (the comparison is not vacuous) */
  changed: number;
  maxErr255: number;
  samples: number[][];
}
export interface MakeupRegions {
  width: number;
  height: number;
  base: string;
  parts: Record<string, { png: string; boxes: [number, number, number, number][]; layers: MakeupLayer[]; passes: string[] }>;
  /** per eye: iris centre / radius and the aperture strip polygon, px */
  eyes: { c: [number, number]; r: number; strip: number[][] }[];
  /** 原圖 and 美瞳 on sample_face.png with a white catchlight disc painted in each iris (S5 §8.3 item 3) */
  catchlight: { base: string; lens: string };
}

declare global {
  interface Window {
    runMakeupPin?: () => Promise<MakeupPinCase[]>;
    runMakeupRegions?: () => Promise<MakeupRegions>;
    runMakeupBlink?: () => Promise<Record<string, string>>;
    runMakeupLashesFail?: () => Promise<{ settled: boolean; meshReady: boolean; compiled: boolean; layers: string[] }>;
    runMakeupLashesHung?: () => Promise<{ settled: boolean; passes: string[]; ms: number }>;
    runMakeupContextLoss?: () => Promise<{ before: string; after: string; noLashes: string; restored: boolean }>;
    runMakeupSheet?: () => Promise<{ name: string; png: string }[]>;
  }
}

const KIND_LAYER: Record<number, MakeupLayer> = {
  [KIND.shadowUpper]: 'shadow',
  [KIND.shadowLower]: 'shadow',
  [KIND.liner]: 'liner',
  [KIND.lashes]: 'lashes',
  [KIND.aegyoLight]: 'aegyoLight',
  [KIND.aegyoShade]: 'aegyoShade',
  [KIND.lens]: 'lens',
  [KIND.lensOrig]: 'lens',
  [KIND.brow]: 'brow',
  [KIND.contourJaw]: 'contour',
  [KIND.contourEllipse]: 'contour',
  [KIND.contourNose]: 'contour',
  [KIND.highlightRibbon]: 'highlight',
  [KIND.highlightEllipse]: 'highlight',
};

type Ramp = [from: number, to: number];
/** loc.x and aux.x ramp left → right, loc.y and aux.y top → bottom, each covering the kind's whole range */
const CASES: { name: string; kind: number; lx: Ramp; ly: Ramp; ax?: Ramp; ay?: Ramp; w?: number; h?: number }[] = [
  { name: '眼影 upper', kind: KIND.shadowUpper, lx: [-0.3, 1.1], ly: [-0.05, 0.6], ax: [0.3, 0.6] },
  { name: '眼影 lower', kind: KIND.shadowLower, lx: [-0.2, 0.6], ly: [-0.05, 0.12] },
  { name: '眼線', kind: KIND.liner, lx: [-0.1, 1.05], ly: [-0.03, 0.07], ax: [0.016, 0.045] },
  { name: '睫毛', kind: KIND.lashes, lx: [0, 1], ly: [1, 0], w: 512, h: 128 },
  { name: '臥蠶 light', kind: KIND.aegyoLight, lx: [0, 1.05], ly: [-0.02, 0.18] },
  { name: '臥蠶 shade', kind: KIND.aegyoShade, lx: [0, 1.05], ly: [-0.02, 0.18] },
  { name: '美瞳', kind: KIND.lens, lx: [-1.2, 1.2], ly: [-1.2, 1.2], ax: [0, 0.12], ay: [0, 0.1] },
  { name: '美瞳 原色', kind: KIND.lensOrig, lx: [-1.2, 1.2], ly: [-1.2, 1.2], ax: [0, 0.12], ay: [0, 0.1] },
  { name: '眉毛', kind: KIND.brow, lx: [-0.2, 1.1], ly: [-0.05, 1.05] },
  { name: '修容 jaw', kind: KIND.contourJaw, lx: [-0.05, 1.05], ly: [-0.05, 1.05] },
  { name: '修容 ellipse', kind: KIND.contourEllipse, lx: [-1.2, 1.2], ly: [-1.2, 1.2] },
  { name: '修容 nose', kind: KIND.contourNose, lx: [-0.05, 1.05], ly: [-0.05, 1.05] },
  { name: '高光 ribbon', kind: KIND.highlightRibbon, lx: [-0.05, 1.05], ly: [-0.05, 1.05] },
  { name: '高光 ellipse', kind: KIND.highlightEllipse, lx: [-1.2, 1.2], ly: [-1.2, 1.2], ax: [0.3, 0.3] },
];

const lerp = (r: Ramp | undefined, t: number) => (r ? r[0] + (r[1] - r[0]) * t : 0);
/** 8-bit ramps: the target (dst) and the source the fragment reads (skin gate / lens colour) */
const dstAt = (i: number, j: number, w: number, h: number) => [Math.round((255 * i) / (w - 1)), Math.round((255 * j) / (h - 1)), 128];
const srcAt = (i: number, j: number, w: number, h: number) => [
  Math.round(40 + (200 * i) / (w - 1)),
  Math.round(30 + (150 * j) / (h - 1)),
  Math.round(20 + 210 * (1 - i / (w - 1))),
];
const rampTexture = (w: number, h: number, f: typeof dstAt): Uint8Array => {
  const d = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) d.set([...f(i, j, w, h), 255], (j * w + i) * 4);
  return d;
};

window.runMakeupPin = async () => {
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('no webgl2');
  const pass = createProcMakeupPass(gl);
  const lashes = await loadImageTexture(gl, '/makeup/own/lashes.png', { r8: true, mipmap: true });
  // what the shader samples at each lashes texel centre (level 0), read back through an FBO
  const lfb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, lfb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lashes.tex, 0);
  const lashPx = new Uint8Array(lashes.width * lashes.height * 4);
  gl.readPixels(0, 0, lashes.width, lashes.height, gl.RGBA, gl.UNSIGNED_BYTE, lashPx);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(lfb);
  const col: [number, number, number, number] = [0.8, 0.35, 0.5, 0.9];
  const out: MakeupPinCase[] = [];
  for (const c of CASES) {
    const W = c.w ?? 256;
    const H = c.h ?? 256;
    const target = createFramebuffer(gl, W, H);
    const dst = rampTexture(W, H, dstAt);
    gl.bindTexture(gl.TEXTURE_2D, target.tex.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, dst);
    const srcData = rampTexture(W, H, srcAt);
    const src: Texture = createTexture(gl, W, H);
    gl.bindTexture(gl.TEXTURE_2D, src.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, srcData);
    // one quad (4-vertex strip) in the case's layer, covering the target; attributes at the corners
    const data = new Float32Array(4 * FLOATS_PER_VERTEX);
    [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ].forEach(([x, y], k) =>
      data.set([x, y, lerp(c.lx, x), lerp(c.ly, y), lerp(c.ax, x), lerp(c.ay, y), ...col, c.kind], k * FLOATS_PER_VERTEX),
    );
    const layer = KIND_LAYER[c.kind];
    const ranges = Object.fromEntries(LAYER_ORDER.map((l) => [l, [0, l === layer ? 4 : 0]])) as MakeupGeometry['ranges'];
    pass.draw(target, { data, ranges }, src, lashes);
    const gpu = new Uint8Array(W * H * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, gpu);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const fwD = Math.abs((c.ly[1] - c.ly[0]) / H);
    const fwU = (18 * Math.abs(c.lx[1] - c.lx[0])) / W;
    let maxErr = 0;
    let changed = 0;
    const samples: number[][] = [];
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        const x = (i + 0.5) / W;
        const y = (j + 0.5) / H;
        const o = (j * W + i) * 4;
        const f = fragment({
          kind: c.kind,
          loc: [lerp(c.lx, x), lerp(c.ly, y)],
          aux: [lerp(c.ax, x), lerp(c.ay, y)],
          col,
          src: [srcData[o] / 255, srcData[o + 1] / 255, srcData[o + 2] / 255],
          lash: c.kind === KIND.lashes ? lashPx[o] / 255 : 0,
          fwD,
          fwU,
        });
        const want = blend(LAYER_MODE[layer], [dst[o] / 255, dst[o + 1] / 255, dst[o + 2] / 255], f);
        for (let k = 0; k < 3; k++) {
          const err = Math.abs(gpu[o + k] - want[k] * 255);
          if (err > maxErr) maxErr = err;
          if (Math.abs(gpu[o + k] - dst[o + k]) > 2) changed++;
        }
        if (i % 64 === 32 && j % 64 === 32) samples.push([i, j, gpu[o], gpu[o + 1], gpu[o + 2], want[0] * 255, want[1] * 255, want[2] * 255]);
      }
    out.push({ name: c.name, mode: LAYER_MODE[layer], n: W * H, changed: Math.round(changed / 3), maxErr255: maxErr, samples });
  }
  pass.dispose();
  return out;
};

// ── the real engine on sample_face.png ──

const PARTS: MakeupPart[] = ['brow', 'eyeshadow', 'liner', 'lashes', 'aegyo', 'contour', 'highlight', 'lens'];
const PART_LAYERS: Record<string, MakeupLayer[]> = {
  brow: ['brow'],
  eyeshadow: ['shadow'],
  liner: ['liner'],
  lashes: ['lashes'],
  aegyo: ['aegyoLight', 'aegyoShade'],
  contour: ['contour'],
  highlight: ['highlight'],
  lens: ['lens'],
};

/** 原圖: every photo value neutral, no filter, no look (P2 and the composite stages are then identities) */
function neutralPhoto(): PhotoParams {
  const p = defaultPhoto();
  const values = Object.fromEntries(Object.keys(p.values).map((k) => [k, neutralValue(paramDef(k as ParamId))])) as PhotoParams['values'];
  return { ...p, values, filterId: 'none', look: null };
}

/** one part at 100 with its first shade (S5 §8.3 item 3) */
function partOn(part: MakeupPart, v = 1, shade?: string | null): PersonParams {
  const p = neutralPerson();
  const first = isShadePart(part) ? (shade === undefined ? SHADES[part][0].id : shade) : null;
  return {
    ...p,
    values: { ...p.values, [MAKEUP_PARAM[part]]: v },
    shades: isShadePart(part) ? { ...emptyShades(), [part]: first } : emptyShades(),
  };
}

async function setup() {
  const blob = await (await fetch('/tests/fixtures/sample_face.png')).blob();
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const engine = createEngine(canvas, { mirror: false });
  await engine.ready;
  const face = adapt({ points: new Float32Array(landmarks.points) }, bitmap.width, bitmap.height);
  const photo = neutralPhoto();
  const input = (person: PersonParams, f: Face = face, source: TexImageSource = bitmap): RenderInput => ({
    source,
    width: bitmap.width,
    height: bitmap.height,
    faces: [{ face: f, weight: 1, person, protect: null }],
    globalSkin: null,
    photo,
  });
  const png = (img: ImageData) => {
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d')!.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  };
  const render = (person: PersonParams, f: Face = face, source: TexImageSource = bitmap) =>
    png(engine.renderToImageData(input(person, f, source), { mirror: false }));
  return { bitmap, canvas, engine, face, input, png, photo, render };
}

window.runMakeupRegions = async () => {
  const { bitmap, engine, face, input, render } = await setup();
  const W = bitmap.width;
  const H = bitmap.height;
  const aspect = W / H;
  const out: MakeupRegions = { width: W, height: H, base: render(neutralPerson()), parts: {}, eyes: [], catchlight: { base: '', lens: '' } };
  for (const part of PARTS) {
    const person = partOn(part);
    const g = buildMakeupGeometry([{ face, weight: 1, person, protect: null }], aspect);
    // one box per eye / side piece would be tighter; the union of each layer's vertices, dilated by 3 px, is the spec's
    const boxes: [number, number, number, number][] = PART_LAYERS[part].map((l) => {
      const [first, count] = g.ranges[l];
      const b: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
      for (let v = first; v < first + count; v++) {
        const x = g.data[v * FLOATS_PER_VERTEX] * W;
        const y = g.data[v * FLOATS_PER_VERTEX + 1] * H;
        b[0] = Math.min(b[0], x - 3);
        b[1] = Math.min(b[1], y - 3);
        b[2] = Math.max(b[2], x + 3);
        b[3] = Math.max(b[3], y + 3);
      }
      return b;
    });
    const passes = engine.render(input(person), { still: true }).passes;
    out.parts[part] = { png: render(person), boxes, layers: PART_LAYERS[part], passes };
  }
  for (const f of eyeFrames(face, aspect)) {
    const iris = f.iris ?? f.irisFallback;
    const upper = STATION_XS.map((x, k) => eyeToUv(f, x, f.upper[k], aspect));
    const lower = STATION_XS.map((x, k) => eyeToUv(f, x, Math.max(f.upper[k], f.lower[k]), aspect)).reverse();
    out.eyes.push({
      c: [iris.c[0] * W, iris.c[1] * aspect * H],
      r: iris.r * W,
      strip: [...upper, ...lower].map(([x, y]) => [x * W, y * H]),
    });
  }
  // a known catchlight: no pixel of the sample_face.png render reaches Y 0.81, so the spec's Y > 0.88 check never fires
  // on the raw image. A white disc up-left in each iris (mostly inside the 美瞳 annulus and the aperture) gives one.
  const lit = new OffscreenCanvas(W, H);
  const ctx = lit.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  ctx.fillStyle = '#fff';
  for (const e of out.eyes) {
    ctx.beginPath();
    ctx.arc(e.c[0] - 0.3 * e.r, e.c[1] - 0.3 * e.r, 0.22 * e.r, 0, 2 * Math.PI);
    ctx.fill();
  }
  const litBitmap = lit.transferToImageBitmap();
  out.catchlight = { base: render(neutralPerson(), face, litBitmap), lens: render(partOn('lens'), face, litBitmap) };
  litBitmap.close();
  engine.dispose();
  bitmap.close();
  return out;
};

window.runMakeupBlink = async () => {
  const { bitmap, engine, face, render } = await setup();
  const closed = closeEye(closeEye(face, 0), 1);
  const out = {
    base: render(neutralPerson(), closed),
    lens: render(partOn('lens', 1, 'blue'), closed),
    lashes: render(partOn('lashes'), closed),
    eyeshadow: render(partOn('eyeshadow'), closed),
  };
  engine.dispose();
  bitmap.close();
  return out;
};

/** the makeup pass alone, its lashes URL unreachable: ready must settle and only the 睫毛 layer may be skipped */
window.runMakeupLashesFail = async () => {
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const gl = canvas.getContext('webgl2');
  if (!gl) throw new Error('no webgl2');
  const pass = createMakeupPass(gl, '/makeup/gp/', '/makeup/own/missing-lashes.png');
  const settled = await Promise.race([pass.ready.then(() => true), new Promise<boolean>((res) => setTimeout(() => res(false), 15_000))]);
  const face = adapt({ points: new Float32Array(landmarks.points) }, landmarks.width, landmarks.height);
  const base = partOn('eyeshadow');
  const person: PersonParams = { ...base, values: { ...base.values, 'makeup.lashes': 1 } };
  const geom = buildMakeupGeometry([{ face, weight: 1, person, protect: null }], landmarks.width / landmarks.height);
  const src = createTexture(gl, 100, 150);
  const dst = createFramebuffer(gl, 100, 150);
  const compiled = pass.ensureProc();
  const layers: string[] = pass.drawFaces(src, dst, [], geom);
  const meshReady = pass.meshReady;
  pass.dispose();
  return { settled, meshReady, compiled, layers };
};

/**
 * The engine with lashes.png held unanswered (the spec routes it and never replies): 口紅 must draw once its own
 * GPUPixel textures are in (makeup readiness per resource), while engine.ready (which also waits for lashes) is pending.
 * Polls engine.render for up to 15 s; returns whether ready settled meanwhile and the passes of the last 口紅 frame.
 */
window.runMakeupLashesHung = async () => {
  const blob = await (await fetch('/tests/fixtures/sample_face.png')).blob();
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const engine = createEngine(canvas, { mirror: false });
  let settled = false;
  void engine.ready.then(
    () => (settled = true),
    () => (settled = true),
  );
  const face = adapt({ points: new Float32Array(landmarks.points) }, bitmap.width, bitmap.height);
  const input: RenderInput = { source: bitmap, width: bitmap.width, height: bitmap.height, faces: [{ face, weight: 1, person: partOn('lip'), protect: null }], globalSkin: null, photo: neutralPhoto() };
  let passes: string[] = [];
  const t0 = performance.now();
  while (performance.now() - t0 < 15_000) {
    passes = engine.render(input, { still: true }).passes;
    if (passes.includes('makeup')) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const ms = Math.round(performance.now() - t0);
  engine.dispose();
  bitmap.close();
  return { settled, passes, ms };
};

/**
 * 眼影 + 睫毛 rendered, the display context lost and restored (iOS backgrounding), rendered again: the same pixels.
 * 睫毛 reads the lashes texture, which the restore must reload with the PMAKEUP program and its VBO (Review Focus 2);
 * `noLashes` (眼影 alone, before the loss) shows that 睫毛 draws, so a restore without it cannot match `before`.
 */
window.runMakeupContextLoss = async () => {
  const { bitmap, canvas, engine, render } = await setup();
  const shadow = partOn('eyeshadow');
  const person: PersonParams = { ...shadow, values: { ...shadow.values, [MAKEUP_PARAM.lashes]: 1 } };
  const noLashes = render(shadow);
  const before = render(person);
  const ext = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context');
  if (!ext) throw new Error('WEBGL_lose_context missing');
  const until = async (ok: () => boolean) => {
    for (let i = 0; i < 200 && !ok(); i++) await new Promise((res) => setTimeout(res, 50));
  };
  ext.loseContext();
  await until(() => engine.lost);
  ext.restoreContext();
  await until(() => !engine.lost);
  await engine.ready; // a new promise after the restore (Engine.ready)
  const after = render(person);
  const restored = !engine.lost;
  engine.dispose();
  bitmap.close();
  return { before, after, noLashes, restored };
};

window.runMakeupSheet = async () => {
  const { bitmap, engine, png, photo, render } = await setup();
  const out: { name: string; png: string }[] = [];
  for (const part of PARTS) {
    const shades: (string | null)[] = isShadePart(part) ? [...(part === 'liner' ? [] : [null]), ...SHADES[part].map((s) => s.id)] : [null];
    for (const shade of shades) for (const v of [0.5, 1]) out.push({ name: `${part}-${shade ?? 'orig'}-${v * 100}`, png: render(partOn(part, v, shade)) });
  }
  for (const id of ['shape.jawline', 'shape.temple', 'shape.hairline', 'shape.noseWing', 'shape.noseBridge', 'shape.mouthHeight'] as const) {
    for (const v of paramDef(id).bidirectional ? [0.25, 0.75] : [0.5]) {
      const p = neutralPerson();
      out.push({ name: `${id}-${Math.round(v * 100 - (paramDef(id).bidirectional ? 50 : 0))}`, png: render({ ...p, values: { ...p.values, [id]: v } }) });
    }
  }
  // the group faces of step 1's group_faces.png (S5 §8.4): its recorder writes `faces`, 478 × (x, y, z) per face
  // (A, the mirrored B, the small C, and D when it was found; D is below MIN_FACE_FRAC and shows little)
  const gBitmap = await createImageBitmap(await (await fetch('/tests/fixtures/group_faces.png')).blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const gJson = (await (await fetch('/tests/fixtures/group_faces.landmarks.json')).json()) as { faces: number[][] };
  const gFaces = gJson.faces.map((pts) => adapt({ points: new Float32Array(pts) }, gBitmap.width, gBitmap.height));
  for (const part of PARTS) {
    const person = partOn(part);
    const img = engine.renderToImageData(
      { source: gBitmap, width: gBitmap.width, height: gBitmap.height, faces: gFaces.map((face) => ({ face, weight: 1, person, protect: null })), globalSkin: null, photo },
      { mirror: false },
    );
    out.push({ name: `group-${part}`, png: png(img) });
  }
  gBitmap.close();
  engine.dispose();
  bitmap.close();
  return out;
};
