// Generates our own 濾鏡 LUTs (spec §7.4, RB §2.5) into public/luts/filters/:
//   <id>.png        512×512, GPUImage 64³ layout: 8×8 tiles of 64×64; blue picks the tile,
//                   x = (b % 8)·64 + r, y = floor(b / 8)·64 + g   (r, g, b ∈ 0..63)
//   <id>_thumb.png  96×96 synthetic portrait swatch graded with that LUT (filter strip thumbnail)
// plus none_thumb.png (the ungraded swatch) for the 無 item.
//
// Looks are built in OKLab (perceptual, on linear light): white balance in linear RGB, tone
// curves on lightness (authored on sRGB-encoded luminance), chroma/hue edits in LCh with skin
// protection, split toning on a/b, then per-channel clipping in linear light (see labToSrgb for
// why not hue-preserving mapping). All output is original work (no third-party LUTs).
// Run: node scripts/gen-luts.mjs   Tests/previews: tests/harness/t5/.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'luts', 'filters');

export const LUT_DIM = 512;
export const LUT_N = 64;
export const THUMB = 96;
export const FILTER_IDS = ['natural', 'soft', 'milktea', 'warm', 'cool', 'japanese', 'film', 'mono'];

// ───────────────────────── colour math ─────────────────────────

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
export const srgbToLin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
export const linToSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

/** linear sRGB → OKLab */
export function linToLab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab → linear sRGB (unclamped) */
export function labToLin([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/**
 * OKLab → sRGB-encoded 0..1, clipping each channel in linear light. Hue-preserving gamut
 * mapping was tried (OKLab chroma clip, projection toward grey) and rejected: whichever channel
 * limits the move switches abruptly between neighbouring LUT entries, and the steep sRGB toe
 * turns that into jumps of 50–130 levels on saturated yellows / cyans. Plain clipping is
 * continuous with small steps; the looks keep colours mostly in gamut anyway (chroma boosts
 * taper near the gamut edge, see chroma()).
 */
export function labToSrgb(lab) {
  return labToLin(lab).map((v) => linToSrgb(clamp01(v)));
}

export const srgbToLab = (c) => linToLab(c.map(srgbToLin));

/** Monotone cubic (Fritsch–Carlson) curve through [x, y] control points; clamps outside. */
export function curve(points) {
  const n = points.length;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const d = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m = new Array(n);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1]
    );
  };
}

/** Raised-cosine window over hue (degrees), 1 at `center`, 0 beyond ±`half`. */
function hueWindow(h, center, half) {
  let dh = (((h - center) % 360) + 540) % 360 - 180;
  dh = Math.abs(dh);
  return dh >= half ? 0 : 0.5 * (1 + Math.cos((Math.PI * dh) / half));
}

/** 0..1: how "skin-like" an OKLab colour is (hue ≈ 25–75°, moderate chroma, mid/high lightness). */
export function skinWeight([L, a, b]) {
  const C = Math.hypot(a, b);
  const h = (Math.atan2(b, a) * 180) / Math.PI;
  const hw = hueWindow(h, 50, 40);
  const cw = smoothstep(0.012, 0.035, C) * (1 - smoothstep(0.13, 0.2, C));
  const lw = smoothstep(0.25, 0.45, L) * (1 - smoothstep(0.95, 1.0, L));
  return hw * cw * lw;
}

/**
 * Linear-light white balance. Default keeps luminance constant (whites may clip toward the
 * boosted channel); norm 'max' scales the gains so none exceeds 1, keeping white a clean tint.
 */
function whiteBalance(srgb, gains, norm = 'luma') {
  const lin = srgb.map(srgbToLin);
  if (norm === 'max') {
    const m = Math.max(...gains);
    return lin.map((v, i) => linToSrgb(clamp01((v * gains[i]) / m)));
  }
  const y0 = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
  const out = lin.map((v, i) => v * gains[i]);
  const y1 = 0.2126 * out[0] + 0.7152 * out[1] + 0.0722 * out[2];
  const k = y1 > 0 ? y0 / y1 : 1;
  return out.map((v) => linToSrgb(clamp01(v * k)));
}

/**
 * Chroma / hue edits in LCh.
 *  sat      global chroma multiplier
 *  vib      extra boost that fades out as chroma rises (vibrance)
 *  skinSat  chroma multiplier used instead on skin (blended by skinWeight)
 *  bands    [{ h, half, sat, shift }] hue-targeted chroma multipliers and hue rotations (degrees)
 * Boosts (k > 1) taper off for colours that are already near the sRGB gamut edge, so a look never
 * pushes a saturated colour into clipping (which would kink the LUT through the steep sRGB toe).
 */
