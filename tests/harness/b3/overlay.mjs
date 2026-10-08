// Renders a recorded pose fixture over its photo (mask tint + upsampled mask contour + skeleton + visibility)
// so it can be inspected by eye.  node tests/harness/b3/overlay.mjs <fixture.json> <out.png>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const fx = JSON.parse(readFileSync(resolve(root, process.argv[2]), 'utf8'));
const out = resolve(root, process.argv[3]);
const img = readFileSync(resolve(root, fx.source)).toString('base64');
const mime = fx.source.endsWith('.png') ? 'image/png' : 'image/jpeg';
const browser = await chromium.launch();
const page = await browser.newPage();
const png = await page.evaluate(async ({ fx, src }) => {
  const im = new Image(); im.src = src; await im.decode();
  const W = im.naturalWidth, H = im.naturalHeight;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.drawImage(im, 0, 0);
  if (fx.mask) {
    const { width: mw, height: mh } = fx.mask;
    const bytes = Uint8Array.from(atob(fx.mask.data), (ch) => ch.charCodeAt(0));
    const mc = document.createElement('canvas'); mc.width = mw; mc.height = mh;
    const id = mc.getContext('2d').createImageData(mw, mh);
    for (let i = 0; i < mw * mh; i++) { id.data[i * 4] = 255; id.data[i * 4 + 1] = 0; id.data[i * 4 + 2] = 200; id.data[i * 4 + 3] = bytes[i] * 0.45; }
    mc.getContext('2d').putImageData(id, 0, 0);
    g.imageSmoothingEnabled = true; g.drawImage(mc, 0, 0, W, H);
    // 0.5 contour (nearest mask texel → image), yellow
    g.fillStyle = '#ffee00';
    for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
      const m = (xx, yy) => bytes[Math.min(mh - 1, Math.floor(yy * mh / H)) * mw + Math.min(mw - 1, Math.floor(xx * mw / W))] >= 128;
      if (m(x, y) !== m(x + 1, y) || m(x, y) !== m(x, y + 1)) g.fillRect(x, y, 1, 1);
    }
  }
  const P = fx.points, pt = (i) => [P[i * 4] * W, P[i * 4 + 1] * H, P[i * 4 + 3]];
  const E = [[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,29],[29,31],[27,31],[28,30],[30,32],[28,32],[15,17],[15,19],[15,21],[16,18],[16,20],[16,22],[0,2],[0,5],[2,7],[5,8],[9,10]];
  g.lineWidth = Math.max(2, W / 300); g.strokeStyle = '#00e5ff';
  for (const [a, b] of E) { const p = pt(a), q = pt(b); g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(q[0], q[1]); g.stroke(); }
  g.font = `${Math.round(W / 60)}px monospace`;
  for (let i = 0; i < 33; i++) {
    const [x, y, v] = pt(i);
    g.fillStyle = v > 0.6 ? '#30ff30' : '#ff3030';
    g.beginPath(); g.arc(x, y, W / 160, 0, Math.PI * 2); g.fill();
    if (i >= 11) { g.fillStyle = '#fff'; g.fillText(String(i), x + 4, y - 4); }
  }
  g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(0, 0, W, 22);
  g.fillStyle = '#fff'; g.font = '14px monospace';
  g.fillText(`${fx.source} ${fx.delegate} people=${fx.people} mask=${fx.mask ? fx.mask.width + 'x' + fx.mask.height : 'none'}`, 6, 16);
  return c.toDataURL('image/png').split(',')[1];
}, { fx, src: `data:${mime};base64,${img}` });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.from(png, 'base64'));
await browser.close();
console.log('wrote', process.argv[3]);
