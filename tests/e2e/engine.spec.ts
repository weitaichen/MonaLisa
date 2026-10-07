// Engine render correctness on sample_face.png (spec §10 "Engine"), on the dev server page that
// imports src/engine directly. Pixels are compared against the pngjs-decoded source in Node.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeDataUrl, decodePng, expect, mad, meanLuma, type Pixels, type Rect, SAMPLE_FACE, SHOTS, test } from './fixtures';

const landmarks = JSON.parse(readFileSync(resolve(import.meta.dirname, '../fixtures/landmarks_sample_face.json'), 'utf8')) as {
  width: number;
  height: number;
  points: number[];
};

const DEV_URL = 'http://127.0.0.1:5190';

/** square patch (pixels) centred on MediaPipe landmark `i` of the fixture */
function patchAt(i: number, size: number): Rect {
  const x = Math.round(landmarks.points[i * 3] * landmarks.width - size / 2);
  const y = Math.round(landmarks.points[i * 3 + 1] * landmarks.height - size / 2);
  return { x, y, w: size, h: size };
}

const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** Freckle-band detail: mean |box3 − box15| of luma over `r` (sampled every 2 px). */
function detail(p: Pixels, r: Rect): number {
  const L = (x: number, y: number) => {
    const i = (y * p.width + x) * 4;
    return 0.299 * p.data[i] + 0.587 * p.data[i + 1] + 0.114 * p.data[i + 2];
  };
  const box = (x: number, y: number, k: number) => {
    let s = 0;
    for (let j = -k; j <= k; j++) for (let i = -k; i <= k; i++) s += L(x + i, y + j);
    return s / ((2 * k + 1) * (2 * k + 1));
  };
  let sum = 0;
  let n = 0;
  for (let y = r.y; y < r.y + r.h; y += 2) {
    for (let x = r.x; x < r.x + r.w; x += 2) {
      sum += Math.abs(box(x, y, 1) - box(x, y, 7));
      n++;
    }
  }
  return sum / n;
}

test('engine: 原圖 ≈ identity, 自然 smooths the skin only, big-eye warps only the eyes', async ({ page }) => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/engine.html`);
  await page.waitForFunction(() => typeof window.runEngineCheck === 'function');
  const r = await page.evaluate(() => window.runEngineCheck!());
  console.log(`renderer: ${r.renderer}; passes: ${JSON.stringify(r.passes)}`);

  for (const [k, v] of Object.entries(r.png)) writeFileSync(resolve(SHOTS, `30-engine-${k}.png`), Buffer.from(v.split(',')[1], 'base64'));

  expect(r.glErrors).toEqual({ lip: 0, original: 0, natural: 0, bigEye: 0, display: 0 });
  // engine.ready covers the makeup textures: the very first lipstick render draws the makeup pass
  expect(r.passes.lip).toContain('makeup');
  const src = decodePng(readFileSync(SAMPLE_FACE));
  expect([r.width, r.height]).toEqual([src.width, src.height]);
  const original = decodeDataUrl(r.png.original);
  const natural = decodeDataUrl(r.png.natural);
  const bigEye = decodeDataUrl(r.png.bigEye);
  const display = decodeDataUrl(r.displayNatural);

  // 原圖: neutral params are an identity (spec: mean abs diff < 2/255)
  const identity = mad(original, src);
  expect(identity).toBeLessThan(2);

  // 自然: non-black and clearly different on the skin. Whitening is global (as in GPUPixel), so the
  // background shifts colour too; what the face mask must guarantee is that *smoothing* stays on
  // the skin: freckle-scale detail drops on cheeks/forehead but not on the sweater or hair.
  expect(meanLuma(natural)).toBeGreaterThan(20);
  const skinPatches = [101, 205, 330, 425, 151, 337].map((i) => patchAt(i, 48));
  const offFace: Rect[] = [
    { x: 420, y: 1150, w: 160, h: 160 }, // sweater
    { x: 60, y: 700, w: 120, h: 120 }, // hair
  ];
  const whole = mad(natural, src);
  const skin = avg(skinPatches.map((p) => mad(natural, src, p)));
  const skinDetail = avg(skinPatches.map((p) => detail(natural, p) / detail(src, p)));
  const offDetail = avg(offFace.map((p) => detail(natural, p) / detail(src, p)));
  console.log(
    `identity ${identity.toFixed(3)}; 自然 whole ${whole.toFixed(2)} skin ${skin.toFixed(2)}; ` +
      `detail kept: skin ${skinDetail.toFixed(2)} off-face ${offDetail.toFixed(2)}`,
  );
  expect(whole).toBeGreaterThan(1);
  expect(skin).toBeGreaterThan(3);
  expect(skinDetail).toBeLessThan(0.8);
  expect(offDetail).toBeGreaterThan(0.95);
  // the face path ran: mask + reshape (自然 has big-eye/slim) before the mean and composite
  expect(r.passes.natural).toEqual(expect.arrayContaining(['mask', 'reshape', 'meanH', 'meanV', 'composite']));
  expect(r.passes.original).not.toContain('reshape');
  // still display == export (same processing size, unmirrored, upright)
  expect(mad(display, natural)).toBeLessThan(1);

  // big-eye only: the eyes change, a far patch (chin-side background corner) does not
  const eyeL = patchAt(468, 50);
  const eyeR = patchAt(473, 50);
  const farCorner: Rect = { x: src.width - 130, y: src.height - 130, w: 120, h: 120 };
  const eyes = (mad(bigEye, src, eyeL) + mad(bigEye, src, eyeR)) / 2;
  const far = mad(bigEye, src, farCorner);
  console.log(`big-eye: eyes ${eyes.toFixed(2)}, far ${far.toFixed(3)}`);
  expect(eyes).toBeGreaterThan(3);
  expect(far).toBeLessThan(0.5);
  expect(r.passes.bigEye).toContain('reshape');
});
