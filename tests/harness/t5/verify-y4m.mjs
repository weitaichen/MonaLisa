// T5 harness: proves tests/fixtures/face.y4m works as Chromium's fake camera.
// Serves a tiny page on localhost (secure context), opens getUserMedia with the y4m as the
// fake device, grabs a frame and compares it with the RGB frame gen-y4m composed.
// Usage: node tests/harness/t5/verify-y4m.mjs
import { createServer } from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';
import { H, W, composeFrame } from '../../../scripts/gen-y4m.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const y4m = join(root, 'tests', 'fixtures', 'face.y4m');

const page = `<!doctype html><video id=v autoplay muted playsinline></video><canvas id=c></canvas><script>
window.grab = async () => {
  const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
  const v = document.getElementById('v');
  v.srcObject = s;
  await new Promise((r) => (v.readyState >= 2 ? r() : (v.onloadeddata = r)));
  await new Promise((r) => setTimeout(r, 500));
  const c = document.getElementById('c');
  c.width = v.videoWidth; c.height = v.videoHeight;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(v, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const settings = s.getVideoTracks()[0].getSettings();
  return { w: c.width, h: c.height, settings, px: Array.from(d) };
};
</script>`;

const server = createServer((_, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(page);
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const port = server.address().port;

const browser = await chromium.launch({
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${y4m}`,
  ],
});
try {
  const p = await browser.newPage();
  await p.goto(`http://127.0.0.1:${port}/`);
  const r = await p.evaluate(() => window.grab());
  console.log('video', r.w, 'x', r.h, 'settings', JSON.stringify(r.settings));
  if (r.w !== W || r.h !== H) throw new Error(`expected ${W}x${H}`);

  const expected = composeFrame(PNG.sync.read(readFileSync(join(root, 'tests', 'fixtures', 'sample_face.png'))));
  let sum = 0;
  let max = 0;
  for (let i = 0; i < W * H; i++) {
    for (let c = 0; c < 3; c++) {
      const d = Math.abs(r.px[i * 4 + c] - expected[i * 3 + c]);
      sum += d;
      if (d > max) max = d;
    }
  }
  const mad = sum / (W * H * 3);
  console.log(`mean abs diff vs composed RGB: ${mad.toFixed(2)} /255, max ${max.toFixed(0)}`);

  const png = new PNG({ width: r.w, height: r.h });
  png.data.set(r.px);
  writeFileSync(join(here, 'y4m_chromium_capture.png'), PNG.sync.write(png));
  console.log('saved tests/harness/t5/y4m_chromium_capture.png');
  if (mad > 4) throw new Error('decoded fake-camera frame differs too much from the source');
  console.log('PASS');
} finally {
  await browser.close();
  server.close();
}
