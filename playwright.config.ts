import process from 'node:process'
import { defineConfig } from '@playwright/test'

const apiPort = process.env.TBOX_TEST_API_PORT || '13000'
const appPort = process.env.TBOX_TEST_APP_PORT || '15173'
const adminPort = process.env.TBOX_TEST_ADMIN_PORT || '15175'

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${appPort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1280, height: 800 } } },
    { name: 'mobile', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: [
    {
      command: 'pnpm --filter @t-box/api start',
      url: `http://127.0.0.1:${apiPort}/api/v1/health`,
      env: { TASK_WORKER_MODE: 'disabled', HOST: '127.0.0.1', PORT: apiPort, ADMIN_ORIGINS: `http://127.0.0.1:${adminPort}`, CORS_ORIGINS: `http://127.0.0.1:${appPort}` },
      reuseExistingServer: false,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 },
    },
    {
      command: `pnpm --filter @t-box/admin preview --outDir ../output/playwright/static/admin --host 127.0.0.1 --port ${adminPort} --strictPort`,
      url: `http://127.0.0.1:${adminPort}`,
      reuseExistingServer: false,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    },
    {
      command: `pnpm --filter @t-box/app preview --outDir ../output/playwright/static/app --host 127.0.0.1 --port ${appPort} --strictPort`,
      url: `http://127.0.0.1:${appPort}`,
      reuseExistingServer: false,
      gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
    },
  ],
})
