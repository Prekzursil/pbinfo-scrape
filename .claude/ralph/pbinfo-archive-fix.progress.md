# Progress Ledger — pbinfo-scrape full archive fix

Status values: `todo` / `in_progress` / `blocked` / `done`.
Commit column records the short-sha when step is `done`.

| Step | Summary | Status | Commit | Notes |
|---|---|---|---|---|
| 0.1 | Confirm branch `feat/full-archive-fix-20260423` | done | (seeded) | branch created during design |
| 0.2 | Confirm `.coverage-thresholds.json` present | done | (seeded) | seed 80% global / 90% new-module |
| 0.3 | Confirm `.local/pbinfo.local.json` present + gitignored | done | (seeded) | creds persisted, `.local/` in `.gitignore` |
| 0.4 | Confirm spec committed | done | 6a68e1397 | spec + plan + ralph scaffolding |
| 0.5 | Confirm progress ledger scaffold present | done | (seeded) | this file |
| 1.1 | Auth bootstrap `src/auth/bootstrap.ts` + tests | done | 48bbc215c | 6 tests, env-vars-first precedence, non-fatal bundle-seal failure, never-log password |
| 1.2 | User-solutions enumerator + fixture test | done | e7ca4e41d | 10 tests: pagination walk, dedup, throttled, cursor resume, maxPages cap |
| 1.3 | Crawler extension: eval-detail, source-list, editorial, official; circuit breaker | in_progress | — | split into 1.3a/1.3b/1.3c below |
| 1.3a | Rate-limit circuit breaker utility | done | ec4244f12 | 9 tests: 429/5xx rolling window, cooldown auto-close, success resets counter |
| 1.3b | 302-to-login re-auth wrapper (auth-aware fetch) | done | (pending) | 6 tests; single-flight reauth; URL + body detection; also hardened user-subs-enumerator maxPages test |
| 1.3c | Crawler integration: visibility gating + breaker + re-auth | todo | — | extends ArchiveCrawler to queue eval-detail + source-list + editorial/official per gate |
| 1.4 | Parser refinements: evaluation, problem-source-list, problem | in_progress | — | split into 1.4a/1.4b/1.4c below |
| 1.4a | evaluation parser: tighten source selector + sourceHash | done | (pending) | 3 new tests; sourceCode skips compile-log textareas; stable SHA-256 hash for dedup |
| 1.4b | problem-source-list parser: per-language + content hash | todo | — | |
| 1.4c | problem parser: visible-tests refinement + editorial fragment | todo | — | |
| 1.5 | Coverage model extension: progressState, bestScore, evaluationTimeline, languagesTried | todo | — | update `ProblemCoverageRecord` |
| 1.6 | Workflow orchestration + CLI flag `--fresh-snapshot` | todo | — | register `materialize-tests` subcommand |
| 1.7 | Phase 1 `npm run verify` green + commit | todo | — | |
| 2.1 | Materializer `src/tests-materializer/materialize-tests.ts` + tests | todo | — | merge rule per spec §3.5 |
| 2.2 | CLI `materialize-tests --snapshot <id>` | todo | — | |
| 2.3 | Materializer fixture cases: examples-only, examples+visible, duplicate, neither | todo | — | |
| 2.4 | Phase 2 `npm run verify` green + commit | todo | — | |
| 3.1 | Backend handler filter/sort extension | todo | — | |
| 3.2 | IPC contract update | todo | — | `GuiCoverageListingRequest` + `GuiCoverageRecord` |
| 3.3 | Renderer UX: filters, sorts, row icons, detail pane | todo | — | |
| 3.4 | Renderer RTL tests | todo | — | |
| 3.5 | Phase 3 `npm run test:desktop-electron` green + commit | todo | — | |
| 4.1 | BrowserView manager + hardened nav | todo | — | |
| 4.2 | Overlay server `src/mirror/overlay-server.ts` | todo | — | `/__pbinfo-overlay.json?problemId=N` |
| 4.3 | Archive-truth stubs in mirror builder | todo | — | "Not archived yet" page |
| 4.4 | Browse tab renderer | todo | — | |
| 4.5 | Viewer IPC channels | todo | — | |
| 4.6 | Playwright E2E `tests/e2e/browse-viewer.spec.ts` | todo | — | |
| 4.7 | Phase 4 smoke green + commit | todo | — | |
| 5.1 | Live fresh crawl (4–5h) | todo | — | run `crawl all --fresh-snapshot` |
| 5.2 | Normalize → rank → materialize → mirror → finalize | todo | — | |
| 5.3 | Numeric truth gates (≥2500 statements, ≥13000 evals, …) | todo | — | |
| 5.4 | Spot-check 10 problems in Coverage Explorer | todo | — | |
| 5.5 | `npm run verify && smoke:desktop-packaged` | todo | — | |
| 5.6 | Commit fresh snapshot artifacts + update `archive/catalog.json` | todo | — | |
| 6.1 | Self-reflect (if available) | todo | — | |
| 6.2 | Progress ledger all `done` | todo | — | |
| 6.3 | Every phase committed on branch | todo | — | |
| 6.4 | Emit `<promise>ARCHIVE-FIX COMPLETE</promise>` | todo | — | |
