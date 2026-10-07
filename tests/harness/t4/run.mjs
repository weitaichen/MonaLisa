// T4 media harness runner: node tests/harness/t4/run.mjs
// Spawns vite on :5184 (unless already up), drives tests/harness/t4/index.html in headless Chromium with a fake
// camera, prints a JSON report and a PASS/FAIL line per check. Images go to $T4_OUT (default: OS temp dir).
import { spawn, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { networkInterfaces, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PORT = 5184;
const BASE = `http://localhost:${PORT}`;
const PAGE = '/tests/harness/t4/index.html';
const OUT = process.env.T4_OUT ?? join(tmpdir(), 't4-harness');
mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  ' + JSON.stringify(detail) : ''}`);
}

// ── vite ──
async function up() {
  try {
    return (await fetch(BASE + PAGE)).ok;
  } catch {
    return false;
  }
}
let vite = null;
if (!(await up())) {
  vite = spawn('npx', ['vite', '--port', String(PORT), '--strictPort'], { cwd: root, shell: true, stdio: 'ignore' });
  for (let i = 0; i < 120 && !(await up()); i++) await new Promise((r) => setTimeout(r, 250));
  if (!(await up())) throw new Error('vite did not come up');
}
function stopVite() {
  if (!vite) return;
  try {
    if (process.platform === 'win32') execSync(`taskkill /pid ${vite.pid} /T /F`, { stdio: 'ignore' });
    else vite.kill('SIGTERM');
  } catch {
    /* already gone */
  }
}

// ── black y4m (320×240, 4:2:0, Y=16 → RGB 0) for the WK 252465 detector ──
const blackY4m = join(OUT, 'black.y4m');
if (!existsSync(blackY4m)) {
  const w = 320, h = 240, frames = 10;
  const frame = Buffer.alloc(w * h * 1.5, 128);
  frame.fill(16, 0, w * h);
  const parts = [Buffer.from(`YUV4MPEG2 W${w} H${h} F30:1 Ip A1:1 C420jpeg\n`)];
  for (let i = 0; i < frames; i++) parts.push(Buffer.from('FRAME\n'), frame);
  writeFileSync(blackY4m, Buffer.concat(parts));
}
const faceY4m = join(root, 'tests', 'fixtures', 'face.y4m');

const media = (y4m, fakeUi = true) => [
  ...(fakeUi ? ['--use-fake-ui-for-media-stream'] : []),
  '--use-fake-device-for-media-stream',
  `--use-file-for-fake-video-capture=${y4m}`,
];

async function open(browser, { origin = BASE, permissions = ['camera'] } = {}) {
  // permissions: null → no Playwright grant at all (its grantPermissions rejects every permission not listed)
  const ctx = await browser.newContext(permissions ? { permissions } : {});
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
  page.on('console', (m) => m.type() === 'error' && console.log('  [console.error]', m.text()));
  await page.goto(origin + PAGE);
  await page.waitForFunction(() => document.getElementById('status')?.textContent === 'ready');
  return { ctx, page };
}

const report = {};
try {
  // ════════ camera: fake device with the face y4m ════════
  {
    const browser = await chromium.launch({ args: media(existsSync(faceY4m) ? faceY4m : blackY4m) });
    const { page } = await open(browser);
    const init = await page.evaluate(() => window.t4.camera.init());
    report.cameraInit = init;
    check('video appended to body, autoplay/muted/playsinline', init.parentIsBody && init.attrs.length === 3 && init.props.muted && init.props.playsInline, init.attrs);
    check('video hidden-but-rendered (not display:none, 1px, opacity 0, no pointer events)',
      init.computed.display !== 'none' && init.computed.position === 'fixed' && init.computed.width === '1px' && init.computed.opacity === '0' && init.computed.pe === 'none', init.computed);

    const s1 = await page.evaluate(() => window.t4.camera.start('user'));
    report.cameraStart = s1;
    check('start → live', s1.snap.state === 'live' && s1.snap.facing === 'user' && s1.snap.error === null, s1.snap);
    check('dimensions from videoWidth/Height (y4m 1280×720)', s1.snap.width === 1280 && s1.snap.height === 720 && s1.video.w === 1280 && s1.video.h === 720, [s1.snap.width, s1.snap.height]);
    check('constraints as planned', s1.gumCalls[0] === JSON.stringify({ audio: false, video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } } }), s1.gumCalls[0]);
    check('video playing', !s1.video.paused && s1.video.readyState >= 2, s1.video);
    const luma = await page.evaluate(() => window.t4.camera.luma());
    check('live frames are not black (detector input)', luma > 40, { maxLuma: luma });
    const frame = await page.evaluate(() => window.t4.camera.frame());
    writeFileSync(join(OUT, 'camera_frame.jpg'), Buffer.from(frame.split(',')[1], 'base64'));
    await page.waitForTimeout(5000);
    const s2 = await page.evaluate(() => window.t4.camera.state());
    check('still live 5 s later (black detector does not misfire)', s2.snap.state === 'live', s2.snap.state);
    report.wake = s2.wakeEvents;
    check('wake lock requested while live (API present: ' + init.wakeLockApi + ')', !init.wakeLockApi || s2.wakeEvents[0] === 'request', s2.wakeEvents);

    const f = await page.evaluate(() => window.t4.camera.flip());
    report.cameraFlip = f;
    check('flip → live environment, old track ended, new constraints', f.snap.state === 'live' && f.snap.facing === 'environment' && f.tracks[0] === 'video:ended' && f.tracks[1] === 'video:live' && f.gumCalls[1].includes('"facingMode":"environment"'), { snap: f.snap, tracks: f.tracks });

    const st = await page.evaluate(() => window.t4.camera.stop());
    check('stop → idle, all tracks ended, srcObject cleared', st.snap.state === 'idle' && st.snap.width === 0 && st.tracks.every((t) => t === 'video:ended') && !st.video.hasSrc, { snap: st.snap, tracks: st.tracks });

    const s3 = await page.evaluate(() => window.t4.camera.start());
    check('restart after stop keeps the last facing', s3.snap.state === 'live' && s3.snap.facing === 'environment', s3.snap);
    const bg = await page.evaluate(() => window.t4.camera.background());
    report.cameraBackground = { whileHidden: bg.whileHidden, at400: bg.at400, at1000: bg.at1000 };
    check('background + ended track → still live during grace → interrupted after 800 ms', bg.whileHidden === 'live' && bg.at400 === 'live' && bg.at1000 === 'interrupted' && !bg.video.hasSrc, report.cameraBackground);
    const rs = await page.evaluate(() => window.t4.camera.resume());
    check('resume → live again with a fresh stream', rs.snap.state === 'live' && rs.tracks.at(-1) === 'video:live', { snap: rs.snap, n: rs.tracks.length });
    const en = await page.evaluate(() => window.t4.camera.endNow());
    check('ended while visible → interrupted immediately', en.snap.state === 'interrupted', en.snap.state);

    const snaps = await page.evaluate(() => window.t4.camera.snaps());
    report.cameraSnapshots = snaps;
    const seq = snaps.map((s) => s.split(' ')[1].split('/')[0]);
    check('subscribe saw idle→starting→live→starting→live→idle→…', seq.slice(0, 6).join(',') === 'idle,starting,live,starting,live,idle', seq);

    const oc = await page.evaluate(() => window.t4.camera.errorVia('overconstrained'));
    check('real OverconstrainedError → notfound', oc.snap.state === 'error' && oc.snap.error === 'notfound', oc);
    await browser.close();
  }

  // ════════ camera: wake lock in full Chromium (the headless shell always rejects it) ════════
  {
    const browser = await chromium.launch({ channel: 'chromium', args: media(blackY4m) });
    const { page } = await open(browser, { permissions: null });
    // headless never auto-grants screen-wake-lock; a real browser grants it to a visible top-level page
    const cdp = await browser.newBrowserCDPSession();
    await cdp.send('Browser.setPermission', { permission: { name: 'screen-wake-lock' }, setting: 'granted', origin: BASE });
    await page.evaluate(() => window.t4.camera.init());
    await page.evaluate(() => window.t4.camera.start('user'));
    await page.waitForTimeout(300);
    const live = await page.evaluate(() => window.t4.camera.state());
    await page.evaluate(() => window.t4.camera.stop());
    await page.waitForTimeout(300);
    const stopped = await page.evaluate(() => window.t4.camera.state());
    report.wakeFull = { live: live.wakeEvents, stopped: stopped.wakeEvents };
    check('wake lock granted while live, released on stop',
      live.wakeEvents.join() === 'request,granted' && stopped.wakeEvents.join() === 'request,granted,released', report.wakeFull);
    await browser.close();
  }

  // ════════ camera: black stream → error 'black' ════════
  {
    const browser = await chromium.launch({ args: media(blackY4m) });
    const { page } = await open(browser);
    await page.evaluate(() => window.t4.camera.init());
    const s = await page.evaluate(() => window.t4.camera.start('user'));
    check('black stream goes live first', s.snap.state === 'live' && s.snap.width === 320, s.snap);
    const luma = await page.evaluate(() => window.t4.camera.luma());
    await page.waitForTimeout(3500);
    const mid = await page.evaluate(() => window.t4.camera.state());
    await page.waitForTimeout(1500);
    const end = await page.evaluate(() => window.t4.camera.state());
    report.black = { luma, at3500: mid.snap, at5000: end.snap };
    check('black frames: live at ~3.5 s, error black by ~5 s (2 s + 3 checks)', mid.snap.state === 'live' && end.snap.state === 'error' && end.snap.error === 'black' && end.tracks.every((t) => t === 'video:ended'), report.black);
    await browser.close();
  }

  // ════════ camera: permission denied (no fake UI, no camera permission) ════════
  // The headless *shell* has no permission-prompt support (getUserMedia → NotSupportedError "Not supported"),
  // so use full Chromium in new-headless mode, which dismisses the prompt like a user tapping 不允許.
  {
    const browser = await chromium.launch({ channel: 'chromium', args: media(blackY4m, false) });
    const { page } = await open(browser, { permissions: [] });
    await page.evaluate(() => window.t4.camera.init());
    const d = await page.evaluate(() => window.t4.camera.errorVia('denied-default'));
    report.denied = d;
    check('permission prompt dismissed → error denied', d.snap.state === 'error' && d.snap.error === 'denied' && d.rawErrorName === 'NotAllowedError', d);

    // explicit block (site setting "Block"), set through CDP
    const { page: p2 } = await open(browser, { permissions: [] });
    const cdp = await browser.newBrowserCDPSession();
    await cdp.send('Browser.setPermission', { permission: { name: 'camera' }, setting: 'denied', origin: BASE });
    await p2.evaluate(() => window.t4.camera.init());
    const d2 = await p2.evaluate(() => window.t4.camera.errorVia('denied-default'));
    const perm = await p2.evaluate(() => navigator.permissions.query({ name: 'camera' }).then((s) => s.state));
    report.deniedBlocked = { ...d2, perm };
    check('camera permission blocked → error denied', perm === 'denied' && d2.snap.error === 'denied' && d2.rawErrorName === 'NotAllowedError', report.deniedBlocked);
    await browser.close();
  }

  // ════════ camera: insecure origin (LAN IP over http) ════════
  {
    const ip = Object.values(networkInterfaces()).flat().find((n) => n && n.family === 'IPv4' && !n.internal)?.address;
    if (!ip) check('insecure context → insecure (skipped: no LAN IPv4)', true);
    else {
      const browser = await chromium.launch({ args: media(blackY4m) });
      try {
        const { page } = await open(browser, { origin: `http://${ip}:${PORT}` });
        const r = await page.evaluate(() => window.t4.camera.insecure());
        report.insecure = { ip, ...r };
        check('insecure context → error insecure', !r.secure && r.snap.state === 'error' && r.snap.error === 'insecure', r);
      } catch (e) {
        check('insecure context → insecure (LAN origin unreachable)', false, String(e));
      }
      await browser.close();
    }
  }

  // ════════ importer + exporter + assets ════════
  {
    const browser = await chromium.launch();
    const { page, ctx } = await open(browser);

    for (const max of [1440, 2048]) {
      const r = await page.evaluate((m) => window.t4.importer.sample(m), max);
      const want = max === 1440 ? [960, 1440] : [1000, 1500];
      writeFileSync(join(OUT, `import_sample_${max}.jpg`), Buffer.from(r.preview.split(',')[1], 'base64'));
      delete r.preview;
      report[`importSample${max}`] = r;
      check(`importPhoto(sample_face.png, ${max}) → ${want.join('×')}, matches reference`, r.w === want[0] && r.h === want[1] && r.meanAbsDiffVsRef < 3, r);
    }

    const expectQuads = {
      1: ['red', 'green', 'blue', 'white'],
      3: ['white', 'blue', 'green', 'red'],
      6: ['blue', 'red', 'white', 'green'],
      8: ['green', 'white', 'red', 'blue'],
    };
    report.resizeSemantics = await page.evaluate(() => window.t4.importer.resizeSemantics());
    console.log('  chromium createImageBitmap(EXIF 6, resize 150×200):', JSON.stringify(report.resizeSemantics));
    for (const o of [1, 3, 6, 8]) {
      for (const [max, path] of [[2048, 'auto'], [200, 'auto'], [200, 'bitmap'], [200, 'img']]) {
        const r = await page.evaluate(([oo, mm, pp]) => window.t4.importer.exif(oo, mm, pp), [o, max, path]);
        const rotated = o >= 5;
        const want = max === 2048 ? (rotated ? [300, 400] : [400, 300]) : rotated ? [150, 200] : [200, 150];
        check(`EXIF orientation ${o}, max ${max}, ${path} → ${want.join('×')} quadrants ${expectQuads[o].join('/')}`,
          r.w === want[0] && r.h === want[1] && r.quads.join() === expectQuads[o].join(), r);
      }
    }

    for (const [w, h, max, want] of [[3000, 4000, 2048, [1536, 2048]], [4000, 3000, 1440, [1440, 1080]]]) {
      const r = await page.evaluate(([ww, hh, mm]) => window.t4.importer.large(ww, hh, mm), [w, h, max]);
      check(`importPhoto ${w}×${h} PNG, max ${max} → ${want.join('×')}`, r.w === want[0] && r.h === want[1] && r.tl[0] > 200 && r.tl[1] < 40, r);
    }

    for (const hide of [false, true]) {
      const r = await page.evaluate((h) => window.t4.exporter.encode(h), hide);
      report[`encode${hide ? 'Canvas' : 'Offscreen'}`] = r;
      check(`encodeJpeg via ${hide ? '<canvas>.toBlob' : 'OffscreenCanvas.convertToBlob'}: name, type, decodes, no EXIF`,
        /^meiyan-\d{8}-\d{6}\.jpg$/.test(r.name) && r.type === 'image/jpeg' && r.soi === 'ffd8' && !r.markers.includes('e1') &&
          r.decoded[0] === 640 && r.decoded[1] === 480 && r.meanAbsDiff < 3 && r.offscreenUsed === !hide, r);
    }
    const now = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    const today = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}`;
    check('filename date is local today', report.encodeOffscreen.name.startsWith(`meiyan-${today}-`), report.encodeOffscreen.name);

    for (const [kind, max, hide, want] of [
      ['imagedata', 256, false, [256, 144]],
      ['bitmap', 256, false, [256, 144]],
      ['canvas', 256, false, [256, 144]],
      ['imagedata', 256, true, [256, 144]],
      ['imagedata', 4096, false, [1280, 720]],
      ['canvas', 160, true, [160, 90]],
    ]) {
      const r = await page.evaluate(([k, m, h]) => window.t4.exporter.thumb(k, m, h), [kind, max, hide]);
      check(`toJpegBlob(${kind}, ${max}${hide ? ', no OffscreenCanvas' : ''}) → ${want.join('×')} JPEG`, r.type === 'image/jpeg' && r.decoded[0] === want[0] && r.decoded[1] === want[1] && r.meanAbsDiff < 4, r);
    }
    const sh = await page.evaluate(() => window.t4.exporter.share());
    report.share = sh;
    check('saveFile without user activation resolves to fallback (never throws/hangs)', sh.result === 'fallback', sh);

    // assets: progress, memoisation (one request), replay to a late caller
    let modelRequests = 0;
    let wasmRequests = 0;
    page.on('request', (r) => {
      if (r.url().endsWith('/face_landmarker.task')) modelRequests++;
      if (r.url().endsWith('/vision_wasm_internal.wasm')) wasmRequests++;
    });
    const a = await page.evaluate(() => window.t4.assets.concurrent());
    report.assets = a;
    check('model streamed with progress (total from Content-Length, monotone, ends at total)',
      a.bytes === 3758596 && a.a.model.first.loaded === 0 && a.a.model.last.loaded === 3758596 && a.a.model.last.total === 3758596 && a.a.model.monotone, a.a.model);
    check('model bytes are the .task archive (bytes 2..3 = "PK")', a.head[2] === 0x50 && a.head[3] === 0x4b, a.head);
    check('wasm warm-up phase reported', a.a.wasm.last && a.a.wasm.last.loaded === 11153617 && a.a.wasm.monotone, a.a.wasm);
    check('phases in order model → wasm → done', a.a.order.join() === 'model,wasm,done' && a.b.order.join() === 'model,wasm,done', a.a.order);
    check('done carries the byte sum', a.a.done.length === 1 && a.a.done[0].loaded === 3758596 + 11153617, a.a.done);
    check('memoised: concurrent callers share one download (1 model + 1 wasm request)', modelRequests === 1 && wasmRequests === 1 && a.sameBuffer, { modelRequests, wasmRequests });
    check('late caller gets the done event replayed, no new request', a.late.length === 1 && a.late[0].phase === 'done' && modelRequests === 1, a.late);
    await ctx.close();

    // assets: failure clears the memo; retry succeeds
    const { page: p2page } = await open(browser);
    let fails = 1;
    await p2page.route('**/face_landmarker.task', (route) => (fails-- > 0 ? route.abort('connectionreset') : route.continue()));
    const r1 = await p2page.evaluate(() => window.t4.assets.once());
    const r2 = await p2page.evaluate(() => window.t4.assets.once());
    report.assetsRetry = { r1, r2: { ok: r2.ok, bytes: r2.bytes, order: r2.ev.order } };
    check('network failure rejects', !r1.ok, r1.error);
    check('retry after failure downloads again and succeeds', r2.ok && r2.bytes === 3758596 && r2.ev.order.join() === 'model,wasm,done', report.assetsRetry.r2);

    // assets: wasm failure is non-fatal
    const { page: p3 } = await open(browser);
    await p3.route('**/vision_wasm_internal.wasm', (route) => route.fulfill({ status: 404, body: 'gone' }));
    const r3 = await p3.evaluate(() => window.t4.assets.once());
    check('wasm warm-up failure is non-fatal (done still emitted)', r3.ok && r3.ev.done.length === 1 && r3.ev.done[0].loaded === 3758596, r3.ev.done);

    // assets: unknown length (chunked, no Content-Length) → total 0 during the download
    const { page: p4 } = await open(browser);
    await p4.route('**/face_landmarker.task', async (route) => {
      const resp = await route.fetch();
      const body = await resp.body();
      await route.fulfill({ status: 200, body, headers: { 'content-type': 'application/octet-stream', 'content-encoding': 'identity' } });
    });
    const r4 = await p4.evaluate(() => window.t4.assets.once());
    report.assetsNoLength = r4.ev.model;
    check('download completes when the server omits/garbles Content-Length', r4.ok && r4.bytes === 3758596, r4.ev.model);
    await browser.close();
  }
} catch (e) {
  check('harness crashed', false, String(e && e.stack ? e.stack : e));
} finally {
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  stopVite();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed. Report + images: ${OUT}`);
process.exit(failed.length ? 1 : 0);
