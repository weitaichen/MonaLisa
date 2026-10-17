/*
 * CPU reference of P5's 質感 + 調節 stages (v0.4 step-2 spec §4.7) on an RGBA8 image whose skin stages are neutral
 * and whose 濾鏡 is 無 — exactly what the composite reads then, so GPU and CPU start from the same 8-bit values.
 *
 * lut64Cpu() is GPUImageLookupFilter's lookup math (the shader's lut64(), composite.ts), ported: two bilinear taps
 * (GL LINEAR, CLAMP_TO_EDGE) in the neighbouring blue slices, mixed by fract(b·63).
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
import { adjustRgb, clamp01, type AdjustUniforms } from './adjustMath';

const LUT = 512;

/** GL LINEAR + CLAMP_TO_EDGE sample of a 512² RGBA8 texture at normalized (u, v): 0..1 RGB into out[o..o+2] */
function sample(lut: ArrayLike<number>, u: number, v: number, out: number[], o: number): void {
  const x = u * LUT - 0.5;
  const y = v * LUT - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const cx0 = Math.min(LUT - 1, Math.max(0, x0));
  const cx1 = Math.min(LUT - 1, Math.max(0, x0 + 1));
  const cy0 = Math.min(LUT - 1, Math.max(0, y0));
  const cy1 = Math.min(LUT - 1, Math.max(0, y0 + 1));
  const i00 = (cy0 * LUT + cx0) * 4;
  const i10 = (cy0 * LUT + cx1) * 4;
  const i01 = (cy1 * LUT + cx0) * 4;
  const i11 = (cy1 * LUT + cx1) * 4;
  for (let c = 0; c < 3; c++) {
    const top = lut[i00 + c] + (lut[i10 + c] - lut[i00 + c]) * fx;
    const bot = lut[i01 + c] + (lut[i11 + c] - lut[i01 + c]) * fx;
    out[o + c] = (top + (bot - top) * fy) / 255;
  }
}

/** The 512² / 64³ lookup of the shader's lut64() */
export function lut64Cpu(lut: ArrayLike<number>, r: number, g: number, b: number): [number, number, number] {
  const blue = b * 63;
  const q1 = Math.floor(blue);
  const q2 = Math.ceil(blue);
  const q1y = Math.floor(q1 / 8);
  const q1x = q1 - q1y * 8;
  const q2y = Math.floor(q2 / 8);
  const q2x = q2 - q2y * 8;
  const k = 1 / 8 - 1 / 512;
  const h = 0.5 / 512;
  const s = [0, 0, 0, 0, 0, 0];
  sample(lut, q1x / 8 + h + k * r, q1y / 8 + h + k * g, s, 0);
  sample(lut, q2x / 8 + h + k * r, q2y / 8 + h + k * g, s, 3);
  const f = blue - Math.floor(blue);
  return [s[0] + (s[3] - s[0]) * f, s[1] + (s[4] - s[1]) * f, s[2] + (s[5] - s[2]) * f];
}

/** P5's 質感 + 調節 on an RGBA8 image (row 0 = image top = vUv.y ≈ 0); alpha out = 255 like the composite. */
export function compositeCpu(
  src: ArrayLike<number>,
  width: number,
  height: number,
  u: AdjustUniforms,
  lookLut: ArrayLike<number> | null,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let c: number[] = [src[i] / 255, src[i + 1] / 255, src[i + 2] / 255];
      if (u.lookAmt > 0 && lookLut) {
        const a = [clamp01(c[0]), clamp01(c[1]), clamp01(c[2])];
        const t = lut64Cpu(lookLut, a[0], a[1], a[2]);
        c = [a[0] + (t[0] - a[0]) * u.lookAmt, a[1] + (t[1] - a[1]) * u.lookAmt, a[2] + (t[2] - a[2]) * u.lookAmt];
      }
      if (u.adjustOn) c = adjustRgb(c, u, [(x + 0.5) / width, (y + 0.5) / height]);
      out[i] = Math.round(clamp01(c[0]) * 255);
      out[i + 1] = Math.round(clamp01(c[1]) * 255);
      out[i + 2] = Math.round(clamp01(c[2]) * 255);
      out[i + 3] = 255;
    }
  }
  return out;
}
