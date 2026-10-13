// Export model (step-3 spec §3.7, §4.4): which plan a 儲存 takes (the working-size path of today, or a tiled render of
// the source decoded at up to 4096), the tile planner and the 設定 view of 輸出解析度. Pure: no DOM, no GL.
import type { ExportSize, Prefs, Tier } from '../types';

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
