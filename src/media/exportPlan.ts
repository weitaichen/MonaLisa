// Export model (step-3 spec §3.7, §4.4): which plan a 儲存 takes (the working-size path of today, or a tiled render of
// the source decoded at up to 4096), the tile planner and the 設定 view of 輸出解析度. Pure: no DOM, no GL.
import { FULL_EXPORT_MAX_EDGE, GL_TILE_BUDGET_MB, SOURCE_MAX_MB } from '../config/limits';
import { displacementBound, reshapeActive, reshapeGeometry, reshapeUniforms } from '../engine/passes/reshape';
import { MEAN_REFERENCE_SHORT_EDGE } from '../engine/uniforms';
import { apply, snapCrop, viewSize, vToO } from '../geometry/view';
import type { ExportDebugKnob } from '../store/settings';
import type { BodyField, ExportFormat, ExportSize, Geometry, Prefs, PxRect, Rect, RenderFace, Size, Tier } from '../types';
import { FULL_JPEG_QUALITY, JPEG_QUALITY } from './exporter';
import { fitLongEdge } from './importer';

export type { ExportFormat, ExportSize } from '../types';

export type FullBlock = 'tierL' | 'tierLow' | 'device' | 'guard' | null;

export interface ExportEnv {
  prefTier: Prefs['tier'];
  /** the tier the live loop settled on this session (autoTierSession) */
  autoTier: Tier;
  screen: { width: number; height: number };
  /** meiyan.exportCap.v1 is set (a full export died earlier) */
  capped: boolean;
}

export const EXPORT_COPY = {
  overlay: '正在輸出原始解析度…',
  cancel: '取消',
  shareReady: '已準備好，點一下分享',
  fallback: '已改用標準解析度輸出',
  breadcrumb: '上次以原始解析度輸出時程式中止，已改用標準解析度',
  noSource: '此照片只保留了 2048 解析度',
  interrupted: '輸出已中斷，請再按一次「儲存」',
  sizeNote: '原始解析度：最長邊最多 4096 像素',
  device: '此裝置記憶體不足，改用標準解析度',
  tierLow: '畫質設為「低」時使用標準解析度',
  guard: '上次以原始解析度輸出時程式中止，已改用標準解析度。再選一次「原始解析度」即可重試',
  jpegSub: '檔案較小，適合分享',
  pngSub: 'PNG 檔案較大，約為 JPEG 的 3–5 倍',
} as const;

/** iPhone SE class (375 × 667 pt) in either orientation: always 標準 (C §6.2) */
export function isSeClassScreen(s: { width: number; height: number }): boolean {
  return Math.min(s.width, s.height) === 375 && Math.max(s.width, s.height) === 667;
}

export function fullExportBlock(env: ExportEnv): FullBlock {
  if (env.prefTier === 'L') return 'tierLow';
  if (env.prefTier === 'auto' && env.autoTier === 'L') return 'tierL';
  if (isSeClassScreen(env.screen)) return 'device';
  if (env.capped) return 'guard';
  return null;
}

export interface ExportSizeView {
  /** the effective choice the segmented control shows */
  value: ExportSize;
  /** 原始解析度 cannot be picked here */
  fullDisabled: boolean;
  sub: string;
}

export function exportSizeView(pref: ExportSize, block: FullBlock): ExportSizeView {
  if (block === 'tierL' || block === 'device') return { value: 'standard', fullDisabled: true, sub: EXPORT_COPY.device };
  if (block === 'tierLow') return { value: 'standard', fullDisabled: true, sub: EXPORT_COPY.tierLow };
  if (block === 'guard') return { value: 'standard', fullDisabled: false, sub: EXPORT_COPY.guard };
  return { value: pref, fullDisabled: false, sub: EXPORT_COPY.sizeNote };
}

export interface SourceInfo {
  /**
   * the file to export from: on reopen HistoryEntry.source; in the first session the picked File, only once
   * shouldKeepSource accepted it (the first session and every reopen export the same); null = none
   */
  blob: Blob | null;
  /** oriented size from the import probe; null = unknown (v1 entries, camera shots) */
  width: number | null;
  height: number | null;
}

