import { describe, expect, it } from 'vitest';
import { syntheticPortrait } from '../body/synthetic';
import type { PersonMask } from '../types';
import { buildFaceProtect, PROTECT_LONG_EDGE, protectGridSize, protectWindow, SD_CLAMP } from './faceProtect';

const pr = syntheticPortrait(); // 600×800, face width 0.5 W, a face-oval-only head
const W = pr.width;
const H = pr.height;

function maskOf(inside: (u: number, v: number) => number, w = 192, h = 256): PersonMask {
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = Math.round(255 * inside((x + 0.5) / w, (y + 0.5) / h));
  return { width: w, height: h, data };
}
const at = (p: { width: number; height: number; data: Float32Array }, u: number, v: number) =>
  p.data[Math.min(p.height - 1, Math.floor(v * p.height)) * p.width + Math.min(p.width - 1, Math.floor(u * p.width))];

describe('protectGridSize', () => {
  it('keeps the aspect with PROTECT_LONG_EDGE on the long side', () => {
    expect(protectGridSize(600, 800)).toEqual([192, PROTECT_LONG_EDGE]);
    expect(protectGridSize(4032, 3024)).toEqual([PROTECT_LONG_EDGE, 192]);
    expect(protectGridSize(1, 1)).toEqual([256, 256]);
    expect(protectGridSize(5000, 10)).toEqual([256, 1]);
  });
});

describe('buildFaceProtect', () => {
  const prot = buildFaceProtect(pr.face, maskOf(pr.inside), W, H);
  const P = pr.face.pts111;
  const fw = Math.hypot(P[0] - P[64], ((P[1] - P[65]) * H) / W); // iso (fractions of the width)

  it('is the signed distance to the person in fractions of the image width: negative inside, positive outside', () => {
    expect(prot.width).toBe(192);
    expect(prot.height).toBe(256);
    expect(prot.data.every(Number.isFinite)).toBe(true);
    expect(prot.data.every((d) => Math.abs(d) <= SD_CLAMP)).toBe(true);
    // the nose tip is deep inside, the top corners far outside
    expect(at(prot, P[46 * 2], P[46 * 2 + 1])).toBeLessThan(-0.15 * fw);
    expect(at(prot, 0.02, 0.02)).toBeGreaterThan(0.3);
    // a point 0.2 FW (iso) outside the mid-cheek contour reads ≈ 0.2 FW
    const x = P[7 * 2] - 0.2 * fw;
    expect(at(prot, x, P[7 * 2 + 1])).toBeGreaterThan(0.15 * fw);
    expect(at(prot, x, P[7 * 2 + 1])).toBeLessThan(0.22 * fw);
  });

  it('is 1-Lipschitz (what bounds the budget slope in the shader): neighbours differ by at most one texel', () => {
    const t = 1 / prot.width;
    let worst = 0;
    for (let y = 0; y < prot.height; y++)
      for (let x = 0; x < prot.width; x++) {
        const d = prot.data[y * prot.width + x];
        if (x + 1 < prot.width) worst = Math.max(worst, Math.abs(prot.data[y * prot.width + x + 1] - d));
        if (y + 1 < prot.height) worst = Math.max(worst, Math.abs(prot.data[(y + 1) * prot.width + x] - d));
      }
    expect(worst).toBeLessThanOrEqual(t * 1.0001);
    expect(worst).toBeGreaterThan(0.9 * t); // and not flattened
  });

  it('the face oval always counts as the person, even when the mask misses it (no mask: the oval alone)', () => {
    const empty: PersonMask = { width: 4, height: 4, data: new Uint8Array(16) };
    for (const p of [buildFaceProtect(pr.face, empty, W, H), buildFaceProtect(pr.face, null, W, H)]) {
      expect(at(p, P[46 * 2], P[46 * 2 + 1])).toBeLessThan(0);
      // the neck is not part of the oval: background now
      expect(at(p, 0.5, P[16 * 2 + 1] + 0.1)).toBeGreaterThan(0);
    }
    expect(at(prot, 0.5, P[16 * 2 + 1] + 0.1)).toBeLessThan(0); // with the mask, the neck is person
  });

  it("only the face's own person counts: a blob not connected to the face is background", () => {
    const blob = maskOf((u, v) => (pr.inside(u, v) > 0 || (Math.abs(u - 0.08) < 0.04 && Math.abs(v - 0.3) < 0.04) ? 1 : 0));
    const p = buildFaceProtect(pr.face, blob, W, H);
    expect(at(p, 0.08, 0.3)).toBeGreaterThan(0.05);
    expect(at(p, 0.08, 0.3)).toBeCloseTo(at(prot, 0.08, 0.3), 3);
  });

  it('a photo that is all person reads deep everywhere; every build gets a new version', () => {
    const full: PersonMask = { width: 2, height: 2, data: new Uint8Array([255, 255, 255, 255]) };
    const p = buildFaceProtect(pr.face, full, W, H);
    expect(p.data.every((d) => d === -SD_CLAMP)).toBe(true);
    expect(p.version).toBeGreaterThan(prot.version);
  });
});

