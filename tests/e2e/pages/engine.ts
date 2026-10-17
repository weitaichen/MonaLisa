// Engine render check (spec §10 "Engine"): renders tests/fixtures/sample_face.png through the real
// engine with fixed params and the recorded landmark fixture, and hands lossless PNGs back to the
// Playwright test, which compares them with the pngjs-decoded source in Node.
import landmarks from '../../fixtures/landmarks_sample_face.json';
import { prepareFaces } from '../../../src/detect/faces';
import { legacyFrame } from '../../../src/edit/frame';
import { splitLegacy } from '../../../src/edit/legacy';
import { defaultPhoto, neutralPerson } from '../../../src/edit/state';
import { createEngine } from '../../../src/engine/index';
import { applyPreset, setFilter, setParam, setShade } from '../../../src/engine/params';
import { apply, flipView, IDENTITY_GEOMETRY, oToV, rotateLeft } from '../../../src/geometry/view';
import { adapt } from '../../../src/tracking/adapter111';
import type { BeautyParams, Geometry, RenderFace, RenderInput } from '../../../src/types';

export interface EngineCheck {
  width: number;
  height: number;
  renderer: string;
  /** gl.getError() after each step (0 = NO_ERROR) */
  glErrors: Record<string, number>;
  passes: Record<string, string[]>;
  /** PNG data URLs of renderToImageData exports */
  png: Record<string, string>;
  /** the display canvas (render(..., {still:true})) copied in the same task, as PNG */
  displayNatural: string;
}

declare global {
  interface Window {
    runEngineCheck?: () => Promise<EngineCheck>;
    runEngineReleaseFields?: () => Promise<{ uploadsBefore: number; freed: number; uploadsAfter: number; err: number }>;
    runEngineOverlay?: () => Promise<Record<string, { inside: number; hit: number; err: number }>>;
    runEngineMulti?: () => Promise<{
      maskA: number;
      maskB: number;
      maskBBorder: number;
      lipA: number;
      lipASolo: number;
      lipOverlap: number;
      lipOverlapSolo: number;
    }>;
  }
}

