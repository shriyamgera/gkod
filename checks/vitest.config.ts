import { defineConfig } from 'vitest/config';

export default defineConfig({
  assetsInclude: ['**/*.stl'],
  test: {
    projects: [
      {
        extends: true,
        test: { name: 'node', environment: 'node', include: ['test/**/*.test.ts'] },
      },
    ],
  },
});
