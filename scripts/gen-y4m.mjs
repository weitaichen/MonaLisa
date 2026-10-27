// Builds tests/fixtures/face.y4m for Chromium's fake camera
// (--use-file-for-fake-video-capture): sample_face.png (portrait) placed into a 1280×720
// landscape frame, face centred, pillarboxed with the photo's own edge colour, encoded as
// YUV4MPEG2 4:2:0 (BT.601 limited range, which is how Chromium interprets I420 from a file).
// Output is gitignored; regenerate with `node scripts/gen-y4m.mjs`.
// Other clips (step-1 group fixtures): `--src <png|jpg> --out <y4m>`; group_faces.png is laid out by composeGroupCam
// (A, B and C inside the camera's 3:4 preview window), any other image fitted by composeFitWidth (a JPEG is decoded
// in headless Chromium first: ten_faces.jpg → group10.y4m);
// `--noise <seed>` (per-frame sub-pixel shifts + ±2 levels of noise) or `--pan <FW/s>` (`--fw <px>`, `--frames <n>`)
// make every frame distinct.
// Camera per-person clips (spec §12.3): `--layout upright_row3|upright_far10|upright_behind|selfie_group` (composeCells:
// sample_face.png cells on an upright 1080×1920 frame, 8 static frames, out tests/fixtures/<layout>.y4m), `--layout
// tile_face` (bench row JG's still clip, TILE_FACE: one cell on 1280×720, 60 noisy frames; no e2e uses it, so
// global-setup does not make it) and `--move` (group_move.y4m: group_faces.png's A, B and C along moveAt's 18 s
// timeline, 640×360); `--seed <n>` seeds their sub-pixel offsets.
import { closeSync, mkdirSync, openSync, readFileSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { GROUP6, GROUP_FACES, groupFace, launch, smallFaceCell } from './gen-group-fixture.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export const W = 1280;
export const H = 720;
export const FRAMES = 30;

/**
 * Source rectangle (in sample_face.png pixels, 1000×1500) that becomes the 720-px-tall image
 * column. Chosen so the face (hairline → chin, cheek → cheek) lands in the frame centre.
 */
const CROP = { x: 0, y: 50, w: 1000, h: 1200 };
/** Source x that should land on the frame's horizontal centre (face midline). */
const FACE_CX = 470;

/**
 * Area-weighted (tent-filter) resample of a rectangle of an RGBA buffer, so downscaling does
 * not alias. Returns Float32 RGB in 0..255.
 */
export function resampleRgb(src, sw, sh, rect, dw, dh) {
  const out = new Float32Array(dw * dh * 3);
  const sx = rect.w / dw;
  const sy = rect.h / dh;
  const rx = Math.max(1, sx);
  const ry = Math.max(1, sy);
  const weights = (n, scale, radius, offset, limit) => {
    const taps = [];
    for (let i = 0; i < n; i++) {
      const c = offset + (i + 0.5) * scale - 0.5;
      const lo = Math.ceil(c - radius);
      const hi = Math.floor(c + radius);
      const list = [];
      let sum = 0;
      for (let s = lo; s <= hi; s++) {
        const w = Math.max(0, 1 - Math.abs(s - c) / radius);
        if (w <= 0) continue;
        list.push([Math.min(limit - 1, Math.max(0, s)), w]);
        sum += w;
      }
      taps.push(list.map(([s, w]) => [s, w / sum]));
    }
    return taps;
  };
  const tx = weights(dw, sx, rx, rect.x, sw);
  const ty = weights(dh, sy, ry, rect.y, sh);
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (const [syy, wy] of ty[y]) {
        for (const [sxx, wx] of tx[x]) {
          const i = (syy * sw + sxx) * 4;
          const w = wx * wy;
          r += src[i] * w;
          g += src[i + 1] * w;
          b += src[i + 2] * w;
        }
      }
      const o = (y * dw + x) * 3;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
    }
  }
  return out;
}

function backdropColour(png) {
  const sum = [0, 0, 0];
  let n = 0;
  for (let y = 0; y < 250; y++) {
    for (const x0 of [0, png.width - 80]) {
      for (let x = x0; x < x0 + 80; x++) {
        const i = (y * png.width + x) * 4;
        sum[0] += png.data[i];
        sum[1] += png.data[i + 1];
        sum[2] += png.data[i + 2];
        n++;
      }
    }
  }
  return sum.map((v) => v / n);
}