function toPng(img: ImageData): string {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no 2d context');
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

/**
 * engine.releaseFields (the still session's dispose): the 美體 and 推臉筆 field textures (RG16F) are deleted with the
 * pipeline's references to the fields, and the next frame with a field uploads it again. Counts RG16F texImage2D
 * uploads and deleteTexture calls on the engine's context.
 */
window.runEngineReleaseFields = async () => {
  const canvas = document.createElement('canvas');
  const engine = createEngine(canvas, { mirror: false });
  await engine.ready;
  const gl = canvas.getContext('webgl2')!;
  let uploads = 0;
  let deleted = 0;
  const texImage2D = gl.texImage2D.bind(gl) as (...a: unknown[]) => void;
  (gl as unknown as { texImage2D: (...a: unknown[]) => void }).texImage2D = (...a: unknown[]) => {
    if (a[2] === gl.RG16F) uploads++;
    texImage2D(...a);
  };
  const deleteTexture = gl.deleteTexture.bind(gl);
  gl.deleteTexture = (t) => {
    deleted++;
    deleteTexture(t);
  };
  const source = await createImageBitmap(new ImageData(64, 48));
  const field = (version: number) => ({ width: 32, height: 24, data: new Float32Array(32 * 24 * 2).fill(0.002), version });
  const input: RenderInput = { source, width: 64, height: 48, faces: [], globalSkin: null, photo: defaultPhoto(), body: field(1), liquify: field(1) };
  engine.render(input, { still: true });
  engine.render(input, { still: true });
  const uploadsBefore = uploads;
  const d0 = deleted;
  engine.releaseFields();
  const freed = deleted - d0;
  engine.render(input, { still: true });
  const uploadsAfter = uploads - uploadsBefore;
  const err = gl.getError();
  engine.dispose();
  source.close();
  return { uploadsBefore, freed, uploadsAfter, err };
};

/**
 * 顯示臉部特徵點 on a still with a view geometry: the canvas shows V, so each of the 111 lime points (#B8F02A) must be
 * drawn where the view puts its O position (view.ts oToV). Per case: the points inside the canvas, and how many of them
 * have a lime pixel within 3 px (the eye-frame points, drawn after in cyan, may cover a few).
 */
window.runEngineOverlay = async () => {
  const blob = await (await fetch('/tests/fixtures/sample_face.png')).blob();
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const { width, height } = bitmap;
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const engine = createEngine(canvas, { mirror: false, showLandmarks: true });
  await engine.ready;
  const gl = canvas.getContext('webgl2') as WebGL2RenderingContext;
  const face = adapt({ points: new Float32Array(landmarks.points) }, width, height);
  const crop = { x: 0.15, y: 0.1, w: 0.6, h: 0.55 };
  const cases: Record<string, Geometry> = {
    identity: IDENTITY_GEOMETRY,
    crop: { ...IDENTITY_GEOMETRY, crop },
    'quarter 1 + flip + crop': { ...flipView(rotateLeft(IDENTITY_GEOMETRY)), crop },
  };
  const lime = (d: Uint8ClampedArray, i: number) => Math.abs(d[i] - 184) <= 40 && d[i + 1] >= 200 && d[i + 2] <= 90;
  const out: Record<string, { inside: number; hit: number; err: number }> = {};
  for (const [name, g] of Object.entries(cases)) {
    const faces: RenderFace[] = [{ face, weight: 1, person: neutralPerson(), protect: null }];
    engine.render({ source: bitmap, width, height, faces, globalSkin: null, photo: { ...defaultPhoto(), geometry: g }, geometry: g }, { still: true });
    // copied in the same task as the render (no preserveDrawingBuffer)
    const copy = new OffscreenCanvas(canvas.width, canvas.height);
    const ctx = copy.getContext('2d')!;
    ctx.drawImage(canvas, 0, 0);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const m = oToV(g, { width: width / height, height: 1 });
    let inside = 0;
    let hit = 0;
    for (let k = 0; k < 111; k++) {
      const [vx, vy] = apply(m, [face.pts111[2 * k], face.pts111[2 * k + 1]]);
      const px = Math.floor(vx * img.width);
      const py = Math.floor(vy * img.height);
      if (px < 4 || py < 4 || px >= img.width - 4 || py >= img.height - 4) continue;
      inside++;
      let found = false;
      for (let dy = -3; dy <= 3 && !found; dy++) for (let dx = -3; dx <= 3 && !found; dx++) found = lime(img.data, ((py + dy) * img.width + px + dx) * 4);
      if (found) hit++;
    }
    out[name] = { inside, hit, err: gl.getError() };
  }
  engine.dispose();
  bitmap.close();
  return out;
};

window.runEngineCheck = async () => {
  const blob = await (await fetch('/tests/fixtures/sample_face.png')).blob();
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const { width, height } = bitmap;

  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const engine = createEngine(canvas, { mirror: false });
  await engine.ready;
  // resident before the first render: an implicit (frame-path) load would skip the filter on that frame
  await engine.loadFilter('mono');
  const gl = canvas.getContext('webgl2') as WebGL2RenderingContext;
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER));

  const face = adapt({ points: new Float32Array(landmarks.points) }, width, height);
  const input = (params: BeautyParams): RenderInput => ({ source: bitmap, width, height, ...legacyFrame(params, face, 1) });

  const glErrors: Record<string, number> = {};
  const passes: Record<string, string[]> = {};
  const png: Record<string, string> = {};

  const cases: Record<string, BeautyParams> = {
    // first face frame of this engine: makeup must already be usable once `ready` resolved
    lip: setShade(applyPreset('original', 1), 'lip', 'rose'),
    original: applyPreset('original', 1),
    natural: applyPreset('natural', 1),
    // big eyes only: proves the landmark-driven warp moves pixels near the eyes and nowhere else
    bigEye: setParam(applyPreset('original', 1), 'shape.eyeEnlarge', 1),
    // the 512² LUT path (load + size check, unit 7, lookup + mix) at full strength, nothing else on
    filterMono: setFilter(applyPreset('original', 1), 'mono'),
  };
  for (const [name, params] of Object.entries(cases)) {
    // a display render first, so the pass list for the case is recorded
    passes[name] = engine.render(input(params), { still: true }).passes;
    png[name] = toPng(engine.renderToImageData(input(params), { mirror: false }));
    glErrors[name] = gl.getError();
  }

  engine.render(input(cases.natural), { still: true });
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  copy.getContext('2d')?.drawImage(canvas, 0, 0);
  const displayNatural = copy.toDataURL('image/png');
  glErrors.display = gl.getError();

  engine.dispose();
  bitmap.close();
  return { width, height, renderer, glErrors, passes, png, displayNatural };
};