/** FNV-1a 32 of the float bits */
function bits(a: Float32Array): string {
  const u = new Uint32Array(a.buffer, a.byteOffset, a.length);
  let h = 0x811c9dc5;
  for (const x of u) {
    h ^= x;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

describe('single face is byte-equal to v0.3 (S §4.7 item 4)', () => {
  it('portrait with mask / without mask', () => {
    expect(bits(buildFaceProtect(pr.face, maskOf(pr.inside), W, H).data)).toMatchSnapshot();
    expect(bits(buildFaceProtect(pr.face, null, W, H).data)).toMatchSnapshot();
  });
});

describe('buildFaceProtect with other persons (S §4.7)', () => {
  const twin = (dx: number) => {
    const f = pr.face;
    const m = (a: Float32Array) => a.map((v, i) => (i % 2 === 0 ? v + dx : v));
    return { pts111: m(f.pts111), ext: m(f.ext), oval: m(f.oval), yaw: 0, iris: m(f.iris), lids: m(f.lids) };
  };
  const B = twin(0.45);
  const P = pr.face.pts111;
  /** R_f = PROTECT_REACH (0.3) face widths, iso */
  const reach = 0.3 * Math.hypot(P[0] - P[64], ((P[1] - P[65]) * H) / W);
  const none = { otherCentres: [], otherOvals: [], otherMasks: [], window: null };
  // a test point half a reach right of the face oval (its own budget is clearly positive there), inside a disc
  // (radius one reach, iso) that stands for another person
  const right = Math.max(...Array.from({ length: 36 }, (_, i) => pr.face.oval[i * 2]));
  const row = P[46 * 2 + 1];
  const probe: [number, number] = [right + 0.5 * reach, row];
  const disc = { cx: right + 1.2 * reach, r: reach };
  const inDisc = (u: number, v: number) => Math.hypot(u - disc.cx, ((v - row) * H) / W) < disc.r;
  const discOval = new Float32Array(72).map((_, k) => {
    const a = (Math.floor(k / 2) / 36) * 2 * Math.PI;
    return k % 2 === 0 ? disc.cx + disc.r * Math.cos(a) : row + ((disc.r * W) / H) * Math.sin(a);
  });
  it('the same regions object without others is today’s limit', () => {
    const a = buildFaceProtect(pr.face, maskOf(pr.inside), W, H);
    const b = buildFaceProtect(pr.face, { own: maskOf(pr.inside), clipToCell: false, ...none }, W, H);
    expect(Array.from(b.data)).toEqual(Array.from(a.data));
  });
  it('another person’s mask or another face’s oval takes the budget to ≈ 0 next to them (S §4.7 item 2)', () => {
    const alone = buildFaceProtect(pr.face, null, W, H);
    expect(reach - at(alone, probe[0], probe[1])).toBeGreaterThan(0.3 * reach);
    const byMask = buildFaceProtect(pr.face, { own: null, clipToCell: false, ...none, otherCentres: [[disc.cx, row]], otherMasks: [maskOf((u, v) => (inDisc(u, v) ? 1 : 0))] }, W, H);
    const byOval = buildFaceProtect(pr.face, { own: null, clipToCell: false, ...none, otherCentres: [[disc.cx, row]], otherOvals: [discOval] }, W, H);
    // the three box blurs round the max(·) a little: ≤ 0 before them (A4), ≤ 0.25 R_f after
    expect(reach - at(byMask, probe[0], probe[1])).toBeLessThanOrEqual(0.25 * reach);
    expect(reach - at(byOval, probe[0], probe[1])).toBeLessThanOrEqual(0.25 * reach);
    expect(reach - at(byMask, disc.cx, row)).toBeLessThanOrEqual(0);
  });
  it('stays 1-Lipschitz with others (the wall-line bound, A4)', () => {
    const p = buildFaceProtect(pr.face, { own: null, clipToCell: false, otherCentres: [[0.95, 0.5]], otherOvals: [B.oval], otherMasks: [], window: null }, W, H);
    let worst = 0;
    for (let y = 0; y < p.height; y++)
      for (let x = 0; x + 1 < p.width; x++) worst = Math.max(worst, Math.abs(p.data[y * p.width + x + 1] - p.data[y * p.width + x]));
    expect(worst).toBeLessThanOrEqual((1 / p.width) * 1.0001);
  });
  it('a shared selfie mask is clipped to this face’s Voronoi cell', () => {
    const both = maskOf(() => 1);
    const cB: [number, number] = [0.95, P[46 * 2 + 1]];
    const p = buildFaceProtect(pr.face, { own: both, clipToCell: true, otherCentres: [cB], otherOvals: [], otherMasks: [], window: null }, W, H);
    expect(at(p, 0.97, 0.5)).toBeGreaterThan(0); // beyond the halfway line: not this person
    expect(at(p, P[46 * 2], P[46 * 2 + 1])).toBeLessThan(0);
  });
  it('≥ 2 faces: a PROTECT_WINDOW² window around the U_MAX box padded by R_f, square in iso units', () => {
    const win = protectWindow(pr.face, W, H);
    expect(win.w).toBeCloseTo((win.h * H) / W, 6);
    const p = buildFaceProtect(pr.face, { own: null, clipToCell: false, otherCentres: [[0.95, 0.5]], otherOvals: [], otherMasks: [], window: win }, W, H);
    expect([p.width, p.height]).toEqual([128, 128]);
    expect(p.window).toEqual(win);
  });
});
