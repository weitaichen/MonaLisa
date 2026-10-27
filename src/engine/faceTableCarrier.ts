// Which face-table carrier the reshape pass is built with (S §4.4). Both carriers sit behind RESHAPE_FS's F(f, i) and
// give the same floats; only their speed differs by renderer (S §6.4, 2026-10-18 rows R): on the desktop GPU the UBO
// draws 8 clustered faces at 2048 in 4.4–4.8 ms against 11.8–12.3 ms for the texture, while on SwiftShader (the e2e
// renderer) the UBO program is 2–3.5× slower than the texture one (3.2× even with no face listed). So a GPU gets
// FACE_TABLE_CARRIER (PR1: the faster carrier ships; the iPhone rows can flip it) and a software rasterizer the texture.
import { FACE_TABLE_CARRIER } from '../config/limits';

/** WebGL renderer strings of software rasterizers: Chromium's SwiftShader, Mesa's llvmpipe / softpipe, Windows' WARP */
const SOFTWARE = /swiftshader|llvmpipe|softpipe|basic render driver/i;

/** the unmasked renderer when the context offers WEBGL_debug_renderer_info, else RENDERER; null when unreadable */
export function rendererOf(gl: WebGL2RenderingContext): string | null {
  const ext = gl.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL: number } | null;
  const unmasked: unknown = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
  if (typeof unmasked === 'string') return unmasked;
  const r: unknown = gl.getParameter(gl.RENDERER);
  return typeof r === 'string' ? r : null;
}

/** the carrier for a renderer string: the texture on a software rasterizer, FACE_TABLE_CARRIER otherwise */
export function faceTableCarrier(renderer: string | null): 'texture' | 'ubo' {
  return renderer && SOFTWARE.test(renderer) ? 'texture' : FACE_TABLE_CARRIER;
}
