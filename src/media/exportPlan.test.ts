import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fieldAt } from '../body/cpuWarp';
import { backMapperCpu } from '../engine/backMapCpu';
import { PARAM_DEFS } from '../engine/params';
import { displacementBound, reshapeGeometry, reshapeUniforms } from '../engine/passes/reshape';
import { reshapeMapCpu, type UvMap } from '../engine/passes/reshapeCpu';
import { applyRatio, IDENTITY_GEOMETRY, rotateLeft, setStraighten, snapCrop, viewSize } from '../geometry/view';
import { adapt } from '../tracking/adapter111';
import type { BodyField, Face, Geometry, ParamId, Prefs } from '../types';
import {
  apronFor,
  chooseTile,
  exportSizeView,
  fullExportBlock,
  isSeClassScreen,
  planExport,
  planTiles,
  shouldKeepSource,
  sourceSizeRecord,
  TILE_SIZES,
  type ExportEnv,
  type SourceInfo,
  type TileBounds,
  type TileGrid,
} from './exportPlan';

const env = (over: Partial<ExportEnv> = {}): ExportEnv => ({
  prefTier: 'auto',
  autoTier: 'H',
  screen: { width: 393, height: 852 },
  capped: false,
  ...over,
});

describe('fullExportBlock (S §3.7)', () => {
  it('in order: 畫質 低, auto tier L, SE-class screen, breadcrumb cap, else none', () => {
    expect(fullExportBlock(env())).toBeNull();
    expect(fullExportBlock(env({ prefTier: 'L', capped: true }))).toBe('tierLow');
    expect(fullExportBlock(env({ autoTier: 'L', capped: true }))).toBe('tierL');
    expect(fullExportBlock(env({ prefTier: 'H', autoTier: 'L' }))).toBeNull();
    expect(fullExportBlock(env({ screen: { width: 667, height: 375 } }))).toBe('device');
    expect(fullExportBlock(env({ capped: true }))).toBe('guard');
  });

  it('SE class is 375 × 667 in either orientation only', () => {
    expect(isSeClassScreen({ width: 375, height: 667 })).toBe(true);
    expect(isSeClassScreen({ width: 375, height: 812 })).toBe(false);
  });
});

describe('exportSizeView (設定 › 輸出解析度, S §2.4)', () => {
  it('shows the stored pref when nothing blocks it', () => {
    expect(exportSizeView('full', null)).toEqual({ value: 'full', fullDisabled: false, sub: '原始解析度：最長邊最多 4096 像素' });
    expect(exportSizeView('standard', null).value).toBe('standard');
  });

  it('shows 標準（2048） under every block; disabled for the device and 畫質 低, enabled (retry) under the cap', () => {
    expect(exportSizeView('full', 'tierL')).toEqual({ value: 'standard', fullDisabled: true, sub: '此裝置記憶體不足，改用標準解析度' });
    expect(exportSizeView('full', 'device')).toEqual({ value: 'standard', fullDisabled: true, sub: '此裝置記憶體不足，改用標準解析度' });
    expect(exportSizeView('full', 'tierLow')).toEqual({ value: 'standard', fullDisabled: true, sub: '畫質設為「低」時使用標準解析度' });
    expect(exportSizeView('full', 'guard')).toEqual({
      value: 'standard',
      fullDisabled: false,
      sub: '上次以原始解析度輸出時程式中止，已改用標準解析度。再選一次「原始解析度」即可重試',
    });
  });
});

const W2048 = { width: 2048, height: 1536 };
const prefs = (over: Partial<Pick<Prefs, 'exportFormat' | 'exportSize'>> = {}) => ({ exportFormat: 'jpeg' as const, exportSize: 'full' as const, ...over });
const src = (w: number | null, h: number | null, blob: Blob | null = new Blob(['x'])): SourceInfo => ({ blob, width: w, height: h });
const edit = (g: Geometry = IDENTITY_GEOMETRY) => ({ photo: { geometry: g } });
const NO_BOUNDS: TileBounds = { body: null, faces: [] };

