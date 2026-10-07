// Generates src/engine/passes/faceMesh.ts from GPUPixel's face_makeup_filter.cc (pinned commit),
// so the 111 template coordinates and 528 indices are copied verbatim, never retyped.
// Usage: node tests/harness/t2/gen-face-mesh.mjs [local/path/to/face_makeup_filter.cc]
import { readFileSync, writeFileSync } from 'node:fs';

const PIN = 'ef552bf8ce2d0d41fa9b979bfb5c7cf79374ca88';
const SRC_URL = `https://raw.githubusercontent.com/pixpark/gpupixel/${PIN}/src/filter/face_makeup_filter.cc`;

const src = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : await (await fetch(SRC_URL)).text();

function body(re, label) {
  const m = src.match(re);
  if (!m) throw new Error(`could not find ${label}`);
  return m[1];
}

// Strip // comments, then pull every numeric literal in source order.
const nums = (s, re) => s.replace(/\/\/[^\n]*/g, '').match(re).map(Number);

const idxBody = body(/static std::vector<uint32_t> faceIndexs\{([\s\S]*?)\};/, 'GetFaceIndexs');
const coordBody = body(/static std::vector<float> arr = \{([\s\S]*?)\};/, 'FaceTextureCoordinates');

const indices = nums(idxBody, /\d+/g);
const coords = nums(coordBody, /\d+\.\d+/g);
// Keep the literal text of each float so the TS file is a byte-faithful copy of the source values.
const coordText = coordBody.replace(/\/\/[^\n]*/g, '').match(/\d+\.\d+/g);

// Section comments from GetFaceIndexs, re-attached to their index runs.
const sections = [];
{
  const lines = idxBody.split('\n');
  let cur = null;
  for (const line of lines) {
    const c = line.match(/\/\/\s*(.*)$/);
    const code = line.replace(/\/\/[^\n]*/, '');
    if (c) {
      if (cur && cur.vals.length === 0) cur.title += ' ' + c[1].trim();
      else sections.push((cur = { title: c[1].trim(), vals: [] }));
    }
    const v = code.match(/\d+/g);
    if (v) cur.vals.push(...v.map(Number));
  }
}

if (coords.length !== 222) throw new Error(`expected 222 coords, got ${coords.length}`);
if (indices.length !== 528) throw new Error(`expected 528 indices, got ${indices.length}`);
if (sections.reduce((n, s) => n + s.vals.length, 0) !== 528) throw new Error('section split mismatch');
if (Math.max(...indices) > 110) throw new Error('index out of range');

const wrap = (items, per, indent) => {
  const out = [];
  for (let i = 0; i < items.length; i += per) out.push(indent + items.slice(i, i + per).join(', ') + ',');
  return out.join('\n');
};

const pairs = [];
for (let i = 0; i < coordText.length; i += 2) pairs.push(`${coordText[i]}, ${coordText[i + 1]}`);

const ts = `/*
 * GPUPixel
 *
 * Created by PixPark on 2021/6/24.
 * Copyright © 2021 PixPark. All rights reserved.
 */
// Derived from GPUPixel src/filter/face_makeup_filter.cc (pixpark/gpupixel@${PIN.slice(0, 7)}, Apache-2.0);
// modified: FaceTextureCoordinates() and GetFaceIndexs() data extracted verbatim by
// tests/harness/t2/gen-face-mesh.mjs into typed arrays (Uint16 indices for WebGL); lipstick / blusher
// texture bounds from lipstick_filter.cc / blusher_filter.cc. GENERATED FILE — do not edit by hand.

/** GPUPixel template coordinates are normalised by this square frame size (\`coord * 1280\`). */
export const TEMPLATE_FRAME = 1280;

/** Pixel rectangle of a makeup texture inside the 1280×1280 template frame. */
export interface TextureBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** lipstick_filter.cc: mouth.png (105×67) scaled ×2.5 */
export const LIP_BOUNDS: TextureBounds = { x: 502.5, y: 710, width: 262.5, height: 167.5 };
/** blusher_filter.cc: blusher.png (489×209) at 1:1 */
export const BLUSH_BOUNDS: TextureBounds = { x: 395, y: 520, width: 489, height: 209 };

/** FaceTextureCoordinates(): 111 × (x, y), top-left origin, normalised by TEMPLATE_FRAME. */
// prettier-ignore
export const FACE_TEMPLATE: Float32Array = new Float32Array([
${wrap(pairs, 4, '  ')}
]);

/** GetFaceIndexs(): 176 triangles over the 111 points. */
// prettier-ignore
export const FACE_INDICES: Uint16Array = new Uint16Array([
${sections.map((s) => `  // ${s.title}\n${wrap(s.vals, 18, '  ')}`).join('\n')}
]);

/** Per-vertex texture coordinates of a makeup texture: \`(template·1280 − bounds.xy) / bounds.wh\` (face_makeup_filter.cc). */
export function templateUvs(bounds: TextureBounds): Float32Array {
  const uv = new Float32Array(FACE_TEMPLATE.length);
  for (let i = 0; i < FACE_TEMPLATE.length; i += 2) {
    uv[i] = (FACE_TEMPLATE[i] * TEMPLATE_FRAME - bounds.x) / bounds.width;
    uv[i + 1] = (FACE_TEMPLATE[i + 1] * TEMPLATE_FRAME - bounds.y) / bounds.height;
  }
  return uv;
}
`;

writeFileSync(new URL('../../../src/engine/passes/faceMesh.ts', import.meta.url), ts);
console.log(`faceMesh.ts: ${coords.length / 2} points, ${indices.length} indices, ${sections.length} sections`);
