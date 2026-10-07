// Engine render check (spec §10 "Engine"): renders tests/fixtures/sample_face.png through the real
// engine with fixed params and the recorded landmark fixture, and hands lossless PNGs back to the
// Playwright test, which compares them with the pngjs-decoded source in Node.
import landmarks from '../../fixtures/landmarks_sample_face.json';
import { createEngine } from '../../../src/engine/index';
import { applyPreset, setFilter, setParam, setShade } from '../../../src/engine/params';
import { adapt } from '../../../src/tracking/adapter111';
import type { BeautyParams, RenderInput } from '../../../src/types';

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
  const input = (params: BeautyParams): RenderInput => ({ source: bitmap, width, height, face, faceWeight: 1, params });

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
