// Generates the 膚質 engine-harness fixture (skin-cleanup spec §8.3): tests/fixtures/sample_face.png with synthetic
// blemishes, blotches, dark circles, nasolabial folds, yellow teeth and red sclera, placed from its recorded landmarks
// (tests/fixtures/landmarks_sample_face.json), plus a JSON listing every defect. Deterministic; Node + pngjs only. Both
// outputs are gitignored and made by tests/e2e/global-setup.ts when missing or older than this script.
//   node scripts/gen-tone-fixture.mjs   → tests/fixtures/sample_face_tone.png + tests/fixtures/sample_face_tone.json
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = (p) => resolve(root, 'tests/fixtures', p);

// ── the part of src/tracking/adapter111.ts this script needs (tests/unit/toneFixture.test.ts pins it to adapt()) ──
const CONTOUR_LEFT = [[162, 127], 127, 234, 93, 132, 58, 172, 136, 150, 149, 176, 148, 152];
const CONTOUR_RIGHT = [152, 377, 400, 378, 379, 365, 397, 288, 361, 323, 454, 356, [356, 389]];
const DIRECT = [
  70, 63, 105, 66, 107, 336, 296, 334, 293, 300, 6, 195, 5, 1, 98, 97, 2, 326, 327, 33, 160, 157, 133, 154, 144, 362, 384, 387, 263,
  373, 381, 46, 52, 65, 55, 285, 295, 282, 276, 159, 145, [33, 133], 386, 374, [362, 263], 245, 465, 48, 278, 64, 294, 61, 39, 37, 0,
  267, 269, 291, 321, 314, 17, 84, 91, 78, 81, 13, 311, 308, 402, 14, 178, 468, 473,
];
const MIDS = [[106, 98, 102], [107, 35, 65], [108, 40, 70], [109, 5, 80], [110, 27, 81]];

