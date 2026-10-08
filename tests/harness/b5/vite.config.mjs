// Harness-only dev server: the app's own vite.config.ts, but with no HMR / file watching so
// concurrent edits by other tasks never reload a page mid-screenshot.
import { resolve } from 'node:path';
import { defineConfig, loadConfigFromFile, mergeConfig } from 'vite';

const root = resolve(import.meta.dirname, '../../..');

export default defineConfig(async (env) => {
  const loaded = await loadConfigFromFile(env, resolve(root, 'vite.config.ts'), root);
  return mergeConfig(loaded?.config ?? {}, { root, server: { host: 'localhost', hmr: false, watch: null } });
});
