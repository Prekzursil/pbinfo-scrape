# PBInfo Full Archive Fix — Design Spec

**Date:** 2026-04-23
**Status:** approved, implementation via ralph loop
**Branch:** `feat/full-archive-fix-20260423`
**Owning operator:** Prekzursil (`prekzursil1993@gmail.com`)
**Ralph prompt:** `.claude/ralph/pbinfo-archive-fix.PROMPT.md`
**Plan:** `docs/superpowers/plans/2026-04-23-pbinfo-full-archive-fix-plan.md`

## 1. Context & problem statement

The `pbinfo-scrape` repo already has a mature pipeline (TypeScript + Electron + React + cheerio + Playwright + age-encryption, canonical snapshot `acceptance-20260310b`), but the current archive is *underpopulated relative to what the type model promises*:

- 2,582 problem statements ✅
- 832 editorials detected ✅
- Only **22 evaluations archived** out of **13,968** listed at `/solutii/user/Prekzursil`
- **0 official sources** archived (despite source-list URLs being present)
- **0 visible tests** extracted (despite `testsFragmentArchived: true`)
- Only **7 problems** marked `solvedByMe`
- `archive/catalog.json → artifactExports[].manifestPath` points at a stale `C:\Users\Prekzursil\Downloads\Pbinfo_Scrape\` path (a previous checkout), so heavy raw artifacts are detached from this repo copy.

User goal: a truthful fresh snapshot that captures statements, editorials, official sources (when visible), their own 100-pt source bodies (when visible), visible + example test cases per problem, and a per-submission verdict trail for every one of the ~13,968 user submissions. GUI must show per-problem status (what's archived), support filter/sort including a "partial attempt" state, and embed a live-site-like viewer for mirrored pages.

## 2. Scope decomposition

Four distinct subsystems, delivered in **one big-bang branch**:

1. **Capture pipeline** — auth bootstrap, user-subs enumeration, crawler extensions, parser refinements, coverage-model extension.
2. **Test-case materializer** — new post-normalize step that emits `archive/snapshots/<id>/tests/<problem-id>-<slug>/` folders.
3. **Coverage Explorer UX** — new filters, sorts, compact row icons, timeline + per-test detail pane.
4. **Embedded live-site viewer** — Electron `WebContentsView` tab, URL bar, navigation, archive-truth stubs, operator overlays.

## 3. Locked design decisions

### 3.1 Snapshot strategy

- New snapshot id pattern: `fresh-YYYYMMDD-full` (deterministic at crawl start).
- `acceptance-20260310b` stays read-only as historical baseline.
- Canonical-snapshot promotion follows existing `MAINTAINING.md` flow after all gates pass.
- `archive/catalog.json` updated to record both snapshots; `currentSnapshotId` switches after promotion.

### 3.2 Visibility rules (gates the crawler observes)

| Artifact | Visible on pbinfo.ro when… | Capture behavior | If blocked |
|---|---|---|---|
| Statement + examples | Always public | Capture for every reachable problem | N/A |
| Indicații de rezolvare (editorial) | User has ≥1 submission to the problem | Capture HTML fragment as its own record | `restricted-upstream` |
| Official source code | User has a 100-pt (Accepted) submission | Capture + tag language | `restricted-upstream` (<100pt) or `not-available-upstream` (no source-list at all) |
| Visible tests table | Per-problem, set by author | Parse `#tests` / tabular fragment | `not-available-upstream` |
| Evaluation-observed tests | On each of user's evaluation detail pages | Verdict + runtime per test | N/A |
| User's source body — full code | 100-pt only (per operator rule) | Keep only for score === 100; partial bodies discarded | Metadata kept |
| Partial-attempt metadata | On submissions list + evaluation detail | Always recorded (score, verdict, language, timestamp) | N/A |

### 3.3 Evaluation capture scope

Fetch detail for **all ~13,968** user submissions. Keep source body only when `score === 100`. Keep metadata + per-test verdicts + per-test runtimes for every one.

Reasoning: per-test runtime across the full history enables "which test times out across attempts" analytics; partial bodies are discarded per operator rule; the full list is the only way to truthfully populate `progressState: partial`.

