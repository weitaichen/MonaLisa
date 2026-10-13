import { describe, expect, it } from 'vitest';
import { formatAdjustBench } from './adjustBench';

describe('調節 bench row text (step-2 spec §6.4)', () => {
  it('lists each configuration with its median, the compile time and the grain-hash probe', () => {
    const text = formatAdjustBench({
      size: '1080×1920',
      rows: [
        { config: 'neutral', medianMs: 1.234, adjust: false },
        { config: '調節 ×12', medianMs: 2.5, adjust: true },
        { config: '質感 film', medianMs: 2.25, adjust: true },
      ],
      compileMs: 12.34,
      hash: { checked: 4096, mismatches: 0 },
    });
    expect(text).toContain('調節效能 1080×1920');
    expect(text).toMatch(/neutral\s+1\.23 ms\n/);
    expect(text).toMatch(/調節 ×12\s+2\.50 ms 調節\n/);
    expect(text).toContain('編譯 12.3 ms');
    expect(text).toContain('顆粒雜湊 4096/4096 一致');
  });
});
