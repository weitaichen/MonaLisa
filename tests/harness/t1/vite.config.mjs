// Harness-only Vite config: serve the repo root without HMR / file watching, so concurrent edits by
// other tasks do not reload the page mid-run.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  root: fileURLToPath(new URL('../../..', import.meta.url)),
  server: { hmr: false, watch: null },
  logLevel: 'warn',
});
