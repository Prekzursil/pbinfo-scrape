# PBInfo Full Archive Fix — Implementation Plan

**Date:** 2026-04-23
**Spec:** `docs/superpowers/specs/2026-04-23-pbinfo-full-archive-fix-design.md`
**Branch:** `feat/full-archive-fix-20260423`
**Ralph prompt:** `.claude/ralph/pbinfo-archive-fix.PROMPT.md`
**Progress ledger:** `.claude/ralph/pbinfo-archive-fix.progress.md`

## How to read this plan

- Each phase is ordered. Complete Phase N before Phase N+1.
- Each step has a deliverable and a test gate. TDD is mandatory: write failing test first, confirm red, implement, confirm green.
- Conventional-commits style, one commit per completed step (or tightly related cluster) with the step id in the body.
- If the loop iterates 3 times on the same step without progress, escalate to `.claude/ralph/pbinfo-archive-fix.open-questions.md`.

---

## Phase 0 — Prep

- **0.1** Confirm current branch is `feat/full-archive-fix-20260423`. If not, `git checkout -b` or `git checkout` as needed.
- **0.2** Confirm `.coverage-thresholds.json` exists and reflects agreed thresholds. If missing, create it with the Phase-0 seed values (80% global / 90% new-module).
- **0.3** Confirm `.local/pbinfo.local.json` is present and git-ignored. Do not commit it.
- **0.4** Confirm `docs/superpowers/specs/2026-04-23-pbinfo-full-archive-fix-design.md` is committed.
- **0.5** Confirm `.claude/ralph/pbinfo-archive-fix.progress.md` exists with one row per step below.

---

## Phase 1 — Capture pipeline (foundational)

### 1.1 Auth bootstrap (`src/auth/bootstrap.ts`)

Exports:
- `bootstrapAuth(workspaceRoot: string, options?): Promise<BootstrapResult>`
- Reads env vars `PBINFO_USERNAME` / `PBINFO_PASSWORD` first; falls back to `.local/pbinfo.local.json`.
- Probes session via `probePbinfoAuthStatus`.
- If stale, logs in via `PbinfoAuthClient.loginWithCredentials`.
- Persists tough-cookie jar to `.local/pbinfo-session.json`.
- Seals `createEncryptedAuthBundle` into `archive/secrets/auth-bundle.age`.
- Never logs the password; structured-log redaction utility is added if missing.

Tests (vitest):
- `tests/auth/bootstrap.test.ts` — mocks `PbinfoAuthClient`, `probePbinfoAuthStatus`, filesystem; asserts env-var precedence, probe-then-login, cookie persistence, bundle seal, redaction.

**Gate:** `npm run test -- tests/auth/bootstrap.test.ts` green; `npm run typecheck` green.

### 1.2 User-solutions enumerator (`src/crawl/user-submissions-enumerator.ts`)

Exports:
- `enumerateUserSubmissions(client, { userHandle, cursor? })` — async generator yielding `{ evaluationId, problemId, problemSlug, problemName, language?, score?, submittedAt? }`.
- Paginates `/solutii/user/<handle>?offset=N` across all rows.
- Durable cursor persisted to `archive/snapshots/<id>/.enum-cursor.json` for resume.

Tests:
- `tests/crawl/user-submissions-enumerator.test.ts` — fixture HTML for pages 1, 2, last; verifies pagination termination, cursor persistence, deduplication across pagination overlap.

Fixtures: `tests/fixtures/pbinfo/2026-04-23/user-solutions-page-*.html`

**Gate:** enumerator test green; content-hash of fixture matches committed hash.

### 1.3 Crawler extension (`src/crawl/archive-crawler.ts`)

Changes:
- Queue `evaluation-detail` for every entry from 1.2.
- Queue `problem-source-list` for every problem reachable from the catalog (even those without user subs).
- Queue `editorial` only if the problem has ≥1 user submission in the enumeration pass.
- Queue `official-source` only if the problem has ≥1 100pt user evaluation (derived post-enum).
- Circuit breaker: 3 × (429 or 5xx) in 60s → pause 5 min, emit `rate-limited` job event.
- 302-to-login → call `bootstrapAuth` to re-auth, then retry.

Tests:
- `tests/crawl/archive-crawler.test.ts` — injected fetch stub with rate-limit scenarios, visibility-gate scenarios, re-auth scenarios.

**Gate:** crawler test green; coverage of new code ≥ 90%.

### 1.4 Parser refinements

