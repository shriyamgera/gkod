import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

// The same test files run twice: in Node, and in a real Chrome, the way the site's compile worker runs the checks.
const include = ['test/**/*.test.ts'];

export default defineConfig({
  assetsInclude: ['**/*.stl'],
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'node', environment: 'node', include },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          include,
          browser: {
            enabled: true,
            headless: true,
            // the installed Chrome, here and on GitHub's ubuntu runners, so no browser download is needed
            provider: playwright({ launchOptions: { channel: 'chrome' } }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});