function chroma(lab, { sat = 1, vib = 0, skinSat = null, bands = [] }) {
  const [L, a, b] = lab;
  let C = Math.hypot(a, b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  const sw = skinWeight(lab);
  let k = sat * (1 + vib * (1 - smoothstep(0.02, 0.2, C)));
  let dh = 0;
  for (const band of bands) {
    const w = hueWindow(h, band.h, band.half) * smoothstep(0.005, 0.03, C);
    k *= 1 + ((band.sat ?? 1) - 1) * w;
    dh += (band.shift ?? 0) * w;
  }
  if (skinSat !== null) {
    k = k + (skinSat - k) * sw;
    dh *= 1 - sw;
  }
  if (k > 1) {
    const enc = labToLin(lab).map((v) => linToSrgb(clamp01(v)));
    const mx = Math.max(...enc);
    const satIn = mx > 0 ? 1 - Math.min(...enc) / mx : 0;
    k = 1 + (k - 1) * (1 - smoothstep(0.6, 0.95, satIn));
  }
  C *= k;
  h += dh;
  const r = (h * Math.PI) / 180;
  return [L, C * Math.cos(r), C * Math.sin(r)];
}

/** Split toning: add a/b offsets weighted by lightness zone; skin receives (1 − skinKeep) of it. */
function tone(lab, { shadows = [0, 0], mids = [0, 0], highlights = [0, 0], skinKeep = 0 }) {
  const [L, a, b] = lab;
  const ws = 1 - smoothstep(0.12, 0.62, L);
  const wh = smoothstep(0.5, 0.95, L);
  const wm = Math.max(0, 1 - ws - wh);
  const k = 1 - skinKeep * skinWeight(lab);
  return [
    L,
    a + k * (ws * shadows[0] + wm * mids[0] + wh * highlights[0]),
    b + k * (ws * shadows[1] + wm * mids[1] + wh * highlights[1]),
  ];
}

/**
 * Apply a tone curve to lightness. Curves are authored on sRGB-encoded luminance ("tone",
 * the scale a Lightroom curve uses) so control points read naturally: [0, 0.06] lifts black
 * to ~15/255. OKLab L is cbrt(Y), so tone = srgb(L³) and back.
 */
const withL = ([L, a, b], f) => {
  const t = f(linToSrgb(clamp01(L) ** 3));
  return [Math.cbrt(srgbToLin(clamp01(t))), a, b];
};

/**
 * Pull skin colours (weighted by k·skinWeight of the ORIGINAL colour) toward a target derived
 * from the original: hue = original hue + hueShift (degrees), chroma = original chroma × chroma
 * (omit to keep the graded chroma). Lightness stays graded. Without this, white-balance moves
 * push skin yellow (warm) or grey (cool), which reads as unhealthy.
 */
function holdSkin(orig, lab, { k = 1, hueShift = 0, chroma: cMul = null }) {
  const w = k * skinWeight(orig);
  if (w <= 0) return lab;
  const ho = Math.atan2(orig[2], orig[1]) + (hueShift * Math.PI) / 180;
  const hn = Math.atan2(lab[2], lab[1]);
  const dh = Math.atan2(Math.sin(ho - hn), Math.cos(ho - hn));
  const h = hn + dh * w;
  const cn = Math.hypot(lab[1], lab[2]);
  const C = cMul === null ? cn : cn + (Math.hypot(orig[1], orig[2]) * cMul - cn) * w;
  return [lab[0], C * Math.cos(h), C * Math.sin(h)];
}

// ───────────────────────── looks ─────────────────────────
// Each look maps sRGB-encoded [r,g,b] in 0..1 to the graded colour. The engine mixes it with the
// source by filter.amount (0.5–0.6 by default, params.ts), so full strength is tuned to be bold
// but still wearable, and the default amount lands on a clearly visible, natural look.

/** 自然 — clean and a little crisper: gentle S-curve, vibrance for the backdrop, skin left alone. */
const naturalCurve = curve([
  [0, 0],
  [0.25, 0.225],
  [0.5, 0.515],
  [0.75, 0.785],
  [1, 1],
]);
function natural(c) {
  let lab = srgbToLab(c);
  lab = withL(lab, naturalCurve);
  lab = chroma(lab, { sat: 1.04, vib: 0.24, skinSat: 1.03 });
  lab = tone(lab, { shadows: [0, -0.005], highlights: [0.001, -0.002], skinKeep: 1 });
  return labToSrgb(lab);
}

/** 柔光 — lifted blacks, bright soft shoulder (bloom feel), muted colour, rosy-pink cast. */
const softCurve = curve([
  [0, 0.06],
  [0.25, 0.33],
  [0.5, 0.6],
  [0.75, 0.835],
  [1, 0.98],
]);
function soft(c) {
  let lab = srgbToLab(c);
  lab = withL(lab, softCurve);
  lab = chroma(lab, { sat: 0.8, skinSat: 0.9 });
  lab = tone(lab, { shadows: [0.012, -0.008], mids: [0.02, 0.002], highlights: [0.018, 0.002], skinKeep: 0.3 });
  return labToSrgb(lab);
}

/** 奶茶 — warm beige, low saturation, creamy highlights, olive-beige greens, soft fade. */
const milkteaCurve = curve([
  [0, 0.075],
  [0.25, 0.3],
  [0.5, 0.555],
  [0.75, 0.78],
  [1, 0.95],
]);
function milktea(c) {
  const orig = srgbToLab(c);
  let lab = srgbToLab(whiteBalance(c, [1.04, 1.0, 0.9]));
  lab = withL(lab, milkteaCurve);
  lab = chroma(lab, {
    sat: 0.5,
    skinSat: 0.78,
    bands: [
      { h: 140, half: 60, sat: 0.55, shift: -32 }, // greens → olive / beige
      { h: 250, half: 50, sat: 0.5 }, // blues → grey
    ],
  });
  lab = tone(lab, { shadows: [0.012, 0.016], mids: [0.01, 0.03], highlights: [0.006, 0.026], skinKeep: 0.45 });
  return labToSrgb(holdSkin(orig, lab, { k: 0.3 }));
}

/** 暖調 — golden warmth: warmer white balance, golden highlights, muted blues, skin kept natural. */
const warmCurve = curve([
  [0, 0.01],
  [0.25, 0.24],
  [0.5, 0.515],
  [0.75, 0.78],
  [1, 0.99],
]);
function warm(c) {
  const orig = srgbToLab(c);
  let lab = srgbToLab(whiteBalance(c, [1.13, 1.02, 0.78]));
  lab = withL(lab, warmCurve);
  lab = chroma(lab, {
    sat: 1.0,
    skinSat: 0.93,
    bands: [
      { h: 75, half: 45, sat: 1.15 }, // golds / ambers richer
      { h: 250, half: 60, sat: 0.75 }, // blues calmer
    ],
  });
  lab = tone(lab, { shadows: [0.01, 0.012], highlights: [0.006, 0.03], skinKeep: 0.55 });
  return labToSrgb(holdSkin(orig, lab, { k: 0.7, chroma: 1.12 }));
}

/** 冷調 — cool and clean: cooler white balance, blue-teal shadows, crisp neutral whites, fair skin. */
const coolCurve = curve([
  [0, 0.01],
  [0.25, 0.25],
  [0.5, 0.535],
  [0.75, 0.805],
  [1, 1],
]);
function cool(c) {
  const orig = srgbToLab(c);
  // max-normalised so white lands on a clean cool white (~236,249,255) instead of clipping cyan
  let lab = srgbToLab(whiteBalance(c, [0.84, 0.95, 1.0], 'max'));
  lab = withL(lab, coolCurve);
  lab = chroma(lab, {
    sat: 0.9,
    skinSat: 0.94,
    bands: [
      { h: 75, half: 45, sat: 0.7 }, // yellows quieter so the cast reads clean
      { h: 220, half: 60, sat: 1.12 }, // blues / teals a bit richer
    ],
  });
  lab = tone(lab, { shadows: [-0.026, -0.03], mids: [-0.008, -0.012], highlights: [0, -0.002], skinKeep: 0.6 });
  return labToSrgb(holdSkin(orig, lab, { k: 0.8, hueShift: -8, chroma: 0.78 }));
}

/** 日系 — bright and airy, low contrast, cyan-leaning shadows, minty greens, clean skin. */
const japaneseCurve = curve([
  [0, 0.07],
  [0.25, 0.345],
  [0.5, 0.625],
  [0.75, 0.855],
  [1, 0.99],
]);
function japanese(c) {
  let lab = srgbToLab(whiteBalance(c, [0.95, 1.0, 1.06]));
  lab = withL(lab, japaneseCurve);
  lab = chroma(lab, {
    sat: 0.72,
    skinSat: 0.86,
    bands: [
      { h: 140, half: 60, sat: 0.8, shift: 26 }, // greens → minty cyan
      { h: 250, half: 45, shift: -16 }, // blues → cyan
      { h: 30, half: 35, sat: 0.85 }, // reds / oranges calmer
    ],
  });
  lab = tone(lab, { shadows: [-0.024, -0.016], mids: [-0.008, -0.006], highlights: [0.002, 0.004], skinKeep: 0.65 });
  return labToSrgb(lab);
}

/** 膠片 — print-film feel: matte faded blacks, film toe/shoulder, green shadows, warm creamy highlights. */
const filmCurve = curve([
  [0, 0.1],
  [0.1, 0.135],
  [0.3, 0.295],
  [0.55, 0.57],
  [0.8, 0.815],
  [1, 0.93],
]);
function film(c) {
  let lab = srgbToLab(c);
  lab = withL(lab, filmCurve);
  lab = chroma(lab, {
    sat: 0.84,
    skinSat: 0.96,
    bands: [
      { h: 140, half: 55, sat: 0.7, shift: -18 }, // greens → softer, olive
      { h: 30, half: 30, sat: 1.08 }, // reds keep their weight
      { h: 250, half: 50, shift: -20 }, // blues lean teal
    ],
  });
  lab = tone(lab, { shadows: [-0.03, 0.008], mids: [-0.004, 0.012], highlights: [0.008, 0.034], skinKeep: 0.5 });
  return labToSrgb(lab);
}

/** 黑白 — rich monochrome: red-weighted mix (smooth, bright skin), deep but open blacks, warm tone. */
const monoCurve = curve([
  [0, 0.02],
  [0.15, 0.11],
  [0.5, 0.52],
  [0.85, 0.9],
  [1, 0.985],
]);
function mono(c) {
  const lin = c.map(srgbToLin);
  const y = 0.36 * lin[0] + 0.53 * lin[1] + 0.11 * lin[2];
  const [L] = withL([Math.cbrt(y), 0, 0], monoCurve);
  const warmth = smoothstep(0.05, 0.4, L) * (1 - 0.5 * smoothstep(0.85, 1, L));
  return labToSrgb([L, 0.003 * warmth, 0.011 * warmth]);
}

export const LOOKS = { natural, soft, milktea, warm, cool, japanese, film, mono };
export const identity = (c) => c;

// ───────────────────────── LUT encode / lookup ─────────────────────────

/** Bake a transform into a 512×512 RGBA buffer in the GPUImage 64³ layout. */
export function buildLut(transform) {
  const data = Buffer.alloc(LUT_DIM * LUT_DIM * 4);
  for (let b = 0; b < LUT_N; b++) {
    const tx = (b % 8) * LUT_N;
    const ty = Math.floor(b / 8) * LUT_N;
    for (let g = 0; g < LUT_N; g++) {
      for (let r = 0; r < LUT_N; r++) {
        const out = transform([r / (LUT_N - 1), g / (LUT_N - 1), b / (LUT_N - 1)]);
        const i = ((ty + g) * LUT_DIM + tx + r) * 4;
        data[i] = Math.round(clamp01(out[0]) * 255);
        data[i + 1] = Math.round(clamp01(out[1]) * 255);
        data[i + 2] = Math.round(clamp01(out[2]) * 255);
        data[i + 3] = 255;
      }
    }
  }
  return data;
}

/** GL LINEAR + CLAMP_TO_EDGE sample of an RGBA8 texture at normalized (u, v); returns 0..1 RGB. */
function sampleBilinear(data, w, h, u, v, out, o) {
  const x = u * w - 0.5;
  const y = v * h - 0.5;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const cx0 = Math.min(w - 1, Math.max(0, x0));
  const cx1 = Math.min(w - 1, Math.max(0, x0 + 1));
  const cy0 = Math.min(h - 1, Math.max(0, y0));
  const cy1 = Math.min(h - 1, Math.max(0, y0 + 1));
  const i00 = (cy0 * w + cx0) * 4;
  const i10 = (cy0 * w + cx1) * 4;
  const i01 = (cy1 * w + cx0) * 4;
  const i11 = (cy1 * w + cx1) * 4;
  for (let c = 0; c < 3; c++) {
    const top = data[i00 + c] + (data[i10 + c] - data[i00 + c]) * fx;
    const bot = data[i01 + c] + (data[i11 + c] - data[i01 + c]) * fx;
    out[o + c] = (top + (bot - top) * fy) / 255;
  }
}

const s1 = [0, 0, 0];
const s2 = [0, 0, 0];

/**
 * The GPUImage 64³ lookup exactly as GPUPixel's shader does it (beauty_face_unit_filter.cc,
 * lookUpCustom): two bilinear taps in the neighbouring blue slices, mixed by fract(b·63).
 */
export function lookup64(lut, r, g, b, out = [0, 0, 0]) {
  const blue = b * 63;
  const q1 = Math.floor(blue);
  const q2 = Math.ceil(blue);
  const q1y = Math.floor(q1 / 8);
  const q1x = q1 - q1y * 8;
  const q2y = Math.floor(q2 / 8);
  const q2x = q2 - q2y * 8;
  const k = 1 / 8 - 1 / 512;
  const h = 0.5 / 512;
  sampleBilinear(lut, LUT_DIM, LUT_DIM, q1x / 8 + h + k * r, q1y / 8 + h + k * g, s1, 0);
  sampleBilinear(lut, LUT_DIM, LUT_DIM, q2x / 8 + h + k * r, q2y / 8 + h + k * g, s2, 0);
  const f = blue - Math.floor(blue);
  out[0] = s1[0] + (s2[0] - s1[0]) * f;
  out[1] = s1[1] + (s2[1] - s1[1]) * f;
  out[2] = s1[2] + (s2[2] - s1[2]) * f;
  return out;
}

/** Apply a LUT to an RGBA8 image in place-free fashion: mix(c, lut(c), amount), like the P5 shader. */
export function applyLut(lut, rgba, amount = 1) {
  const out = Buffer.alloc(rgba.length);
  const t = [0, 0, 0];
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i] / 255;
    const g = rgba[i + 1] / 255;
    const b = rgba[i + 2] / 255;
    lookup64(lut, r, g, b, t);
    out[i] = Math.round((r + (t[0] - r) * amount) * 255);
    out[i + 1] = Math.round((g + (t[1] - g) * amount) * 255);
    out[i + 2] = Math.round((b + (t[2] - b) * amount) * 255);
    out[i + 3] = rgba[i + 3];
  }
  return out;
}

