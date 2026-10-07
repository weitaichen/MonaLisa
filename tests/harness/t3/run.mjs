// Drives tests/harness/t3/index.html in headless Chromium. Needs vite on port 5183:
//   npx vite --port 5183 --strictPort   (then)   node tests/harness/t3/run.mjs [overlay|tracker|video|contextloss|all]
import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const what = process.argv[2] ?? 'all';
const y4m = join(root, 'tests/fixtures/face.y4m');

const args = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--enable-unsafe-swiftshader'];
if (existsSync(y4m)) args.push(`--use-file-for-fake-video-capture=${y4m}`);
const browser = await chromium.launch({ args });
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') console.log(`[page ${m.type()}]`, m.text().slice(0, 300));
});
await page.goto('http://localhost:5183/tests/harness/t3/index.html');
await page.waitForFunction(() => window.harnessReady === true, null, { timeout: 30000 });

// Vite may full-reload the page (dep re-optimisation, other agents' edits): retry on that.
async function call(fn, arg) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await page.evaluate(fn, arg);
    } catch (e) {
      if (attempt >= 2 || !/context was destroyed|navigation/i.test(String(e))) throw e;
      await page.waitForLoadState('load');
      await page.waitForFunction(() => window.harnessReady === true, null, { timeout: 30000 });
    }
  }
}

const save = (name, dataUrl) => {
  writeFileSync(join(here, name), Buffer.from(dataUrl.split(',')[1], 'base64'));
  console.log('wrote', name);
};

try {
  if (what === 'overlay' || what === 'all') {
    const full = await call((a) => window.renderOverlay(...a), [[150, 330, 720, 720], 1.25]);
    save('overlay.png', full.png);
    const eyes = await call((a) => window.renderOverlay(...a), [[190, 360, 480, 220], 2.0]);
    save('overlay_eyes.png', eyes.png);
    const mouth = await call((a) => window.renderOverlay(...a), [[300, 600, 340, 260], 2.4]);
    save('overlay_mouth.png', mouth.png);
    delete full.png;
    console.log('overlay', JSON.stringify(full));
  }
  if (what === 'tracker' || what === 'all') {
    for (const d of ['auto', 'CPU']) console.log(`tracker ${d}`, JSON.stringify(await call((x) => window.runTracker(x), d)));
  }
  if (what === 'video' || what === 'all') {
    console.log('fake camera file:', existsSync(y4m) ? 'tests/fixtures/face.y4m' : '(none: Chromium test pattern)');
    for (const d of ['auto', 'CPU']) {
      const v = await call((x) => window.runVideo(x, 60), d);
      save(`video_${d}.png`, v.png);
      delete v.png;
      console.log(`video ${d}`, JSON.stringify(v));
    }
  }
  if (what === 'contextloss' || what === 'all') {
    let ok = true;
    for (const d of ['auto', 'CPU']) {
      const r = await call((x) => window.runContextLoss(x), d);
      console.log(`contextloss ${d}`, JSON.stringify(r));
      // the face must come back within ~10 s; on GPU the loss must actually have been noticed
      const pass =
        r.before !== null && r.after !== null && r.after.maxDiffVsFixture < 0.02 && (r.delegateBefore !== 'GPU' || r.states.includes('lost'));
      console.log(`${pass ? 'PASS' : 'FAIL'}  contextloss ${d}: face back after ${r.recoveredMs.toFixed(0)} ms (states ${r.states.join('→') || 'none'})`);
      ok &&= pass;
    }
    if (!ok) process.exitCode = 1;
  }
} finally {
  if (errors.length) console.log('PAGE ERRORS', errors);
  await browser.close();
}
