import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import preact from '@preact/preset-vite';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

interface VercelHeaders {
  headers?: { source: string; headers: { key: string; value: string }[] }[];
}

/** The site-wide security headers from vercel.json (CSP etc.), so `vite preview` and the e2e suite run under the production policy. */
function siteHeaders(): Record<string, string> {
  const cfg = JSON.parse(readFileSync(resolve(import.meta.dirname, 'vercel.json'), 'utf8')) as VercelHeaders;
  const all = cfg.headers?.find((h) => h.source === '/(.*)');
  return Object.fromEntries((all?.headers ?? []).map((h) => [h.key, h.value]));
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
    VitePWA({
      registerType: 'autoUpdate',
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
        // injectRegister:false means vite-plugin-pwa does not set this for 'autoUpdate': without it the first
        // session (incl. a fresh Home Screen install) stays uncontrolled and the engine download skips the
        // CacheFirst route. skipWaiting stays off on purpose: an update applies on the next cold launch and
        // never reloads the page mid-capture.
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
  server: { host: true },
  preview: { headers: siteHeaders() },
});
