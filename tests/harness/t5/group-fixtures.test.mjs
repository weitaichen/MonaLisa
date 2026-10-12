// tests/harness/t5/group-fixtures.test.mjs
// Step-1 group fixtures (scripts/gen-group-fixture.mjs, gen-y4m.mjs --src/--noise/--pan): sizes, the recorded
// multi-face / multi-pose JSON shapes, and the y4m frame helpers.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { GROUP_FACES, groupFace } from '../../../scripts/gen-group-fixture.mjs';
import { composeFitWidth, composeGroupCam, GROUP_CAM, groupCamTiles, PREVIEW_34, resampleRgb, rng, shiftFrame } from '../../../scripts/gen-y4m.mjs';

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
  it('composeGroupCam keeps A, B and C inside the camera 3:4 preview window, no smaller than in the width fit', () => {
    // the preview covers its 3:4 frame with the whole 1280×720 video: only x 0.289–0.711 is on screen (S §8.4 taps)
    expect([PREVIEW_34.x0 / 1280, PREVIEW_34.x1 / 1280]).toEqual([0.2890625, 0.7109375]);
    const tiles = groupCamTiles();
    expect(tiles.map((t) => t.name)).toEqual(['A', 'B', 'C']);
    const k = tiles[0].k;
    expect(k).toBeCloseTo((1280 / 1800) * GROUP_CAM.scale, 9);
    const j = JSON.parse(readFileSync(fx('group_faces.landmarks.json'), 'utf8'));
    const recorded = j.faces.map((f) => {
      const b = { x0: 1, x1: 0, y0: 1, y1: 0 };
      for (let i = 0; i < 478; i++) {
        b.x0 = Math.min(b.x0, f[i * 3]);
        b.x1 = Math.max(b.x1, f[i * 3]);
        b.y0 = Math.min(b.y0, f[i * 3 + 1]);
        b.y1 = Math.max(b.y1, f[i * 3 + 1]);
      }
      return { x0: b.x0 * 1800 * k, x1: b.x1 * 1800 * k, y0: b.y0 * 1200 * k, y1: b.y1 * 1200 * k }; // px of the photo scaled by k
    });
    // A is the largest face (the camera's default selection); no face is smaller than in the width fit (1280/1800)
    expect(tiles[0].fw).toBeGreaterThan(tiles[1].fw);
    expect(tiles[1].fw).toBeGreaterThan(tiles[2].fw);
    for (const [i, c] of GROUP_FACES.copies.slice(0, 3).entries()) expect(tiles[i].fw).toBeGreaterThanOrEqual(groupFace(c).fw * (1280 / 1800));
    for (const t of tiles) {
      // the face FaceLandmarker found in the photo lies inside the tile, so it is moved whole
      const r = recorded.find((b) => Math.abs((b.x0 + b.x1) / 2 - t.face.x) < 0.05 * 1800 * k);
      expect(r, `recorded face ${t.name}`).toBeDefined();
      expect(r.x0).toBeGreaterThanOrEqual(t.rect.x);
      expect(r.x1).toBeLessThanOrEqual(t.rect.x + t.rect.w);
      expect(r.y0).toBeGreaterThanOrEqual(t.rect.y);
      expect(r.y1).toBeLessThanOrEqual(t.rect.y + t.rect.h);
      // and lands inside the 3:4 window: its centre within [0.289, 0.711], its whole box on screen
      const cx = (r.x0 + r.x1) / 2 + t.dx;
      expect(cx / 1280, `face ${t.name} centre`).toBeGreaterThanOrEqual(0.289);
      expect(cx / 1280, `face ${t.name} centre`).toBeLessThanOrEqual(0.711);
      expect(r.x0 + t.dx, `face ${t.name} left`).toBeGreaterThanOrEqual(PREVIEW_34.x0);
      expect(r.x1 + t.dx, `face ${t.name} right`).toBeLessThanOrEqual(PREVIEW_34.x1);
      expect(r.y0 + t.dy).toBeGreaterThanOrEqual(0);
      expect(r.y1 + t.dy).toBeLessThanOrEqual(720);
      // its centre lands where GROUP_CAM puts it (within the whole-px move)
      expect(Math.abs(t.face.x + t.dx - GROUP_CAM.faces[t.name].x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(t.face.y + t.dy - GROUP_CAM.faces[t.name].y)).toBeLessThanOrEqual(0.5);
      // the tile itself stays inside the scaled photo and the frame
      expect(t.rect.x).toBeGreaterThanOrEqual(0);
      expect(t.rect.y + t.rect.h).toBeLessThanOrEqual(Math.round(1200 * k));
      expect(t.rect.x + t.dx).toBeGreaterThanOrEqual(0);
      expect(t.rect.y + t.dy).toBeGreaterThanOrEqual(0);
      expect(t.rect.x + t.rect.w + t.dx).toBeLessThanOrEqual(1280);
      expect(t.rect.y + t.rect.h + t.dy).toBeLessThanOrEqual(720);
    }
    // the tiles do not overlap in the frame
    for (const a of tiles) {
      for (const b of tiles) {
        if (a === b) continue;
        const apart =
          a.rect.x + a.dx + a.rect.w <= b.rect.x + b.dx ||
          b.rect.x + b.dx + b.rect.w <= a.rect.x + a.dx ||
          a.rect.y + a.dy + a.rect.h <= b.rect.y + b.dy ||
          b.rect.y + b.dy + b.rect.h <= a.rect.y + a.dy;
        expect(apart, `${a.name} / ${b.name}`).toBe(true);
      }
    }
  });
  it('composeGroupCam moves the faces pixel for pixel from the scaled photo, on the photo background', () => {
    const png = PNG.sync.read(readFileSync(fx('group_faces.png')));
    const cam = composeGroupCam(png);
    expect(cam.length).toBe(1280 * 720 * 3);
    const tiles = groupCamTiles();
    const sw = Math.round(1800 * tiles[0].k);
    const scaled = resampleRgb(png.data, 1800, 1200, { x: 0, y: 0, w: 1800, h: 1200 }, sw, Math.round(1200 * tiles[0].k));
    for (const t of tiles) {
      for (let a = 0; a <= 8; a++) {
        for (let b = 0; b <= 8; b++) {
          const x = t.rect.x + Math.min(t.rect.w - 1, Math.round((a * t.rect.w) / 8));
          const y = t.rect.y + Math.min(t.rect.h - 1, Math.round((b * t.rect.h) / 8));
          const o = ((y + t.dy) * 1280 + x + t.dx) * 3;
          const i = (y * sw + x) * 3;
          expect([cam[o], cam[o + 1], cam[o + 2]]).toEqual([scaled[i], scaled[i + 1], scaled[i + 2]]);
        }
      }
    }
    const bg = [png.data[0], png.data[1], png.data[2]];
    for (const [x, y] of [
      [0, 0],
      [1279, 719],
      [640, 388], // between A and the B / C row
      [647, 540], // between B and C
    ]) {
      const o = (y * 1280 + x) * 3;
      expect([cam[o], cam[o + 1], cam[o + 2]], `background at ${x}, ${y}`).toEqual(bg);
    }
    expect(() => composeGroupCam(new PNG({ width: 400, height: 100 }))).toThrow(/group_faces/);
  });
  it('the generated clips exist once global-setup ran (skipped before)', () => {
    if (!existsSync(fx('group.y4m'))) return;
    const head = readFileSync(fx('group.y4m')).subarray(0, 40).toString('ascii');
    expect(head.startsWith('YUV4MPEG2 W1280 H720')).toBe(true);
  });
});
