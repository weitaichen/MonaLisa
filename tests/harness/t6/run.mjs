// Runs the T6 store harness in headless Chromium against real localStorage + IndexedDB.
// usage: node tests/harness/t6/run.mjs   (serves the repo with Vite on :5186, stops it afterwards)
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

const PORT = 5186;
const root = fileURLToPath(new URL('../../../', import.meta.url));
const page = (host, phase) => `http://${host}:${PORT}/tests/harness/t6/index.html?phase=${phase}`;

function lanIp() {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return null;
}

async function runPhase(p, url) {
  await p.goto(url);
  await p.waitForFunction(() => window.__t6?.done === true, null, { timeout: 60_000 });
  return p.evaluate(() => window.__t6);
}

const server = await createServer({ root, configFile: `${root}vite.config.ts`, server: { port: PORT, strictPort: true, host: true }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch();
const results = [];
let failed = 0;
try {
  const ctx = await browser.newContext();
  const a = await ctx.newPage();
  const errors = [];
  a.on('pageerror', (e) => errors.push(String(e)));
  a.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

  results.push(await runPhase(a, page('localhost', 'write')));
  // a new document load: everything must come back from persistent storage
  results.push(await runPhase(a, page('localhost', 'read'))); // page a keeps its connection open

  const b = await ctx.newPage();
  results.push(await runPhase(b, page('localhost', 'upgrade')));
  await ctx.close();

  // storage getters throwing (Lockdown / blocked site data)
  const blockedCtx = await browser.newContext();
  await blockedCtx.addInitScript(() => {
    for (const name of ['localStorage', 'indexedDB']) {
      Object.defineProperty(window, name, {
        configurable: true,
        get() {
          throw new DOMException(`${name} blocked`, 'SecurityError');
        },
      });
    }
  });
  results.push(await runPhase(await blockedCtx.newPage(), page('localhost', 'blocked')));
  await blockedCtx.close();

  // plain-http LAN origin → insecure context → no crypto.randomUUID
  const ip = lanIp();
  if (ip) {
    const insecureCtx = await browser.newContext();
    results.push(await runPhase(await insecureCtx.newPage(), page(ip, 'insecure')));
    await insecureCtx.close();
  } else {
    results.push({ phase: 'insecure', done: true, checks: [], timings: {}, error: 'skipped: no LAN IPv4 address' });
  }

  for (const r of results) {
    console.log(`\n== phase ${r.phase} ==`);
    for (const c of r.checks) {
      if (!c.ok) failed++;
      console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail && !c.ok ? `  (${c.detail})` : ''}`);
    }
    for (const [k, v] of Object.entries(r.timings)) console.log(`      ${k}: ${v}`);
    if (r.error) {
      failed++;
      console.log(`ERROR ${r.error}`);
    }
  }
  if (errors.length) {
    failed += errors.length;
    console.log('\npage errors:', errors);
  }
} finally {
  await browser.close();
  await server.close();
}
console.log(`\n${failed === 0 ? 'ALL PASS' : `${failed} FAILURE(S)`}`);
process.exit(failed === 0 ? 0 : 1);