window.runEngineMulti = async () => {
  // two faces of the group fixture side by side: A at 自然 with a rose lip, B neutral; B's mesh must not erase A's lip,
  // and B's skin must not be smoothed (others untouched, S §4.2/§4.3)
  const blob = await (await fetch('/tests/fixtures/group_faces.png')).blob();
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const j = (await (await fetch('/tests/fixtures/group_faces.landmarks.json')).json()) as { width: number; height: number; faces: number[][] };
  const prepared = prepareFaces(j.faces.map((f) => ({ points: new Float32Array(f) })), j.width, j.height);
  const [A, B] = prepared.faces;
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const engine = createEngine(canvas, { mirror: false });
  await engine.ready;
  const lipPerson = { ...splitLegacy(setShade(applyPreset('natural', 1), 'lip', 'rose')).person };
  const frame = (faces: RenderFace[]): RenderInput => ({ source: bitmap, width: bitmap.width, height: bitmap.height, faces, globalSkin: null, photo: splitLegacy(applyPreset('original', 1)).photo });
  const both = engine.renderToImageData(frame([{ face: A.face, weight: 1, person: lipPerson, protect: null }, { face: B.face, weight: 1, person: neutralPerson(), protect: null }]), { mirror: false });
  const solo = engine.renderToImageData(frame([{ face: A.face, weight: 1, person: lipPerson, protect: null }]), { mirror: false });
  const orig = engine.renderToImageData(frame([]), { mirror: false });
  // overlapping meshes (the case the MESH_FS discard exists for): two entries on A's landmarks, both on 原圖 (no warp,
  // no smoothing), the first with a rose lip only, the second with blush only. The second mesh covers the first, and
  // its blush factor is 1 at the lip, so without the discard it writes src · 1 over the first face's lip (§4.3).
  const lipOnly = splitLegacy(setShade(setParam(applyPreset('original', 1), 'makeup.lip', 0.8), 'lip', 'rose')).person;
  const blushOnly = splitLegacy(setParam(applyPreset('original', 1), 'makeup.blush', 0.8)).person;
  const overlap = engine.renderToImageData(
    frame([
      { face: A.face, weight: 1, person: lipOnly, protect: null },
      { face: A.face, weight: 1, person: blushOnly, protect: null },
    ]),
    { mirror: false },
  );
  const overlapSolo = engine.renderToImageData(frame([{ face: A.face, weight: 1, person: lipOnly, protect: null }]), { mirror: false });
  const mean = (img: ImageData, cx: number, cy: number, r = 3) => {
    let s = 0;
    let n = 0;
    for (let y = Math.round(cy * img.height) - r; y <= Math.round(cy * img.height) + r; y++)
      for (let x = Math.round(cx * img.width) - r; x <= Math.round(cx * img.width) + r; x++) {
        const i = (y * img.width + x) * 4;
        s += img.data[i];
        n++;
      }
    return s / n;
  };
  const P = A.face.pts111;
  const Q = B.face.pts111;
  // the lower lip: halfway between the outer lower-lip centre (93) and the inner one (102)
  const lip = [(P[93 * 2] + P[102 * 2]) / 2, (P[93 * 2 + 1] + P[102 * 2 + 1]) / 2] as const;
  const cheekB = [Q[7 * 2] + 0.01, Q[7 * 2 + 1]] as const;
  engine.dispose();
  bitmap.close();
  return {
    maskA: Math.abs(mean(both, P[7 * 2] + 0.01, P[7 * 2 + 1]) - mean(orig, P[7 * 2] + 0.01, P[7 * 2 + 1])),
    maskB: Math.abs(mean(both, cheekB[0], cheekB[1]) - mean(orig, cheekB[0], cheekB[1])),
    maskBBorder: Math.abs(mean(both, Q[0], Q[1]) - mean(orig, Q[0], Q[1])),
    lipA: Math.abs(mean(both, lip[0], lip[1]) - mean(orig, lip[0], lip[1])),
    lipASolo: Math.abs(mean(solo, lip[0], lip[1]) - mean(orig, lip[0], lip[1])),
    lipOverlap: Math.abs(mean(overlap, lip[0], lip[1]) - mean(orig, lip[0], lip[1])),
    lipOverlapSolo: Math.abs(mean(overlapSolo, lip[0], lip[1]) - mean(orig, lip[0], lip[1])),
  };
};
