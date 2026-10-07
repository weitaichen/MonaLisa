// E2E (spec §10): Chromium with a fake front camera fed by tests/fixtures/face.y4m, an iPhone-sized
// touch viewport, the production build served by `vite preview` (with vercel.json's CSP), plus the
// dev server for the engine render-check page that imports src/ directly.
import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

const y4m = resolve(import.meta.dirname, 'tests/fixtures/face.y4m');
const APP_URL = 'http://127.0.0.1:4173';
const DEV_URL = 'http://127.0.0.1:5190';

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  globalSetup: './tests/e2e/global-setup.ts',
  // SwiftShader renders WebGL and runs MediaPipe on the CPU: one worker keeps frame rates sane
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: APP_URL,
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
    locale: 'zh-TW',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        browserName: 'chromium',
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-video-capture=${y4m}`,
            // headless has no GPU here: let WebGL2 (engine + MediaPipe GPU delegate) run on SwiftShader
            '--enable-unsafe-swiftshader',
          ],
        },
      },
    },
  ],
  webServer: [
    {
      command: 'npx vite preview --port 4173 --strictPort --host 127.0.0.1',
      url: APP_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npx vite --port 5190 --strictPort --host 127.0.0.1',
      url: `${DEV_URL}/tests/e2e/pages/engine.html`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