/** Compose the 1280×720 RGB frame (Float32, 0..255). */
export function composeFrame(png) {
  const scale = H / CROP.h;
  const colW = Math.round(CROP.w * scale);
  const col = resampleRgb(png.data, png.width, png.height, CROP, colW, H);
  const left = Math.round(W / 2 - (FACE_CX - CROP.x) * scale);

  // Pillarbox colour: the studio backdrop (top corners of the photo), darkened so the frame edge
  // reads as a neutral border rather than part of the photo.
  const fill = backdropColour(png).map((v) => v * 0.6);

  const rgb = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 3;
      const cx = x - left;
      if (cx >= 0 && cx < colW) {
        const i = (y * colW + cx) * 3;
        rgb[o] = col[i];
        rgb[o + 1] = col[i + 1];
        rgb[o + 2] = col[i + 2];
      } else {
        rgb[o] = fill[0];
        rgb[o + 1] = fill[1];
        rgb[o + 2] = fill[2];
      }
    }
  }
  return rgb;
}

const clamp8 = (v) => Math.min(255, Math.max(0, Math.round(v)));

/** RGB (0..255 floats) → I420 planes, BT.601 limited range, chroma averaged over 2×2 (centre siting). */
export function rgbToI420(rgb, w, h) {
  const Y = new Uint8Array(w * h);
  const U = new Uint8Array((w / 2) * (h / 2));
  const V = new Uint8Array((w / 2) * (h / 2));
  for (let i = 0; i < w * h; i++) {
    const r = rgb[i * 3] / 255;
    const g = rgb[i * 3 + 1] / 255;
    const b = rgb[i * 3 + 2] / 255;
    Y[i] = clamp8(16 + 65.481 * r + 128.553 * g + 24.966 * b);
  }
  for (let y = 0; y < h / 2; y++) {
    for (let x = 0; x < w / 2; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]) {
        const i = ((y * 2 + dy) * w + x * 2 + dx) * 3;
        r += rgb[i];
        g += rgb[i + 1];
        b += rgb[i + 2];
      }
      r /= 4 * 255;
      g /= 4 * 255;
      b /= 4 * 255;
      const o = y * (w / 2) + x;
      U[o] = clamp8(128 - 37.797 * r - 74.203 * g + 112 * b);
      V[o] = clamp8(128 + 112 * r - 93.786 * g - 18.214 * b);
    }
  }
  return { Y, U, V };
}

export function encodeY4m({ Y, U, V }, w, h, frames) {
  const header = Buffer.from(`YUV4MPEG2 W${w} H${h} F30:1 Ip A1:1 C420jpeg\n`, 'ascii');
  const frameHeader = Buffer.from('FRAME\n', 'ascii');
  const frame = Buffer.concat([frameHeader, Y, U, V]);
  return Buffer.concat([header, ...Array.from({ length: frames }, () => frame)]);
}

/**
 * Any source other than sample_face and group_faces: scaled to the frame width, bottom-aligned; the top is cropped,
 * or padded with the top-left pixel's colour when the source is wider than 16:9.
 */
export function composeFitWidth(png) {
  const dh = Math.round((png.height * W) / png.width);
  const img = resampleRgb(png.data, png.width, png.height, { x: 0, y: 0, w: png.width, h: png.height }, W, dh);
  const fill = [png.data[0], png.data[1], png.data[2]];
  const top = H - dh;
  const rgb = new Float32Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    const sy = y - top;
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 3;
      const i = (sy * W + x) * 3;
      const inside = sy >= 0 && sy < dh;
      rgb[o] = inside ? img[i] : fill[0];
      rgb[o + 1] = inside ? img[i + 1] : fill[1];
      rgb[o + 2] = inside ? img[i + 2] : fill[2];
    }
  }
  return rgb;
}

/** The part of the frame the camera preview shows at its default 3:4 ratio (object-fit: cover), in frame px. */
export const PREVIEW_34 = { x0: (W - (H * 3) / 4) / 2, x1: (W + (H * 3) / 4) / 2 };

