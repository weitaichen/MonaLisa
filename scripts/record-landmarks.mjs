// Records MediaPipe FaceLandmarker output for tests/fixtures/sample_face.png into
// tests/fixtures/landmarks_sample_face.json (the adapter111 unit-test fixture).
//
// Runs tasks-vision 0.10.35 from node_modules inside headless Chromium (Playwright), served by a
// tiny static server so nothing depends on file:// or a running dev server.
//   node scripts/record-landmarks.mjs [image.png] [out.json]
import { createReadStream, existsSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const imgPath = resolve(root, process.argv[2] ?? 'tests/fixtures/sample_face.png');
const outPath = resolve(root, process.argv[3] ?? 'tests/fixtures/landmarks_sample_face.json');
const toUrl = (abs) => '/' + relative(root, abs).split(sep).join('/');

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.task': 'application/octet-stream',
};

const PAGE = `<!doctype html><meta charset="utf-8"><body><script type="module">
import { FilesetResolver, FaceLandmarker } from '/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs';
window.run = async (imgUrl) => {
  const img = new Image();
  img.src = imgUrl;
  await img.decode();
  const fileset = await FilesetResolver.forVisionTasks('/node_modules/@mediapipe/tasks-vision/wasm');
  const model = new Uint8Array(await (await fetch('/public/models/face_landmarker/float16-1/face_landmarker.task')).arrayBuffer());
  // CPU delegate: deterministic and independent of the headless GPU backend.
  const lm = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetBuffer: model, delegate: 'CPU' },
    runningMode: 'IMAGE',
    numFaces: 1,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  });
  const detect = (src) => {
    const face = lm.detect(src).faceLandmarks[0];
    if (!face) throw new Error('no face detected');
    return face.flatMap((p) => [p.x, p.y, p.z]);
  };
  const points = detect(img);
  // Horizontally flipped copy: lets tests check left/right index consistency independent of
  // the face's own asymmetry and yaw.
  const flip = document.createElement('canvas');
  flip.width = img.naturalWidth;
  flip.height = img.naturalHeight;
  const ctx = flip.getContext('2d');
  ctx.translate(flip.width, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(img, 0, 0);
  const mirrored = detect(flip);
  lm.close();
  return { width: img.naturalWidth, height: img.naturalHeight, points, mirrored };
};
window.pageReady = true;
</script>`;

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/__record.html') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGE);
    return;
  }
  const file = normalize(join(root, decodeURIComponent(url.pathname)));
  if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

/** Bundled Playwright chromium may be missing; fall back to the newest installed revision. */
async function launch() {
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

const browser = await launch();
try {
  const page = await browser.newPage();
  page.on('console', (m) => m.type() === 'error' && console.error('[page]', m.text()));
  await page.goto(`http://127.0.0.1:${port}/__record.html`);
  await page.waitForFunction(() => window.pageReady === true);
  const result = await page.evaluate((u) => window.run(u), toUrl(imgPath));
  for (const k of ['points', 'mirrored']) {
    if (result[k].length !== 478 * 3) throw new Error(`${k}: expected 1434 values, got ${result[k].length}`);
  }
  const round = (a) => a.map((v) => Math.round(v * 1e6) / 1e6);
  const fixture = {
    source: relative(root, imgPath).split(sep).join('/'),
    width: result.width,
    height: result.height,
    tasksVision: '0.10.35',
    model: 'face_landmarker.task float16/1',
    delegate: 'CPU',
    note:
      'MediaPipe FaceLandmarker IMAGE mode; points = 478 x (x, y, z) flattened; x,y normalized, top-left origin, unmirrored. ' +
      'mirrored = same, detected on the horizontally flipped image (coordinates of the flipped image itself).',
    points: round(result.points),
    mirrored: round(result.mirrored),
  };
  writeFileSync(outPath, JSON.stringify(fixture) + '\n');
  console.log(`wrote ${relative(root, outPath)} (${result.width}x${result.height}, 478 points)`);
} finally {
  await browser.close();
  server.close();
}
