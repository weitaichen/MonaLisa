// App icons (spec §9): black #000 ground, lime #B8F02A mark. Original artwork rendered by a tiny
// software rasteriser (analytic shapes, 8×8 supersampling per pixel) — no fonts, no external art.
// The mark: an egg-shaped face outline drawn as an open stroke with round caps, two calm closed
// eyes, and a four-point glint sitting in the outline's opening (the "beauty" glow).
//   public/icons/apple-touch-icon-180.png  (iOS rounds the corners itself)
//   public/icons/icon-192.png, icon-512.png
//   public/icons/icon-512-maskable.png     (mark kept inside the central 80 % safe circle)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'icons');

export const BG = [0, 0, 0];
export const LIME = [0xb8, 0xf0, 0x2a];

// ───────────────────────── mark geometry (mark space: centre 0,0, y down, extent ≈ ±1) ─────────────────────────

const FACE = { cx: -0.08, cy: 0.04, rx: 0.62, ry: 0.8, half: 0.08 };
/** Opening of the outline (radians in the ellipse's parameter space; y is down, so −π/2 is the top). */
const GAP = { from: -1.18, to: -0.12 };
const GLINT = { cx: 0.58, cy: -0.6, r: 0.34, k: 0.6 };
/** Closed eyes: two short downward-bowed arcs (∪), round caps. */
const EYES = [
  { cx: -0.3, cy: 0.0 },
  { cx: 0.14, cy: 0.0 },
].map((e) => ({ ...e, r: 0.135, from: 0.4, to: Math.PI - 0.4, half: 0.055 }));
export const OPTIONS = { eyes: true };

/** Egg: the half-width narrows toward the chin. */
const faceRx = (y) => FACE.rx * (1 - 0.1 * Math.min(1, Math.max(0, (y - FACE.cy) / FACE.ry)));

function facePoint(t) {
  const y = FACE.cy + FACE.ry * Math.sin(t);
  return [FACE.cx + faceRx(y) * Math.cos(t), y];
}

/** Approximate distance to the egg outline: implicit value over its gradient length. */
function faceDistance(x, y) {
  const rx = faceRx(y);
  const dx = (x - FACE.cx) / rx;
  const dy = (y - FACE.cy) / FACE.ry;
  const e = Math.hypot(dx, dy);
  if (e < 1e-9) return FACE.ry;
  const gx = dx / rx / e;
  const gy = dy / FACE.ry / e;
  return Math.abs(e - 1) / Math.hypot(gx, gy);
}

const angleIn = (t, from, to) => {
  const a = Math.atan2(Math.sin(t - from), Math.cos(t - from));
  const span = to - from;
  return (a >= 0 ? a : a + 2 * Math.PI) <= span;
};

function insideFace(x, y) {
  const t = Math.atan2((y - FACE.cy) / FACE.ry, (x - FACE.cx) / faceRx(y));
  if (!angleIn(t, GAP.from, GAP.to)) return faceDistance(x, y) <= FACE.half;
  // round caps at both ends of the opening
  for (const a of [GAP.from, GAP.to]) {
    const [px, py] = facePoint(a);
    if (Math.hypot(x - px, y - py) <= FACE.half) return true;
  }
  return false;
}

/** Circular arc stroke with round caps. Angles in screen space (y down): 0..π is the lower half. */
function insideArc(x, y, arc) {
  const t = Math.atan2(y - arc.cy, x - arc.cx);
  if (angleIn(t, arc.from, arc.to)) return Math.abs(Math.hypot(x - arc.cx, y - arc.cy) - arc.r) <= arc.half;
  for (const a of [arc.from, arc.to]) {
    if (Math.hypot(x - arc.cx - arc.r * Math.cos(a), y - arc.cy - arc.r * Math.sin(a)) <= arc.half) return true;
  }
  return false;
}

/** Four-point glint: a superellipse with exponent < 1 (concave sides, sharp tips). */
function insideGlint(x, y) {
  const u = Math.abs(x - GLINT.cx) / GLINT.r;
  const v = Math.abs(y - GLINT.cy) / GLINT.r;
  return u ** GLINT.k + v ** GLINT.k <= 1;
}

export const insideMark = (x, y) =>
  insideFace(x, y) || insideGlint(x, y) || (OPTIONS.eyes && EYES.some((e) => insideArc(x, y, e)));

/** Mark-space bounding box (centre, half-span of the larger side) and max radius from its centre. */
export function markBounds(samples = 600) {
  const pts = [];
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let j = 0; j < samples; j++) {
    for (let i = 0; i < samples; i++) {
      const x = -1.4 + (2.8 * (i + 0.5)) / samples;
      const y = -1.4 + (2.8 * (j + 0.5)) / samples;
      if (!insideMark(x, y)) continue;
      pts.push([x, y]);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  let ext = 0;
  for (const [x, y] of pts) ext = Math.max(ext, Math.hypot(x - cx, y - cy));
  return { cx, cy, half: Math.max(x1 - x0, y1 - y0) / 2, ext };
}

// ───────────────────────── raster ─────────────────────────

const toLin = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toEnc = (l) => (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055);

/**
 * Render a size×size RGBA icon: mark point (cx, cy) lands on the tile centre and one mark unit
 * spans scale·size pixels. Coverage from ss×ss samples, blended in linear light so anti-aliased
 * edges keep their weight against black.
 */
export function renderIcon(size, scale, ss = 8, cx = 0, cy = 0) {
  const data = Buffer.alloc(size * size * 4);
  const k = scale * size;
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hit = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = cx + (px + (sx + 0.5) / ss - size / 2) / k;
          const y = cy + (py + (sy + 0.5) / ss - size / 2) / k;
          if (insideMark(x, y)) hit++;
        }
      }
      const a = hit / (ss * ss);
      const i = (py * size + px) * 4;
      for (let c = 0; c < 3; c++) data[i + c] = Math.round(toEnc(toLin(BG[c] / 255) * (1 - a) + toLin(LIME[c] / 255) * a) * 255);
      data[i + 3] = 255;
    }
  }
  return data;
}

export const ICONS = [
  // regular icons: the mark's bounding box spans 64 % of the tile (clear of iOS's rounded corners)
  { file: 'apple-touch-icon-180.png', size: 180, fill: 0.64 },
  { file: 'icon-192.png', size: 192, fill: 0.64 },
  { file: 'icon-512.png', size: 512, fill: 0.64 },
  // maskable: every mark pixel within radius 0.34·size, inside the 0.4·size (80 %) safe circle
  { file: 'icon-512-maskable.png', size: 512, safeRadius: 0.34 },
];

function main() {
  mkdirSync(outDir, { recursive: true });
  const bounds = markBounds();
  for (const icon of ICONS) {
    const scale = icon.safeRadius ? icon.safeRadius / bounds.ext : icon.fill / (2 * bounds.half);
    const png = new PNG({ width: icon.size, height: icon.size });
    renderIcon(icon.size, scale, 8, bounds.cx, bounds.cy).copy(png.data);
    // opaque RGB: home-screen icons must not carry transparency
    writeFileSync(join(outDir, icon.file), PNG.sync.write(png, { colorType: 2, deflateLevel: 9 }));
    console.log(`public/icons/${icon.file} ${icon.size}x${icon.size}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
