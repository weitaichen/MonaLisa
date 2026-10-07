// Present stage: the only place the image is flipped / mirrored (coordinate convention in gl.ts).
// uOut = (±1, ±1) scales clip space: y = −1 puts texture row 0 (image top) at the top of the
// canvas; y = +1 keeps row 0 at framebuffer row 0 for readPixels capture; x = −1 mirrors.
// The attribute-less fullscreen triangle still covers the viewport after negation.

export const PRESENT_VS = /* glsl */ `#version 300 es
uniform vec2 uOut;
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4((p * 2.0 - 1.0) * uOut, 0.0, 1.0);
}`;

/** Plain source draw for hold-to-compare (renderOriginal). */
export const PRESENT_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
out vec4 outColor;
void main() { outColor = vec4(texture(uSrc, vUv).rgb, 1.0); }`;
