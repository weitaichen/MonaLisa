// tests/harness/t5/group-fixtures.test.mjs
// Step-1 group fixtures (scripts/gen-group-fixture.mjs, gen-y4m.mjs --src/--noise/--pan): sizes, the recorded
// multi-face / multi-pose JSON shapes, and the y4m frame helpers.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { ELEVEN_FACES, GROUP_FACES, groupFace, SMALL_FACES, smallFaceCell, TEN_FACES } from '../../../scripts/gen-group-fixture.mjs';
import {
  composeCells,
  composeFitWidth,
  composeFitWidthBoxes,
  composeGroupCam,
  composeMove,
  GROUP_CAM,
  groupCamTiles,
  MOVE,
  moveAt,
  PREVIEW_34,
  resampleRgb,
  rng,
  SELFIE_GROUP,
  shiftFrame,
  UPRIGHT_FAR10,
  UPRIGHT_ROW3,
} from '../../../scripts/gen-y4m.mjs';

const fx = (n) => join(import.meta.dirname, '..', '..', 'fixtures', n);
/** a JPEG's [width, height] from its first SOFn marker */
const jpegSize = (buf) => {
  expect([buf[0], buf[1]]).toEqual([0xff, 0xd8]);
  let o = 2;
  while (o < buf.length && !(buf[o + 1] >= 0xc0 && buf[o + 1] <= 0xc3)) o += 2 + buf.readUInt16BE(o + 2);
  return [buf.readUInt16BE(o + 7), buf.readUInt16BE(o + 5)];
};
/** a layout's cells lie inside its image, its faces sit where the layout says, and no two cells overlap */
const expectCells = (layout) => {
  const cells = layout.faces.map((s) => smallFaceCell(s, layout));
  for (const c of cells) {
    expect(c.x).toBeGreaterThanOrEqual(0);
    expect(c.y).toBeGreaterThanOrEqual(0);
    expect(c.x + c.size).toBeLessThanOrEqual(layout.width);
    expect(c.y + c.size).toBeLessThanOrEqual(layout.height);
    // the face sits where the layout says: its centre at (cx, cy), its oval-box width fw of the image width
    expect(c.face.cx / layout.width).toBeCloseTo(c.spec.cx, 2);
    expect(c.face.cy / layout.height).toBeCloseTo(c.spec.cy, 2);
    expect(c.face.fw / layout.width).toBeCloseTo(c.spec.fw, 2);
  }
  for (const a of cells) {
    for (const b of cells) {
      if (a === b) continue;
      const apart = a.x + a.size <= b.x || b.x + b.size <= a.x || a.y + a.size <= b.y || b.y + b.size <= a.y;
      expect(apart).toBe(true);
    }
  }
  return cells;
};

