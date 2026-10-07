// T5 generated-asset tests: LUT layout + lookup math, shipped LUT/thumbnail/mask/icon/y4m outputs.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { FILTERS } from '../../../src/engine/params.ts';
import { ICONS } from '../../../scripts/gen-icons.mjs';
import {
  FILTER_IDS,
  LOOKS,
  LUT_DIM,
  THUMB,
  buildLut,
  drawSwatch,
  encodePng,
  identity,
  lookup64,
  srgbToLab,
} from '../../../scripts/gen-luts.mjs';
import { MASKS, blur, maskFromRgba } from '../../../scripts/gen-makeup.mjs';
import { FRAMES, H, W, composeFrame, rgbToI420 } from '../../../scripts/gen-y4m.mjs';
import { lutStats } from './lut-stats.mjs';

const root = join(import.meta.dirname, '..', '..', '..');
const pub = (...p) => join(root, 'public', ...p);
const readPng = (p) => PNG.sync.read(readFileSync(p));

/** PNG chunk types, in order. */
function chunks(buf) {
  const out = [];
  for (let o = 8; o < buf.length; ) {
    const len = buf.readUInt32BE(o);
    out.push(buf.toString('ascii', o + 4, o + 8));
    o += 12 + len;
  }
  return out;
}

const meanAbsDiff = (a, b) => {
  let s = 0;
  let n = 0;
  for (let i = 0; i < a.length; i += 4) {
    s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    n += 3;
  }
  return s / n;
};

describe('64³ GPUImage LUT layout and lookup', () => {
  // Goes through PNG encode/decode so the test covers exactly what ships.
  const idLut = PNG.sync.read(encodePng(buildLut(identity), LUT_DIM, LUT_DIM)).data;

  it('stores colour (r,g,b)/63 at x = (b%8)·64 + r, y = floor(b/8)·64 + g', () => {
    for (const [r, g, b] of [
      [0, 0, 0],
      [63, 0, 0],
      [0, 63, 0],
      [0, 0, 63],
      [17, 42, 9],
      [63, 63, 63],
      [5, 60, 33],
    ]) {
      const i = ((Math.floor(b / 8) * 64 + g) * LUT_DIM + (b % 8) * 64 + r) * 4;
      expect([idLut[i], idLut[i + 1], idLut[i + 2], idLut[i + 3]]).toEqual([
        Math.round((r * 255) / 63),
        Math.round((g * 255) / 63),
        Math.round((b * 255) / 63),
        255,
      ]);
    }
  });

  it('identity LUT reproduces every 8-bit colour exactly through the shader lookup math', () => {
    const t = [0, 0, 0];
    let mismatches = 0;
    for (let b = 0; b < 256; b++) {
      for (let g = 0; g < 256; g++) {
        for (let r = 0; r < 256; r++) {
          lookup64(idLut, r / 255, g / 255, b / 255, t);
          if (Math.round(t[0] * 255) !== r || Math.round(t[1] * 255) !== g || Math.round(t[2] * 255) !== b) mismatches++;
        }
      }
    }
    expect(mismatches).toBe(0);
  });

  it('interpolates between blue slices (fract(b·63)), not nearest-slice', () => {
    // b exactly halfway between slices 10 and 11: output blue must be the midpoint
    const t = lookup64(idLut, 0.5, 0.5, 10.5 / 63);
    const mid = (Math.round((10 * 255) / 63) + Math.round((11 * 255) / 63)) / 2 / 255;
    expect(t[2]).toBeCloseTo(mid, 6);
  });
});

