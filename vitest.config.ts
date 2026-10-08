import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import preact from '@preact/preset-vite';
import { defineConfig } from 'vitest/config';

// same build-time constant as vite.config.ts (src/version.ts)
const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string };

export default defineConfig({
  plugins: [preact()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
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