/**
 * The group camera clips' layout. The preview shows only the frame's centred 3:4 window (PREVIEW_34: x 370–910,
 * 0.289–0.711; 1:1 shows 0.219–0.781), and group_faces.png's A, B and C sit at x 0.22, 0.55 and 0.82, so any fit of
 * the whole photo leaves A and C off screen. The clip cuts each face out of the photo instead and sets it inside the
 * window, A above, B and C side by side below (`faces`: face centres in frame px), at `scale` × the width fit
 * (1280/1800): A about 222, B 180 and C 169 px wide. At 1.0 (A 185, B 150, C 141 px, the whole-photo clip's sizes)
 * Chromium's FaceLandmarker misses C (on the CPU or GPU delegate) at 5 of 12 placements a few px apart; at 1.1, 1.15
 * and 1.2 it finds all three at every placement, and along the whole pan at 1.2, on both delegates.
 */
export const GROUP_CAM = { scale: 1.2, faces: { A: { x: 640, y: 182 }, B: { x: 505, y: 540 }, C: { x: 782, y: 540 } } };
/** A tile around a face: ±0.65 FW across (1.3 FW, as group6_faces.png's cells), 0.75 FW above the centre to 0.85 FW below (chin 0.58 FW, neck). */
const TILE = { half: 0.65, above: 0.75, below: 0.85 };

/**
 * composeGroupCam's tiles: `rect` (whole px) in group_faces.png scaled by `k` (= GROUP_CAM.scale × the width fit),
 * moved by (`dx`, `dy`) whole px, so the face pixels are those of that scaled photo; `face` (centre) and `fw` (face
 * width) in the scaled photo. `scale` lays them out on a frame `scale` × 1280×720 (the move clip's 0.5: k and the
 * GROUP_CAM places scaled with it).
 */
export function groupCamTiles(scale = 1) {
  const k = (W / GROUP_FACES.width) * GROUP_CAM.scale * scale;
  return GROUP_FACES.copies
    .filter((c) => c.name in GROUP_CAM.faces)
    .map((c) => {
      const f = groupFace(c);
      const face = { x: f.cx * k, y: f.cy * k };
      const fw = f.fw * k;
      const x = Math.round(face.x - TILE.half * fw);
      const y = Math.round(face.y - TILE.above * fw);
      const rect = { x, y, w: Math.round(face.x + TILE.half * fw) - x, h: Math.round(face.y + TILE.below * fw) - y };
      const to = GROUP_CAM.faces[c.name];
      return { name: c.name, k, face, fw, rect, dx: Math.round(to.x * scale - face.x), dy: Math.round(to.y * scale - face.y) };
    });
}

/** group_faces.png for the camera clips: its A, B and C tiles (GROUP_CAM) on the photo's plain background colour. */
export function composeGroupCam(png) {
  if (png.width !== GROUP_FACES.width || png.height !== GROUP_FACES.height) {
    throw new Error(`composeGroupCam: expects group_faces.png (${GROUP_FACES.width}×${GROUP_FACES.height}), got ${png.width}×${png.height}`);
  }
  const tiles = groupCamTiles();
  const sw = Math.round(png.width * tiles[0].k);
  const sh = Math.round(png.height * tiles[0].k);
  const img = resampleRgb(png.data, png.width, png.height, { x: 0, y: 0, w: png.width, h: png.height }, sw, sh);
  const rgb = new Float32Array(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    rgb[i * 3] = png.data[0];
    rgb[i * 3 + 1] = png.data[1];
    rgb[i * 3 + 2] = png.data[2];
  }
  for (const t of tiles) {
    for (let y = t.rect.y; y < t.rect.y + t.rect.h; y++) {
      const from = (y * sw + t.rect.x) * 3;
      rgb.set(img.subarray(from, from + t.rect.w * 3), ((y + t.dy) * W + t.rect.x + t.dx) * 3);
    }
  }
  return rgb;
}