describe('shipped filter LUTs', () => {
  it('every FilterDef except none has a LUT id here, and vice versa', () => {
    expect(FILTERS.filter((f) => f.id !== 'none').map((f) => f.id)).toEqual(FILTER_IDS);
  });

  for (const id of FILTER_IDS) {
    describe(id, () => {
      const file = pub('luts', 'filters', `${id}.png`);
      const raw = readFileSync(file);
      const png = PNG.sync.read(raw);

      it('is a 512×512 opaque RGB PNG with no colour-management chunks', () => {
        expect([png.width, png.height]).toEqual([512, 512]);
        expect(raw[25]).toBe(2); // IHDR colour type: truecolour, no alpha
        expect(chunks(raw).filter((c) => c !== 'IDAT')).toEqual(['IHDR', 'IEND']);
      });

      it('matches the generator output (assets are up to date)', () => {
        expect(Buffer.compare(png.data, buildLut(LOOKS[id]))).toBe(0);
      });

      it('is smooth (no jumps between neighbouring grid entries) with a monotone grey axis', () => {
        const s = lutStats(png.data);
        expect(s.greyMonotone).toBe(true);
        expect(s.maxStep).toBeLessThanOrEqual(36);
      });

      it('is a visible look: thumbnail differs from the ungraded swatch', () => {
        const thumb = readPng(pub('luts', 'filters', `${id}_thumb.png`));
        expect([thumb.width, thumb.height]).toEqual([THUMB, THUMB]);
        const none = readPng(pub('luts', 'filters', 'none_thumb.png'));
        expect(meanAbsDiff(thumb.data, none.data)).toBeGreaterThan(4);
      });
    });
  }

  it('looks are mutually distinct on the thumbnail swatch', () => {
    const thumbs = FILTER_IDS.map((id) => readPng(pub('luts', 'filters', `${id}_thumb.png`)).data);
    for (let i = 0; i < thumbs.length; i++) {
      for (let j = i + 1; j < thumbs.length; j++) {
        const d = meanAbsDiff(thumbs[i], thumbs[j]);
        if (d < 5) throw new Error(`${FILTER_IDS[i]} vs ${FILTER_IDS[j]}: mean diff ${d.toFixed(2)}`);
      }
    }
  });

  it('none_thumb is the ungraded swatch', () => {
    expect(Buffer.compare(readPng(pub('luts', 'filters', 'none_thumb.png')).data, drawSwatch(THUMB))).toBe(0);
  });

  it('keeps skin tones skin-like in every colour look (hue, chroma, no darkening)', () => {
    const skins = [
      [241, 194, 167],
      [232, 190, 172],
      [224, 172, 150],
      [200, 150, 130],
      [198, 134, 110],
      [171, 140, 114],
      [141, 85, 60],
    ];
    const lch = (lab) => [lab[0], Math.hypot(lab[1], lab[2]), (Math.atan2(lab[2], lab[1]) * 180) / Math.PI];
    for (const id of FILTER_IDS.filter((f) => f !== 'mono')) {
      for (const s of skins) {
        const inp = lch(srgbToLab(s.map((v) => v / 255)));
        const out = lch(srgbToLab(LOOKS[id](s.map((v) => v / 255))));
        const msg = `${id} ${s}: L ${out[0].toFixed(3)} C ${out[1].toFixed(3)} h ${out[2].toFixed(1)}`;
        expect(out[2], msg).toBeGreaterThan(25);
        expect(out[2], msg).toBeLessThan(75);
        expect(out[1], msg).toBeGreaterThan(0.025);
        expect(out[1], msg).toBeLessThan(0.11);
        expect(out[0], msg).toBeGreaterThan(inp[0] - 0.03);
      }
    }
  });
});

describe('GPUPixel LUTs and makeup textures', () => {
  // RB §2.1: no colour chunks, so no browser can colour-manage LUT / makeup data
  // (Safari's colorSpaceConversion:'none' handling is unverified; gAMA alone is a 2.2 power curve).
  const files = [
    ...['gray', 'origin', 'skin', 'light'].map((n) => pub('luts', 'gp', `lookup_${n}.png`)),
    ...['lip', 'lip_mask', 'blush', 'blush_mask'].map((n) => pub('makeup', 'gp', `${n}.png`)),
  ];
  for (const file of files) {
    it(`${file.slice(pub().length + 1).replaceAll('\\', '/')} has no colour-management chunks`, () => {
      expect(chunks(readFileSync(file)).filter((c) => c !== 'IDAT')).toEqual(['IHDR', 'IEND']);
    });
  }
});

