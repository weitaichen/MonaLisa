// Minimal WebGL2 helpers shared by every pass.
//
// Coordinate convention (RB §2.1): texture v=0 is the IMAGE TOP ROW through the whole FBO chain.
// Sources are uploaded with UNPACK_FLIP_Y=false, the fullscreen triangle writes vUv=(0,0) to
// framebuffer row 0, so every intermediate keeps "row 0 = top". Only the final present to the
// canvas flips Y (and optionally mirrors X). readPixels from an FBO therefore returns rows
// top-first, matching ImageData.

export type GL = WebGL2RenderingContext;

/** Fullscreen triangle, no attributes. vUv covers [0,1]² over the viewport. */
export const FULLSCREEN_VS = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Plain copy, used for blits / scaling. */
export const COPY_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
out vec4 outColor;
void main() { outColor = texture(uSrc, vUv); }`;

export interface Program {
  readonly program: WebGLProgram;
  /** cached uniform location lookup (null when optimised out) */
  u(name: string): WebGLUniformLocation | null;
  use(): void;
  dispose(): void;
}

function compile(gl: GL, type: number, src: string, label: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error(`[${label}] createShader failed`);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(sh) ?? '';
    const numbered = src
      .split('\n')
      .map((l, i) => `${String(i + 1).padStart(3)}: ${l}`)
      .join('\n');
    gl.deleteShader(sh);
    throw new Error(`[${label}] ${type === gl.VERTEX_SHADER ? 'VS' : 'FS'} compile error:\n${log}\n${numbered}`);
  }
  return sh;
}

export function createProgram(gl: GL, vsSrc: string, fsSrc: string, label: string): Program {
  const vs = compile(gl, gl.VERTEX_SHADER, vsSrc, label);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc, label);
  const program = gl.createProgram();
  if (!program) throw new Error(`[${label}] createProgram failed`);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`[${label}] link error: ${log}`);
  }
  const cache = new Map<string, WebGLUniformLocation | null>();
  return {
    program,
    u(name) {
      if (!cache.has(name)) cache.set(name, gl.getUniformLocation(program, name));
      return cache.get(name)!;
    },
    use() {
      gl.useProgram(program);
    },
    dispose() {
      gl.deleteProgram(program);
    },
  };
}

export interface Texture {
  readonly tex: WebGLTexture;
  width: number;
  height: number;
}

export interface TextureOptions {
  internalFormat?: number; // default RGBA8
  format?: number; // default RGBA
  type?: number; // default UNSIGNED_BYTE
  filter?: number; // default LINEAR
}

/** Sets the unpack state every upload in this app relies on (no flip, no premultiply, no colour conversion). */
export function setUnpackState(gl: GL): void {
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
}

export function createTexture(gl: GL, width: number, height: number, opts: TextureOptions = {}): Texture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('createTexture failed');
  const filter = opts.filter ?? gl.LINEAR;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (width > 0 && height > 0) {
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      opts.internalFormat ?? gl.RGBA8,
      width,
      height,
      0,
      opts.format ?? gl.RGBA,
      opts.type ?? gl.UNSIGNED_BYTE,
      null,
    );
  }
  return { tex, width, height };
}

/** Upload a DOM/bitmap source (video frame, ImageBitmap, canvas) into `tex`, resizing as needed. */
export function uploadSource(gl: GL, tex: Texture, source: TexImageSource, width: number, height: number): void {
  gl.bindTexture(gl.TEXTURE_2D, tex.tex);
  setUnpackState(gl);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
  tex.width = width;
  tex.height = height;
}

/** Fetch a PNG and upload it as an RGBA8 LINEAR/CLAMP texture with no colour management. */
export async function loadImageTexture(gl: GL, url: string): Promise<Texture> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const t = createTexture(gl, 0, 0);
  uploadSource(gl, t, bmp, bmp.width, bmp.height);
  bmp.close();
  return t;
}

export function bindTexture(gl: GL, unit: number, tex: Texture | null): void {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex ? tex.tex : null);
}

export function deleteTexture(gl: GL, tex: Texture | null | undefined): void {
  if (tex) gl.deleteTexture(tex.tex);
}

export interface Framebuffer {
  readonly fbo: WebGLFramebuffer;
  readonly tex: Texture;
  readonly internalFormat: number;
  width: number;
  height: number;
}

function formatFor(gl: GL, internalFormat: number): { format: number; type: number } {
  if (internalFormat === gl.R8) return { format: gl.RED, type: gl.UNSIGNED_BYTE };
  if (internalFormat === gl.RGBA16F) return { format: gl.RGBA, type: gl.HALF_FLOAT };
  return { format: gl.RGBA, type: gl.UNSIGNED_BYTE };
}

export function createFramebuffer(gl: GL, width: number, height: number, internalFormat: number = gl.RGBA8): Framebuffer {
  const { format, type } = formatFor(gl, internalFormat);
  const tex = createTexture(gl, width, height, { internalFormat, format, type });
  const fbo = gl.createFramebuffer();
  if (!fbo) throw new Error('createFramebuffer failed');
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex.tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE && !gl.isContextLost()) {
    throw new Error(`framebuffer incomplete: 0x${status.toString(16)}`);
  }
  return { fbo, tex, internalFormat, width, height };
}

/** Reallocate storage when the size changes (no-op otherwise). */
export function resizeFramebuffer(gl: GL, fb: Framebuffer, width: number, height: number): void {
  if (fb.width === width && fb.height === height) return;
  const { format, type } = formatFor(gl, fb.internalFormat);
  gl.bindTexture(gl.TEXTURE_2D, fb.tex.tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, fb.internalFormat, width, height, 0, format, type, null);
  fb.tex.width = fb.width = width;
  fb.tex.height = fb.height = height;
}

export function deleteFramebuffer(gl: GL, fb: Framebuffer | null | undefined): void {
  if (!fb) return;
  gl.deleteFramebuffer(fb.fbo);
  gl.deleteTexture(fb.tex.tex);
}

/** Bind `fb` (or the canvas when null) as the draw target and set the viewport to its size. */
export function bindTarget(gl: GL, fb: Framebuffer | null, width?: number, height?: number): void {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb ? fb.fbo : null);
  gl.viewport(0, 0, fb ? fb.width : width ?? gl.drawingBufferWidth, fb ? fb.height : height ?? gl.drawingBufferHeight);
}

let emptyVao: WebGLVertexArrayObject | null = null;
let emptyVaoGl: GL | null = null;

/** Draw the attribute-less fullscreen triangle with the currently bound program. */
export function drawFullscreen(gl: GL): void {
  if (emptyVaoGl !== gl || !emptyVao) {
    emptyVao = gl.createVertexArray();
    emptyVaoGl = gl;
  }
  gl.bindVertexArray(emptyVao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindVertexArray(null);
}

/** Forget cached GL objects (call after context loss / when disposing a context). */
export function resetGlCaches(): void {
  emptyVao = null;
  emptyVaoGl = null;
}

/** Fit (w,h) so the short edge is at most `shortEdge`, keeping aspect; never upscales. Even sizes. */
export function fitShortEdge(w: number, h: number, shortEdge: number): { width: number; height: number } {
  const s = Math.min(1, shortEdge / Math.min(w, h));
  const even = (n: number) => Math.max(2, Math.round((n * s) / 2) * 2);
  return { width: even(w), height: even(h) };
}

/** Parse '#RRGGBB' → linear-ish 0..1 triple (sRGB values, no conversion). */
export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
