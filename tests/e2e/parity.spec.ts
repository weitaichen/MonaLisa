// Single-person parity (RM §1.1, S §1.3): the parity cases rendered by today's engine equal the v0.3 goldens within
// max 1/255 per channel and mean < 0.02/255. Runs after every task of step 1 (and every later step).
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeDataUrl, decodePng, expect, test } from './fixtures';

const DEV_URL = 'http://127.0.0.1:5190';
const GOLDEN = resolve(import.meta.dirname, '../fixtures/parity-v03');

test('v0.3 parity: 自然, 精緻 + 美型 max, lip + blush shades, 細腰 + 長腿 + 增高, one face + its body with 天鵝頸 + 小頭 through the editor path; 自然 without a face and mirrored; 美型 max at weight 0.4 and at yaw 0.25', async ({ page }) => {
  await page.goto(`${DEV_URL}/tests/e2e/pages/parity.html`);
  await page.waitForFunction(() => typeof window.runParity === 'function');
  const r = await page.evaluate(() => window.runParity!());
  // every golden is rendered (a port that drops a case must not pass by comparing fewer images)
  const goldens = readdirSync(GOLDEN).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4));
  expect(Object.keys(r.png).sort()).toEqual(goldens.sort());
  for (const [name, url] of Object.entries(r.png)) {
    const got = decodeDataUrl(url);
    const want = decodePng(readFileSync(resolve(GOLDEN, `${name}.png`)));
    expect([got.width, got.height], name).toEqual([want.width, want.height]);
    let max = 0;
    let sum = 0;
    let n = 0;
    for (let i = 0; i < got.data.length; i += 4) {
      for (let k = 0; k < 3; k++) {
        const d = Math.abs(got.data[i + k] - want.data[i + k]);
        max = Math.max(max, d);
        sum += d;
        n++;
      }
    }
    console.log(`${name}: max ${max}/255, mean ${(sum / n).toFixed(4)}/255`);
    expect(max, name).toBeLessThanOrEqual(1);
    expect(sum / n, name).toBeLessThan(0.02);
  }
});
