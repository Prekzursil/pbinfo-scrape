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
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      all: true,
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        // Process entry points: wire-up only, exercised by the desktop-electron
        // smoke test (PBINFO_INCLUDE_ELECTRON_SMOKE=1), not by unit tests.
        'src/gui/main/index.ts',
        'src/gui/renderer/main.tsx',
        'src/gui/preload/index.ts',
        // Type-only modules: no executable statements to cover.
        'src/types/**',
        '**/*.d.ts',
      ],
      reporter: ['text', 'text-summary', 'html', 'json-summary'],
      // Lean strict-zero target: 100% line + branch coverage.
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});
