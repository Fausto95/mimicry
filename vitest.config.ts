import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const pkg = (name: string) => fileURLToPath(new URL(`./packages/${name}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Tests are written like app code: `import { View } from 'react-native'`.
      'react-native': pkg('react-native'),
    },
  },
  test: {
    include: ['packages/*/test/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    environment: 'node',
    testTimeout: 30_000,
    pool: 'threads',
  },
});