/** mulberry32: a deterministic PRNG in [0, 1) */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `rgb` (w×h) shifted by (sx, sy) px (bilinear, edge clamp) plus uniform noise of ±amp levels drawn from `rand`. */
export function shiftFrame(rgb, sx, sy, rand, amp, w = W, h = H) {
  const out = new Float32Array(w * h * 3);
  const at = (x, y, k) => rgb[(Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 3 + k];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fx = x - sx;
      const fy = y - sy;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const ax = fx - x0;
      const ay = fy - y0;
      for (let k = 0; k < 3; k++) {
        const v =
          (at(x0, y0, k) * (1 - ax) + at(x0 + 1, y0, k) * ax) * (1 - ay) + (at(x0, y0 + 1, k) * (1 - ax) + at(x0 + 1, y0 + 1, k) * ax) * ay;
        out[(y * w + x) * 3 + k] = amp > 0 ? v + (rand() - 0.5) * 2 * amp : v;
      }
    }
  }
  return out;
}

/** A clip of distinct frames (each `{Y, U, V}`), 30 fps. */
export function encodeY4mFrames(planes, w, h) {
  const header = Buffer.from(`YUV4MPEG2 W${w} H${h} F30:1 Ip A1:1 C420jpeg\n`, 'ascii');
  const frameHeader = Buffer.from('FRAME\n', 'ascii');
  return Buffer.concat([header, ...planes.flatMap((p) => [frameHeader, p.Y, p.U, p.V])]);
}

// ---- camera per-person clips (spec §12.3, K20) ----

/** sample_face.png's face height over its width (its oval box, 722 × 619 px: GROUP6's comment) */
const FACE_H = 722 / 619;
/** neighbours' centres in a row of people standing shoulder to shoulder: 2.7 face widths apart (spec §6.1) */
const SHOULDER = 2.7;
const UPRIGHT = { width: 1080, height: 1920 };
const LONG = Math.max(UPRIGHT.width, UPRIGHT.height);
/** the upright clips are static: 8 identical frames (about 25 MB at 1080×1920) */
export const UPRIGHT_FRAMES = 8;

/**
 * A row of an upright layout: faces `fws` wide (fractions of the long edge) at height `cy`, neighbours' centres
 * SHOULDER × their mean width apart, the row centred on the frame's vertical midline, alternate faces mirrored.
 */
function uprightRow(fws, cy, firstMirror = false) {
  const xs = [0];
  for (let i = 1; i < fws.length; i++) xs.push(xs[i - 1] + SHOULDER * ((fws[i - 1] + fws[i]) / 2) * LONG);
  const left = UPRIGHT.width / 2 - xs[xs.length - 1] / 2;
  return fws.map((fw, i) => ({ fw, cx: (left + xs[i]) / UPRIGHT.width, cy, mirror: (i % 2 === 1) !== firstMirror }));
}

/**
 * Face layouts on an upright frame (the stream of a phone held upright: 1080×1920; the preview's 3:4 crop is y 240–1680):
 * fw = face width as a fraction of the LONG edge (BlazeFace fits the long edge, K19); cx, cy fractions of width, height.
 * UPRIGHT_ROW3: three faces at 6.5 % (125 px) across the width at mid-height (the builder check's case).
 */
export const UPRIGHT_ROW3 = { ...UPRIGHT, faces: uprightRow([0.065, 0.065, 0.065], 0.5) };

/** UPRIGHT_FAR10's back row (above, 3.0–3.4 %) and front row (3.5–4.0 %): a back-camera group about 3 m away */
const FAR_BACK = [0.032, 0.03, 0.034, 0.031, 0.033];
const FAR_FRONT = [0.038, 0.035, 0.04, 0.036, 0.037];
/** half the rows' distance (fraction of the height): 1.6 mean face heights apart */
const FAR_HALF = (1.6 * FACE_H * ([...FAR_BACK, ...FAR_FRONT].reduce((s, f) => s + f, 0) / 10) * LONG) / 2 / UPRIGHT.height;
/** ten faces at 3–4 % (58–77 px) in two rows of five around the frame centre (gates PGR and PGN) */
export const UPRIGHT_FAR10 = { ...UPRIGHT, faces: [...uprightRow(FAR_BACK, 0.5 - FAR_HALF), ...uprightRow(FAR_FRONT, 0.5 + FAR_HALF, true)] };

