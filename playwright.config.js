import { defineConfig } from '@playwright/test';

// End-to-end tests against the production build (`npm run build` first).
// PW_CHROMIUM_PATH lets a sandbox without Playwright's own browser point at a local Chromium.
export default defineConfig({
  testDir: 'test/e2e',
  timeout: 120_000,
  workers: 1,
  use: {
    baseURL: 'http://localhost:4173/PinyinLens/',
    browserName: 'chromium',
    launchOptions: {
      executablePath: process.env.PW_CHROMIUM_PATH || undefined,
      args: ['--no-proxy-server', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    },
  },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/PinyinLens/',
    reuseExistingServer: !process.env.CI,
  },
});