### 3.4 Concurrency, pacing, scope

- `maxConcurrency`: 2
- `jitterMsRange`: 250–750 ms per request
- Scope: every public `/probleme/<id>/<slug>` reachable from `/?pagina=probleme-lista` (all grades 5–12 + mixed) **plus** tag-page enumeration `/probleme/eticheta/...` for completeness.
- Circuit breaker: 3 × (429 or 5xx) inside a 60s rolling window → pause queue 5 minutes, emit `rate-limited` job event for GUI banner.

### 3.5 Test-case folder layout (materializer output)

Location: `archive/snapshots/<snapshot-id>/tests/<problem-id>-<slug>/` (first-class peer of `normalized/` and `mirror/`).

Per problem:

```
tests/<problem-id>-<slug>/
  001.in   001.ok
  002.in   002.ok
  tests.json   ← cases[] with provenanceKinds, evaluationVerdicts[], generatedAt
  meta.json    ← { problemId, slug, name, caseCount, provenanceSummary, hash, updatedAt }
  README.md    ← human-readable: problem name, URL, count, provenance, "how to run" snippet
```

Merge rule:
1. Collect candidates from examples (statement) + visible (problem page table).
2. Normalize: trim trailing newlines, collapse runs of whitespace-only lines, preserve interior whitespace.
3. SHA-256 hash of `(input || '\0' || output)` for dedup keying.
4. Stable sort: example-first then visible, preserve original index within each source.
5. Re-number starting at `001`.
6. Attach per-case `evaluationVerdicts[]` from best-per-language ranked evaluations (each entry: `{ evaluationId, language, verdict, runtimeSeconds, score, maxScore }`).
7. Problems with zero examples AND zero visible tests → **no folder emitted**.

Idempotent: re-running overwrites existing folders deterministically.

### 3.6 Coverage Explorer UX (ProblemCoverageRecord extensions + filters + sorts + UI)

Type additions:

```ts
export type ProgressState = 'solved' | 'partial' | 'not-attempted';

export interface EvaluationTimelineEntry {
  evaluationId: number;
  language: string;
  score: number;
  verdictSummary: string;
  submittedAt: string;    // ISO
  runtimeSeconds?: number;
  memoryKb?: number;
  sourceAvailable: boolean;  // true only for 100pt
}

// extend ProblemCoverageRecord:
progressState: ProgressState;
bestScore: number;               // max score across your submissions (0–100); 0 if none
lastAttemptAt?: string;          // ISO
evaluationTimeline: EvaluationTimelineEntry[];
languagesTried: string[];        // union of languages you submitted in
requiredTestsCaptured: boolean;  // true iff folder emitted (>=1 case)
```

Filters:
- Search (query over slug/name/id/tags)
- **Progress (new)**: all / solved (100pt) / partial (1–99pt) / not-attempted (0 subs)
- Completeness: all / complete / missing-my-100pt-source / missing-official-source / missing-tests / missing-editorial / unsolved
- Tests availability: captured / not-captured-yet / not-available-upstream / all
- Official source: archived / restricted-upstream / not-available-upstream / not-captured-yet / all
- Your source: archived / not-captured-yet / not-applicable / all
- Editorial: visible / restricted / hidden / unknown / all
- Grade: 5–12 / mixed / all
- Category / tag: multi-select
- Best score: range slider 0–100
- Languages tried: multi-select

Sorts:
- Problem ID (asc/desc, default asc)
- Grade then problem ID
- Best score (asc/desc)
- Last attempt (desc)
- Name (A–Z)
- Attempts count (desc)
- Completeness (missing-fields count asc)

Compact row icon strip (single line per problem):
```
#1234  ArrayMax  G9   ▸ statement ✓ · editorial 🔒 · official C++ ✓ · mine C++ ✓ · tests 3/3 · eval × 7    [100 ✓]
```
Legend: ✓ = archived · 🔒 = restricted upstream · ✗ = visible upstream, not yet captured · · = not applicable.

Detail pane (right when row selected):
- Header: number, name, grade, tags, progress chip.
- Artifacts strip with per-artifact icons + "Open in viewer" / "Copy" buttons.
- Evaluation timeline: newest-first list of all your submissions, with jump-to-detail action.
- Test breakdown table: per-case index, verdict-of-best-eval, runtime, score / maxScore.
- Action buttons: "Open in viewer", "Open tests folder", "Copy 100pt source", "Re-try capture".

