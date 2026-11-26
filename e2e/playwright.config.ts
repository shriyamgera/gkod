import { defineConfig } from '@playwright/test';

// Runs against the built site (npm run build first), served under /gkod/ as on GitHub Pages.
const PORT = 4318;
const BASE = `http://127.0.0.1:${PORT}/gkod/`;

export default defineConfig({
  testDir: '.',
  timeout: 120_000,
  expect: { timeout: 10_000 },
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: { baseURL: BASE, channel: 'chrome', acceptDownloads: true },
  webServer: {
    command: `npm run preview --workspace app -- --port ${PORT} --strictPort --host 127.0.0.1`,
    cwd: '..',
    url: BASE,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
