// Runs the B1 CPU visual proofs: `node tests/harness/b1/run.mjs [scene-filter...]` → tests/harness/b1/out/*.png.
// Uses Vite's SSR loader (no dev server / port needed) so the TypeScript sources load unchanged.
import { createServer } from 'vite';

const server = await createServer({
  root: new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  configFile: false,
  logLevel: 'error',
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
});
try {
  const mod = await server.ssrLoadModule('/tests/harness/b1/render.ts');
  const only = process.argv.slice(2);
  const rows = mod.render(only.length ? only : undefined);
  console.table(rows);
  const bad = rows.filter((r) => r.minDet <= 0.3);
  if (bad.length) console.log('FOLD RISK:', bad);
} finally {
  await server.close();
}