export const NO_SOURCE: SourceInfo = { blob: null, width: null, height: null };

export interface TileJob {
  /** V output pixels this tile writes (the tiles partition V) */
  out: PxRect;
  /** V pixels the GPU buffers cover: out ⊕ apron, snapped outward to multiples of 4, then clipped to V */
  buf: PxRect;
  /** decode pixels the source crop covers: bbox(Geo⁻¹(buf)) ⊕ displacement bound ⊕ 4, snapped to 4, then clipped */
  win: PxRect;
}

export interface ExportPlan {
  mode: 'working' | 'tiled';
  format: ExportFormat;
  /** JPEG only: 0.95 when the size pref is 'full' (whatever the mode), 0.92 for 'standard' */
  quality: number;
  /** V output size in pixels */
  width: number;
  height: number;
  /** 'tiled': the size the source is decoded at */
  decode: Size | null;
  /** O short edge in output pixels (kernel scale, C §3.5) */
  fullShortEdge: number;
  tile: number;
  tiles: TileJob[];
  /** why the plan is 'working' while the size pref is 'full'; null otherwise */
  fallback: 'noSource' | 'notLarger' | FullBlock;
}

export interface FaceBound {
  /** the face's influence box (UV, reshapeGeometry().box) */
  box: readonly [number, number, number, number];
  /** displacementBound: iso units (fractions of the O width) */
  bound: number;
}

export interface TileBounds {
  /** the O-space body field (UV vectors); null = none */
  body: BodyField | null;
  /** every face with an active warp */
  faces: readonly FaceBound[];
  /** step 6: the liquify model's max |L| over an O rect, UV; absent = no strokes */
  liquifyMaxDisp?: (rectO: Rect) => number;
  /** step 4: grows an O-normalized window around the spots (and donors) that meet it; absent = identity */
  spotWindowGrowth?: (winO: Rect) => Rect;
  /** step 4: an O-space pass holds B at window size, so the GL budget is (3·win² + 2·buf²)·4 B */
  oSpacePasses?: boolean;
}

export interface TileGrid {
  /** V output size */
  V: Size;
  /** decode size of the source */
  decode: Size;
  /** the geometry snapped to the decode grid (snapCrop) */
  geometry: Geometry;
  /** the working bitmap's aspect (S §4.1 oAspect) */
  oAspect: number;
  fullShortEdge: number;
}

export const TILE_SIZES = [2048, 1024, 512, 256] as const;

const floor4 = (n: number) => Math.floor(n / 4) * 4;
const ceil4 = (n: number) => Math.ceil(n / 4) * 4;

/** the mean's reach per axis is 14·k (3.5 × 4·k), each pass's bilinear tap adds ≤ 1 px; sharpen lies inside (S D11) */
export function apronFor(fullShortEdge: number): number {
  const k = fullShortEdge / MEAN_REFERENCE_SHORT_EDGE;
  return ceil4(Math.ceil(14 * k) + 2);
}

/** the largest body-field texel, in decode pixels (a bilinear field never exceeds its largest texel) */
export function bodyMaxDispPx(field: BodyField | null, decode: Size): number {
  if (!field) return 0;
  let m = 0;
  for (let i = 0; i + 1 < field.data.length; i += 2) m = Math.max(m, Math.hypot(field.data[i] * decode.width, field.data[i + 1] * decode.height));
  return m;
}

/** |tc − o| ≤ L + B + Σ F_f over the faces near the tile's O rect (S §4.4), in decode pixels */
function displacementPx(rectO: Rect, bounds: TileBounds, decode: Size, oAspect: number, bodyPx: number): number {
  const L = bounds.liquifyMaxDisp ? bounds.liquifyMaxDisp(rectO) * Math.max(decode.width, decode.height) : 0;
  const reach = L + bodyPx;
  const gx = reach / decode.width;
  const gy = reach / decode.height;
  let F = 0;
  for (const f of bounds.faces) {
    const fx = f.bound;
    const fy = f.bound * oAspect; // iso y = UV y / aspect
    const near =
      f.box[0] - fx <= rectO.x + rectO.w + gx &&
      f.box[2] + fx >= rectO.x - gx &&
      f.box[1] - fy <= rectO.y + rectO.h + gy &&
      f.box[3] + fy >= rectO.y - gy;
    if (near) F += f.bound * decode.width;
  }
  return L + bodyPx + F;
}