describe('makeup masks', () => {
  for (const m of MASKS) {
    it(`${m.dst} = RB §2.5 formula of ${m.src} (greyscale RGBA, zero border, peak 255)`, () => {
      const src = readPng(pub('makeup', 'gp', m.src));
      const dst = readPng(pub('makeup', 'gp', m.dst));
      expect([dst.width, dst.height]).toEqual([src.width, src.height]);
      const expected = blur(maskFromRgba(src.data, src.width, src.height, m.darkest), src.width, src.height, m.blurSigma);
      let peak = 0;
      for (let i = 0; i < src.width * src.height; i++) {
        const v = dst.data[i * 4];
        expect(dst.data[i * 4 + 1]).toBe(v);
        expect(dst.data[i * 4 + 2]).toBe(v);
        expect(dst.data[i * 4 + 3]).toBe(255);
        expect(v).toBe(Math.round(Math.min(1, Math.max(0, expected[i])) * 255));
        peak = Math.max(peak, v);
        const x = i % src.width;
        const y = Math.floor(i / src.width);
        if (x === 0 || y === 0 || x === src.width - 1 || y === src.height - 1) expect(v).toBe(0);
      }
      expect(peak).toBe(255);
    });
  }

  it('lip mask is the raw formula (no smoothing): darkest lip pixel → 255, white → 0', () => {
    const src = readPng(pub('makeup', 'gp', 'lip.png'));
    const dst = readPng(pub('makeup', 'gp', 'lip_mask.png'));
    for (let i = 0; i < src.width * src.height; i++) {
      const m = (1 - Math.min(src.data[i * 4 + 1], src.data[i * 4 + 2]) / 255) / (1 - 40 / 255);
      expect(dst.data[i * 4]).toBe(Math.round(Math.min(1, Math.max(0, m)) * 255));
    }
  });
});

describe('icons', () => {
  for (const icon of ICONS) {
    it(`${icon.file}: ${icon.size}² opaque, black ground, lime mark${icon.safeRadius ? ' inside the 80 % safe circle' : ''}`, () => {
      const png = readPng(pub('icons', icon.file));
      expect([png.width, png.height]).toEqual([icon.size, icon.size]);
      let lime = 0;
      let maxR = 0;
      for (let y = 0; y < png.height; y++) {
        for (let x = 0; x < png.width; x++) {
          const i = (y * png.width + x) * 4;
          expect(png.data[i + 3]).toBe(255);
          if (png.data[i] + png.data[i + 1] + png.data[i + 2] > 0) {
            maxR = Math.max(maxR, Math.hypot(x + 0.5 - png.width / 2, y + 0.5 - png.height / 2) / png.width);
          }
          if (png.data[i] === 0xb8 && png.data[i + 1] === 0xf0 && png.data[i + 2] === 0x2a) lime++;
        }
      }
      expect(lime).toBeGreaterThan(icon.size * icon.size * 0.05);
      for (const [x, y] of [
        [0, 0],
        [icon.size - 1, 0],
        [0, icon.size - 1],
        [icon.size - 1, icon.size - 1],
      ]) {
        const i = (y * icon.size + x) * 4;
        expect([png.data[i], png.data[i + 1], png.data[i + 2]]).toEqual([0, 0, 0]);
      }
      expect(maxR).toBeLessThan(icon.safeRadius ? 0.4 : 0.45);
    });
  }
});

describe('fake-camera y4m', () => {
  const file = join(root, 'tests', 'fixtures', 'face.y4m');
  it.skipIf(!existsSync(file))('is 1280×720 4:2:0, 30 frames, and matches the generator', () => {
    const header = `YUV4MPEG2 W${W} H${H} F30:1 Ip A1:1 C420jpeg\n`;
    const frameBytes = 6 + W * H * 1.5;
    expect(statSync(file).size).toBe(header.length + FRAMES * frameBytes);
    const buf = readFileSync(file);
    expect(buf.toString('ascii', 0, header.length)).toBe(header);
    expect(buf.toString('ascii', header.length, header.length + 6)).toBe('FRAME\n');
    const { Y, U, V } = rgbToI420(composeFrame(readPng(join(root, 'tests', 'fixtures', 'sample_face.png'))), W, H);
    const f0 = header.length + 6;
    expect(Buffer.compare(buf.subarray(f0, f0 + Y.length), Buffer.from(Y))).toBe(0);
    expect(Buffer.compare(buf.subarray(f0 + Y.length, f0 + Y.length + U.length), Buffer.from(U))).toBe(0);
    expect(Buffer.compare(buf.subarray(f0 + Y.length + U.length, f0 + frameBytes - 6), Buffer.from(V))).toBe(0);
  });
});