- `src/pbinfo/parsers/evaluation.ts` — tighten per-test `runtimeSeconds` extraction; isolate source-code textarea from compile-log textarea; SHA-256 `sourceHash` for dedupe; never emit `sourceCode` when `score < 100` (store empty string, set `sourceAvailable: false`).
- `src/pbinfo/parsers/problem-source-list.ts` — parse official-source tabs per language; attach `sourceHash`; attach `provenanceType: 'official-fragment'`.
- `src/pbinfo/parsers/problem.ts` — tighten `extractVisibleTestsFromTable`; add `parseEditorialFragment` for `/indicatii/<id>/<slug>`; verify `editorialAvailability` state transitions.

Tests:
- `tests/pbinfo/parsers/evaluation.test.ts`, `problem-source-list.test.ts`, `problem.test.ts` — each loads real fixtures (one per edge case) and asserts exact output shapes.

Fixtures (commit under `tests/fixtures/pbinfo/2026-04-23/`):
- `evaluation-63567684.html` (100pt, C++)
- `evaluation-partial.html` (<100pt)
- `problem-3171-with-visible-tests.html`
- `problem-no-editorial.html`
- `problem-editorial-visible.html`
- `problem-source-list-3171.html`

**Gate:** all parser tests green; coverage of parser modules ≥ 90%.

### 1.5 Coverage model extension

- `src/types/records.ts` — add `ProgressState`, `EvaluationTimelineEntry`, extended fields on `ProblemCoverageRecord`.
- `src/coverage/problem-coverage.ts` — compute new fields; preserve existing fields; update `ProblemCoverageTotals` with new counts (`progressStateCounts: { solved, partial, notAttempted }`).

Tests:
- `tests/coverage/problem-coverage.test.ts` — exhaustive scenario table: not-attempted / partial / solved; missing-this / missing-that; verify field derivation.

**Gate:** coverage tests green; full type-check clean.

### 1.6 Workflow orchestration + CLI

- `src/workflows/crawl-workflow.ts` — new sequence: `bootstrap-auth → public-crawl → user-subs-enum → drain → normalize → rank → materialize-tests → build-mirror → finalize`.
- `src/cli.ts` — new subcommand `materialize-tests --snapshot <id>`; new flag `crawl all --fresh-snapshot` (shortcut that generates a new snapshot id via pattern `fresh-YYYYMMDD-full` and sets mode=fresh).

Tests:
- `tests/workflows/crawl-workflow.test.ts` — integration-style with mocked sub-workflows; asserts ordering and short-circuits.

**Gate:** `npm run verify` green (typecheck + vitest + build).

### 1.7 Phase 1 commit gate

- Full `npm run verify` green.
- Coverage thresholds met.
- Commit: `feat(capture): extend crawl + parser + coverage model for full archive fix\n\nRefs: plan step 1.1–1.6.`

---

## Phase 2 — Tests materializer

### 2.1 Materializer module (`src/tests-materializer/materialize-tests.ts`)

Implements the merge rule from spec §3.5:
1. Load `normalized/problems/<id>.json`, `normalized/evaluations/*.json` (grouped by problemId), `normalized/rankings/<id>.json`.
2. Collect candidates, normalize, hash, dedupe, stable-sort, re-number.
3. Emit `archive/snapshots/<id>/tests/<problem-id>-<slug>/` with `NNN.in`, `NNN.ok`, `tests.json`, `meta.json`, `README.md`.
4. Idempotent: always overwrites.

Exports: `materializeTestsForSnapshot(workspaceRoot, snapshotId): Promise<MaterializeResult>`.

Tests:
- `tests/tests-materializer/materialize-tests.test.ts` — fixture problems:
  - (a) only examples
  - (b) examples + visible
  - (c) duplicate pairs (must dedupe)
  - (d) no examples, no visible (must NOT emit folder)
  - (e) 100+ cases (stress)
- Asserts folder shape, file contents, `meta.json.hash` stability across reruns.

**Gate:** materializer tests green; coverage ≥ 95%.

### 2.2 CLI wiring

- `src/cli.ts` — register `materialize-tests` subcommand; calls `materializeTestsForSnapshot`; prints summary JSON.

Tests:
- `tests/cli/materialize-tests.test.ts` — command parser smoke test with in-memory fs.

**Gate:** CLI test green.

### 2.3 Phase 2 commit gate

- `npm run verify` green.
- Commit: `feat(tests-materializer): emit per-problem test folders from normalized archive\n\nRefs: plan step 2.1–2.2.`

---

## Phase 3 — Coverage Explorer UX

### 3.1 Backend handler extension (`src/gui/main/problem-coverage-explorer.ts`)

- Accept new filter params: `progressState`, `completenessFilter`, `languagesTried` (multi), `bestScoreMin`, `bestScoreMax`, `lastAttemptSince`, `attemptsCountMin`, `tags` (multi), `grade`, `officialSourceStatus`, `userSourceStatus`, `editorialAvailability`, `testsAvailability`.
- Accept new sort params: `sortBy: 'id'|'grade'|'bestScore'|'lastAttempt'|'name'|'attempts'|'completeness'`, `sortDir: 'asc'|'desc'`.

