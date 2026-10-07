// Runs T5's asset tests (they live outside the root vitest `include`):
//   npx vitest run -c tests/harness/t5/vitest.config.mjs
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: fileURLToPath(new URL('../../..', import.meta.url)),
  test: {
    environment: 'node',
    include: ['tests/harness/t5/**/*.test.mjs'],
    testTimeout: 180000,
  },
});
