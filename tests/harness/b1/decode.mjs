// Decode the JPEG fixtures to PNG (out/) with headless Chromium — the repo has no JPEG decoder for Node.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const out = new URL('./out/', import.meta.url);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage();
for (const name of ['fullbody', 'fullbody_yoga']) {
  const b64 = readFileSync(new URL(`../../fixtures/${name}.jpg`, import.meta.url)).toString('base64');
  const png = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/png');
  }, `data:image/jpeg;base64,${b64}`);
  writeFileSync(new URL(`${name}.png`, out), Buffer.from(png.split(',')[1], 'base64'));
  console.log('decoded', name);
}
await browser.close();
