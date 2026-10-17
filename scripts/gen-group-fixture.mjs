// Builds the step-1 group fixtures from Apache-2.0 images already in tests/fixtures (LICENSES/NOTICE.txt):
//   group_faces.png  1800×1200: four sample_face.png copies with their upper bodies, bottom-aligned on the source's
//                    edge colour: A scale 0.42 at x 0.22; B mirrored, 0.34 at x 0.55; C 0.32 at x 0.82; D 0.05 at the
//                    bottom right (its face is below MIN_FACE_FRAC: must be ignored)
//                    (PD2, S §6.3: Chromium's FaceLandmarker misses C at the spec's 0.22 and at PD2's 0.26, CPU and GPU;
//                    0.32 is the smallest scale found at every decode 1024–2048 with one step of margin: 0.31 is
//                    found too, 0.30 is missed on CPU)
//   group6_faces.png 2048×1536: six square cells of sample_face.png (1.3 face widths each) in a 3×2 grid, odd cells
//                    mirrored: faces 1.3 FW apart (clustered-cap bench and e2e)
//   group_people.jpg fullbody.jpg + fullbody_yoga.jpg side by side at equal height (1000 px), JPEG q 0.92
// Composed with canvas 2D in headless Chromium (Playwright), so it is deterministic for a given Chromium build.
//   node scripts/gen-group-fixture.mjs
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fx = (name) => join(root, 'tests', 'fixtures', name);
const dataUrl = (name, mime) => `data:${mime};base64,${readFileSync(fx(name)).toString('base64')}`;

/** sample_face.png is 1000×1500; x = copy centre (fraction of the width); copies are bottom-aligned */
export const GROUP_FACES = {
  width: 1800,
  height: 1200,
  copies: [
    { name: 'A', scale: 0.42, x: 0.22, mirror: false },
    { name: 'B', scale: 0.34, x: 0.55, mirror: true },
    { name: 'C', scale: 0.32, x: 0.82, mirror: false },
    { name: 'D', scale: 0.05, x: 0.975, mirror: false },
  ],
};

/**
 * sample_face.png's face (oval bbox of landmarks_sample_face.json): x 193–813, y 270–992 px, face width 619 px,
 * centre (503, 631); the crop is a square of 805 px = 1.3 FW around that centre, drawn into 644 px cells (0.8×).
 */
export const GROUP6 = { width: 2048, height: 1536, cell: 644, crop: { x: 100.5, y: 227.5, w: 805, h: 805 } };

/** sample_face.png's size and its face (centre and width of the oval bbox above), in its own px */
export const SAMPLE_FACE = { width: 1000, height: 1500, cx: 503, cy: 631, fw: 619 };

/** A GROUP_FACES copy's face in group_faces.png px (centre, face width), from the copy's rect as `main` draws it. */
export function groupFace(copy) {
  const w = Math.round(SAMPLE_FACE.width * copy.scale);
  const h = Math.round(SAMPLE_FACE.height * copy.scale);
  const left = Math.round(copy.x * GROUP_FACES.width - w / 2);
  const fx = (SAMPLE_FACE.cx * w) / SAMPLE_FACE.width;
  return {
    cx: left + (copy.mirror ? w - fx : fx),
    cy: GROUP_FACES.height - h + (SAMPLE_FACE.cy * h) / SAMPLE_FACE.height,
    fw: (SAMPLE_FACE.fw * w) / SAMPLE_FACE.width,
  };
}

/** Bundled Playwright chromium may be missing; fall back to the newest installed revision. */
async function launch() {
  // imported here, not at the top: gen-y4m.mjs and the unit tests import this module for its geometry only
  const { chromium } = await import('@playwright/test');
  try {
    return await chromium.launch();
  } catch (e) {
    const base = join(process.env.LOCALAPPDATA ?? '', 'ms-playwright');
    const revs = existsSync(base) ? readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort() : [];
    for (const rev of revs.reverse()) {
      for (const exe of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome']) {
        const p = join(base, rev, exe);
        if (existsSync(p)) return chromium.launch({ executablePath: p });
      }
    }
    return chromium.launch({ channel: 'chrome' }).catch(() => {
      throw e;
    });
  }
}