describe('planExport: plan selection (S §3.7)', () => {
  it('standard pref, a block, no source, or a source no larger than the working copy → working (today\'s path)', () => {
    const a = planExport(edit(), prefs({ exportSize: 'standard' }), src(4032, 3024), W2048, env(), NO_BOUNDS);
    expect([a.mode, a.width, a.height, a.fallback, a.quality]).toEqual(['working', 2048, 1536, null, 0.92]);
    const tierL = planExport(edit(), prefs(), src(4032, 3024), { width: 1440, height: 1080 }, env({ autoTier: 'L' }), NO_BOUNDS);
    expect([tierL.mode, tierL.width, tierL.fallback, tierL.quality]).toEqual(['working', 1440, 'tierL', 0.95]);
    expect(planExport(edit(), prefs(), src(4032, 3024), W2048, env({ screen: { width: 375, height: 667 } }), NO_BOUNDS).fallback).toBe('device');
    expect(planExport(edit(), prefs(), src(4032, 3024), W2048, env({ capped: true }), NO_BOUNDS).fallback).toBe('guard');
    expect(planExport(edit(), prefs(), src(null, null, null), W2048, env(), NO_BOUNDS).fallback).toBe('noSource');
    expect(planExport(edit(), prefs(), src(4032, 3024, null), W2048, env(), NO_BOUNDS).fallback).toBe('noSource');
    expect(planExport(edit(), prefs(), src(2048, 1536), W2048, env(), NO_BOUNDS).fallback).toBe('notLarger');
  });

  it('a larger source with the full pref → tiled at min(source, 4096), q 0.95; PNG has no quality', () => {
    const p = planExport(edit(), prefs(), src(4032, 3024), W2048, env(), NO_BOUNDS);
    expect([p.mode, p.width, p.height, p.fullShortEdge, p.quality]).toEqual(['tiled', 4032, 3024, 3024, 0.95]);
    expect(p.decode).toEqual({ width: 4032, height: 3024 });
    const big = planExport(edit(), prefs({ exportFormat: 'png' }), src(8064, 6048), W2048, env(), NO_BOUNDS);
    expect([big.width, big.height, big.format]).toEqual([4096, 3072, 'png']);
  });

  it('a crop exports the cropped part at the decode density; 旋轉 swaps the sides', () => {
    const one = applyRatio(IDENTITY_GEOMETRY, '1:1', W2048);
    const p = planExport(edit(one), prefs(), src(4032, 3024), W2048, env(), NO_BOUNDS);
    expect([p.width, p.height]).toEqual([3024, 3024]);
    const turned = planExport(edit(rotateLeft(IDENTITY_GEOMETRY)), prefs(), src(4032, 3024), W2048, env(), NO_BOUNDS);
    expect([turned.width, turned.height]).toEqual([3024, 4032]);
  });

  it('a panorama and a sliver stay finite (Review Focus 4)', () => {
    const pano = planExport(edit(), prefs(), src(16000, 4000), { width: 2048, height: 512 }, env(), NO_BOUNDS);
    expect([pano.mode, pano.width, pano.height]).toEqual(['tiled', 4096, 1024]);
    expectPartition(pano.tiles, { width: pano.width, height: pano.height });
    const sliver = planExport(edit(), prefs(), src(20000, 3), { width: 2048, height: 1 }, env(), NO_BOUNDS);
    expect(sliver.width).toBe(4096);
    expect(sliver.height).toBeGreaterThanOrEqual(1);
    expectPartition(sliver.tiles, { width: sliver.width, height: sliver.height });
  });

  it('the knob forces the tile size', () => {
    expect(planExport(edit(), prefs(), src(4032, 3024), W2048, env(), NO_BOUNDS, { tile: 256 }).tile).toBe(256);
  });
});

/** the out rects cover V exactly once (counted, then asserted once: millions of pixels) */
function expectPartition(tiles: { out: { x: number; y: number; w: number; h: number } }[], V: { width: number; height: number }) {
  const seen = new Uint8Array(V.width * V.height);
  let overlaps = 0;
  for (const { out } of tiles)
    for (let y = out.y; y < out.y + out.h; y++)
      for (let x = out.x; x < out.x + out.w; x++) {
        const i = y * V.width + x;
        if (seen[i]) overlaps++;
        seen[i] = 1;
      }
  expect(overlaps).toBe(0);
  expect(seen.indexOf(0)).toBe(-1);
}