/**
 * A group selfie: two near faces at 14 % and 16 % side by side in the lower half (centres 2.68 widths apart, both whole
 * in the 3:4 crop; their cells run off the frame's sides), three at 6–8 % in a row behind them (the solo path finds the
 * near two, the group path the back row).
 */
export const SELFIE_GROUP = {
  ...UPRIGHT,
  faces: [
    { fw: 0.14, cx: 0.135, cy: 0.68, mirror: false },
    { fw: 0.16, cx: 0.85, cy: 0.68, mirror: true },
    { fw: 0.06, cx: (540 - 363) / 1080, cy: 0.45, mirror: true },
    { fw: 0.07, cx: 0.5, cy: 0.45, mirror: false },
    { fw: 0.08, cx: (540 + 363) / 1080, cy: 0.45, mirror: true },
  ],
};

/**
 * Bench row JG's still clip (PJ1G, camera per-person spec §10: a still face refreshed by the whole view and one
 * refreshed by a tile): one face at 14 % of the long edge (179 px) on a 1280 × 720 landscape frame, above short-range's
 * floor (about 12 %, §6.1), so MediaPipe's numFaces-1 VIDEO graph (JG's reference) finds it, and whole inside one tile
 * of the back camera's layout over the whole frame for either detector (full-range: t1,0 of 480 px tiles; short-range:
 * t2,1 of 349 px tiles), so JG's whole and tile kinds both follow the face the reference follows. `noise`: 60 frames,
 * each shifted by a seeded sub-pixel offset with ±2 levels of noise (noiseFrames), as group_noise.y4m: identical frames
 * have no jitter to measure. (group_noise.y4m's tile kind is n/a whenever MediaPipe follows its face A, 225 px wide,
 * which no 480 px tile holds whole, the tiles' horizontal overlap being 213 px; which of its faces MediaPipe follows
 * varies by run.)
 */
export const TILE_FACE = { width: W, height: H, faces: [{ fw: 0.14, cx: 0.427, cy: 0.46, mirror: false }], noise: { seed: 7, frames: 60 } };

/**
 * E4d's blocker scene (camera per-person spec §12.2, round-3 review E7): a far face at 3.2 % of the long edge (61 px, as
 * UPRIGHT_FAR10's back row) just above and right of a near face at 15 % (288 px), as someone standing behind a
 * shoulder. The near face's oval box (288 × 336 px around (540, 1136)) tops out at y 968; padded by SEED_BOX_PAD (0.25)
 * it reaches up to y 884 and right to x 756, so the far face's centre (640, 921) lies inside it while the far face
 * (y 886–957) is boxed apart from the near one (IoU 0). On a 9:16 shot the editor's one full-range pass finds the near
 * face only: the hand-over's never-edited box on it (round-1 review C7) is all that keeps an edited far person's box
 * from taking it by the padded-centre rule.
 */
export const UPRIGHT_BEHIND = {
  ...UPRIGHT,
  faces: [
    { fw: 0.15, cx: 0.5, cy: 1136 / 1920, mirror: false },
    { fw: 0.032, cx: 640 / 1080, cy: 921 / 1920, mirror: true },
  ],
};

/** `--layout` names */
export const LAYOUTS = { upright_row3: UPRIGHT_ROW3, upright_far10: UPRIGHT_FAR10, upright_behind: UPRIGHT_BEHIND, selfie_group: SELFIE_GROUP, tile_face: TILE_FACE };

/** `n` distinct I420 frames of `rgb` (w×h): each shifted by a seeded sub-pixel offset in [−0.5, 0.5) px with ±2 levels of noise */
export function noiseFrames(rgb, w, h, seed, n) {
  const rand = rng(seed);
  const frames = [];
  for (let f = 0; f < n; f++) {
    const sx = rand() - 0.5;
    const sy = rand() - 0.5;
    frames.push(rgbToI420(shiftFrame(rgb, sx, sy, rand, 2, w, h), w, h));
  }
  return frames;
}

/**
 * A layout's frame (Float32 RGB, layout.width × layout.height) from sample_face.png: GROUP6's 1.3 FW square crop
 * resampled into each face's cell (size = round(fw · long · crop.w / SAMPLE_FACE.fw), placed as smallFaceCell places
 * it), mirrored per face, on backdropColour; each face moved by seeded sub-pixel offsets in [0, 1) px (BlazeFace's
 * scores depend on where a face falls on its anchor grid, spec §6.1). Cells running off the frame are clipped.
 */