// ───────────────────────── thumbnail swatch ─────────────────────────

const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Approximate signed distance to an ellipse (negative inside); radius may vary with y (egg). */
function ellipseSd(x, y, cx, cy, rx, ry) {
  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  return (Math.sqrt(dx * dx + dy * dy) - 1) * Math.min(rx, ry);
}

/**
 * Colour of the synthetic portrait at (x, y) in a 0..1 square: sky → haze → foliage backdrop
 * with window light, long dark hair with a side-swept fringe, a lit-to-shadow face and neck,
 * cheek flush and lips, and a coral top. It holds skin, neutrals, near-blacks, near-whites,
 * greens, blues and reds, so every look reads differently at thumbnail size.
 */
function swatchColour(x, y) {
  let c = mixc([142, 186, 228], [214, 224, 228], smoothstep(0.0, 0.5, y));
  c = mixc(c, [92, 140, 98], smoothstep(0.45, 0.9, y));
  c = mixc(c, [252, 250, 242], Math.exp(-((x - 0.86) ** 2 + (y - 0.12) ** 2) / 0.012) * 0.95);

  const over = (col, sd, soft = 0.008, opacity = 1) => {
    const a = (1 - smoothstep(-soft, soft, sd)) * opacity;
    if (a > 0) c = mixc(c, col, a);
  };

  // long hair behind the head and shoulders, with a soft sheen
  const hairTop = ellipseSd(x, y, 0.5, 0.43, 0.27, 0.3);
  const hairBack = Math.max(Math.abs(x - 0.5) - (0.25 + 0.06 * smoothstep(0.4, 0.9, y)), Math.abs(y - 0.62) - 0.24);
  const sheen = Math.exp(-((x - 0.38) ** 2 + (y - 0.26) ** 2) / 0.004) * 0.6;
  over(mixc(mixc([64, 42, 32], [30, 21, 18], smoothstep(0.2, 0.8, y)), [120, 86, 64], sheen), Math.min(hairTop, hairBack));

  // neck and a little chest, darker under the jaw
  const skinLow = mixc([170, 112, 92], [214, 158, 132], smoothstep(0.68, 0.84, y));
  over(skinLow, Math.max(Math.abs(x - 0.5) - 0.056, Math.abs(y - 0.79) - 0.13), 0.006);
  over(skinLow, ellipseSd(x, y, 0.5, 0.9, 0.12, 0.09), 0.006);

  // top / shoulders with a scoop neckline
  const bodySd = Math.max(ellipseSd(x, y, 0.5, 1.1, 0.5, 0.3), -ellipseSd(x, y, 0.5, 0.84, 0.1, 0.075));
  const fold = smoothstep(0.3, 0.9, Math.abs(x - 0.5) * 2);
  over(mixc([232, 112, 98], [168, 64, 60], 0.15 + 0.5 * fold), bodySd, 0.006);

  // egg-shaped face: narrower toward the chin; light from the upper left
  const rx = 0.175 * (1 - 0.22 * smoothstep(0.45, 0.7, y));
  const faceSd = ellipseSd(x, y, 0.5, 0.47, rx, 0.235);
  const light = smoothstep(-0.35, 0.9, (0.62 - x) * 1.3 + (0.6 - y) * 0.7);
  let skin = mixc([204, 146, 120], [248, 212, 192], light);
  skin = mixc(skin, [238, 160, 150], Math.exp(-((x - 0.41) ** 2 + (y - 0.54) ** 2) / 0.0025) * 0.4);
  skin = mixc(skin, [232, 154, 146], Math.exp(-((x - 0.6) ** 2 + (y - 0.54) ** 2) / 0.0025) * 0.3);
  over(skin, faceSd);
  // lips (soft-edged, partly transparent so they read as colour, not a hard shape)
  over([200, 104, 112], ellipseSd(x, y, 0.5, 0.638, 0.046, 0.015), 0.01, 0.75);

  // side-swept fringe: covers the forehead above a curved hairline
  const hairline = 0.3 + 0.07 * smoothstep(0.3, 0.72, x) - 0.03 * Math.exp(-((x - 0.62) ** 2) / 0.004);
  const fringeSd = Math.max(ellipseSd(x, y, 0.5, 0.43, 0.27, 0.3), y - hairline);
  over(mixc([58, 39, 30], [96, 68, 52], sheen * 0.8), fringeSd, 0.006);
  return c;
}

