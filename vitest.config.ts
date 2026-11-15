import { configDefaults, defineConfig } from 'vitest/config';

const includeDesktopElectronSmoke = process.env.PBINFO_INCLUDE_ELECTRON_SMOKE === '1';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: includeDesktopElectronSmoke
      ? configDefaults.exclude
      : [...configDefaults.exclude, 'tests/gui/desktop-electron-smoke.test.ts'],
    // vitest 4 runs the suite ~30% slower than vitest 3 (transform cost);
    // the heaviest end-to-end GUI drives measured close to the old 60s
    // default under coverage instrumentation, so both lanes (test and
    // test:coverage) now share this 120s budget.
    testTimeout: 120_000,
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
      // ─────────────────────────────────────────────────────────────────────
      // STRICT 100% GATES — restored 2026-11-15.
      //
      // The interim measured-maximum pins (99.18/97.5/98.71/99.13, owner
      // decision 2026-11-04, tracked in issue #89) existed because vitest
      // 4.1.11+'s ast-v8-to-istanbul remapper emitted branch entries at
      // non-executable positions. The vitest 5.1.0 upgrade (dev-dependency
      // wave that also cleared the vitest/tinypool/@vitest/mocker Dependabot
      // advisories) fixed the phantom-branch emission; tests were written for
      // every remaining real gap, and one negative-counter artifact (a
      // short-circuit || chain in assertAuthenticatedCrawlPreflight) was
      // removed by restating the check with an includes() set membership.
      thresholds: {
        lines: 100,
        branches: 100,
        functions: 100,
        statements: 100,
      },
    },
  },
});