### 3.7 Embedded live-site viewer

Electron `WebContentsView` (supersedes `BrowserView` in newer Electron) hosted in a new "Browse" tab:
- URL bar + back / forward / reload + "home".
- Hard security: `setWindowOpenHandler` returns `{ action: 'deny' }` + `shell.openExternal(url)`; `will-navigate` allow-list only `http://127.0.0.1:<mirrorPort>`; external URLs always break out to OS browser.
- Archive-truth fallback: underlinks to content not in the mirror route index are served by the mirror's `archive-truth` stub with an "Open on live pbinfo.ro" button (uses `shell.openExternal`).
- Operator overlay: `did-finish-load` injects a tiny HUD reading `/__pbinfo-overlay.json?problemId=N` (served by `src/mirror/overlay-server.ts`), showing `[You: 100 ✓ · Official: C++ ✓ · Tests: 3/3 captured · Eval × 7]` stuck to a corner; non-invasive, not baked into mirrored HTML on disk.

### 3.8 Auth bootstrap

- `src/auth/bootstrap.ts`: on CLI/Desktop startup, load creds (env vars `PBINFO_USERNAME`/`PBINFO_PASSWORD` first, then `.local/pbinfo.local.json`), probe session with `probePbinfoAuthStatus`, re-auth via `PbinfoAuthClient.loginWithCredentials` if stale, persist tough-cookie jar to `.local/pbinfo-session.json`, then seal `createEncryptedAuthBundle` → `archive/secrets/auth-bundle.age`.
- Never log the password. Redaction utility scrubs any structured log that contains a `password` key.
- 302-to-login during crawl triggers automatic re-bootstrap.

### 3.9 Ongoing freshness

Manual only. Operator clicks "Continue crawl" in GUI or runs `npm run cli -- crawl all --mode incremental` when desired. Scheduled auto-refresh and change-detection heuristics are explicitly out of scope.

## 4. Module change map

| Area | File | Status | Summary |
|---|---|---|---|
| Auth | `src/auth/bootstrap.ts` | NEW | Auto-login + session probe + bundle seal |
| Crawl | `src/crawl/user-submissions-enumerator.ts` | NEW | Paginate `/solutii/user/<handle>?offset=N`, durable cursor |
| Crawl | `src/crawl/archive-crawler.ts` | EXTEND | Queue evaluation-detail + source-list + editorial (gated) + official (gated); circuit breaker |
| Parsers | `src/pbinfo/parsers/evaluation.ts` | TIGHTEN | Per-test `runtimeSeconds`; source textarea isolation; content-hash |
| Parsers | `src/pbinfo/parsers/problem-source-list.ts` | TIGHTEN | Official-source tabs per language; content-hash |
| Parsers | `src/pbinfo/parsers/problem.ts` | EXTEND | Visible-tests table refined; editorial fragment handler |
| Coverage | `src/coverage/problem-coverage.ts` | EXTEND | `progressState`, `bestScore`, `lastAttemptAt`, `evaluationTimeline`, `languagesTried`, `requiredTestsCaptured` |
| Tests artifact | `src/tests-materializer/materialize-tests.ts` | NEW | Emit `tests/<problem-id>-<slug>/` folders |
| Workflow | `src/workflows/crawl-workflow.ts` | EXTEND | New sequence with bootstrap → enum → drain → normalize → rank → materialize-tests → build-mirror → finalize |
| CLI | `src/cli.ts` | EXTEND | New `materialize-tests` subcommand; new `crawl all --fresh-snapshot` flag |
| Mirror | `src/mirror/build-mirror.ts` | EXTEND | Inject archive-truth stubs for missing underlinks |
| Mirror | `src/mirror/overlay-server.ts` | NEW | `/__pbinfo-overlay.json?problemId=N` endpoint |
| Desktop | `src/gui/main/browser-view-manager.ts` | NEW | Wrap WebContentsView, hardened nav, HUD injection |
| Desktop | `src/gui/main/problem-coverage-explorer.ts` | EXTEND | New filter/sort handlers matching spec |
| Desktop | `src/gui/main/ipc.ts` | EXTEND | `viewer:navigate/back/forward/reload/current-url/resolve-archive-truth` |
| Desktop | `src/gui/renderer/browse-viewer.tsx` | NEW | Browse tab UI |
| Desktop | `src/gui/renderer/coverage-explorer.tsx` | EXTEND | New filters/sorts/row-icons/detail-pane |
| Desktop | `src/gui/shared/contracts.ts` | EXTEND | Updated IPC contract types |
| Desktop | `src/gui/shared/types.ts` | EXTEND | New filter/sort types |
| Types | `src/types/records.ts` | EXTEND | `ProgressState`, `EvaluationTimelineEntry`, extended `ProblemCoverageRecord` |
| Tests | `tests/fixtures/pbinfo/2026-04-23/` | NEW | Captured HTML for parser tests |
| Tests | `tests/e2e/browse-viewer.spec.ts` | NEW | Playwright against packaged Electron |

