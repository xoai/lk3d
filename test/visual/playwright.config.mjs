// The image tests: every reference scene drawn in each look, in Chromium, Firefox and WebKit, compared with stored
// pictures. Pictures differ between platforms (GPU, fonts), so each platform keeps its own:
// baselines/<browser>-<platform>/. Make or refresh them with `npm run test:visual -- --update-snapshots`.
import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';
// Playwright's WebKit for macOS 14 is frozen at an old build that this Playwright cannot drive: there, WebKit runs in
// CI (Linux) only. Everywhere else all three browsers run.
const oldMac = process.platform === 'darwin' && +os.release().split('.')[0] < 24;
export default defineConfig({
  testDir: '.',
  testMatch: ['images.spec.mjs', 'api.spec.mjs', 'quality.spec.mjs', 'playground.spec.mjs'],
  snapshotPathTemplate: '{testDir}/baselines/{projectName}-{platform}/{arg}{ext}',
  timeout: 120_000,
  workers: 4,
  reporter: [['list']],
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.002, threshold: 0.02, animations: 'disabled' } },
  use: { baseURL: 'http://localhost:4173', viewport: { width: 520, height: 420 }, deviceScaleFactor: 1 },
  webServer: {
    command: 'node serve.mjs',
    url: 'http://localhost:4173/test/visual/index.html',
    reuseExistingServer: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 520, height: 420 }, deviceScaleFactor: 1 },
    },
    {
      name: 'firefox',
      use: {
        ...devices['Desktop Firefox'],
        viewport: { width: 520, height: 420 },
        deviceScaleFactor: 1,
        // headless Firefox on Linux (CI) has no WebGL, and lk3d would draw in 2D: there it runs with a window, on the
        // virtual display the workflow gives it (xvfb-run), drawing WebGL in software (Mesa)
        headless: !(process.platform === 'linux' && process.env.CI),
        launchOptions: { firefoxUserPrefs: { 'webgl.force-enabled': true } },
      },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], viewport: { width: 520, height: 420 }, deviceScaleFactor: 1 },
    },
  ].filter((p) => !(oldMac && p.name === 'webkit')),
});