export function planTiles(grid: TileGrid, bounds: TileBounds, T: number): TileJob[] {
  const { V, decode } = grid;
  const apron = apronFor(grid.fullShortEdge);
  const m = vToO(grid.geometry, { width: grid.oAspect, height: 1 });
  const bodyPx = bodyMaxDispPx(bounds.body, decode);
  const tiles: TileJob[] = [];
  for (let y = 0; y < V.height; y += T) {
    for (let x = 0; x < V.width; x += T) {
      const out: PxRect = { x, y, w: Math.min(T, V.width - x), h: Math.min(T, V.height - y) };
      const bx0 = Math.max(0, floor4(out.x - apron));
      const by0 = Math.max(0, floor4(out.y - apron));
      const bx1 = Math.min(V.width, ceil4(out.x + out.w + apron));
      const by1 = Math.min(V.height, ceil4(out.y + out.h + apron));
      const buf: PxRect = { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 };
      let ox0 = Infinity;
      let oy0 = Infinity;
      let ox1 = -Infinity;
      let oy1 = -Infinity;
      for (const [px, py] of [[bx0, by0], [bx1, by0], [bx0, by1], [bx1, by1]]) {
        const [ox, oy] = apply(m, [px / V.width, py / V.height]);
        ox0 = Math.min(ox0, ox);
        oy0 = Math.min(oy0, oy);
        ox1 = Math.max(ox1, ox);
        oy1 = Math.max(oy1, oy);
      }
      const rectO: Rect = { x: ox0, y: oy0, w: ox1 - ox0, h: oy1 - oy0 };
      const pad = displacementPx(rectO, bounds, decode, grid.oAspect, bodyPx) + 4;
      let winO: Rect = {
        x: ox0 - pad / decode.width,
        y: oy0 - pad / decode.height,
        w: rectO.w + (2 * pad) / decode.width,
        h: rectO.h + (2 * pad) / decode.height,
      };
      if (bounds.spotWindowGrowth) winO = bounds.spotWindowGrowth(winO);
      const wx0 = Math.max(0, floor4(winO.x * decode.width));
      const wy0 = Math.max(0, floor4(winO.y * decode.height));
      const wx1 = Math.min(decode.width, ceil4((winO.x + winO.w) * decode.width));
      const wy1 = Math.min(decode.height, ceil4((winO.y + winO.h) * decode.height));
      tiles.push({ out, buf, win: { x: wx0, y: wy0, w: Math.max(1, wx1 - wx0), h: Math.max(1, wy1 - wy0) } });
    }
  }
  return tiles;
}

/** GL bytes of a tile: src and A at window size, B, C and D at buffer size (step 4: B at window size too) */
export function tileBytes(t: TileJob, oSpace: boolean): number {
  const win = t.win.w * t.win.h;
  const buf = t.buf.w * t.buf.h;
  return (oSpace ? 3 * win + 2 * buf : 2 * win + 3 * buf) * 4;
}

/** the largest TILE whose worst tile fits the GL budget (S D9); 256 when none does */
export function chooseTile(grid: TileGrid, bounds: TileBounds, budgetBytes = GL_TILE_BUDGET_MB * 1024 * 1024): { tile: number; tiles: TileJob[] } {
  for (const T of TILE_SIZES) {
    const tiles = planTiles(grid, bounds, T);
    if (tiles.every((t) => tileBytes(t, !!bounds.oSpacePasses) <= budgetBytes)) return { tile: T, tiles };
  }
  return { tile: 256, tiles: planTiles(grid, bounds, 256) };
}

