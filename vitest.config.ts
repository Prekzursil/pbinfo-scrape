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
      // INTERIM MEASURED-MAXIMUM THRESHOLDS — NOT the 100/100/100/100 target.
      //
      // The lean strict-zero target is 100% line + branch. It is currently
      // unattainable because the vitest >= 4.1.11 security upgrade (required
      // to clear Dependabot advisories GHSA for vitest/@vitest/mocker/tinypool;
      // see PR "fix(deps): vitest 3 -> 4.1.12") switched coverage remapping to
      // ast-v8-to-istanbun, which emits branch entries at NON-EXECUTABLE
      // positions: TS interface members (src/archive/storage.ts:21-31), import
      // bindings (src/auth/secrets.ts:2, src/cli.ts:1-15), regex-continuation
      // and blank/L0 positions (src/mirror/build-mirror.ts:0,
      // src/publish/publish.ts:57). ~55-60 such artifact entries cannot be
      // covered by any runtime test; the repo's `/* v8 ignore next */`
      // convention is NOT honored at those positions (verified empirically on
      // src/pbinfo/parsers/category.ts); the istanbul provider is worse (117
      // entries); vitest 4.1.12 exposes no remap toggle; vitest 5.x breaks 34
      // tests. Real tests were added for every genuinely coverable gap first
      // (window-bridge fallback, article-statement fallback, non-input
      // literal comparisons), and these thresholds pin the EXACT measured
      // maximum after those tests landed (owner decision 2026-11-04; not
      // rounded down). Restore 100/100/100/100 the moment vitest ships fixed
      // remapping — tracked in https://github.com/Prekzursil/pbinfo-scrape/issues/89.
      thresholds: {
        lines: 99.18,
        branches: 97.61,
        functions: 98.71,
        statements: 99.13,
      },
    },
  },
});
