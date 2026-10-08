// Probe raw PoseLandmarker behaviour (delegate × mask read path) in headless Chromium.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PAGE = `<!doctype html><meta charset="utf-8"><body><script type="module">
import { FilesetResolver, PoseLandmarker } from '/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs';
window.probe = async (cfg) => {
  const img = new Image(); img.src = '/tests/fixtures/fullbody.jpg'; await img.decode();
  const fs = await FilesetResolver.forVisionTasks('/node_modules/@mediapipe/tasks-vision/wasm');
  const model = new Uint8Array(await (await fetch('/models/pose_landmarker/' + (cfg.v ?? 'full') + '-float16-1/pose_landmarker_' + (cfg.v ?? 'full') + '.task')).arrayBuffer());
  const o = { baseOptions: { modelAssetBuffer: model, delegate: cfg.delegate }, runningMode: cfg.video ? 'VIDEO' : 'IMAGE', numPoses: cfg.np ?? 2, outputSegmentationMasks: cfg.mask };
  if (cfg.canvas) o.canvas = new OffscreenCanvas(1,1);
  const lm = await PoseLandmarker.createFromOptions(fs, o);
  let src = img;
  if (cfg.input === 'offscreen') { const c = new OffscreenCanvas(img.naturalWidth, img.naturalHeight); c.getContext('2d').drawImage(img,0,0); src = c; }
  if (cfg.input === 'bitmap') src = await createImageBitmap(img);
  let info;
  const readTex = (m) => {
    const gl = o.canvas.getContext('webgl2');
    const ext = gl.getExtension('EXT_color_buffer_float');
    const tex = m.getAsWebGLTexture();
    const fb = gl.createFramebuffer();
    const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    const fmt = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_FORMAT), typ = gl.getParameter(gl.IMPLEMENTATION_COLOR_READ_TYPE);
    const px = new Float32Array(m.width * m.height * 4);
    gl.readPixels(0, 0, m.width, m.height, gl.RGBA, gl.FLOAT, px);
    const err = gl.getError();
    gl.bindFramebuffer(gl.FRAMEBUFFER, prev); gl.deleteFramebuffer(fb);
    let s = 0, mx = 0; for (let i = 0; i < px.length; i += 4) { s += px[i]; mx = Math.max(mx, px[i]); }
    return { ext: !!ext, st: st === gl.FRAMEBUFFER_COMPLETE, fmt, typ, err, mean: s / (m.width * m.height), max: mx };
  };
  const read = (r) => {
    if (cfg.tex) return readTex(r.segmentationMasks[0]);
    if (cfg.u8) { const m = r.segmentationMasks[0]; const a = m.getAsUint8Array(); let s = 0; for (const v of a) s += v; return { u8mean: s / a.length, len: a.length }; } const m = r.segmentationMasks?.[0]; let sum = -1; if (m && cfg.read) { const a = m.getAsFloat32Array(); sum = 0; for (const v of a) sum += v; sum /= a.length; }
    return { n: r.landmarks.length, vis: r.landmarks[0]?.[0]?.visibility, mask: m ? [m.width, m.height, m.hasFloat32Array(), m.hasUint8Array(), m.hasWebGLTexture()] : null, sum }; };
  if (cfg.video) { const r = lm.detectForVideo(src, 1); info = read(r); r.close(); } else if (cfg.cb) lm.detect(src, (r) => { info = read(r); }); else { const r = lm.detect(src); info = read(r); r.close(); }
  lm.close();
  return info;
};
window.pageReady = true;
</script>`;
const server = await createServer({ root, configFile: false, logLevel: 'error', server: { port: 0, host: '127.0.0.1' },
  optimizeDeps: { noDiscovery: true, include: [] },
  plugins: [{ name: 'p', configureServer(s) { s.middlewares.use((req, res, next) => { if (req.url !== '/__probe.html') return next(); res.setHeader('content-type','text/html'); res.end(PAGE); }); } }] });
await server.listen();
const port = server.httpServer.address().port;
const browser = await chromium.launch({ args: (process.env.GPU_ARGS ?? '').split(' ').filter(Boolean) });
const cfgs = JSON.parse(process.argv[2]);
for (const cfg of cfgs) {
  const page = await browser.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('INFO')) errs.push(m.text().slice(0, 120)); });
  await page.goto(`http://127.0.0.1:${port}/__probe.html`);
  await page.waitForFunction(() => window.pageReady === true);
  try { console.log(JSON.stringify(cfg), '=>', JSON.stringify(await page.evaluate((c) => window.probe(c), cfg))); }
  catch (e) { console.log(JSON.stringify(cfg), '=> FAIL', e.message.split('\n')[0], errs.slice(0, 2).join(' | ')); }
  await page.close();
}
await browser.close(); await server.close();