describe('planTiles (S §4.4)', () => {
  const grid = (V: { width: number; height: number }, decode = V, g: Geometry = IDENTITY_GEOMETRY, fse = Math.min(decode.width, decode.height)): TileGrid => ({
    V,
    decode,
    geometry: g,
    oAspect: decode.width / decode.height,
    fullShortEdge: fse,
  });

  it('apronV = ceil(14·k) + 2 rounded up to 4: 64 at a 3072 short edge', () => {
    expect(apronFor(3072)).toBe(64);
    expect(apronFor(1536)).toBe(32);
    expect(apronFor(720) % 4).toBe(0);
  });

  it('tiles partition V; origins are multiples of 4; buf ⊆ V and win ⊆ decode, also off the 4-grid', () => {
    for (const V of [{ width: 4096, height: 3072 }, { width: 4001, height: 2999 }, { width: 601, height: 799 }]) {
      for (const T of [256, 1024]) {
        const tiles = planTiles(grid(V), NO_BOUNDS, T);
        expectPartition(tiles, V);
        for (const t of tiles) {
          expect(t.out.x % 4).toBe(0);
          expect(t.out.y % 4).toBe(0);
          expect(t.buf.x >= 0 && t.buf.y >= 0 && t.buf.x + t.buf.w <= V.width && t.buf.y + t.buf.h <= V.height).toBe(true);
          expect(t.win.x >= 0 && t.win.y >= 0 && t.win.x + t.win.w <= V.width && t.win.y + t.win.h <= V.height).toBe(true);
          expect(t.buf.x <= t.out.x && t.buf.x + t.buf.w >= t.out.x + t.out.w).toBe(true);
        }
      }
    }
  });

  it('the TILE choice: 1024 at 4096 × 3072 within 40 MiB', () => {
    const r = chooseTile(grid({ width: 4096, height: 3072 }), NO_BOUNDS);
    expect(r.tile).toBe(1024);
    expect(TILE_SIZES).toEqual([2048, 1024, 512, 256]);
  });

  it('coverage: every buffer pixel of every tile samples inside its window (two faces, a body field, θ = 12°)', () => {
    const lm = JSON.parse(readFileSync(new URL('../../tests/fixtures/landmarks_sample_face.json', import.meta.url), 'utf8')) as {
      width: number;
      height: number;
      points: number[];
    };
    const decode = { width: 400, height: 600 };
    const aspect = decode.width / decode.height;
    const faceA = adapt({ points: new Float32Array(lm.points) }, lm.width, lm.height);
    const moved = (f: Face, s: number, dx: number, dy: number): Face => {
      const m = (a: Float32Array) => a.map((v, i) => (i % 2 === 0 ? v * s + dx : v * s + dy));
      return { ...f, pts111: m(f.pts111), ext: m(f.ext), oval: m(f.oval) };
    };
    const faceB = moved(faceA, 0.4, 0.55, 0.05);
    const values = Object.fromEntries(PARAM_DEFS.map((d) => [d.id, d.bidirectional ? 0.5 : 0])) as Record<ParamId, number>;
    for (const id of ['shape.faceSlim', 'shape.faceV', 'shape.chin', 'shape.eyeEnlarge', 'shape.eyeDistance'] as ParamId[]) values[id] = 1;
    const u = reshapeUniforms(values, 1);
    const bw = 16;
    const bh = 24;
    const bd = new Float32Array(bw * bh * 2);
    for (let i = 0; i < bw * bh; i++) {
      bd[i * 2] = 0.02 * Math.sin(i * 0.37);
      bd[i * 2 + 1] = 0.015 * Math.cos(i * 0.21);
    }
    const body: BodyField = { width: bw, height: bh, data: bd, version: 1 };
    const mapA = reshapeMapCpu(faceA, u, aspect);
    const mapB = reshapeMapCpu(faceB, u, aspect);
    const oMap: UvMap = (x, y) => {
      const d = fieldAt(body, x, y);
      const bx = x + d[0];
      const by = y + d[1];
      const a = mapA(bx, by);
      const b = mapB(bx, by);
      return [a[0] + b[0] - bx, a[1] + b[1] - by];
    };
    const bounds: TileBounds = {
      body,
      faces: [faceA, faceB].map((f) => ({ box: reshapeGeometry(f, aspect, u).box, bound: displacementBound(f, aspect, u) })),
    };
    const g = snapCrop(setStraighten(IDENTITY_GEOMETRY, 12, decode), decode);
    const V = viewSize(g, decode);
    const tiles = planTiles({ V, decode, geometry: g, oAspect: aspect, fullShortEdge: 400 }, bounds, 64);
    const back = backMapperCpu({ geometry: g, oSize: decode, oMap });
    let checked = 0;
    const outside: number[][] = [];
    for (const t of tiles)
      for (let y = t.buf.y; y < t.buf.y + t.buf.h; y += 3)
        for (let x = t.buf.x; x < t.buf.x + t.buf.w; x += 3) {
          const o = back([(x + 0.5) / V.width, (y + 0.5) / V.height]);
          const px = o[0] * decode.width;
          const py = o[1] * decode.height;
          // a window clipped at the decode edge may be passed there (CLAMP_TO_EDGE does the same untiled)
          const inX = (t.win.x === 0 || px >= t.win.x) && (t.win.x + t.win.w === decode.width || px <= t.win.x + t.win.w);
          const inY = (t.win.y === 0 || py >= t.win.y) && (t.win.y + t.win.h === decode.height || py <= t.win.y + t.win.h);
          if (!inX || !inY) outside.push([x, y, px, py]);
          checked++;
        }
    expect(checked).toBeGreaterThan(5000);
    expect(outside.slice(0, 5)).toEqual([]);
  });
});

