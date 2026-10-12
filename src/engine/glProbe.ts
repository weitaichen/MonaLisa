// Phase 0 GL limits and probes (S §6.2). Limits are plain getParameter reads (free) and are logged once per engine
// build. The probes compile tiny programs and read pixels back, so they run only in /bench.html and dev builds: in
// production they would stall every engine build, and the face-table carrier is a build-time choice anyway.

export function readGlLimits(gl: WebGL2RenderingContext): Record<string, number | boolean> {
  return {
    MAX_FRAGMENT_UNIFORM_VECTORS: gl.getParameter(gl.MAX_FRAGMENT_UNIFORM_VECTORS) as number,
    MAX_UNIFORM_BLOCK_SIZE: gl.getParameter(gl.MAX_UNIFORM_BLOCK_SIZE) as number,
    MAX_TEXTURE_SIZE: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    MAX_TEXTURE_IMAGE_UNITS: gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) as number,
    MAX_ARRAY_TEXTURE_LAYERS: gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number,
    EXT_color_buffer_float: !!gl.getExtension('EXT_color_buffer_float'),
    OES_texture_float_linear: !!gl.getExtension('OES_texture_float_linear'),
  };
}

const VS = `#version 300 es
void main() { vec2 p = vec2(float(gl_VertexID % 2), float(gl_VertexID / 2)) * 4.0 - 1.0; gl_Position = vec4(p, 0.0, 1.0); }`;

/** the four PG1 values: float32 literals, an fp16 or mediump path fails them, ±1e9 overflows fp16 (EMPTY_BOX) */
export const PROBE_VALUES = [0.123456789, 0.999999, 1e9, -1e9] as const;
const LIT = 'vec4(0.123456789, 0.999999, 1e9, -1e9)';

function program(gl: WebGL2RenderingContext, fs: string): WebGLProgram | null {
  const mk = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const v = mk(gl.VERTEX_SHADER, VS);
  const f = mk(gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return null;
  const p = gl.createProgram()!;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  return gl.getProgramParameter(p, gl.LINK_STATUS) ? p : null;
}

/** Draw one pixel with `prog` into a fresh RGBA8 (or RGBA32F) target and read it back. */
function drawPixel(gl: WebGL2RenderingContext, prog: WebGLProgram, float: boolean): Uint8Array | Float32Array {
  // the target is set up on unit 1 and left unbound: unit 0 holds the probed texture, and binding the target there
  // would unbind it and turn the draw into a feedback loop (INVALID_OPERATION, nothing drawn)
  gl.activeTexture(gl.TEXTURE1);
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, float ? gl.RGBA32F : gl.RGBA8, 1, 1, 0, gl.RGBA, float ? gl.FLOAT : gl.UNSIGNED_BYTE, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  gl.activeTexture(gl.TEXTURE0);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  gl.viewport(0, 0, 1, 1);
  gl.useProgram(prog);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const out = float ? new Float32Array(4) : new Uint8Array(4);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, float ? gl.FLOAT : gl.UNSIGNED_BYTE, out);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fbo);
  gl.deleteTexture(tex);
  return out;
}

const near128 = (px: Uint8Array | Float32Array) => Array.from(px).every((v) => Math.abs(v - 128) <= 1);

/**
 * PG1: a 96×2 RGBA32F NEAREST texture and a std140 UBO of 192 vec4 each hold the probe values at their last texel;
 * each is fetched and written as 0.5 + (fetched − expected)·2^16 into RGBA8, passing only at 128 ± 1. With
 * EXT_color_buffer_float the texture path is also rendered into RGBA32F and compared within 2^-20 relative.
 */
export function probeFaceTable(gl: WebGL2RenderingContext): { texture: boolean; ubo: boolean; float32: boolean | null } {
  const data = new Float32Array(96 * 2 * 4);
  data.set(PROBE_VALUES, (96 * 2 - 1) * 4);
  const tex = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D, p, gl.NEAREST);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 96, 2, 0, gl.RGBA, gl.FLOAT, data);
  const texFs = (out: string) => `#version 300 es
precision highp float;
uniform highp sampler2D uT;
out vec4 o;
void main() { vec4 v = texelFetch(uT, ivec2(95, 1), 0); ${out} }`;
  let texture = false;
  let float32: boolean | null = null;
  const p1 = program(gl, texFs(`o = vec4(0.5) + (v - ${LIT}) * 65536.0 / 255.0;`));
  if (p1) {
    gl.useProgram(p1);
    gl.uniform1i(gl.getUniformLocation(p1, 'uT'), 0);
    texture = near128(drawPixel(gl, p1, false));
    gl.deleteProgram(p1);
  }
  if (gl.getExtension('EXT_color_buffer_float')) {
    const p2 = program(gl, texFs('o = v;'));
    if (p2) {
      gl.useProgram(p2);
      gl.uniform1i(gl.getUniformLocation(p2, 'uT'), 0);
      const got = drawPixel(gl, p2, true);
      float32 = PROBE_VALUES.every((v, i) => Math.abs(got[i] - Math.fround(v)) <= Math.abs(Math.fround(v)) * 2 ** -20);
      gl.deleteProgram(p2);
    }
  }
  gl.deleteTexture(tex);

  let ubo = false;
  const p3 = program(
    gl,
    `#version 300 es
precision highp float;
layout(std140) uniform T { vec4 uT[192]; };
out vec4 o;
void main() { o = vec4(0.5) + (uT[191] - ${LIT}) * 65536.0 / 255.0; }`,
  );
  if (p3) {
    const buf = gl.createBuffer()!;
    gl.bindBuffer(gl.UNIFORM_BUFFER, buf);
    gl.bufferData(gl.UNIFORM_BUFFER, data, gl.STATIC_DRAW);
    gl.uniformBlockBinding(p3, gl.getUniformBlockIndex(p3, 'T'), 0);
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, buf);
    ubo = near128(drawPixel(gl, p3, false));
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, null);
    gl.deleteBuffer(buf);
    gl.deleteProgram(p3);
  }
  return { texture, ubo, float32 };
}

/** PG2: a 2-layer R16F TEXTURE_2D_ARRAY, LINEAR, sampled with textureLod between the two texels of layer 1 → 0.5. */
export function probeR16FArray(gl: WebGL2RenderingContext): boolean {
  const tex = gl.createTexture()!;
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  for (const p of [gl.TEXTURE_MIN_FILTER, gl.TEXTURE_MAG_FILTER]) gl.texParameteri(gl.TEXTURE_2D_ARRAY, p, gl.LINEAR);
  for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D_ARRAY, p, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.R16F, 2, 1, 2, 0, gl.RED, gl.FLOAT, new Float32Array([0, 0, 0.25, 0.75]));
  const p = program(
    gl,
    `#version 300 es
precision highp float;
uniform mediump sampler2DArray uA;
out vec4 o;
void main() { o = vec4(textureLod(uA, vec3(0.5, 0.5, 1.0), 0.0).r, 0.5, 0.5, 0.5); }`,
  );
  let ok = false;
  if (p) {
    gl.useProgram(p);
    gl.uniform1i(gl.getUniformLocation(p, 'uA'), 0);
    ok = near128(drawPixel(gl, p, false));
    gl.deleteProgram(p);
  }
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
  gl.deleteTexture(tex);
  return ok;
}
