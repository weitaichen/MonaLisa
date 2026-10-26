// E2E (spec §10): Chromium with a fake front camera fed by tests/fixtures/face.y4m, an iPhone-sized
// touch viewport, the production build served by `vite preview` (with vercel.json's CSP), plus the
// dev server for the engine render-check page that imports src/ directly.
import { resolve } from 'node:path';
import { defineConfig } from '@playwright/test';

const y4m = resolve(import.meta.dirname, 'tests/fixtures/face.y4m');
// three faces (gen-y4m composeGroupCam): the chromium-group project runs camera-group.spec.ts on it
const groupY4m = resolve(import.meta.dirname, 'tests/fixtures/group.y4m');
const APP_URL = 'http://127.0.0.1:4173';
const DEV_URL = 'http://127.0.0.1:5190';

/** a Chromium project whose fake camera plays `clip` (tests/fixtures/, made by global-setup.ts) */
const fakeCamera = (clip: string) => ({
  browserName: 'chromium' as const,
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${resolve(import.meta.dirname, 'tests/fixtures', clip)}`,
      '--enable-unsafe-swiftshader',
    ],
  },
});

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
      // the multi-face camera specs run on their own clips (projects below)
      testIgnore: /camera-(group|persons|groups|back|identity)\.spec\.ts/,
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
    {
      name: 'chromium-group',
      testMatch: /camera-(group|persons)\.spec\.ts/,
      use: {
        browserName: 'chromium',
        launchOptions: {
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            `--use-file-for-fake-video-capture=${groupY4m}`,
            '--enable-unsafe-swiftshader',
          ],
        },
      },
    },
    // camera per-person spec §12.2-§12.3: one project per clip. E4 (camera-groups.spec.ts) on the upright 1080×1920
    // clips, each project running the tests tagged for its clip
    { name: 'chromium-upright-row3', testMatch: 'camera-groups.spec.ts', grep: /@row3/, use: fakeCamera('upright_row3.y4m') },
    { name: 'chromium-upright-far10', testMatch: 'camera-groups.spec.ts', grep: /@far10/, use: fakeCamera('upright_far10.y4m') },
    { name: 'chromium-upright-behind', testMatch: 'camera-groups.spec.ts', grep: /@behind/, use: fakeCamera('upright_behind.y4m') },
    { name: 'chromium-selfie-group', testMatch: 'camera-groups.spec.ts', grep: /@selfie/, use: fakeCamera('selfie_group.y4m') },
    // E4b, the landscape ten-face regression (K20)
    { name: 'chromium-group10', testMatch: 'camera-back.spec.ts', use: fakeCamera('group10.y4m') },
    // E5, identity through absences and a swap (the 18 s group_move timeline)
    { name: 'chromium-group-move', testMatch: 'camera-identity.spec.ts', use: fakeCamera('group_move.y4m') },
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
