// v0.3 parity cases (RM §8.3, S §8.3): the same inputs through whatever the engine API is at the time. Recorded on
// 892ea61 by scripts/record-parity.mjs into tests/fixtures/parity-v03/, compared by tests/e2e/parity.spec.ts after
// every task. Only this file is ported when an API changes; the goldens never are.
// 'face-body' (step-1 follow-up) goes through the editor's own path instead of a test adapter, so a regression in the
// pairing, buildFrame, frameFacesOf, fieldInputOf or buildBodyField fails parity. Its golden was recorded the same way
// on f877881 (src identical to 892ea61, and the four older goldens re-recorded byte-identical there) by adding to that
// commit's page, in the v0.3 API:
//   const faceDet: BodyDetection = <sample_face.pose.json, as det below>;
//   const faceBodyParams = setParam(setParam(applyPreset('natural', 1), 'body.neck', 1), 'body.head', 1);
//   const faceField = buildBodyField(measureBody(faceDet, f), faceBodyParams, face.width / face.height);
//   png['face-body'] = toPng(engine.renderToImageData({ ...onFace(faceBodyParams), body: faceField }, { mirror: false }));
// (天鵝頸 and 小頭 are the 美體 items a head-and-shoulders photo allows, and only when measured with its face.)
import landmarks from '../../fixtures/landmarks_sample_face.json';
import pose from '../../fixtures/pose_fullbody.json';
import facePose from '../../fixtures/sample_face.pose.json';
import { measureBody } from '../../../src/body/measure';
import { buildBodyField, buildBodyFieldV1 } from '../../../src/body/field';
import { prepareFaces } from '../../../src/detect/faces';
import { buildFrame, legacyFrame } from '../../../src/edit/frame';
import { firstAnswer, openState } from '../../../src/edit/migrate';
import { createEngine } from '../../../src/engine/index';
import { applyPreset, setHeightBand, setParam, setShade } from '../../../src/engine/params';
import { adapt } from '../../../src/tracking/adapter111';
import { BodyFieldMemo, fieldInputOf, frameFacesOf, measurePersons } from '../../../src/ui/editorModel';
import type { BeautyParams, BodyDetection, Face, HistoryEntry, ParamId, RenderInput } from '../../../src/types';

export type ParityCase = 'natural' | 'refined-shape-max' | 'makeup-shades' | 'fullbody-body' | 'face-body';

