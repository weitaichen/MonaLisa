// The 膚質 fixture generator (skin-cleanup spec §8.3): its copy of the adapter geometry equals adapt(), the defects sit
// where the spec puts them, nothing outside them changes, and two runs give the same bytes.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { beforeAll, describe, expect, it } from 'vitest';
import { adapt } from '../../src/tracking/adapter111';

interface Defect {
  kind: string;
  name: string;
  center: [number, number];
  sigma?: number;
  box: [number, number, number, number];
  pixels: [number, number, number][];
}
interface Fixture {
  width: number;
  height: number;
  fw: number;
  defects: Defect[];
  regions: { cheek: [number, number, number, number] };
}
interface Gen {
  pts111Of(points: number[], w: number, h: number): Float64Array;
  generateToneFixture(): { png: Buffer; json: Fixture };
}

const root = resolve(import.meta.dirname, '../..');
let gen: Gen;
let out: { png: Buffer; json: Fixture };
beforeAll(async () => {
  gen = (await import(pathToFileURL(resolve(root, 'scripts/gen-tone-fixture.mjs')).href)) as Gen;
  out = gen.generateToneFixture();
}, 60_000);

describe('gen-tone-fixture', () => {
  it('its pts111 equal adapt()', () => {
    const lm = JSON.parse(readFileSync(resolve(root, 'tests/fixtures/landmarks_sample_face.json'), 'utf8')) as { width: number; height: number; points: number[] };
    const a = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height).pts111;
    const b = gen.pts111Of(lm.points, lm.width, lm.height);
    for (let i = 0; i < 222; i++) expect(Math.abs(a[i] - b[i])).toBeLessThan(1e-6);
  });

  it('lists every defect of S §8.3, each with pixels, and the blotches ≥ 0.16 fw from every blemish', () => {
    const names = out.json.defects.map((d) => d.name);
    expect(names).toEqual(['dot1', 'dot2', 'dot3', 'blotch1', 'blotch2', 'darkL', 'darkR', 'foldL', 'foldR', 'teeth', 'scleraL', 'scleraR']);
    for (const d of out.json.defects) expect(d.pixels.length, d.name).toBeGreaterThan(30);
    expect(out.json.fw).toBeCloseTo(588.8, 0);
    const dots = out.json.defects.filter((d) => d.kind === 'blemish');
    for (const b of out.json.defects.filter((d) => d.kind === 'blotch'))
      for (const d of dots) expect(Math.hypot(b.center[0] - d.center[0], b.center[1] - d.center[1]) / out.json.fw).toBeGreaterThanOrEqual(0.16);
  });

  it('draws each nasolabial fold as a soft shadow 20–40 px wide at half depth (σ_mid…2σ_mid), not a line finer than the mid band', () => {
    const lm = JSON.parse(readFileSync(resolve(root, 'tests/fixtures/landmarks_sample_face.json'), 'utf8')) as { width: number; height: number; points: number[] };
    const face = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
    const { width: W, height: H, fw } = out.json;
    const P = (i: number): [number, number] => [face.pts111[i * 2] * W, face.pts111[i * 2 + 1] * H];
    const ex = [P(77)[0] - P(74)[0], P(77)[1] - P(74)[1]];
    const xhat = [ex[0] / Math.hypot(ex[0], ex[1]), ex[1] / Math.hypot(ex[0], ex[1])];
    const sigmaMid = 0.0141 * Math.min(W, H);
    for (const [name, ia, ib, s] of [['foldL', 82, 84, -1], ['foldR', 83, 90, 1]] as const) {
      // the spec's path (S §8.3): P(82|83) + 0.04 fw·o to P(84|90) + 0.06 fw·o
      const a = [P(ia)[0] + s * xhat[0] * 0.04 * fw, P(ia)[1] + s * xhat[1] * 0.04 * fw];
      const b = [P(ib)[0] + s * xhat[0] * 0.06 * fw, P(ib)[1] + s * xhat[1] * 0.06 * fw];
      const dist = (x: number, y: number) => {
        const t = Math.min(1, Math.max(0, ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / ((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2)));
        return Math.hypot(x - a[0] - t * (b[0] - a[0]), y - a[1] - t * (b[1] - a[1]));
      };
      const d = out.json.defects.find((e) => e.name === name)!;
      const halfDepth = Math.max(...d.pixels.filter((p) => p[2] >= 0.5).map(([x, y]) => dist(x + 0.5, y + 0.5)));
      expect(2 * halfDepth, `${name} width at half depth`).toBeGreaterThanOrEqual(Math.max(20, sigmaMid));
      expect(2 * halfDepth, `${name} width at half depth`).toBeLessThanOrEqual(Math.min(40, 2 * sigmaMid + 4));
    }
  });

  it('changes pixels only inside the defect boxes, and keeps the cheek patch clean', () => {
    const src = PNG.sync.read(readFileSync(resolve(root, 'tests/fixtures/sample_face.png')));
    const fix = PNG.sync.read(out.png);
    expect([fix.width, fix.height]).toEqual([src.width, src.height]);
    const inBox = (x: number, y: number) => out.json.defects.some((d) => x >= d.box[0] && x <= d.box[2] && y >= d.box[1] && y <= d.box[3]);
    let changed = 0;
    for (let y = 0; y < src.height; y++)
      for (let x = 0; x < src.width; x++) {
        const i = (y * src.width + x) * 4;
        if (src.data[i] === fix.data[i] && src.data[i + 1] === fix.data[i + 1] && src.data[i + 2] === fix.data[i + 2]) continue;
        changed++;
        expect(inBox(x, y), `${x},${y}`).toBe(true);
      }
    expect(changed).toBeGreaterThan(5000);
    const [cx, cy, cw, ch] = out.json.regions.cheek;
    for (const d of out.json.defects)
      expect(d.box[2] < cx || d.box[0] > cx + cw || d.box[3] < cy || d.box[1] > cy + ch, `cheek patch overlaps ${d.name}`).toBe(true);
  });

  it('is deterministic', () => {
    expect(gen.generateToneFixture().png.equals(out.png)).toBe(true);
  });
});