export function composeCells(png, layout, seed) {
  const { width: w, height: h } = layout;
  const long = Math.max(w, h);
  const { crop } = GROUP6;
  const fill = backdropColour(png);
  const rgb = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) rgb.set(fill, i * 3);
  const rand = rng(seed);
  for (const spec of layout.faces) {
    // smallFaceCell measures fw against the image width: the same face, its width a fraction of the long edge
    const c = smallFaceCell({ ...spec, fw: (spec.fw * long) / w }, layout);
    const ox = rand();
    const oy = rand();
    const s = crop.w / c.size;
    // the face lands (ox, oy) px right of and below its whole-px cell: the source rect moves the other way (mirrored:
    // the cell is flipped, so the same way)
    const rect = { x: crop.x + (spec.mirror ? ox : -ox) * s, y: crop.y - oy * s, w: crop.w, h: crop.h };
    const cell = resampleRgb(png.data, png.width, png.height, rect, c.size, c.size);
    for (let y = Math.max(0, -c.y); y < Math.min(c.size, h - c.y); y++) {
      for (let x = Math.max(0, -c.x); x < Math.min(c.size, w - c.x); x++) {
        const i = (y * c.size + (spec.mirror ? c.size - 1 - x : x)) * 3;
        const o = ((c.y + y) * w + c.x + x) * 3;
        rgb[o] = cell[i];
        rgb[o + 1] = cell[i + 1];
        rgb[o + 2] = cell[i + 2];
      }
    }
  }
  return rgb;
}

/**
 * A gen-group-fixture layout's face boxes (its oval boxes: fw wide, fw · FACE_H tall, at (cx, cy)) in frame UV once
 * composeFitWidth drew the image: scaled to the 1280-px width, bottom-aligned (the top cropped).
 */
export function composeFitWidthBoxes(layout) {
  const sx = W / layout.width;
  const dh = Math.round((layout.height * W) / layout.width);
  const sy = dh / layout.height;
  const top = H - dh;
  return layout.faces.map((f) => {
    const w = f.fw * layout.width * sx;
    const h = f.fw * layout.width * FACE_H * sy;
    const cx = f.cx * layout.width * sx;
    const cy = f.cy * layout.height * sy + top;
    return { x: (cx - w / 2) / W, y: (cy - h / 2) / H, w: w / W, h: h / H };
  });
}

/** group_move.y4m: half of the group clips' frame (about 187 MB for 540 frames), 18 s, looping to its first frame */
export const MOVE = { width: 640, height: 360, seconds: 18 };
const MOVE_SCALE = MOVE.width / W;

/**
 * group_move's timeline at time `t` (s, wrapped to the 18 s loop): face centres in MOVE px (GROUP_CAM's places × 0.5),
 * C null while away, `cBehind` while C passes behind B (C drawn first).
 *   0–2 s still · 2–3.5 s C away · 3.5–5.5 s C back at +0.2 of its face width · 5.5–7 s B and C swap places (about
 *   1.1 C face widths per second, C behind B, hidden about 0.3 s) · 7–8.5 s still · 8.5–10 s they swap back ·
 *   10–11 s still · 11–16.5 s C away (5.5 s, over REID_GRACE_MS) · 16.5–18 s still.
 * (Not §12.3's 16 s clip: that one ends with B where C starts, so its loop seam would hand B's track to C.)
 */
export function moveAt(t) {
  const T = ((t % MOVE.seconds) + MOVE.seconds) % MOVE.seconds;
  const home = (name) => ({ x: GROUP_CAM.faces[name].x * MOVE_SCALE, y: GROUP_CAM.faces[name].y * MOVE_SCALE });
  const [A, B, C] = [home('A'), home('B'), home('C')];
  const near = { x: C.x + 0.2 * groupCamTiles(MOVE_SCALE).find((k) => k.name === 'C').fw, y: C.y };
  const lerp = (p, q, u) => ({ x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u });
  const at = (b, c, cBehind = false) => ({ A, B: b, C: c, cBehind });
  if (T < 2) return at(B, C);
  if (T < 3.5) return at(B, null);
  if (T < 5.5) return at(B, near);
  if (T < 7) return at(lerp(B, C, (T - 5.5) / 1.5), lerp(near, B, (T - 5.5) / 1.5), true);
  if (T < 8.5) return at(C, B);
  if (T < 10) return at(lerp(C, B, (T - 8.5) / 1.5), lerp(B, C, (T - 8.5) / 1.5), true);
  if (T < 11) return at(B, C);
  if (T < 16.5) return at(B, null);
  return at(B, C);
}