async function main() {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><meta charset="utf-8"><body></body>');
    const out = await page.evaluate(
      async ({ face, body, yoga, G, G6 }) => {
        const load = async (src) => {
          const i = new Image();
          i.src = src;
          await i.decode();
          return i;
        };
        const [F, Bd, Y] = await Promise.all([load(face), load(body), load(yoga)]);
        const canvas = (w, h) => {
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const g = c.getContext('2d');
          g.imageSmoothingEnabled = true;
          g.imageSmoothingQuality = 'high';
          return [c, g];
        };
        // the source's edge colour: mean of its top-left 40×40 block
        const [, pg] = canvas(40, 40);
        pg.drawImage(F, 0, 0, 40, 40, 0, 0, 40, 40);
        const px = pg.getImageData(0, 0, 40, 40).data;
        const mean = [0, 1, 2].map((k) => {
          let s = 0;
          for (let i = k; i < px.length; i += 4) s += px[i];
          return Math.round(s / (px.length / 4));
        });
        const fill = `rgb(${mean.join(',')})`;
        const draw = (g, img, sx, sy, sw, sh, dx, dy, dw, dh, mirror) => {
          g.save();
          if (mirror) {
            g.translate(dx + dw, dy);
            g.scale(-1, 1);
            g.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
          } else g.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
          g.restore();
        };

        const [c1, g1] = canvas(G.width, G.height);
        g1.fillStyle = fill;
        g1.fillRect(0, 0, G.width, G.height);
        for (const k of G.copies) {
          const w = Math.round(F.naturalWidth * k.scale);
          const h = Math.round(F.naturalHeight * k.scale);
          draw(g1, F, 0, 0, F.naturalWidth, F.naturalHeight, Math.round(k.x * G.width - w / 2), G.height - h, w, h, k.mirror);
        }

        const [c2, g2] = canvas(G6.width, G6.height);
        g2.fillStyle = fill;
        g2.fillRect(0, 0, G6.width, G6.height);
        const x0 = Math.round((G6.width - 3 * G6.cell) / 2);
        const y0 = Math.round((G6.height - 2 * G6.cell) / 2);
        for (let i = 0; i < 6; i++) {
          const cx = x0 + (i % 3) * G6.cell;
          const cy = y0 + Math.floor(i / 3) * G6.cell;
          draw(g2, F, G6.crop.x, G6.crop.y, G6.crop.w, G6.crop.h, cx, cy, G6.cell, G6.cell, i % 2 === 1);
        }

        const yw = Math.round((Y.naturalWidth * Bd.naturalHeight) / Y.naturalHeight);
        const [c3, g3] = canvas(Bd.naturalWidth + yw, Bd.naturalHeight);
        g3.drawImage(Bd, 0, 0);
        g3.drawImage(Y, 0, 0, Y.naturalWidth, Y.naturalHeight, Bd.naturalWidth, 0, yw, Bd.naturalHeight);
        return { faces: c1.toDataURL('image/png'), six: c2.toDataURL('image/png'), people: c3.toDataURL('image/jpeg', 0.92) };
      },
      {
        face: dataUrl('sample_face.png', 'image/png'),
        body: dataUrl('fullbody.jpg', 'image/jpeg'),
        yoga: dataUrl('fullbody_yoga.jpg', 'image/jpeg'),
        G: GROUP_FACES,
        G6: GROUP6,
      },
    );
    const write = (name, url) => {
      writeFileSync(fx(name), Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
      console.log(`wrote tests/fixtures/${name}`);
    };
    write('group_faces.png', out.faces);
    write('group6_faces.png', out.six);
    write('group_people.jpg', out.people);
  } finally {
    await browser.close();
  }
}

// CLI only: importing the module (for GROUP_FACES / GROUP6 / groupFace) must not launch a browser
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
