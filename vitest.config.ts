import { configDefaults, defineConfig } from 'vitest/config';

const includeDesktopElectronSmoke = process.env.PBINFO_INCLUDE_ELECTRON_SMOKE === '1';

const baseExclude = includeDesktopElectronSmoke
  ? configDefaults.exclude
  : [...configDefaults.exclude, 'tests/gui/desktop-electron-smoke.test.ts'];

export default defineConfig({
  test: {
    coverage: {
      reporter: ['text', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: [
        'dist/**',
        'dist-desktop/**',
        'archive/**',
        'src/**/*.d.ts',
        'src/gui/renderer/full/**',
      ],
    },
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: baseExclude,
        },
      },
      {
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          include: ['tests/**/*.test.tsx'],
          exclude: baseExclude,
        },
      },
    ],
  },
});