describe('group fixtures', () => {
  it('group_faces.png is 1800×1200 and group6_faces.png 2048×1536', () => {
    const a = PNG.sync.read(readFileSync(fx('group_faces.png')));
    expect([a.width, a.height]).toEqual([1800, 1200]);
    const b = PNG.sync.read(readFileSync(fx('group6_faces.png')));
    expect([b.width, b.height]).toEqual([2048, 1536]);
  });
  it('small_faces.jpg: a 2000×1500 JPEG of seven faces 6–14 % of the width, cells inside the image and apart', () => {
    expect(jpegSize(readFileSync(fx('small_faces.jpg')))).toEqual([SMALL_FACES.width, SMALL_FACES.height]);
    expect(SMALL_FACES.faces).toHaveLength(7);
    const fws = SMALL_FACES.faces.map((f) => f.fw);
    expect(Math.min(...fws)).toBeCloseTo(0.06, 9);
    expect(Math.max(...fws)).toBeCloseTo(0.14, 9);
    // smallFaceCell's layout defaults to SMALL_FACES
    expect(SMALL_FACES.faces.map((s) => smallFaceCell(s))).toEqual(expectCells(SMALL_FACES));
  });
  it('ten_faces.jpg / eleven_faces.jpg (S §6.7): ten faces 9–13 % of the width; the eleventh, 8 %, is the smallest', () => {
    expect(jpegSize(readFileSync(fx('ten_faces.jpg')))).toEqual([TEN_FACES.width, TEN_FACES.height]);
    expect(jpegSize(readFileSync(fx('eleven_faces.jpg')))).toEqual([ELEVEN_FACES.width, ELEVEN_FACES.height]);
    expect([TEN_FACES.width, TEN_FACES.height]).toEqual([2000, 1500]);
    expect(TEN_FACES.faces).toHaveLength(10);
    expect(ELEVEN_FACES.faces).toHaveLength(11);
    // the same ten faces, plus one
    expect(ELEVEN_FACES.faces.slice(0, 10)).toEqual(TEN_FACES.faces);
    expect([ELEVEN_FACES.width, ELEVEN_FACES.height]).toEqual([TEN_FACES.width, TEN_FACES.height]);
    const fws = TEN_FACES.faces.map((f) => f.fw);
    expect(Math.min(...fws)).toBeCloseTo(0.09, 9);
    expect(Math.max(...fws)).toBeCloseTo(0.13, 9);
    const extra = ELEVEN_FACES.faces[10];
    expect(extra.fw).toBeCloseTo(0.08, 9);
    // a clear margin under the ten (box area 0.79×; detected widths differ from these by ≤ 0.004), and well above
    // MIN_FACE_FRAC (3 % of the short edge = 0.0225 of the width)
    expect(Math.min(...fws) - extra.fw).toBeGreaterThanOrEqual(0.01 - 1e-9);
    // every centre x at least 0.03 from every other: ids run left to right on any delegate (prepareFaces ties within 0.01)
    const xs = ELEVEN_FACES.faces.map((f) => f.cx).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(0.03 - 1e-9);
    expectCells(TEN_FACES);
    expectCells(ELEVEN_FACES);
    // modified derivatives of sample_face.png (Apache-2.0 §4(b)): NOTICE lists them
    const notice = readFileSync(join(import.meta.dirname, '..', '..', '..', 'LICENSES', 'NOTICE.txt'), 'utf8');
    expect(notice).toContain('tests/fixtures/ten_faces.jpg and tests/fixtures/eleven_faces.jpg: modified derivatives of sample_face.png');
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

describe('upright and move clips (camera per-person spec §12.3)', () => {
  const FH = 722 / 619; // sample_face.png's face height over its width (SAMPLE_FACE, the oval box)
  const px = (f) => ({ x: f.cx * 1080, y: f.cy * 1920, w: f.fw * 1920 });
  const inCrop34 = (f) => {
    const p = px(f);
    return p.x - p.w / 2 >= 0 && p.x + p.w / 2 <= 1080 && p.y - (p.w * FH) / 2 >= 240 && p.y + (p.w * FH) / 2 <= 1680;
  };
  const rowsOf = (L) =>
    [...new Set(L.faces.map((f) => f.cy))]
      .sort((a, b) => a - b)
      .map((cy) => L.faces.filter((f) => f.cy === cy).sort((a, b) => a.cx - b.cx));
  const gaps = (row) => row.slice(1).map((f, i) => (px(f).x - px(row[i]).x) / ((px(f).w + px(row[i]).w) / 2));

  it('UPRIGHT_ROW3: three faces at 6.5 % of the long edge (125 px), centres 2.7 FW apart, at mid-height, inside the 3:4 crop', () => {
    expect(UPRIGHT_ROW3.faces.map((f) => Math.round(px(f).w))).toEqual([125, 125, 125]);
    expect(gaps(rowsOf(UPRIGHT_ROW3)[0]).map((g) => +g.toFixed(1))).toEqual([2.7, 2.7]);
    expect(UPRIGHT_ROW3.faces.every((f) => f.cy === 0.5 && inCrop34(f))).toBe(true);
  });
  it('UPRIGHT_FAR10: ten faces at 3–4 % (58–77 px) in two rows of five, centres 2.7 FW apart, rows 1.6 face heights apart', () => {
    expect(UPRIGHT_FAR10.faces.every((f) => f.fw >= 0.03 && f.fw <= 0.04 && inCrop34(f))).toBe(true);
    const rows = rowsOf(UPRIGHT_FAR10);
    expect(rows.map((r) => r.length)).toEqual([5, 5]);
    for (const r of rows) for (const g of gaps(r)) expect(g).toBeCloseTo(2.7, 1);
    const fh = (UPRIGHT_FAR10.faces.reduce((s, f) => s + px(f).w, 0) / 10) * FH;
    expect((px(rows[1][0]).y - px(rows[0][0]).y) / fh).toBeCloseTo(1.6, 1);
  });
  it('SELFIE_GROUP: two near faces at 14 % and 16 % in the lower half, three at 6–8 % in a row behind them, all whole', () => {
    const [back, near] = rowsOf(SELFIE_GROUP);
    expect([near.map((f) => f.fw), back.map((f) => f.fw)]).toEqual([
      [0.14, 0.16],
      [0.06, 0.07, 0.08],
    ]);
    expect(near.every((f) => f.cy > 0.5) && back.every((f) => f.cy < near[0].cy)).toBe(true);
    for (const g of [...gaps(near), ...gaps(back)]) expect(g).toBeCloseTo(2.7, 0);
    expect(SELFIE_GROUP.faces.every(inCrop34)).toBe(true);
  });
  it('composeCells is deterministic for a seed; another seed moves the faces by sub-pixel offsets', () => {
    const png = PNG.sync.read(readFileSync(fx('sample_face.png')));
    const a = composeCells(png, UPRIGHT_ROW3, 1);
    const again = composeCells(png, UPRIGHT_ROW3, 1);
    expect(a.every((v, i) => v === again[i])).toBe(true);
    const b = composeCells(png, UPRIGHT_ROW3, 2);
    let d = 0;
    for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i]));
    expect(d).toBeGreaterThan(0);
  });
  it('moveAt: C gone 2–3.5 s and 11–16.5 s, back at +0.2 FW at 3.5 s, swapped at 7–8.5 s, home at 10 s; the loop seam is continuous', () => {
    const fwC = groupCamTiles().find((t) => t.name === 'C').fw / 2;
    expect([moveAt(2.5).C, moveAt(12).C, moveAt(16.4).C]).toEqual([null, null, null]);
    expect(moveAt(4).C.x - moveAt(1).C.x).toBeCloseTo(0.2 * fwC, 1);
    expect(moveAt(7.5).C.x).toBeCloseTo(moveAt(1).B.x, 1);
    expect(moveAt(7.5).B.x).toBeCloseTo(moveAt(1).C.x, 1);
    expect(moveAt(10.5)).toEqual(moveAt(0.5));
    expect(moveAt(17.99)).toEqual(moveAt(0));
  });
  it('composeMove: A, B and C at half composeGroupCam scale on the photo background, C absent while away, drawn behind B in the swaps', () => {
    const png = PNG.sync.read(readFileSync(fx('group_faces.png')));
    const frame = composeMove(png);
    const bg = [png.data[0], png.data[1], png.data[2]];
    const at = (rgb, p) => {
      const o = (Math.round(p.y) * MOVE.width + Math.round(p.x)) * 3;
      return [rgb[o], rgb[o + 1], rgb[o + 2]];
    };
    const still = frame(moveAt(1));
    expect(still.length).toBe(MOVE.width * MOVE.height * 3);
    for (const k of ['A', 'B', 'C']) expect(at(still, moveAt(1)[k]), `face ${k}`).not.toEqual(bg);
    expect(at(still, { x: 0, y: 0 })).toEqual(bg);
    expect(at(frame(moveAt(2.5)), moveAt(1).C), 'C away').toEqual(bg);
    // mid swap C's tile overlaps B's face: B covers it while C is behind
    const m = moveAt(6.25);
    expect(m.cBehind).toBe(true);
    expect(Math.abs(m.C.x - m.B.x)).toBeLessThan((0.3 * groupCamTiles().find((t) => t.name === 'C').fw) / 2);
    const alone = frame({ ...m, C: null });
    expect(at(frame(m), m.B)).toEqual(at(alone, m.B));
    expect(at(frame({ ...m, cBehind: false }), m.B)).not.toEqual(at(alone, m.B));
    expect([moveAt(1).cBehind, moveAt(7.5).cBehind, moveAt(9).cBehind]).toEqual([false, false, true]);
  });
  it('composeFitWidthBoxes(TEN_FACES): ten boxes 9–13 % of the frame width, bottom-aligned as composeFitWidth draws them', () => {
    const boxes = composeFitWidthBoxes(TEN_FACES);
    expect(boxes).toHaveLength(10);
    expect(boxes.every((b) => b.w >= 0.09 - 1e-6 && b.w <= 0.13 + 1e-6 && b.y >= 0 && b.y + b.h <= 1)).toBe(true);
  });
  it('NOTICE lists the generated clips as modified derivatives (Apache-2.0 §4(b))', () => {
    const notice = readFileSync(join(import.meta.dirname, '..', '..', '..', 'LICENSES', 'NOTICE.txt'), 'utf8');
    for (const clip of ['upright_row3.y4m', 'upright_far10.y4m', 'selfie_group.y4m', 'group10.y4m', 'group_move.y4m']) expect(notice).toContain(clip);
  });
});
