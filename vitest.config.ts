import { configDefaults, defineConfig } from 'vitest/config';

const includeDesktopElectronSmoke = process.env.PBINFO_INCLUDE_ELECTRON_SMOKE === '1';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: includeDesktopElectronSmoke
      ? configDefaults.exclude
      : [...configDefaults.exclude, 'tests/gui/desktop-electron-smoke.test.ts'],
    environmentMatchGlobs: [['tests/**/*.test.tsx', 'jsdom']],
    coverage: {
      provider: 'v8',
      all: true,
      reporter: ['text', 'html', 'json', 'lcov'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        // Type-only declarations carry no executable statements.
        'src/types/**',
        'src/gui/shared/types.ts',
        'src/gui/shared/contracts.ts',
        // Renderer/static assets and styling are not executable TypeScript.
        'src/gui/renderer/assets/**',
        '**/*.css',
        '**/*.html',
        '**/*.svg',
      ],
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});
