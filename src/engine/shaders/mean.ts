/*
 * GPUPixel
 *
 * Created by PixPark on 2021/6/24.
 * Copyright © 2021 PixPark. All rights reserved.
 *
 * Derived from GPUPixel src/filter/box_mono_blur_filter.cc (+ box_blur_filter.cc,
 * gaussian_blur_mono_filter.cc) at ef552bf8ce2d0d41fa9b979bfb5c7cf79374ca88, which ports
 * GPUImageBoxBlurFilter.m. Modified: GLSL ES 3.00; the generated shader for radius 4 is written
 * out by hand; `lowp vec4 sum` accumulator replaced by highp; one program for both axes (uStep);
 * the texel spacing is scaled by shortEdge/720 by the host (RB §2.3) instead of fixed pixels.
 *
 * GPUImage — Copyright (c) 2012, Brad Larson, Ben Cochran, Hugues Lismonde, Keitaroh Kobayashi,
 * Alaric Cole, Matthew Clark, Jacob Gundersen, Chris Williams. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification, are permitted
 * provided that the following conditions are met:
 *
 * Redistributions of source code must retain the above copyright notice, this list of conditions
 * and the following disclaimer.
 * Redistributions in binary form must reproduce the above copyright notice, this list of
 * conditions and the following disclaimer in the documentation and/or other materials provided
 * with the distribution.
 * Neither the name of the GPUImage framework nor the names of its contributors may be used to
 * endorse or promote products derived from this software without specific prior written
 * permission.
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR
 * IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND
 * FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
 * SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR
 * OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 * POSSIBILITY OF SUCH DAMAGE.
 */

// Sparse 5-tap separable "box" mean: taps at {0, ±1.5, ±3.5} × uStep, weights 1/9 and 2/9
// (boxWeight = 1/(2·radius+1) with radius 4). Tap coordinates are computed per vertex, as in the
// GPUImage original.

export const MEAN_VS = /* glsl */ `#version 300 es
uniform vec2 uStep;
out vec2 vUv;
out vec4 vTap1;
out vec4 vTap2;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  vTap1 = vec4(p + uStep * 1.5, p - uStep * 1.5);
  vTap2 = vec4(p + uStep * 3.5, p - uStep * 3.5);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

export const MEAN_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
in vec4 vTap1;
in vec4 vTap2;
uniform sampler2D uSrc;
out vec4 outColor;
void main() {
  vec4 sum = texture(uSrc, vUv) * 0.111111;
  sum += texture(uSrc, vTap1.xy) * 0.222222;
  sum += texture(uSrc, vTap1.zw) * 0.222222;
  sum += texture(uSrc, vTap2.xy) * 0.222222;
  sum += texture(uSrc, vTap2.zw) * 0.222222;
  outColor = sum;
}`;