## 5. Acceptance gates

Before the ralph loop may emit its completion promise, ALL of these must be green:

- `npm run verify` (typecheck + typecheck:desktop + vitest + build) — **green**.
- `npm run test:desktop-electron` — **green**.
- `npm run smoke:desktop-packaged` — **green** on the packaged portable .exe.
- Coverage thresholds in `.coverage-thresholds.json` — **met or exceeded** globally and per-module.
- **Live fresh crawl against real pbinfo.ro** with creds in `.local/pbinfo.local.json`:
  - Statements captured ≥ 2,500.
  - Evaluations captured ≥ 13,000 of ~13,968.
  - Official sources captured for every problem where operator has ≥ 1 100pt eval.
  - 100pt user sources captured for every (problem × language) with score === 100.
  - Test folders exist for every problem with ≥ 1 example or visible test.
  - Coverage Explorer shows correct state for 10 spot-check problems (list in plan).
- **Live-site viewer smoke**: inside packaged Electron, open a problem, follow an underlink, follow another underlink, hit a "not archived yet" page, click external-pbinfo button, verify OS browser was asked to open.
- **Playwright E2E** `tests/e2e/browse-viewer.spec.ts` — **green**.
- **Credentials privacy**: password appears nowhere in the repo or `output/` outside `.local/pbinfo.local.json` and `archive/secrets/*.age`.

## 6. Risks & mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | pbinfo.ro rate-limit or IP ban | `maxConcurrency=2`, 250–750ms jitter, circuit breaker on 429/5xx |
| 2 | Session expiry mid-crawl | Auto-reauth on 302-to-login via bootstrap |
| 3 | DOM drift in pbinfo.ro | Committed HTML fixtures + live Phase 5 crawl |
| 4 | Electron + WebContentsView Windows quirks | Existing `smoke:desktop-packaged` exercises packaged binary |
| 5 | 15–30k test files in git | Small text; pack compression handles it |
| 6 | Ralph loop context bloat | Prompt references files; doesn't embed spec body |
| 7 | Long crawl wall-clock (~4–5h @ 2 concurrency) | Durable resume queue; loop handles multiple iterations |
| 8 | Test cases containing non-ASCII edge whitespace | Normalization rule preserves interior whitespace; only trims trailing newlines |

## 7. Out of scope (explicit)

- Scheduled/auto-refresh of the archive (Part 3-A chosen; only manual refresh).
- Private-lot / contest-only problems not reachable from standard listings.
- Non-100pt user source body archiving.
- Web-hosted version of the GUI (Electron only).
- Telemetry / analytics.
- Multi-user archives (single-operator design).

## 8. Open decisions (parkable during loop)

- Final `.coverage-thresholds.json` tightening after Phase 1 lands (seed value is 80% global / 90% new-module; adjust on review).
- Whether to commit fresh snapshot files directly or publish as external release asset (follows existing `MAINTAINING.md` "ship a finalized noncanonical snapshot" flow if the file count becomes large).
- Sort-order default: currently "Problem ID asc"; consider "Last attempt desc" if that matches operator daily usage better. Defer to first-week UX feedback.
