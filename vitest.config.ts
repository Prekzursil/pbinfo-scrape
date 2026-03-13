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
      reporter: ['text', 'html'],
    },
  },
});