Tests:
- `tests/gui/main/problem-coverage-explorer.test.ts` — table-driven filter+sort permutations against a synthetic coverage fixture.

**Gate:** handler tests green.

### 3.2 IPC contract update (`src/gui/shared/contracts.ts`, `types.ts`)

- Extend `GuiCoverageListingRequest` with new filter/sort fields.
- Extend `GuiCoverageRecord` with new fields.
- Preserve backward-compat: older renderers without new params still get reasonable defaults.

**Gate:** typecheck green.

### 3.3 Renderer UX (`src/gui/renderer/coverage-explorer.tsx`)

- New filter controls (Progress chip group, language multi-chip, best-score range slider, completeness-reason select, attempts-count numeric).
- New sort dropdown.
- Compact row icon strip per spec §3.6.
- Enhanced detail pane: artifacts strip + evaluation timeline + per-test breakdown + action buttons (Open in viewer / Open tests folder / Copy 100pt source / Re-try capture).

Tests:
- `tests/gui/renderer/coverage-explorer.test.tsx` — `@testing-library/react` tests: filter interactions, sort changes, row icon rendering, timeline rendering.

**Gate:** renderer tests green.

### 3.4 Phase 3 commit gate

- `npm run typecheck && npm run typecheck:desktop && npm run test:desktop-electron` green.
- Commit: `feat(coverage-ui): new filters, sorts, row icons, timeline+per-test detail pane\n\nRefs: plan step 3.1–3.3.`

---

## Phase 4 — Embedded live-site viewer

### 4.1 BrowserView manager (`src/gui/main/browser-view-manager.ts`)

- Wrap `WebContentsView` (Electron ≥ 28).
- On attach: bind to a named renderer frame region; listen for `resize` events to reposition.
- `setWindowOpenHandler` returns `{ action: 'deny' }`, then `shell.openExternal(url)`.
- `will-navigate` guard: allow only `http://127.0.0.1:<mirrorPort>`; `event.preventDefault()` + `shell.openExternal(url)` for anything else.
- `did-finish-load`: inject `<script>` that fetches `/__pbinfo-overlay.json?problemId=<id>` and renders a sticky HUD element.

Tests:
- `tests/gui/main/browser-view-manager.test.ts` — stub `WebContentsView`; assert event handler registration, external-open routing, overlay injection.

### 4.2 Overlay server (`src/mirror/overlay-server.ts`)

- Express route `GET /__pbinfo-overlay.json?problemId=<id>` → returns compact JSON `{ problemId, slug, progressState, bestScore, languages: { cpp: { mine:true, official:true, ... } }, testsCaptured, evalCount }`.
- Integrated into `src/mirror/server.ts` startup.

Tests:
- `tests/mirror/overlay-server.test.ts` — supertest-style; fixture coverage record.

### 4.3 Archive-truth stubs (`src/mirror/build-mirror.ts`)

- During mirror build, keep a registry of all `route → resolved?` pairs.
- For every underlink in any mirrored page whose target is not in the registry, rewrite to `http://127.0.0.1:<mirrorPort>/__not-archived?original=<encoded-url>`.
- New mirror route `GET /__not-archived?original=...` returns a Brand-consistent stub page with:
  - Title: "Not archived yet"
  - Body: truthful wording ("This pbinfo.ro page wasn't captured in snapshot `<id>`.")
  - Button: "Open on live pbinfo.ro" that triggers external navigation (click handler sends IPC message `viewer:open-external` which calls `shell.openExternal`).

Tests:
- `tests/mirror/build-mirror.test.ts` — extend with archive-truth-stub scenarios.

### 4.4 Renderer Browse tab (`src/gui/renderer/browse-viewer.tsx`)

- New React component wired into `dashboard.tsx` as a 5th tab ("Browse").
- URL bar input + back / forward / reload / home buttons.
- Host div with `data-browser-view-host` attribute — main process positions the WebContentsView over it via bounding-rect IPC.
- `ResizeObserver` on host div recomputes bounds and sends `viewer:bounds` IPC.

Tests:
- `tests/gui/renderer/browse-viewer.test.tsx` — `@testing-library/react`; asserts URL-bar input → `viewer:navigate` IPC; back/forward buttons; resize observer bounds updates.

### 4.5 IPC channels (`src/gui/main/ipc.ts`)

New channels:
- `viewer:navigate(url: string)` — validate allow-list, then call `webContents.loadURL`.
- `viewer:back()`, `viewer:forward()`, `viewer:reload()` — proxy to `webContents`.
- `viewer:current-url() → string`.
- `viewer:bounds({ x, y, width, height })` — reposition WebContentsView.
- `viewer:open-external(url: string)` — `shell.openExternal`.
- `viewer:resolve-archive-truth(url: string) → { resolved: boolean, route?: string }`.

