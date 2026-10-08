// node tests/harness/b1/dbg.mjs '<js expression using probe/worstCells>'
import { createServer } from 'vite';
const server = await createServer({
  root: new URL('../../../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'),
  configFile: false, logLevel: 'silent', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const mod = await server.ssrLoadModule('/tests/harness/b1/debug.ts');
  const fn = new Function('m', `with (m) { return (${process.argv[2]}); }`);
  console.log(JSON.stringify(fn(mod), null, 1));
} finally { await server.close(); }
