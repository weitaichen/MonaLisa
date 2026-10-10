// Generates the drawn-lines 美體 fixture (reports/美體修圖 背景扭曲 抑制技術.md, stage 0): tests/fixtures/fullbody.jpg
// with 1–2 px dark straight lines drawn only where the recorded person mask (tests/fixtures/pose_fullbody.json,
// bilinearly upsampled) is below 0.1, i.e. on background. Lines: verticals 0.25 / 0.5 / 1 / 2 W outside the waist
// silhouette on both sides (W = measured waist half-width), horizontals at the neck, waist and knee rows (they run
// behind the person: T-junctions), and 30° / 45° diagonals through the waist side.
//   node scripts/gen-lines-fixture.mjs
// → tests/fixtures/fullbody_lines.jpg (JPEG q 0.95, same size) + tests/fixtures/fullbody_lines.json (the lines in px,
// and how many pixels of each were drawn). Re-run only when the source photo or its pose fixture changes.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fx = (p) => resolve(root, 'tests/fixtures', p);
const pose = JSON.parse(readFileSync(fx('pose_fullbody.json'), 'utf8'));
const { width: W, height: H } = pose;
const mask = { width: pose.mask.width, height: pose.mask.height, data: Buffer.from(pose.mask.data, 'base64') };
const MASK_MAX = 0.1;
/** full coverage within CORE px of the line, fading to 0 over the next 1 px: 1.5–2 px wide lines */
const CORE = 0.4;

/** bilinear mask at pixel centre (x, y), 0..1 */
function maskAt(x, y) {
  const mx = Math.max(0, Math.min(mask.width - 1, ((x + 0.5) / W) * mask.width - 0.5));
  const my = Math.max(0, Math.min(mask.height - 1, ((y + 0.5) / H) * mask.height - 0.5));
  const x0 = Math.floor(mx);
  const y0 = Math.floor(my);
  const x1 = Math.min(mask.width - 1, x0 + 1);
  const y1 = Math.min(mask.height - 1, y0 + 1);
  const fx_ = mx - x0;
  const fy = my - y0;
  const m = (xx, yy) => mask.data[yy * mask.width + xx] / 255;
  return (m(x0, y0) * (1 - fx_) + m(x1, y0) * fx_) * (1 - fy) + (m(x0, y1) * (1 - fx_) + m(x1, y1) * fx_) * fy;
}

const kp = (i) => [pose.points[i * 4] * W, pose.points[i * 4 + 1] * H];
const shoulderY = (kp(11)[1] + kp(12)[1]) / 2;
const hipY = (kp(23)[1] + kp(24)[1]) / 2;
const kneeY = (kp(25)[1] + kp(26)[1]) / 2;
const noseY = kp(0)[1];
const cx = (kp(23)[0] + kp(24)[0]) / 2;
// waist: the narrowest torso row between 45 % and 85 % of shoulder → hip, edges where the mask drops below 0.5
let waist = null;
for (let y = Math.round(shoulderY + 0.45 * (hipY - shoulderY)); y <= shoulderY + 0.85 * (hipY - shoulderY); y++) {
  let l = Math.round(cx);
  let r = Math.round(cx);
  while (l > 0 && maskAt(l - 1, y) >= 0.5) l--;
  while (r < W - 1 && maskAt(r + 1, y) >= 0.5) r++;
  if (!waist || r - l < waist.r - waist.l) waist = { y, l, r };
}
const halfW = (waist.r - waist.l + 1) / 2;

