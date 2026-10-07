/*
 * GPUPixel
 *
 * Created by PixPark on 2021/6/24.
 * Copyright © 2021 PixPark. All rights reserved.
 *
 * Derived from GPUPixel src/filter/beauty_face_unit_filter.cc (GLES variant) and
 * src/filter/box_difference_filter.cc at ef552bf8ce2d0d41fa9b979bfb5c7cf79374ca88.
 * Modified: GLSL ES 3.00; BoxDifference (delta 7.07) folded in, computed in fp32 instead of an
 * RGBA8 intermediate; the skin ramp `p` is optionally gated by our face mask (P0); the whitening
 * chain is faded in with smoothstep(0.0, 0.1, whiten) instead of switching on at full strength;
 * sharpen taps skipped when sharpen = 0, and their offsets scaled by shortEdge/720 like the mean
 * (so preview tiers and the full-res capture sharpen the same footprint); added 紅潤 soft-light
 * tint, a 512² LUT filter (GPUImage 64³ layout, the same lookup math as lookupCustom) and the
 * present flip/mirror (PRESENT_VS); output alpha is 1.0 (opaque export).
 *
 * lut64() (the 512² / 64³ lookup used for lookup_light and the filter LUTs) is GPUImageLookupFilter's
 * lookup math, carried through GPUPixel beauty_face_unit_filter.cc:136-157. Modified: GLSL ES 3.00,
 * written as a function that takes the LUT sampler.
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

// P5 composite + present (RB §2.3 parts 1–2, §2.5). Draw with PRESENT_VS.
// Texture units: 0 src, 1 mean, 2 mask, 3 lookup_gray, 4 lookup_origin, 5 lookup_skin,
// 6 lookup_light, 7 filter LUT.

export const COMPOSITE_UNITS = {
  src: 0,
  mean: 1,
  mask: 2,
  gray: 3,
  origin: 4,
  skin: 5,
  light: 6,
  filter: 7,
} as const;

export const COMPOSITE_FS = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;

uniform sampler2D uSrc;
uniform sampler2D uMean;
uniform sampler2D uMask;
uniform sampler2D uLookupGray;
uniform sampler2D uLookupOrigin;
uniform sampler2D uLookupSkin;
uniform sampler2D uLookupLight;
uniform sampler2D uFilterLut;

uniform vec2 uTexel;      // (shortEdge/720) / processing size (GPUPixel widthOffset, heightOffset at 720)
uniform float uSmooth;    // GPUPixel blurAlpha
uniform float uSharpen;   // GPUPixel sharpen
uniform float uWhiten;    // GPUPixel whiten
uniform float uRosy;      // soft-light opacity (0.35·v)
uniform float uFilterAmt; // LUT mix
uniform float uMaskOn;    // 1 → gate the skin ramp with uMask.r
uniform vec3 uRosyTint;

out vec4 outColor;

const float levelRangeInv = 1.02657;
const float levelBlack = 0.0258820;
const float alpha = 0.7;
const float theta = 0.1;
const float delta = 7.07; // BoxDifferenceFilter default

// 16³ LUT stored as 64×64 in 4×4 tiles (lookup_origin, lookup_skin) — GPUPixel verbatim.
vec3 lut16(sampler2D lut, vec3 texel) {
  float blueColor = texel.b * 15.0;
  vec2 quad1;
  quad1.y = floor(floor(blueColor) * 0.25);
  quad1.x = floor(blueColor) - (quad1.y * 4.0);
  vec2 quad2;
  quad2.y = floor(ceil(blueColor) * 0.25);
  quad2.x = ceil(blueColor) - (quad2.y * 4.0);
  vec2 texPos2 = texel.rg * 0.234375 + 0.0078125;
  vec2 texPos1 = quad1 * 0.25 + texPos2;
  texPos2 = quad2 * 0.25 + texPos2;
  vec3 newColor1 = texture(lut, texPos1).rgb;
  vec3 newColor2 = texture(lut, texPos2).rgb;
  return mix(newColor1, newColor2, fract(blueColor));
}

// 64³ LUT stored as 512×512 in 8×8 tiles (GPUImage layout and lookup math; lookup_light and our filters).
vec3 lut64(sampler2D lut, vec3 color) {
  float blueColor = color.b * 63.0;
  vec2 quad1;
  quad1.y = floor(floor(blueColor) / 8.0);
  quad1.x = floor(blueColor) - (quad1.y * 8.0);
  vec2 quad2;
  quad2.y = floor(ceil(blueColor) / 8.0);
  quad2.x = ceil(blueColor) - (quad2.y * 8.0);
  vec2 texPos1;
  texPos1.x = (quad1.x * 1.0 / 8.0) + 0.5 / 512.0 + ((1.0 / 8.0 - 1.0 / 512.0) * color.r);
  texPos1.y = (quad1.y * 1.0 / 8.0) + 0.5 / 512.0 + ((1.0 / 8.0 - 1.0 / 512.0) * color.g);
  vec2 texPos2;
  texPos2.x = (quad2.x * 1.0 / 8.0) + 0.5 / 512.0 + ((1.0 / 8.0 - 1.0 / 512.0) * color.r);
  texPos2.y = (quad2.y * 1.0 / 8.0) + 0.5 / 512.0 + ((1.0 / 8.0 - 1.0 / 512.0) * color.g);
  vec3 newColor1 = texture(lut, texPos1).rgb;
  vec3 newColor2 = texture(lut, texPos2).rgb;
  return mix(newColor1, newColor2, fract(blueColor));
}

// GPUPixel whitening chain (beauty_face_unit_filter.cc, "if (whiten > 0.0)" block), verbatim.
vec3 whitenChain(vec3 color, float whiten) {
  vec3 colorEPM = color;
  color = clamp((colorEPM - vec3(levelBlack)) * levelRangeInv, 0.0, 1.0);
  vec3 texel = vec3(texture(uLookupGray, vec2(color.r, 0.5)).r,
                    texture(uLookupGray, vec2(color.g, 0.5)).g,
                    texture(uLookupGray, vec2(color.b, 0.5)).b);
  texel = mix(color, texel, 0.5);
  texel = mix(colorEPM, texel, alpha);

  texel = clamp(texel, 0., 1.);
  vec3 colorOrigin = lut16(uLookupOrigin, texel);
  texel = mix(colorOrigin, color, alpha);

  texel = clamp(texel, 0., 1.);
  color = lut16(uLookupSkin, texel);
  color = clamp(color, 0., 1.);

  vec3 color_custom = lut64(uLookupLight, color);
  return mix(color, color_custom, whiten);
}

// W3C soft-light (base a, blend b), per channel.
vec3 softLight(vec3 a, vec3 b) {
  vec3 d = mix(sqrt(a), ((16.0 * a - 12.0) * a + 4.0) * a, step(a, vec3(0.25)));
  vec3 lo = a - (1.0 - 2.0 * b) * a * (1.0 - a);
  vec3 hi = a + (2.0 * b - 1.0) * (d - a);
  return mix(lo, hi, step(vec3(0.5), b));
}

void main() {
  vec3 I = texture(uSrc, vUv).rgb;
  vec3 Mn = texture(uMean, vUv).rgb;

  // BoxDifference folded in.
  vec3 dv = (I - Mn) * delta;
  vec3 V = min(dv * dv, 1.0);

  // Smoothing (GLES gate is blurAlpha >= 0.0, so it always runs; k = 0 when uSmooth = 0).
  float p = clamp((min(I.r, Mn.r - 0.1) - 0.2) * 4.0, 0.0, 1.0);
  p *= mix(1.0, texture(uMask, vUv).r, uMaskOn);
  float meanVar = (V.r + V.g + V.b) / 3.0;
  float kMin = clamp((1.0 - meanVar / (meanVar + theta)) * p * uSmooth, 0.0, 1.0);
  vec3 color = mix(I, Mn, kMin);

  if (uSharpen > 0.0) {
    vec3 sum = 0.25 * I;
    sum += 0.125 * texture(uSrc, vUv + vec2(-uTexel.x, 0.0)).rgb;
    sum += 0.125 * texture(uSrc, vUv + vec2(uTexel.x, 0.0)).rgb;
    sum += 0.125 * texture(uSrc, vUv + vec2(0.0, -uTexel.y)).rgb;
    sum += 0.125 * texture(uSrc, vUv + vec2(0.0, uTexel.y)).rgb;
    sum += 0.0625 * texture(uSrc, vUv + uTexel).rgb;
    sum += 0.0625 * texture(uSrc, vUv - uTexel).rgb;
    sum += 0.0625 * texture(uSrc, vUv + vec2(-uTexel.x, uTexel.y)).rgb;
    sum += 0.0625 * texture(uSrc, vUv + vec2(uTexel.x, -uTexel.y)).rgb;
    vec3 hPass = I - sum;
    color = color + uSharpen * hPass * 2.0;
  }

  if (uWhiten > 0.0) {
    color = mix(color, whitenChain(color, uWhiten), smoothstep(0.0, 0.1, uWhiten));
  }

  if (uRosy > 0.0) {
    vec3 a = clamp(color, 0.0, 1.0);
    color = mix(a, softLight(a, uRosyTint), uRosy * p);
  }

  if (uFilterAmt > 0.0) {
    vec3 a = clamp(color, 0.0, 1.0);
    color = mix(a, lut64(uFilterLut, a), uFilterAmt);
  }

  outColor = vec4(color, 1.0);
}`;