/**
 * group_move's frames before their per-frame shift: group_faces.png's A, B and C tiles (groupCamTiles at half scale)
 * on the photo's background, each with its face centre at a moveAt state's place (whole px); C drawn before B while
 * `cBehind`, so B covers it. Returns state → Float32 RGB of MOVE.width × MOVE.height.
 */
export function composeMove(png) {
  if (png.width !== GROUP_FACES.width || png.height !== GROUP_FACES.height) {
    throw new Error(`composeMove: expects group_faces.png (${GROUP_FACES.width}×${GROUP_FACES.height}), got ${png.width}×${png.height}`);
  }
  const tiles = Object.fromEntries(groupCamTiles(MOVE_SCALE).map((t) => [t.name, t]));
  const sw = Math.round(png.width * tiles.A.k);
  const sh = Math.round(png.height * tiles.A.k);
  const img = resampleRgb(png.data, png.width, png.height, { x: 0, y: 0, w: png.width, h: png.height }, sw, sh);
  const { width: w, height: h } = MOVE;
  const bg = [png.data[0], png.data[1], png.data[2]];
  return (state) => {
    const rgb = new Float32Array(w * h * 3);
    for (let i = 0; i < w * h; i++) rgb.set(bg, i * 3);
    for (const name of state.cBehind ? ['A', 'C', 'B'] : ['A', 'B', 'C']) {
      const to = state[name];
      if (!to) continue;
      const t = tiles[name];
      const dx = Math.round(to.x - t.face.x);
      const dy = Math.round(to.y - t.face.y);
      // the tile's columns and rows that land inside the frame
      const x0 = Math.max(t.rect.x, -dx);
      const x1 = Math.min(t.rect.x + t.rect.w, w - dx);
      if (x1 <= x0) continue;
      for (let y = Math.max(t.rect.y, -dy); y < Math.min(t.rect.y + t.rect.h, h - dy); y++) {
        const from = (y * sw + x0) * 3;
        rgb.set(img.subarray(from, from + (x1 - x0) * 3), ((y + dy) * w + x0 + dx) * 3);
      }
    }
    return rgb;
  };
}

/** A JPEG decoded in headless Chromium (composeFitWidth reads pixels; pngjs reads PNG only): its pixels as a pngjs PNG. */
async function decodeJpeg(path) {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><meta charset="utf-8"><body></body>');
    const url = await page.evaluate(async (src) => {
      const i = new Image();
      i.src = src;
      await i.decode();
      const c = document.createElement('canvas');
      c.width = i.naturalWidth;
      c.height = i.naturalHeight;
      c.getContext('2d').drawImage(i, 0, 0);
      return c.toDataURL('image/png');
    }, `data:image/jpeg;base64,${readFileSync(path).toString('base64')}`);
    return PNG.sync.read(Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
  } finally {
    await browser.close();
  }
}

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};

const report = (outRel, w, h, bytes) => console.log(`${outRel} ${w}x${h} (${(bytes / 1e6).toFixed(1)} MB)`);

/** Optional RGB preview of the composed frame (for eyeballing / the fake-camera check): `--preview <png>`. */
function writePreview(rgb, w, h) {
  const p = arg('--preview', null);
  if (!p) return;
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) {
    png.data[i * 4] = clamp8(rgb[i * 3]);
    png.data[i * 4 + 1] = clamp8(rgb[i * 3 + 1]);
    png.data[i * 4 + 2] = clamp8(rgb[i * 3 + 2]);
    png.data[i * 4 + 3] = 255;
  }
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, PNG.sync.write(png));
  console.log(`preview -> ${p}`);
}