Tests:
- `tests/gui/main/ipc.test.ts` — extend with viewer channel test.

### 4.6 Playwright E2E (`tests/e2e/browse-viewer.spec.ts`)

Script:
1. Package the app (reuse `desktop:build` output).
2. Launch via `electron` test API.
3. Open Browse tab.
4. Navigate to `/probleme/3171/waterreserve`.
5. Assert problem title visible.
6. Click first underlink to another `/probleme/...` → assert navigation.
7. Click an underlink we haven't archived → assert "Not archived yet" stub.
8. Click "Open on live pbinfo.ro" → assert external open was invoked (mock `shell.openExternal` or intercept via test harness).

**Gate:** `npm run test:desktop-electron && npm run smoke:desktop-packaged` green; Playwright E2E green.

### 4.7 Phase 4 commit gate

Commit: `feat(viewer): embedded live-site BrowserView with archive-truth stubs and overlays\n\nRefs: plan step 4.1–4.6.`

---

## Phase 5 — Live crawl truth test

### 5.1 Kick off the fresh crawl

```bash
npm run cli -- crawl all --fresh-snapshot
```

Expected wall-clock: ~4–5 hours. Loop should use `run_in_background` for long commands and poll periodically.

### 5.2 Drain + normalize + rank + materialize + mirror + finalize

```bash
SNAPSHOT_ID=$(node -e "console.log(require('./archive/catalog.json').currentSnapshotId)")
npm run cli -- crawl status --snapshot "$SNAPSHOT_ID"
npm run cli -- normalize snapshot --snapshot "$SNAPSHOT_ID"
npm run cli -- rank --snapshot "$SNAPSHOT_ID"
npm run cli -- materialize-tests --snapshot "$SNAPSHOT_ID"
npm run cli -- build-mirror --snapshot "$SNAPSHOT_ID"
npm run cli -- snapshot finalize --snapshot "$SNAPSHOT_ID"
```

### 5.3 Numeric truth gates

Check via small verification script that:
- Statements captured ≥ 2,500.
- Evaluations captured ≥ 13,000.
- Official sources present for every problem where operator has ≥ 1 100pt eval.
- 100pt user sources captured for every (problem × language) with score === 100.
- Test folders present for every problem with ≥ 1 example OR visible test (and absent for problems with neither).

### 5.4 Spot-check problems

For each of the following problem ids, manually verify the Coverage Explorer shows the correct truthful state (operator can list these in the open-questions file if they change their mind):
- 3171 waterreserve (used in canonical baseline)
- 4967 collatz1 (operator-recent)
- 4966 zudt (operator-recent)
- 1 sum (oldest)
- + 6 operator-chosen during review

### 5.5 Verify suite

```bash
npm run verify
npm run verify:canonical-snapshot   # will fail unless promotion happens; treat as informational unless promoting
npm run smoke:desktop-packaged
```

### 5.6 Commit the fresh snapshot artifacts

- Commit the new snapshot under `archive/snapshots/fresh-YYYYMMDD-full/` (or whatever id was generated).
- Update `archive/catalog.json` with new entry.
- DO NOT promote to canonical in this branch — that is an explicit later step per `MAINTAINING.md`.
- Commit: `feat(archive): fresh full-archive snapshot <id>\n\nRefs: plan step 5.x`.

---

## Phase 6 — Self-reflect & completion

- **6.1** Run `/self-reflect` if available; commit knowledge-base updates.
- **6.2** Confirm `.claude/ralph/pbinfo-archive-fix.progress.md` shows every row `done`.
- **6.3** Confirm every Phase 0–5 commit is on the branch.
- **6.4** Emit completion promise in the loop's final response:

```
<promise>ARCHIVE-FIX COMPLETE</promise>
```

Followed by a 5-bullet summary: (1) spec + plan commit ids, (2) phase 1 commit ids, (3) phase 2 commit id, (4) phase 3 commit id, (5) phase 4 + snapshot commit ids.

## Safety exits — do NOT emit the completion promise if

- `npm run verify` is failing.
- `npm run test:desktop-electron` is failing.
- `npm run smoke:desktop-packaged` is failing.
- Coverage thresholds in `.coverage-thresholds.json` are not met globally or per-module.
- Fresh crawl did not run end-to-end without a fatal error.
- Coverage Explorer is missing any agreed filter/sort/row/detail capability.
- Browse tab does not resolve at least one real underlink locally in the packaged app.
- Password or raw cookies appear anywhere outside `.local/` or `archive/secrets/*.age`.
- Uncommitted changes remain (run `git status`).
