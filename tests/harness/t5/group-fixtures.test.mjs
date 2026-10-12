// tests/harness/t5/group-fixtures.test.mjs
// Step-1 group fixtures (scripts/gen-group-fixture.mjs, gen-y4m.mjs --src/--noise/--pan): sizes, the recorded
// multi-face / multi-pose JSON shapes, and the y4m frame helpers.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { composeFitWidth, rng, shiftFrame } from '../../../scripts/gen-y4m.mjs';

const fx = (n) => join(import.meta.dirname, '..', '..', 'fixtures', n);

describe('group fixtures', () => {
  it('group_faces.png is 1800×1200 and group6_faces.png 2048×1536', () => {
    const a = PNG.sync.read(readFileSync(fx('group_faces.png')));
    expect([a.width, a.height]).toEqual([1800, 1200]);
    const b = PNG.sync.read(readFileSync(fx('group6_faces.png')));
    expect([b.width, b.height]).toEqual([2048, 1536]);
  });
  it('group_people.jpg exists and is a JPEG', () => {
    const buf = readFileSync(fx('group_people.jpg'));
    expect([buf[0], buf[1]]).toEqual([0xff, 0xd8]);
  });
  it('group_faces.landmarks.json holds ≥ 3 faces of 478 points; A, B and C are found (PD2)', () => {
    const j = JSON.parse(readFileSync(fx('group_faces.landmarks.json'), 'utf8'));
    expect(j.numFaces).toBe(8);
    expect(j.faces.length).toBeGreaterThanOrEqual(3);
    for (const f of j.faces) expect(f).toHaveLength(478 * 3);
    const centres = j.faces.map((f) => {
      let lo = 1;
      let hi = 0;
      for (let i = 0; i < 478; i++) {
        lo = Math.min(lo, f[i * 3]);
        hi = Math.max(hi, f[i * 3]);
      }
      return (lo + hi) / 2;
    });
    for (const cx of [0.22, 0.55, 0.82]) expect(centres.some((c) => Math.abs(c - cx) < 0.05), `face at x ${cx}`).toBe(true);
  });
  it('the multi-pose JSONs hold poses of 132 floats', () => {
    for (const n of ['group_faces.pose.json', 'group_people.pose.json']) {
      const j = JSON.parse(readFileSync(fx(n), 'utf8'));
      expect(j.numPoses).toBe(4);
      expect(j.poses.length).toBeGreaterThanOrEqual(n === 'group_people.pose.json' ? 2 : 1);
      for (const p of j.poses) expect(p.points).toHaveLength(132);
    }
  });
});

describe('gen-y4m helpers', () => {
  it('rng is deterministic and in [0, 1)', () => {
    const a = rng(7);
    const b = rng(7);
    for (let i = 0; i < 100; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x >= 0 && x < 1).toBe(true);
    }
  });
  it('shiftFrame by (0, 0) without noise is the identity; a 1 px shift moves a column', () => {
    const w = 4;
    const h = 2;
    const rgb = new Float32Array(w * h * 3).map((_, i) => (i % 3 === 0 ? (Math.floor(i / 3) % w) * 10 : 0));
    expect(Array.from(shiftFrame(rgb, 0, 0, () => 0.5, 0, w, h))).toEqual(Array.from(rgb));
    const s = shiftFrame(rgb, 1, 0, () => 0.5, 0, w, h);
    expect(s[3 * 2]).toBeCloseTo(10); // x = 2 now shows source x = 1
  });
  it('composeFitWidth scales a 1800×1200 source to the 1280-px frame width, bottom-aligned (the top is cropped)', () => {
    // top half red 50, bottom half red 200: at scale 1280/1800 the source's row 600 lands at 600·0.711 − 133 ≈ row 294
    const png = new PNG({ width: 1800, height: 1200 });
    for (let i = 0; i < 1800 * 1200; i++) {
      png.data[i * 4] = i < 1800 * 600 ? 50 : 200;
      png.data[i * 4 + 3] = 255;
    }
    const rgb = composeFitWidth(png);
    expect(rgb.length).toBe(1280 * 720 * 3);
    expect(rgb[0]).toBeCloseTo(50, 3); // frame top = source row ≈ 187: cropped, not padded
    expect(rgb[(280 * 1280 + 640) * 3]).toBeCloseTo(50, 3);
    expect(rgb[(310 * 1280 + 640) * 3]).toBeCloseTo(200, 3);
    expect(rgb[(719 * 1280 + 1279) * 3]).toBeCloseTo(200, 3);
  });
  it('composeFitWidth pads a source wider than 16:9 at the top with its top-left colour', () => {
    const png = new PNG({ width: 400, height: 100 }); // 1280×320 in the frame: 400 rows of padding
    png.data.fill(200);
    png.data[0] = 10;
    const rgb = composeFitWidth(png);
    expect(rgb[(100 * 1280 + 640) * 3]).toBe(10);
    expect(rgb[(399 * 1280 + 640) * 3]).toBe(10);
    expect(rgb[(500 * 1280 + 640) * 3]).toBeCloseTo(200, 3);
  });
  it('the generated clips exist once global-setup ran (skipped before)', () => {
    if (!existsSync(fx('group.y4m'))) return;
    const head = readFileSync(fx('group.y4m')).subarray(0, 40).toString('ascii');
    expect(head.startsWith('YUV4MPEG2 W1280 H720')).toBe(true);
  });
});