/** Supersampled (4×4) swatch, RGBA8. */
export function drawSwatch(size = THUMB) {
  const data = Buffer.alloc(size * size * 4);
  const ss = 4;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = swatchColour((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size);
          acc[0] += c[0];
          acc[1] += c[1];
          acc[2] += c[2];
        }
      }
      const i = (py * size + px) * 4;
      data[i] = Math.round(acc[0] / (ss * ss));
      data[i + 1] = Math.round(acc[1] / (ss * ss));
      data[i + 2] = Math.round(acc[2] / (ss * ss));
      data[i + 3] = 255;
    }
  }
  return data;
}

// ───────────────────────── output ─────────────────────────

/**
 * Opaque RGB PNG (alpha dropped; it is always 255), max deflate: ~18 % smaller than RGBA for
 * the precached LUTs. pngjs writes only IHDR/IDAT/IEND — no gAMA/sRGB/iCCP — so browsers cannot
 * colour-manage the data.
 */
export function encodePng(data, width, height) {
  const png = new PNG({ width, height });
  data.copy(png.data);
  return PNG.sync.write(png, { colorType: 2, deflateLevel: 9 });
}

function main() {
  mkdirSync(outDir, { recursive: true });
  const swatch = drawSwatch(THUMB);
  writeFileSync(join(outDir, 'none_thumb.png'), encodePng(swatch, THUMB, THUMB));
  for (const id of FILTER_IDS) {
    const lut = buildLut(LOOKS[id]);
    writeFileSync(join(outDir, `${id}.png`), encodePng(lut, LUT_DIM, LUT_DIM));
    writeFileSync(join(outDir, `${id}_thumb.png`), encodePng(applyLut(lut, swatch, 1), THUMB, THUMB));
    console.log(`public/luts/filters/${id}.png + ${id}_thumb.png`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
