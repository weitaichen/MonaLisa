// 膚質 engine harness (skin-cleanup spec §8.2): renders the step-4 passes on the dev server with the recorded face of
// sample_face.png and hands raw RGBA8 readbacks (base64) or lossless PNGs to tests/e2e/tone-engine.spec.ts, which
// compares them with the CPU references in Node.
import landmarks from '../../fixtures/landmarks_sample_face.json';
import { createFramebuffer, type Framebuffer } from '../../../src/engine/gl/gl';
import { createToneMaskPass } from '../../../src/engine/passes/toneMask';
import { IDENTITY_WIN, NEUTRAL_TONE, Q_CLEAR, R_CLEAR, toneDrawsQ, toneDrawsR, type ToneFaceInput, type ToneValues } from '../../../src/engine/passes/toneGeometry';
import { adapt } from '../../../src/tracking/adapter111';

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

declare global {
  interface Window {
    runToneMasks?: () => { w: number; h: number; err: number; R: string; Qwarm: string; Qcool: string };
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