/** `--move`: group_move.y4m, every frame moveAt(f / 30) shifted by ±0.5 px (seeded), written frame by frame */
function writeMove(outRel, seed) {
  const frame = composeMove(PNG.sync.read(readFileSync(join(root, arg('--src', 'tests/fixtures/group_faces.png')))));
  const { width: w, height: h } = MOVE;
  const out = join(root, outRel);
  mkdirSync(dirname(out), { recursive: true });
  const fd = openSync(out, 'w');
  let bytes = 0;
  const put = (buf) => {
    writeSync(fd, buf);
    bytes += buf.length;
  };
  try {
    put(Buffer.from(`YUV4MPEG2 W${w} H${h} F30:1 Ip A1:1 C420jpeg\n`, 'ascii'));
    const rand = rng(seed);
    for (let f = 0; f < MOVE.seconds * 30; f++) {
      const { Y, U, V } = rgbToI420(shiftFrame(frame(moveAt(f / 30)), rand() - 0.5, rand() - 0.5, rand, 0, w, h), w, h);
      put(Buffer.from('FRAME\n', 'ascii'));
      put(Y);
      put(U);
      put(V);
    }
  } finally {
    closeSync(fd);
  }
  report(outRel, w, h, bytes);
  writePreview(frame(moveAt(0)), w, h);
}

async function main() {
  const seed = Number(arg('--seed', '1'));
  const layoutName = arg('--layout', null);
  if (layoutName !== null) {
    const layout = LAYOUTS[layoutName];
    if (!layout) throw new Error(`--layout ${layoutName}: expected one of ${Object.keys(LAYOUTS).join(', ')}`);
    const outRel = arg('--out', `tests/fixtures/${layoutName}.y4m`);
    const base = composeCells(PNG.sync.read(readFileSync(join(root, arg('--src', 'tests/fixtures/sample_face.png')))), layout, seed);
    const buf = layout.noise
      ? encodeY4mFrames(noiseFrames(base, layout.width, layout.height, layout.noise.seed, layout.noise.frames), layout.width, layout.height)
      : encodeY4m(rgbToI420(base, layout.width, layout.height), layout.width, layout.height, UPRIGHT_FRAMES);
    const out = join(root, outRel);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, buf);
    report(outRel, layout.width, layout.height, buf.length);
    writePreview(base, layout.width, layout.height);
    return;
  }
  if (process.argv.includes('--move')) {
    writeMove(arg('--out', 'tests/fixtures/group_move.y4m'), seed);
    return;
  }

  const srcRel = arg('--src', 'tests/fixtures/sample_face.png');
  const outRel = arg('--out', 'tests/fixtures/face.y4m');
  const noise = arg('--noise', null);
  const pan = arg('--pan', null);
  const src = /\.jpe?g$/i.test(srcRel) ? await decodeJpeg(join(root, srcRel)) : PNG.sync.read(readFileSync(join(root, srcRel)));
  const base = srcRel.endsWith('sample_face.png')
    ? composeFrame(src)
    : srcRel.endsWith('group_faces.png')
      ? composeGroupCam(src)
      : composeFitWidth(src);
  const out = join(root, outRel);
  mkdirSync(dirname(out), { recursive: true });
  let buf;
  if (noise === null && pan === null) {
    buf = encodeY4m(rgbToI420(base, W, H), W, H, FRAMES);
  } else {
    const n = Number(arg('--frames', '60'));
    // face width of face A in the group clip (0.42 × 619 px × 1280/1800 × GROUP_CAM.scale ≈ 222 px)
    const fwPx = Number(arg('--fw', String(Math.round(groupCamTiles()[0].fw))));
    const rand = rng(Number(noise ?? 1));
    const frames = [];
    for (let f = 0; f < n; f++) {
      const sx = pan !== null ? (Number(pan) * fwPx * f) / 30 : rand() - 0.5;
      const sy = pan !== null ? 0 : rand() - 0.5;
      frames.push(rgbToI420(shiftFrame(base, sx, sy, rand, noise !== null ? 2 : 0), W, H));
    }
    buf = encodeY4mFrames(frames, W, H);
  }
  writeFileSync(out, buf);
  report(outRel, W, H, buf.length);
  writePreview(base, W, H);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
