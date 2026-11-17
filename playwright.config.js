import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests: production build of the app + the real GuestDesk.gs running
 * in the local emulator. Use your own export with: E2E_XLSX=./All_Guest.xlsx npm run test:e2e
 * If Playwright's browser isn't installed: npx playwright install chromium
 * (or point CHROME_PATH at any Chromium/Chrome binary).
 */
const xlsx = process.env.E2E_XLSX ? ` --xlsx "${process.env.E2E_XLSX}"` : '';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4174',
    ...devices['Pixel 7'],
    launchOptions: process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {},
  },
  webServer: [
    { command: `node emulator/server.js --port 8787${xlsx}`, url: 'http://localhost:8787', reuseExistingServer: false, timeout: 60_000 },
    { command: 'npx vite build --mode e2e && npx vite preview --mode e2e --outDir dist-e2e --port 4174 --strictPort', url: 'http://localhost:4174', reuseExistingServer: false, timeout: 120_000 },
  ],
});