declare global {
  interface Window {
    runParity?: () => Promise<{ renderer: string; png: Record<ParityCase, string> }>;
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

async function bitmapOf(url: string, w?: number, h?: number): Promise<ImageBitmap> {
  const blob = await (await fetch(url)).blob();
  const opts: ImageBitmapOptions = { colorSpaceConversion: 'none', premultiplyAlpha: 'none' };
  return createImageBitmap(blob, w && h ? { ...opts, resizeWidth: w, resizeHeight: h, resizeQuality: 'high' } : opts);
}

/** sample_face.pose.json as the BodyDetection a v0.3 history entry cached (HistoryEntry.body) */
const faceDet = (): BodyDetection => ({
  pose: { points: new Float32Array(facePose.points) },
  mask: facePose.mask ? { width: facePose.mask.width, height: facePose.mask.height, data: Uint8Array.from(atob(facePose.mask.data), (c) => c.charCodeAt(0)) } : null,
  people: facePose.people,
  width: facePose.width,
  height: facePose.height,
});

/**
 * 'face-body' as the editor renders it (S §3.3): a v0.3 entry with a cached body opens (openState: editFromLegacy), the
 * first face answer pairs the face with that body (firstAnswer: buildCache, pairPersons, assignPersons), the 美體 field
 * comes from the persons (measurePersons with the PAIRED face, fieldInputOf, BodyFieldMemo → buildBodyField) and the
 * frame from the edit (frameFacesOf, buildFrame; no 瘦臉 limit was requested).
 */
function faceBodyInEditor(face: ImageBitmap, f: Face): RenderInput {
  const size = { width: face.width, height: face.height };
  const params = setParam(setParam(applyPreset('natural', 1), 'body.neck', 1), 'body.head', 1);
  const entry: HistoryEntry = { id: 'parity', createdAt: 0, updatedAt: 0, original: new Blob([]), thumb: new Blob([]), params, width: size.width, height: size.height, body: faceDet() };
  const opened = openState(entry, size);
  // the session's faces: what still.ts detectOnce keeps of the tracker's answer
  const prepared = prepareFaces([{ points: new Float32Array(landmarks.points) }], size.width, size.height);
  const faces = prepared.faces;
  if (faces.length !== 1 || faces[0].face.pts111.some((v, i) => v !== f.pts111[i])) throw new Error('face-body: the session face is not the parity face');
  const answer = firstAnswer({ detect: opened.detect, prepared, size, v1Body: opened.v1Body, rematch: opened.rematch, faceSeed: null });
  const edit = answer.rebase(opened.edit);
  const cache = answer.detect;
  const [person] = cache.persons;
  if (cache.persons.length !== 1 || !person.face || !person.body) throw new Error(`face-body: one person with a face and a body expected, got ${JSON.stringify(cache.persons)}`);
  const measures = measurePersons(cache, (id) => faces.find((x) => x.id === id)?.face ?? null, measureBody, (e) => {
    throw e;
  });
  const body = new BodyFieldMemo(buildBodyField).update(fieldInputOf(edit, cache, measures, size.width / size.height)).field;
  const frame = buildFrame(edit, frameFacesOf(cache, faces), cache.obstacles, new Map(), cache.primary);
  return { source: face, width: size.width, height: size.height, ...frame, body };
}

window.runParity = async () => {
  // half size keeps the four committed goldens under 3 MB (landmarks are normalized: any size works)
  const face = await bitmapOf('/tests/fixtures/sample_face.png', 500, 750);
  const body = await bitmapOf('/tests/fixtures/fullbody.jpg');
  const canvas = document.getElementById('gl') as HTMLCanvasElement;
  const engine = createEngine(canvas, { mirror: false });
  await engine.ready;
  await engine.loadFilter('soft');
  const gl = canvas.getContext('webgl2') as WebGL2RenderingContext;
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const renderer = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER));

  const f = adapt({ points: new Float32Array(landmarks.points) }, face.width, face.height);
  const onFace = (params: BeautyParams): RenderInput => ({ source: face, width: face.width, height: face.height, ...legacyFrame(params, f, 1) });

  // 美型 max = the nine 美型 items of v0.3 (892ea61's shape group) at max. Step 5 adds six items to the group, which the
  // golden never saw; they stay neutral here, as RM §1.1's invariant (every new item neutral) requires.
  const V03_SHAPE: ParamId[] = [
    'shape.eyeEnlarge', 'shape.faceSlim', 'shape.faceV', 'shape.faceNarrow', 'shape.chin', 'shape.forehead', 'shape.noseSlim', 'shape.mouthSize', 'shape.eyeDistance',
  ];
  const shapeMax = V03_SHAPE.reduce((p, id) => setParam(p, id, 1), applyPreset('refined', 1));
  const shades = setShade(setShade(applyPreset('natural', 1), 'lip', 'rose'), 'blush', 'peach');

  const det: BodyDetection = {
    pose: { points: new Float32Array(pose.points) },
    mask: pose.mask ? { width: pose.mask.width, height: pose.mask.height, data: Uint8Array.from(atob(pose.mask.data), (c) => c.charCodeAt(0)) } : null,
    people: pose.people,
    width: pose.width,
    height: pose.height,
  };
  const bodyParams = setHeightBand(setParam(setParam(applyPreset('natural', 1), 'body.waist', 1), 'body.legs', 1), { top: 0.55, bottom: 0.85, amount: 0.6 });
  const field = buildBodyFieldV1(measureBody(det, null), bodyParams, body.width / body.height);

  const png = {} as Record<ParityCase, string>;
  png.natural = toPng(engine.renderToImageData(onFace(applyPreset('natural', 1)), { mirror: false }));
  png['refined-shape-max'] = toPng(engine.renderToImageData(onFace(shapeMax), { mirror: false }));
  png['makeup-shades'] = toPng(engine.renderToImageData(onFace(shades), { mirror: false }));
  png['face-body'] = toPng(engine.renderToImageData(faceBodyInEditor(face, f), { mirror: false }));
  png['fullbody-body'] = toPng(
    engine.renderToImageData({ source: body, width: body.width, height: body.height, ...legacyFrame(bodyParams, null, 0), body: field }, { mirror: false }),
  );
  engine.dispose();
  face.close();
  body.close();
  return { renderer, png };
};
