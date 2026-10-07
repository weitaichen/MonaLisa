import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [preact()],
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'tests/unit/**/*.test.ts',
      // generated-asset checks (LUT layout/lookup math, masks, icons, y4m) live next to T5's tooling
      'tests/harness/t5/**/*.test.mjs',
    ],
    // the asset tests decode full LUT / mask PNGs; give them headroom when run in parallel
    testTimeout: 30000,
  },
});