describe('source retention (S §3.7)', () => {
  const file = (bytes: number) => ({ size: bytes }) as Blob;
  const MiB = 1024 * 1024;
  it('keeps a larger original within 30 MiB when 3× its size is free', async () => {
    const est = (quota: number, usage: number) => async () => ({ quota, usage });
    expect(await shouldKeepSource(file(8 * MiB), { width: 4032, height: 3024 }, 2048, est(1000 * MiB, 100 * MiB))).toBe(true);
    expect(await shouldKeepSource(file(8 * MiB), { width: 2048, height: 1536 }, 2048, est(1000 * MiB, 0))).toBe(false);
    expect(await shouldKeepSource(file(31 * MiB), { width: 8064, height: 6048 }, 2048, est(1000 * MiB, 0))).toBe(false);
    expect(await shouldKeepSource(file(8 * MiB), { width: 4032, height: 3024 }, 2048, est(30 * MiB, 10 * MiB))).toBe(false);
    expect(await shouldKeepSource(file(8 * MiB), null, 2048, est(1000 * MiB, 0))).toBe(false);
  });

  it('without an estimate (missing or throwing) only files ≤ 10 MiB are kept', async () => {
    expect(await shouldKeepSource(file(8 * MiB), { width: 4032, height: 3024 }, 2048, undefined)).toBe(true);
    expect(await shouldKeepSource(file(12 * MiB), { width: 4032, height: 3024 }, 2048, undefined)).toBe(false);
    const boom = async () => {
      throw new Error('no');
    };
    expect(await shouldKeepSource(file(12 * MiB), { width: 4032, height: 3024 }, 2048, boom)).toBe(false);
  });

  it('records the oriented size whenever it exceeds the working edge', () => {
    expect(sourceSizeRecord({ width: 4032, height: 3024 }, 2048)).toEqual({ sourceWidth: 4032, sourceHeight: 3024 });
    expect(sourceSizeRecord({ width: 2000, height: 1500 }, 2048)).toBeNull();
    expect(sourceSizeRecord(null, 2048)).toBeNull();
  });
});
