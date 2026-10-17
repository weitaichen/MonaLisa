import { describe, expect, it } from 'vitest';
import { formatAdjustBench } from './adjustBench';

describe('調節 bench row text (step-2 spec §6.4)', () => {
  const rows = [
    { config: 'neutral', medianMs: 1.234, adjust: false },
    { config: '調節 ×12', medianMs: 2.5, adjust: true },
    { config: '質感 film', medianMs: 2.25, adjust: true },
  ];

  it('lists each frame (the synthetic bitmap and the camera frame at tier H) with its medians and first-frame overhead, then the compile time and the grain-hash probe', () => {
    const text = formatAdjustBench({
      frames: [
        { label: '合成', size: '1080×1920 → 1080×1920', rows, firstFrameMs: 3.21 },
        { label: '相機 H', size: '640×480 → 1440×1080', rows: rows.map((r) => ({ ...r, medianMs: r.medianMs + 1 })), firstFrameMs: 0.5 },
      ],
      cameraNote: null,
      compileMs: 12.34,
      hash: { checked: 4096, mismatches: 0 },
    });
    expect(text).toContain('調節效能（中位數，含 GPU 完成）');
    expect(text).toContain('合成 1080×1920 → 1080×1920');
    expect(text).toContain('相機 H 640×480 → 1440×1080');
    expect(text).toMatch(/合成[^]*neutral\s+1\.23 ms\n調節 ×12\s+2\.50 ms 調節\n質感 film\s+2\.25 ms 調節\n首幀額外 3\.2 ms/);
    expect(text).toMatch(/相機 H[^]*neutral\s+2\.23 ms\n調節 ×12\s+3\.50 ms 調節\n[^]*首幀額外 0\.5 ms/);
    // the compile is timed on its own (a fresh context), not folded into the first 調節 frame
    expect(text).toContain('編譯 12.3 ms（獨立 context，冷）');
    expect(text).toContain('顆粒雜湊 4096/4096 一致');
  });

  it('says why the camera rows are missing', () => {
    const text = formatAdjustBench({
      frames: [{ label: '合成', size: '1080×1920 → 1080×1920', rows, firstFrameMs: 3 }],
      cameraNote: '未開相機（先按「開始」）',
      compileMs: 10,
      hash: { checked: 4096, mismatches: 0 },
    });
    expect(text).toContain('相機 H：未開相機（先按「開始」）');
  });
});
