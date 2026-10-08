// Records the 美體 test fixture: runs the app's own createBodyTracker (src/tracking/bodyTracker.ts, full model,
// app options: CPU preferred, IMAGE; masks resolve to the GPU graph) on a photo inside headless Chromium and writes the BodyDetection as JSON.
//   node scripts/record-pose.mjs [image] [out.json] [full|lite]
// defaults: tests/fixtures/fullbody.jpg → tests/fixtures/pose_fullbody.json, full.
// Needs the pose models in public/models (node scripts/fetch-assets.mjs). Vite serves the repo on a free port
// (no config file), so the TypeScript module and its @mediapipe import resolve exactly as in the app.
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const imgPath = resolve(root, process.argv[2] ?? 'tests/fixtures/fullbody.jpg');
const outPath = resolve(root, process.argv[3] ?? 'tests/fixtures/pose_fullbody.json');
const variant = process.argv[4] ?? 'full';
const toUrl = (abs) => '/' + relative(root, abs).split(sep).join('/');

const PAGE = `<!doctype html><meta charset="utf-8"><body><script type="module">
import { createBodyTracker } from '/src/tracking/bodyTracker.ts';
import { POSE_MODELS } from '/src/engine/assets.ts';
window.run = async (imgUrl, variant) => {
  const img = new Image();
  img.src = imgUrl;
  await img.decode();
  const bitmap = await createImageBitmap(img);
  const model = new Uint8Array(await (await fetch(POSE_MODELS[variant])).arrayBuffer());
  const tracker = await createBodyTracker({
    modelBuffer: model,
    wasmBase: '/node_modules/@mediapipe/tasks-vision/wasm',
    variant,
    delegate: 'CPU',
    runningMode: 'IMAGE',
  });
  const det = tracker.detect(bitmap);
  const delegate = tracker.delegate;
  tracker.close();
  if (!det) throw new Error('no person detected');
  let bin = '';
  if (det.mask) for (const b of det.mask.data) bin += String.fromCharCode(b);
  return {
    delegate,
    width: det.width,
    height: det.height,
    people: det.people,
    points: Array.from(det.pose.points),
    mask: det.mask ? { width: det.mask.width, height: det.mask.height, data: btoa(bin) } : null,
  };
};
window.pageReady = true;
</script>`;

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

const server = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  server: { port: 0, host: '127.0.0.1', strictPort: false },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [
    {
      name: 'record-pose-page',
      configureServer(s) {
        s.middlewares.use((req, res, next) => {
          if (req.url !== '/__record-pose.html') return next();
          res.setHeader('content-type', 'text/html');
          res.end(PAGE);
        });
      },
    },
  ],
});
await server.listen();
const port = server.httpServer.address().port;

const browser = await launch();
try {
  const page = await browser.newPage();
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('INFO:') && console.error('[page]', m.text()));
  page.on('pageerror', (e) => console.error('[page]', e));
  await page.goto(`http://127.0.0.1:${port}/__record-pose.html`);
  await page.waitForFunction(() => window.pageReady === true, null, { timeout: 60_000 });
  const r = await page.evaluate(([u, v]) => window.run(u, v), [toUrl(imgPath), variant]);
  if (r.points.length !== 33 * 4) throw new Error(`expected 132 values, got ${r.points.length}`);
  const round = (a) => a.map((v) => Math.round(v * 1e6) / 1e6);
  const fixture = {
    source: relative(root, imgPath).split(sep).join('/'),
    width: r.width,
    height: r.height,
    tasksVision: '0.10.35',
    model: `pose_landmarker_${variant}.task float16/1`,
    delegate: r.delegate,
    runningMode: 'IMAGE',
    note:
      'createBodyTracker (src/tracking/bodyTracker.ts) output. points = 33 x (x, y, z, visibility) flattened; x,y ' +
      'normalized to the image, top-left origin, unmirrored. mask = PersonMask of the selected person: base64 of ' +
      'width*height bytes (0..255 person confidence, row-major, row 0 = image top), or null.',
    people: r.people,
    points: round(r.points),
    mask: r.mask,
  };
  writeFileSync(outPath, JSON.stringify(fixture) + '\n');
  const vis = r.points.filter((_, i) => i % 4 === 3);
  console.log(
    `wrote ${relative(root, outPath).split(sep).join('/')} [${r.delegate}] (${r.width}x${r.height}, people ${r.people}, ` +
      `visibility min ${Math.min(...vis).toFixed(2)}, mask ${r.mask ? `${r.mask.width}x${r.mask.height}` : 'none'})`,
  );
} finally {
  await browser.close();
  await server.close();
}