/** pts111 (normalized, 222 values) of MediaPipe's 478 points, built as adapt() builds them */
export function pts111Of(points, width, height) {
  const sx = (s) => (typeof s === 'number' ? points[s * 3] : (points[s[0] * 3] + points[s[1] * 3]) * 0.5);
  const sy = (s) => (typeof s === 'number' ? points[s * 3 + 1] : (points[s[0] * 3 + 1] + points[s[1] * 3 + 1]) * 0.5);
  const out = new Float64Array(222);
  const resample = (chain, first) => {
    const X = [];
    const Y = [];
    const C = [0];
    chain.forEach((s, i) => {
      X.push(sx(s) * width);
      Y.push(sy(s) * height);
      if (i > 0) C.push(C[i - 1] + Math.hypot(X[i] - X[i - 1], Y[i] - Y[i - 1]));
    });
    const total = C[C.length - 1];
    let seg = 0;
    for (let k = 0; k < 17; k++) {
      const t = (total * k) / 16;
      while (seg < chain.length - 2 && C[seg + 1] < t) seg++;
      const len = C[seg + 1] - C[seg];
      const f = len > 0 ? Math.min(1, Math.max(0, (t - C[seg]) / len)) : 0;
      out[(first + k) * 2] = (X[seg] + (X[seg + 1] - X[seg]) * f) / width;
      out[(first + k) * 2 + 1] = (Y[seg] + (Y[seg + 1] - Y[seg]) * f) / height;
    }
  };
  resample(CONTOUR_LEFT, 0);
  resample(CONTOUR_RIGHT, 16);
  DIRECT.forEach((s, i) => {
    out[(33 + i) * 2] = sx(s);
    out[(33 + i) * 2 + 1] = sy(s);
  });
  for (const [d, a, b] of MIDS) {
    out[d * 2] = (out[a * 2] + out[b * 2]) * 0.5;
    out[d * 2 + 1] = (out[a * 2 + 1] + out[b * 2 + 1]) * 0.5;
  }
  return out;
}

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
// JPEG full-range YCbCr (skin-cleanup spec §4.4)
const toYcc = (r, g, b) => [0.299 * r + 0.587 * g + 0.114 * b, 0.5 - 0.168736 * r - 0.331264 * g + 0.5 * b, 0.5 + 0.5 * r - 0.418688 * g - 0.081312 * b];
const toRgb = (y, cb, cr) => [y + 1.402 * (cr - 0.5), y - 0.344136 * (cb - 0.5) - 0.714136 * (cr - 0.5), y + 1.772 * (cb - 0.5)];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const mul = (a, k) => [a[0] * k, a[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);
const unit = (a) => mul(a, 1 / (len(a) || 1));
const mid = (a, b) => mul(add(a, b), 0.5);
function inPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function segDist(p, a, b) {
  const ab = sub(b, a);
  const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return len(sub(p, add(a, mul(ab, t))));
}

export function generateToneFixture(
  srcPng = readFileSync(fixture('sample_face.png')),
  lm = JSON.parse(readFileSync(fixture('landmarks_sample_face.json'), 'utf8')),
) {
  const src = PNG.sync.read(srcPng);
  const W = src.width;
  const H = src.height;
  const P111 = pts111Of(lm.points, lm.width, lm.height);
  const P = (i) => [P111[i * 2] * W, P111[i * 2 + 1] * H];
  const M = (i) => [lm.points[i * 3] * W, lm.points[i * 3 + 1] * H];
  const ext1 = M(151);
  const menton = M(152);
  const fw = len(sub(P(0), P(32)));
  const xhat = unit(sub(P(77), P(74)));
  let yhat = [-xhat[1], xhat[0]];
  if (dot(yhat, sub(menton, P(46))) < 0) yhat = mul(yhat, -1);
  const eyeW = { L: len(sub(P(52), P(55))), R: len(sub(P(58), P(61))) };
  const data = Buffer.from(src.data);
  const defects = [];

  /**
   * Applies `edit(ycc, g)` to every pixel of `box` whose weight g = weight(pixel centre, ycc) is > 0.01 and records the
   * defect; `core` keeps only pixels with g ≥ 0.5 in the list (the Gaussian defects), else every changed pixel is listed.
   */
  function apply(kind, name, center, box, weight, edit, extra = {}, core = false) {
    const x0 = Math.max(0, Math.floor(box[0]));
    const y0 = Math.max(0, Math.floor(box[1]));
    const x1 = Math.min(W - 1, Math.ceil(box[2]));
    const y1 = Math.min(H - 1, Math.ceil(box[3]));
    const pixels = [];
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = (y * W + x) * 4;
        const ycc = toYcc(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
        const g = weight([x + 0.5, y + 0.5], ycc);
        if (!(g > 0.01)) continue;
        const rgb = toRgb(...edit(ycc, g));
        for (let c = 0; c < 3; c++) data[i + c] = Math.round(Math.min(1, Math.max(0, rgb[c])) * 255);
        if (!core || g >= 0.5) pixels.push([x, y, Math.round(g * 1000) / 1000]);
      }
    }
    defects.push({ kind, name, center: [Math.round(center[0] * 10) / 10, Math.round(center[1] * 10) / 10], ...extra, box: [x0, y0, x1, y1], pixels });
  }

  // 3 blemishes, Gaussian σ 5 px: Y × (1 − 0.22 g), Cr + 0.03 g
  const gauss = (c, s) => (p) => {
    const d = len(sub(p, c));
    return d <= 3 * s ? Math.exp(-(d * d) / (2 * s * s)) : 0;
  };
  for (const [name, c] of [
    ['dot1', mid(P(6), P(82))],
    ['dot2', mid(ext1, P(35))],
    ['dot3', add(mul(P(26), 0.6), mul(P(83), 0.4))],
  ]) {
    const s = 5;
    apply('blemish', name, c, [c[0] - 3 * s, c[1] - 3 * s, c[0] + 3 * s, c[1] + 3 * s], gauss(c, s), ([y, cb, cr], g) => [y * (1 - 0.22 * g), cb, cr + 0.03 * g], { sigma: s }, true);
  }
  // 2 blotches for 勻膚, Gaussian σ 0.04 fw: Cr + 0.025 g, Y × (1 − 0.03 g)
  for (const [name, c] of [
    ['blotch1', mid(P(77), P(26))],
    ['blotch2', mid(ext1, P(40))],
  ]) {
    const s = 0.04 * fw;
    apply('blotch', name, c, [c[0] - 3 * s, c[1] - 3 * s, c[0] + 3 * s, c[1] + 3 * s], gauss(c, s), ([y, cb, cr], g) => [y * (1 - 0.03 * g), cb, cr + 0.025 * g], { sigma: Math.round(s * 100) / 100 }, true);
  }
  // dark circles: an ellipse under each eye, centre = lower-mid lid + 0.22 eyeW·ŷ, semi-axes 0.45 × 0.16 eyeW (x̂ × ŷ),
  // feathered over its outer 30 %: Y × (1 − 0.16 g), Cb + 0.015 g
  for (const [name, lid, w] of [
    ['darkL', P(73), eyeW.L],
    ['darkR', P(76), eyeW.R],
  ]) {
    const c = add(lid, mul(yhat, 0.22 * w));
    const a = 0.45 * w;
    const b = 0.16 * w;
    const weight = (p) => {
      const d = sub(p, c);
      const rho = Math.hypot(dot(d, xhat) / a, dot(d, yhat) / b);
      return 1 - smooth(0.7, 1, rho);
    };
    apply('darkCircle', name, c, [c[0] - a - 2, c[1] - a - 2, c[0] + a + 2, c[1] + a + 2], weight, ([y, cb, cr], g) => [y * (1 - 0.16 * g), cb + 0.015 * g, cr]);
  }
  // nasolabial folds: a soft shadow along P(82|83) + 0.04 fw·o → P(84|90) + 0.06 fw·o, a Gaussian across the line with
  // σ 0.02 fw (28 px wide at half depth on sample_face.png, 2σ_mid), fading in and out over the first and last 15 % of
  // its length as the 法令紋 band does (so it stays off dot1 at the nose end): Y × (1 − 0.12 g). A real fold is a shadow
  // at the scale of the field's mid band; the first fixture's 6 px line was finer than σ_mid ≈ 14 px (plan Task 11, a).
  for (const [name, ia, ib, o] of [
    ['foldL', 82, 84, mul(xhat, -1)],
    ['foldR', 83, 90, xhat],
  ]) {
    const a = add(P(ia), mul(o, 0.04 * fw));
    const b = add(P(ib), mul(o, 0.06 * fw));
    const s = 0.02 * fw;
    const pad = 3 * s;
    const ab = sub(b, a);
    const weight = (p) => {
      const d = segDist(p, a, b);
      const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / dot(ab, ab)));
      return d <= 3 * s ? Math.exp(-(d * d) / (2 * s * s)) * smooth(0, 0.15, t) * (1 - smooth(0.85, 1, t)) : 0;
    };
    apply('fold', name, mid(a, b), [Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad, Math.max(a[0], b[0]) + pad, Math.max(a[1], b[1]) + pad], weight, ([y, cb, cr], g) => [y * (1 - 0.12 * g), cb, cr], { sigma: Math.round(s * 100) / 100 });
  }
  // yellow teeth: inner-lip polygon (96–103), pixels with Y > 0.15 and chroma < 0.15: Cb − 0.05. sample_face.png's teeth
  // are in shadow (Y 0.15–0.24, the gap between them ≤ 0.13), so spec §8.3's Y > 0.35 would catch only 8 lip-corner pixels;
  // the chroma bound (as for the sclera) keeps the lip edge inside the polygon out.
  {
    const poly = [96, 97, 98, 99, 100, 101, 102, 103].map(P);
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    const c = [xs.reduce((s, v) => s + v, 0) / xs.length, ys.reduce((s, v) => s + v, 0) / ys.length];
    apply('teeth', 'teeth', c, [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], (p, [y, cb, cr]) => (inPolygon(p, poly) && y > 0.15 && 2 * Math.hypot(cb - 0.5, cr - 0.5) < 0.15 ? 1 : 0), ([y, cb, cr]) => [y, cb - 0.05, cr]);
  }
  // red sclera: eye-ring polygons, pixels with Y > 0.5 and chroma < 0.15: Cr + 0.03
  for (const [name, ring] of [
    ['scleraL', [52, 53, 72, 54, 55, 56, 73, 57]],
    ['scleraR', [58, 59, 75, 60, 61, 62, 76, 63]],
  ]) {
    const poly = ring.map(P);
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    const c = [xs.reduce((s, v) => s + v, 0) / xs.length, ys.reduce((s, v) => s + v, 0) / ys.length];
    apply('sclera', name, c, [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], (p, [y, cb, cr]) => (inPolygon(p, poly) && y > 0.5 && 2 * Math.hypot(cb - 0.5, cr - 0.5) < 0.15 ? 1 : 0), ([y, cb, cr]) => [y, cb, cr + 0.03]);
  }

  const cheek = mid(P(26), P(90));
  const png = new PNG({ width: W, height: H });
  data.copy(png.data);
  return {
    png: PNG.sync.write(png),
    json: {
      source: 'tests/fixtures/sample_face.png',
      generator: 'scripts/gen-tone-fixture.mjs',
      width: W,
      height: H,
      fw: Math.round(fw * 100) / 100,
      defects,
      regions: { cheek: [Math.round(cheek[0] - 24), Math.round(cheek[1] - 24), 48, 48] },
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { png, json } = generateToneFixture();
  writeFileSync(fixture('sample_face_tone.png'), png);
  writeFileSync(fixture('sample_face_tone.json'), JSON.stringify(json));
  console.log(`sample_face_tone.png: ${json.defects.length} defects, ${json.defects.reduce((s, d) => s + d.pixels.length, 0)} listed pixels`);
}