/** the faces whose warps the tile windows must cover (P2 draws only weight > 0 faces with an active warp) */
export function faceBoundsFor(faces: readonly RenderFace[], oAspect: number): FaceBound[] {
  const out: FaceBound[] = [];
  for (const f of faces) {
    if (!(f.weight > 0)) continue;
    // as the engine's job(): the person's shape.* values at the face weight (warpScale ≤ 1 and the caps only shrink moves)
    const u = reshapeUniforms(f.person.values, f.weight);
    if (!reshapeActive(u)) continue;
    out.push({ box: reshapeGeometry(f.face, oAspect, u).box, bound: displacementBound(f.face, oAspect, u) });
  }
  return out;
}

export function planExport(
  edit: { photo: { geometry: Geometry } },
  prefs: Pick<Prefs, 'exportFormat' | 'exportSize'>,
  source: SourceInfo,
  working: Size,
  env: ExportEnv,
  bounds: TileBounds,
  knob: ExportDebugKnob = {},
): ExportPlan {
  const g = edit.photo.geometry;
  const format = prefs.exportFormat;
  const quality = format === 'jpeg' ? (prefs.exportSize === 'full' ? FULL_JPEG_QUALITY : JPEG_QUALITY) : 1;
  const workingPlan = (fallback: ExportPlan['fallback']): ExportPlan => {
    const v = viewSize(snapCrop(g, working), working);
    return { mode: 'working', format, quality, width: v.width, height: v.height, decode: null, fullShortEdge: Math.min(working.width, working.height), tile: 0, tiles: [], fallback };
  };
  if (prefs.exportSize === 'standard') return workingPlan(null);
  const block = fullExportBlock(env);
  if (block) return workingPlan(block);
  const sw = source.width ?? 0;
  const sh = source.height ?? 0;
  if (!source.blob || !(sw > 0 && sh > 0)) return workingPlan('noSource');
  if (Math.max(sw, sh) <= Math.max(working.width, working.height)) return workingPlan('notLarger');
  const decode = fitLongEdge(sw, sh, FULL_EXPORT_MAX_EDGE);
  const gs = snapCrop(g, decode);
  const V = viewSize(gs, decode);
  const fullShortEdge = Math.min(decode.width, decode.height);
  const grid: TileGrid = { V, decode, geometry: gs, oAspect: working.width / working.height, fullShortEdge };
  const { tile, tiles } = knob.tile ? { tile: knob.tile, tiles: planTiles(grid, bounds, knob.tile) } : chooseTile(grid, bounds);
  return { mode: 'tiled', format, quality, width: V.width, height: V.height, decode, fullShortEdge, tile, tiles, fallback: null };
}

export interface StorageEstimateLike {
  quota?: number;
  usage?: number;
}

function defaultEstimate(): (() => Promise<StorageEstimateLike>) | undefined {
  const s = typeof navigator !== 'undefined' ? navigator.storage : undefined;
  return s && typeof s.estimate === 'function' ? () => s.estimate() : undefined;
}

/** keep the picked file? (S §3.7): larger than the working copy, ≤ 30 MiB, and 3× its size free (unknown → ≤ 10 MiB) */
export async function shouldKeepSource(
  file: Blob,
  probed: Size | null,
  workingLong: number,
  estimate: (() => Promise<StorageEstimateLike>) | undefined = defaultEstimate(),
): Promise<boolean> {
  if (!probed || Math.max(probed.width, probed.height) <= workingLong) return false;
  const MiB = 1024 * 1024;
  if (file.size > SOURCE_MAX_MB * MiB) return false;
  try {
    if (!estimate) throw new Error('no storage estimate');
    const e = await estimate();
    if (typeof e.quota !== 'number' || typeof e.usage !== 'number') throw new Error('incomplete storage estimate');
    return e.quota - e.usage >= 3 * file.size;
  } catch {
    return file.size <= 10 * MiB;
  }
}

/** HistoryEntry.sourceWidth/Height: recorded whenever the original exceeded the working edge (the "only 2048 kept" note) */
export function sourceSizeRecord(probed: Size | null, workingLong: number): { sourceWidth: number; sourceHeight: number } | null {
  if (!probed || Math.max(probed.width, probed.height) <= workingLong) return null;
  return { sourceWidth: probed.width, sourceHeight: probed.height };
}
