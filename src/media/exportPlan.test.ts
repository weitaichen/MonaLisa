import { describe, expect, it } from 'vitest';
import { exportSizeView, fullExportBlock, isSeClassScreen, type ExportEnv } from './exportPlan';

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
