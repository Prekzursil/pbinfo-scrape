# Contributing

## Lean quality gates (CI, required on every PR)

`.github/workflows/quality.yml` calls quality-zero-platform's reusable lean
6-gate workflow, pinned to a full commit SHA. For the languages in this
repository (TypeScript):

1. **Lint + format** — oxlint (linter) + biome (formatter check)
2. **Types** — `tsc --noEmit` per tsconfig (`tsconfig.json`,
   `tsconfig.desktop.json`)
3. **Tests + coverage** — the project's `test:coverage` script (vitest,
   `@vitest/coverage-v8`), **STRICT 100% line AND branch** on the declared
   scope (`src/**`, `all: true`, thresholds 100/100/100/100 in
   `vitest.config.ts`; the Electron process entry points are excluded with a
   written reason there and exercised by the desktop-electron smoke suite)
4. **SAST** — opengrep (always on)
5. **Secrets** — gitleaks (always on; `.gitleaks.toml` is a reviewed
   allowlist only)
6. **Deps** — osv-scanner + Dependabot at `deps-severity-floor: any`
   (every finding blocks; `osv-scanner.toml` carries only reviewed, dated,
   reasoned ignores — currently the dev-only electron 40.x line, whose fixes
   are breaking majors taken deliberately)

CodeQL (`security-and-quality`, javascript-typescript + actions) runs
alongside via the thin caller in `.github/workflows/codeql.yml`, scoped by
`.github/codeql/codeql-config.yml` (archive/ snapshots and tests/ scaffolding
are out of scope, with reasons in that file).

The repo's own Quality Gate and Desktop Gate workflows continue to run the
project-specific lanes (desktop build, electron smoke).

## Local commands

```bash
npm ci
npm test              # vitest run
npm run test:coverage # the 100/100/100/100 gate
bash scripts/verify   # the lean gate, exactly as CI runs it
```

## Conventions

- Every change reaches `main` through a pull request; never push to the
  default branch.
- New behavior ships with the tests that pin it; keep coverage at the
  declared 100% line+branch.
- `archive/` holds verbatim third-party snapshots (the product of this
  crawler); it is never rewritten to satisfy a linter and stays out of the
  lint/scan/coverage scopes.
- Security findings are fixed (version bump or code change), never muted;
  an ignore entry needs a written reason and a date.
