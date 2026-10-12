// v0.3 parity cases (RM §8.3, S §8.3): the same inputs through whatever the engine API is at the time. Recorded on
// 892ea61 by scripts/record-parity.mjs into tests/fixtures/parity-v03/, compared by tests/e2e/parity.spec.ts after
// every task. Only this file is ported when an API changes; the goldens never are.
import landmarks from '../../fixtures/landmarks_sample_face.json';
import pose from '../../fixtures/pose_fullbody.json';
import { measureBody } from '../../../src/body/measure';
import { buildBodyField } from '../../../src/body/field';
import { legacyFrame } from '../../../src/edit/frame';
import { createEngine } from '../../../src/engine/index';
import { applyPreset, PARAM_DEFS, setHeightBand, setParam, setShade } from '../../../src/engine/params';
import { adapt } from '../../../src/tracking/adapter111';
import type { BeautyParams, BodyDetection, RenderInput } from '../../../src/types';

export type ParityCase = 'natural' | 'refined-shape-max' | 'makeup-shades' | 'fullbody-body';

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

  const shapeMax = PARAM_DEFS.filter((d) => d.group === 'shape').reduce((p, d) => setParam(p, d.id, 1), applyPreset('refined', 1));
  const shades = setShade(setShade(applyPreset('natural', 1), 'lip', 'rose'), 'blush', 'peach');

  const det: BodyDetection = {
    pose: { points: new Float32Array(pose.points) },
    mask: pose.mask ? { width: pose.mask.width, height: pose.mask.height, data: Uint8Array.from(atob(pose.mask.data), (c) => c.charCodeAt(0)) } : null,
    people: pose.people,
    width: pose.width,
    height: pose.height,
  };
  const bodyParams = setHeightBand(setParam(setParam(applyPreset('natural', 1), 'body.waist', 1), 'body.legs', 1), { top: 0.55, bottom: 0.85, amount: 0.6 });
  const field = buildBodyField(measureBody(det, null), bodyParams, body.width / body.height);

  const png = {} as Record<ParityCase, string>;
  png.natural = toPng(engine.renderToImageData(onFace(applyPreset('natural', 1)), { mirror: false }));
  png['refined-shape-max'] = toPng(engine.renderToImageData(onFace(shapeMax), { mirror: false }));
  png['makeup-shades'] = toPng(engine.renderToImageData(onFace(shades), { mirror: false }));
  png['fullbody-body'] = toPng(
    engine.renderToImageData({ source: body, width: body.width, height: body.height, ...legacyFrame(bodyParams, null, 0), body: field }, { mirror: false }),
  );
  engine.dispose();
  face.close();
  body.close();
  return { renderer, png };
};