/** the part of the line through p with direction angle deg (y down) inside the frame */
function clip(p, deg, tag) {
  const d = [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
  let t0 = -Infinity;
  let t1 = Infinity;
  for (const [o, dd, hi] of [
    [p[0], d[0], W],
    [p[1], d[1], H],
  ]) {
    if (Math.abs(dd) < 1e-12) continue;
    const a = -o / dd;
    const b = (hi - o) / dd;
    t0 = Math.max(t0, Math.min(a, b));
    t1 = Math.min(t1, Math.max(a, b));
  }
  const r = (v) => Math.round(v * 100) / 100;
  return { tag, angleDeg: deg, a: [r(p[0] + t0 * d[0]), r(p[1] + t0 * d[1])], b: [r(p[0] + t1 * d[0]), r(p[1] + t1 * d[1])] };
}

const lines = [];
for (const k of [0.25, 0.5, 1, 2]) {
  lines.push(clip([waist.l - 0.5 - k * halfW, 0], 90, `door+${k}W L`));
  lines.push(clip([waist.r + 0.5 + k * halfW, 0], 90, `door+${k}W R`));
}
lines.push(clip([0, Math.round((noseY + shoulderY) / 2)], 0, 'h neck'));
lines.push(clip([0, waist.y], 0, 'h waist'));
lines.push(clip([0, Math.round(kneeY)], 0, 'h knee'));
lines.push(clip([waist.r + halfW, waist.y], -30, 'd30 R'));
lines.push(clip([waist.l - halfW, waist.y], 30, 'd30 L'));
lines.push(clip([waist.r + 0.5 * halfW, hipY], 45, 'd45 R'));
lines.push(clip([waist.l - 0.5 * halfW, hipY], -45, 'd45 L'));

/** per-pixel line coverage (only where the mask is below MASK_MAX), and per-line drawn-pixel counts */
const cover = new Float32Array(W * H);
for (const l of lines) {
  const dx = l.b[0] - l.a[0];
  const dy = l.b[1] - l.a[1];
  const len = Math.hypot(dx, dy);
  let drawn = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const px = x + 0.5 - l.a[0];
      const py = y + 0.5 - l.a[1];
      const t = Math.max(0, Math.min(len, (px * dx + py * dy) / len));
      const dist = Math.hypot(px - (t * dx) / len, py - (t * dy) / len);
      const c = Math.max(0, Math.min(1, CORE + 1 - dist));
      if (c <= 0 || maskAt(x, y) >= MASK_MAX) continue;
      cover[y * W + x] = Math.max(cover[y * W + x], c);
      if (c >= 0.5) drawn++;
    }
  l.drawnPx = drawn;
  if (drawn < 40) throw new Error(`line ${l.tag} is almost entirely on the person (${drawn} px)`);
}

/** Bundled Playwright chromium may be missing; fall back to the newest installed revision (as record-pose.mjs). */
async function launch() {
  try {
    return await chromium.launch();
  } catch (e) {
    const base = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
    const revs = existsSync(base) ? readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort() : [];
    for (const rev of revs.reverse())
      for (const exe of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome']) {
        const p = join(base, rev, exe);
        if (existsSync(p)) return chromium.launch({ executablePath: p });
      }
    throw e;
  }
}

const browser = await launch();
try {
  const page = await browser.newPage();
  const jpeg = await page.evaluate(
    async ([src, cov, w, h]) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      if (img.naturalWidth !== w || img.naturalHeight !== h) throw new Error('size mismatch');
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const id = ctx.getImageData(0, 0, w, h);
      const LINE = [24, 24, 28];
      for (let i = 0; i < w * h; i++) {
        const a = cov[i];
        if (!a) continue;
        for (let k = 0; k < 3; k++) id.data[i * 4 + k] = Math.round(id.data[i * 4 + k] * (1 - a) + LINE[k] * a);
      }
      ctx.putImageData(id, 0, 0);
      return c.toDataURL('image/jpeg', 0.95);
    },
    [`data:image/jpeg;base64,${readFileSync(fx('fullbody.jpg')).toString('base64')}`, Array.from(cover), W, H],
  );
  writeFileSync(fx('fullbody_lines.jpg'), Buffer.from(jpeg.split(',')[1], 'base64'));
} finally {
  await browser.close();
}
const meta = {
  source: 'tests/fixtures/fullbody.jpg',
  generator: 'scripts/gen-lines-fixture.mjs',
  width: W,
  height: H,
  note:
    'Lines in image px (top-left origin), drawn dark (~1.5–2 px) only where the bilinearly upsampled pose_fullbody.json ' +
    `mask is < ${MASK_MAX}; drawnPx = pixels with coverage ≥ 0.5. waist = narrowest torso row, W = its half-width.`,
  waist: { y: waist.y, left: waist.l, right: waist.r, halfWidthPx: halfW },
  lines,
};
writeFileSync(fx('fullbody_lines.json'), JSON.stringify(meta, null, 1) + '\n');
console.log(`wrote tests/fixtures/fullbody_lines.jpg + .json: ${lines.length} lines, waist y ${waist.y} [${waist.l}, ${waist.r}]`);
for (const l of lines) console.log(`  ${l.tag.padEnd(12)} ${JSON.stringify(l.a)} → ${JSON.stringify(l.b)}  ${l.drawnPx} px`);
