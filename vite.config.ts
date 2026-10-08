import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import preact from '@preact/preset-vite';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

interface VercelHeaders {
  headers?: { source: string; headers: { key: string; value: string }[] }[];
}

function vercelHeaders(): NonNullable<VercelHeaders['headers']> {
  return (JSON.parse(readFileSync(resolve(import.meta.dirname, 'vercel.json'), 'utf8')) as VercelHeaders).headers ?? [];
}

/** The site-wide security headers from vercel.json (CSP etc.), so `vite preview` and the e2e suite run under the production policy. */
function siteHeaders(): Record<string, string> {
  const all = vercelHeaders().find((h) => h.source === '/(.*)');
  return Object.fromEntries((all?.headers ?? []).map((h) => [h.key, h.value]));
}

/** vercel.json's single-file rules (/sw.js, /version.json: no-cache) applied by `vite preview` too. */
function previewFileHeaders(): Plugin {
  const exact = new Map(vercelHeaders().filter((h) => !/[()*:\\]/.test(h.source)).map((h) => [h.source, h.headers]));
  return {
    name: 'meiyan-preview-file-headers',
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        for (const h of exact.get(path) ?? []) res.setHeader(h.key, h.value);
        next();
      });
    },
  };
}

/**
 * The app version, single source: package.json. MEIYAN_VERSION overrides it only for the update e2e
 * (tests/e2e/update.spec.ts builds a "newer" copy of the app); a Vercel build never honours it.
 */
function appVersion(): string {
  const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string };
  const override = process.env.VERCEL ? undefined : process.env.MEIYAN_VERSION;
  const v = override || pkg.version;
  if (!/^\d+\.\d+\.\d+$/.test(v)) throw new Error(`app version must be x.y.z, got "${v}"`);
  return v;
}
const APP_VERSION = appVersion();

/**
 * /version.json: the deployed version, read by a page whose service worker found an update so the banner can
 * say which one (src/ui/update.ts). Not precached (workbox globPatterns has no json) and served no-cache.
 */
function emitVersion(): Plugin {
  return {
    name: 'meiyan-emit-version',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify({ version: APP_VERSION })}\n` });
    },
  };
}

/**
 * Ship the license / notice texts with the deployed site as /licenses/*.txt (Apache-2.0 §4(a), BSD-3 clause 2,
 * MIT). LICENSES/ at the repo root stays the source of truth; the app also shows them in 關於與授權.
 */
function emitLicenses(): Plugin {
  return {
    name: 'meiyan-emit-licenses',
    apply: 'build',
    generateBundle() {
      const dir = resolve(import.meta.dirname, 'LICENSES');
      for (const f of readdirSync(dir).filter((n) => n.endsWith('.txt'))) {
        this.emitFile({ type: 'asset', fileName: `licenses/${f}`, source: readFileSync(resolve(dir, f)) });
      }
    },
  };
}

export default defineConfig({
  plugins: [
    preact(),
    emitLicenses(),
    emitVersion(),
    previewFileHeaders(),
    VitePWA({
      // 'prompt': a new version waits until the user taps 更新 in the 有新版本 banner (src/ui/update.ts)
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        id: '/',
        name: 'MonaLisa 美顏',
        short_name: 'MonaLisa',
        description: '在手機上即時美顏與修圖，所有處理都在裝置上完成。',
        lang: 'zh-Hant',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        // Android Chrome honours this for installed PWAs; iOS ignores it (RB §1 #11), so theme.css has the CSS lock
        orientation: 'portrait',
        background_color: '#000000',
        theme_color: '#000000',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        // public/ PNGs (icons, LUTs, makeup) are matched here; includeAssets would list them twice
        globIgnores: ['mediapipe/**', 'models/**', 'bench.html', 'assets/bench-*.js'],
        navigateFallback: '/index.html',
        // /licenses/*.txt must reach the network, not the app shell
        navigateFallbackDenylist: [/^\/bench/, /^\/licenses\//],
        // without it the first session (incl. a fresh Home Screen install) stays uncontrolled and the engine
        // download skips the CacheFirst route. skipWaiting stays off on purpose: a new version waits until the
        // user taps 更新 (only offered on 首頁 / 設定) or the next cold launch, and never reloads mid-capture.
        clientsClaim: true,
        runtimeCaching: [
          {
            // versioned paths → safe to cache forever. cacheName must equal ENGINE_CACHE in src/engine/assets.ts:
            // an uncontrolled page stashes the binaries there itself and prunes older versions.
            urlPattern: ({ url }) => url.pathname.startsWith('/mediapipe/') || url.pathname.startsWith('/models/'),
            handler: 'CacheFirst',
            options: { cacheName: 'meiyan-engine-v1', cacheableResponse: { statuses: [200] } },
          },
        ],
      },
    }),
  ],
  build: {
    target: 'safari16',
    rollupOptions: {
      input: { main: resolve(import.meta.dirname, 'index.html'), bench: resolve(import.meta.dirname, 'bench.html') },
    },
  },
  define: { __APP_VERSION__: JSON.stringify(APP_VERSION) },
  server: { host: true },
  preview: { headers: siteHeaders() },
});
