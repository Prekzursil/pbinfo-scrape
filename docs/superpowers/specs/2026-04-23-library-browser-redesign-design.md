# Library Browser Redesign — Design Spec

**Date:** 2026-04-23
**Status:** approved, pending implementation plan
**Branch target:** `feat/full-archive-fix-20260423` (same feature branch as the full-archive-fix work)
**Supersedes:** `2026-04-23-pbinfo-full-archive-fix-design.md` sections §3.6–§3.7 (Coverage Explorer UX + embedded live-site viewer)

## 1. Motivation & problem statement

The current desktop shell is a sprawling five-tab operator console (Home · Coverage · Browse · Data · Settings) with:

- Theme inconsistencies that make text unreadable when the OS is in the opposite theme.
- A workspace picker that prompts on first launch and silently remembers the wrong folder forever.
- A dense Home view with six competing metric cards, a second chip-filter row, two focus panels, and a problem list — nothing is the obvious "what now" action.
- A Coverage tab whose filters are under-exposed for the operator's actual daily question: *"which problems still need capture work?"*

The operator does not want an operator console. They want a **library browser** for pbinfo problems: open the app → see every problem → search / filter / click → read the statement, see tests, see their own submissions, see the official source and editorial when captured, see exactly what's missing. Crawling, normalizing, authenticating are *maintenance actions* that should be tucked behind one hidden menu, not promoted as primary surfaces.

## 2. Core design decisions (locked)

| # | Decision | Value |
|---|---|---|
| 1 | Primary experience | Library browser for pbinfo problems |
| 2 | Archive location | Auto-detect `<exe-dir>/archive/` (fallbacks: `<exe-dir>/resources/archive/`, `<cwd>/archive/`) — zero workspace prompt |
| 3 | Theme | Follow OS by default (`prefers-color-scheme`), explicit Auto / Light / Dark override in Settings; both palettes fully designed |
| 4 | Main layout | Table-dense problem list with side drawer on row click |
| 5 | Completeness taxonomy | Granular per-pillar flags + unified rollup status (`complete` / `incomplete-my-gap` / `incomplete-upstream` / `never-crawled`) |
| 6 | At-a-glance row status | Yes — 5 icons per row: statement · editorial · official · mine · tests, using `✓ / 🔒 / ✗ / ·` |
| 7 | Detail drawer | Tabbed (Statement default · Tests · My submissions · Official source · Editorial · Raw data); responsive 900 px on wide viewports, full-viewport under 1280 px |
| 8 | Operator surface | Single "Operator ▾" dropdown in top bar (Login / Run full refresh / Data explorer / Live-site viewer / Settings) |
| 9 | Live-site viewer | Retained but tucked under Operator; opens in a child window, not a main tab |
| 10 | First-launch empty state | Friendly welcome card with embedded "Run initial crawl now" button + "Browse for archive/" escape hatch |
| 11 | Default sort | Problem ID ascending |
| 12 | Search | Free text over id / name / slug / tags (fielded operators are a nice-to-have, not required for v1) |

## 3. Architecture

### 3.1 New files

```
src/gui/renderer/library-shell/
  LibraryShell.tsx              — root component, replaces AppShell + dashboard
  TopBar.tsx                    — title, snapshot chip, theme toggle, Operator ▾
  FilterSidebar.tsx             — collapsible left rail with filter controls
  ProblemsTable.tsx             — virtualized table (react-window or similar)
  ProblemRow.tsx                — single row with status icons
  ProblemDrawer.tsx             — slide-in right drawer
  tabs/
    StatementTab.tsx
    TestsTab.tsx
    SubmissionsTab.tsx
    OfficialSourceTab.tsx
    EditorialTab.tsx
    RawDataTab.tsx
  OperatorMenu.tsx              — dropdown contents
  EmptyStateWelcome.tsx         — first-launch card
  theme/
    tokens.css                  — CSS custom properties, light + dark palettes
    global.css                  — resets, typography
    components.css              — component-scoped styles

src/gui/main/archive-resolver.ts — resolveArchiveRoot() probe logic
src/gui/main/theme-bridge.ts    — nativeTheme → renderer IPC
```

### 3.2 Deleted / retired

```
src/gui/renderer/app-shell.tsx        DELETE (superseded by LibraryShell)
src/gui/renderer/app-shell.css        DELETE (superseded by theme/tokens.css)
src/gui/renderer/dashboard.tsx        DELETE (1200+ line legacy)
src/gui/renderer/coverage-explorer.tsx DELETE (replaced by ProblemsTable + ProblemDrawer)
src/gui/renderer/data-explorer.tsx    KEEP — opened via Operator ▾ only
src/gui/renderer/browse-viewer.tsx    KEEP as host for BrowserView
src/gui/renderer/inline-browse-viewer.tsx KEEP — used by Operator → Live-site viewer
```

### 3.3 Retained backend (unchanged)

- `src/auth/bootstrap.ts`
- `src/crawl/*` (archive-crawler, user-submissions-enumerator, rate-limit-breaker, auth-aware-fetch)
- `src/pbinfo/parsers/*`
- `src/coverage/problem-coverage.ts`
- `src/tests-materializer/materialize-tests.ts`
- `src/mirror/build-mirror.ts`, `src/mirror/server.ts`, `src/mirror/overlay-server.ts`
- `src/gui/main/browser-view-manager.ts`
- CLI commands

### 3.4 Data flow

```
Main process startup
  → resolveArchiveRoot()
      → { found: true,  archiveRoot, snapshotId } | { found: false, probedPaths }
  → theme-bridge.attach(nativeTheme)
  → registerDesktopIpc()
  → load BrowserWindow → renderer

Renderer mount
  → bridge.getArchiveState() via IPC
  → if found:  render LibraryShell with snapshotId
  → if !found: render EmptyStateWelcome

LibraryShell
  → bridge.listProblemRows(filters, sort)
  → bridge.getProblemDetail(problemId) on row click
  → bridge.runOperatorAction(kind) for Operator menu actions
```

### 3.5 IPC contract (new handlers)

| Channel | Payload | Returns |
|---|---|---|
| `archive:state` | `{}` | `{ found, archiveRoot?, snapshotId?, probedPaths }` |
| `library:problems:list` | `{ filters, sort, limit, offset }` | `{ totalCount, rows[] }` |
| `library:problems:detail` | `{ problemId }` | `{ problem, coverage, tests, submissions, officialSources, editorial, rawPaths }` |
| `library:tags` | `{}` | `string[]` |
| `library:theme:get` | `{}` | `{ effective: 'light' \| 'dark', preference: 'auto' \| 'light' \| 'dark' }` |
| `library:theme:set` | `{ preference }` | `{ effective, preference }` |
| `operator:run-full-refresh` | `{}` | streams progress events, returns final result |
| `operator:login` | `{ username, password }` | `{ success, resolvedHandle }` |
| `operator:open-live-site-viewer` | `{ problemId? }` | opens child window |

Zod contracts live in `src/gui/shared/contracts.ts` alongside existing schemas.

## 4. Theme system

### 4.1 CSS custom properties (token file)

Two palettes under `[data-theme="light"]` and `[data-theme="dark"]`. Tokens:

```
--pac-bg            — page background
--pac-bg-panel      — card / panel surface
--pac-bg-hover      — row hover
--pac-bg-active     — row selected
--pac-fg            — primary text
--pac-fg-muted      — secondary text
--pac-fg-subtle     — tertiary (metadata)
--pac-border        — dividers
--pac-border-strong — outlines, input borders
--pac-accent        — primary action color (adjusts between palettes)
--pac-accent-fg     — text on accent surfaces
--pac-success / --pac-warning / --pac-danger — semantic
--pac-shadow-sm / -md / -lg — elevation
--pac-font-sans / -mono
--pac-radius-sm / -md / -lg
--pac-space-1 … -8 — 4/8/12/16/24/32/48/64 px
```

Every component CSS rule uses these tokens only. No hardcoded colors. No `rgba(...)` literals outside the token file.

### 4.2 Theme resolution

- Main process subscribes to `nativeTheme.on('updated')` and broadcasts `theme:changed` IPC.
- Renderer reads `library:theme:get` once on mount, stores `preference` in state, sets `document.documentElement.dataset.theme` to the effective value.
- Settings → Theme dropdown has three options: **Auto** (follows OS live), **Light**, **Dark**. Preference persisted via `library:theme:set` into `desktop-preferences.json`.

### 4.3 Contrast & readability

- Body text contrast ≥ 7:1 in both palettes (WCAG AAA).
- Code blocks get `--pac-bg-panel` background with a single subtle inset border.
- Problem statements render in a reading-optimized typography setting (serif optional via user toggle; default sans-serif for Romanian diacritic clarity).

## 5. Archive auto-detect

### 5.1 `resolveArchiveRoot()` algorithm

```typescript
function resolveArchiveRoot(): ArchiveProbeResult {
  const exeDir = path.dirname(app.getPath('exe'));
  const candidates = [
    path.join(exeDir, 'archive'),                  // primary: packaged portable exe, next to archive/
    path.join(exeDir, 'resources', 'archive'),     // electron-builder default resources dir
    path.join(process.cwd(), 'archive'),           // dev mode fallback
  ];
  for (const candidate of candidates) {
    const catalog = path.join(candidate, 'catalog.json');
    if (existsSync(catalog)) {
      try {
        const parsed = JSON.parse(readFileSync(catalog, 'utf8'));
        return { found: true, archiveRoot: candidate, snapshotId: resolveCurrentSnapshotId(parsed) };
      } catch { /* malformed catalog, continue probe */ }
    }
  }
  return { found: false, probedPaths: candidates };
}
```

If none of the probes succeed, a secondary probe reads `<user-data>/pbinfo-crawler-config.json` for a persisted `manualArchiveOverride` path from the "Browse for archive/" escape hatch (§10.3) before declaring the archive missing.

### 5.2 Snapshot picking

`resolveCurrentSnapshotId(catalog)`:

1. If `catalog.currentSnapshotId` is set and points to a completed snapshot on disk → use it.
2. Else: pick the newest snapshot with `status === 'completed'`.
3. Else: return undefined (will show empty state).

### 5.3 No workspace config

All existing `workspaceRoot` references in the desktop controller are renamed / removed. The "workspace" concept is gone from the UI entirely. Internally, the archive root derived from `resolveArchiveRoot()` becomes the single source of truth for all file reads. `desktop-preferences.json` still exists for theme + verbosity preferences, but no longer holds a workspace path.

## 6. Problems table

### 6.1 Columns

| Col | Header | Width | Content | Sortable |
|---|---|---|---|---|
| 1 | `#` | 72 px | problem id | Yes |
| 2 | `Name` | flex | problem name | Yes |
| 3 | `Grade` | 72 px | 5–12 or — | Yes |
| 4 | `Progress` | 112 px | Chip: solved / partial / — | Yes |
| 5 | `Best` | 64 px | numeric 0–100 or — | Yes |
| 6 | `Archive` | 140 px | 5 icons: stmt · editorial · official · mine · tests | No (status filter covers this) |
| 7 | `Tags` | flex | comma-separated top 3 | No |

### 6.2 Row icons legend

- `✓` (green) = archived / captured / visible for me
- `🔒` (amber) = restricted upstream — I'd need to submit / solve 100 pt to unlock
- `✗` (red) = visible upstream but not yet captured in our archive
- `·` (muted) = not applicable (pbinfo doesn't expose this piece for this problem)

### 6.3 Virtualization

- Uses `react-window` (FixedSizeList) for the 2,500+ row dataset so scrolling stays at 60 fps.
- Row height: 48 px. Visible rows at 1080 px window: ~18. Total DOM nodes: ~30 at any time.

### 6.4 Keyboard

- `Ctrl+F` / `Cmd+F` — focus search input
- `↑` / `↓` — move row selection
- `Enter` — open drawer for selected row
- `Esc` — close drawer
- `Ctrl+L` / `Cmd+L` — focus filters sidebar

## 7. Filter sidebar

### 7.1 Layout (top-to-bottom)

```
[ Search problems…                          ]  (full width, has keyboard shortcut)

Preset: [All] [Incomplete (my gap)] [Solved] [Partial] [Not attempted] [Upstream-blocked]

Grade
  [5] [6] [7] [8] [9] [10] [11] [12] [mixed]

Progress
  ( ) All
  ( ) Solved (100 pt)
  ( ) Partial
  ( ) Not attempted

Completeness
  ( ) All
  ( ) Complete
  ( ) Incomplete — my gap
  ( ) Incomplete — upstream limit
  ( ) Never crawled

Statement              [ all | ✓ | ✗ ]
Editorial              [ all | visible | restricted | hidden | unknown ]
Official source        [ all | archived | restricted | unavailable | not-captured ]
My source              [ all | archived per-language-match | not-applicable ]
Tests                  [ all | captured | not-captured | not-available ]

Languages tried         [ multi-select chips: cpp, c, py, pas, … ]

Best score              [ min ○─────────● max ]

Tags                    [ autocomplete multi-select ]

[ Reset all filters ]
```

### 7.2 Filter interaction

- All filters AND together.
- "Preset" buttons are macros that set a specific combination of the lower filters (and deselect others). Clicking a preset toggles: first click sets it, second click resets to All.
- Filter state is local component state; survives tab changes within a session, does not persist across app restarts (can be added later if requested).

## 8. Problem detail drawer

### 8.1 Shell

- Slides in from the right with 200 ms cubic-bezier ease-out.
- Sticky header: `#<id> <name>` · grade badge · tag badges · status icon strip · "Open in pbinfo.ro" (external) · "Open mirrored" (launches Operator → Live-site viewer scoped to this problem) · close `×`.
- Tabs below header (sticky): Statement · Tests · My submissions · Official source · Editorial · Raw data.

### 8.2 Tab contents

#### Statement

- Rendered problem statement: all `sections[]` from the normalized record, in original order, with headings at h3 level inside the drawer.
- Examples: each input/output pair in side-by-side `<pre>` blocks with a "Copy" button on each.
- Constraints: bulleted list.
- Execution hints: subtle line at top — "Time limit: 0.2 s · Memory: 64 MB".

#### Tests

- Reads the materialized test folder `<archive>/snapshots/<id>/tests/<problem-id>-<slug>/tests.json`.
- Each case: collapsible block with input + expected output side-by-side, provenance chips (`example` / `visible`), and if `evaluationVerdicts` present, a per-language verdict chip cluster.
- "Copy case" button per case.
- "Open folder" button linking to the on-disk test folder.

#### My submissions

- Vertical timeline (newest first) of all evaluations from the operator's `evaluationTimeline`.
- Each row: score badge · language · verdict summary · timestamp · runtime · memory · "View source" button (enabled only when score === 100).
- Clicking "View source" opens the source in-line in the same drawer (or under an accordion beneath the row).

#### Official source

- If `officialSourceArchived`: tabbed sub-view per language (cpp / c / py / pas / etc.) with syntax-highlighted code (Prism or Shiki).
- If `restricted-upstream`: banner "Solve this problem for 100 pt to unlock the official source on pbinfo.ro."
- If `not-available-upstream`: banner "pbinfo.ro doesn't publish an official source for this problem."

#### Editorial

- If `editorialAvailability === 'visible'`: rendered `editorial.html` content.
- If `restricted`: banner "Editorial is visible to you on pbinfo.ro after your first submission — even an incorrect one."
- If `hidden` / `unknown`: banner explaining state.

#### Raw data

- File-paths list with "Open" buttons: normalized problem JSON, evaluation JSONs, source record JSONs, raw HTML pages, coverage record JSON.
- This tab is for power users who want to inspect the archive on disk.

## 9. Operator dropdown

- Top-right of TopBar, icon `⚙` or `▾`.
- Clicking opens a 280 px-wide panel (not a typed `<select>`) anchored below.
- Contents:

```
┌────────────────────────────────────────────────────┐
│ Logged in as Prekzursil  ·  Session 2 h old       │
│ [ Re-authenticate ]                                │
├────────────────────────────────────────────────────┤
│ 🔄 Run full refresh                                │
│    Crawl → normalize → rank → materialize → mirror │
│    → finalize. ~4-5 h wall-clock.                  │
├────────────────────────────────────────────────────┤
│ 📊 Open data explorer                              │
│ 🌐 Open live-site viewer                           │
│ ⚙  Settings                                        │
└────────────────────────────────────────────────────┘
```

- **Run full refresh**: starts the full pipeline in the main process; the TopBar shows a live progress chip (e.g., "Crawl: 12,453 / 22,500 · 2 h 12 m remaining") while the refresh runs. User can continue browsing.
- **Re-authenticate**: tiny form (username + password) → writes to `.local/pbinfo.local.json` with the user's existing secret bundle flow.
- **Settings**: secondary modal with Theme dropdown (Auto / Light / Dark), Verbosity dropdown, Snapshot override dropdown, About/version.

## 10. Empty-state welcome screen

Triggered when `archive:state.found === false`.

### 10.1 Layout

Full-window centered card, 560 px wide max. Copy:

> ## Welcome to Problem Archive Crawler
>
> We couldn't find an `archive/` folder next to this application. Two ways to get started:
>
> ### Build a fresh archive now
>
> [ **Run the initial crawl** ] — signs in with your PBInfo credentials, crawls every problem, your submissions, editorial & official source where visible, and writes everything to `archive/` next to this app. Takes about 4–5 hours on a first run.
>
> ### Point at an existing archive
>
> If you already have an archive folder somewhere, [ **Browse for archive/…** ] lets you pick it.
>
> We tried: `<probed-path-1>`, `<probed-path-2>`, `<probed-path-3>`.

### 10.2 "Run the initial crawl" flow

1. Check if credentials exist in `.local/pbinfo.local.json`.
2. If yes → proceed to step 3.
3. If no → show an inline login form (username + password) in the welcome card, persist on submit.
4. Launch the full refresh pipeline in the main process, streaming progress to the welcome card (progress bar + current step + ETA).
5. On completion: refresh `archive:state`, swap out of empty-state into the full LibraryShell.

### 10.3 "Browse for archive/" flow

- Opens native directory picker (`dialog.showOpenDialog`).
- On selection: writes the chosen path to a fallback config file so future launches probe it too.
- Re-runs `archive:state` and re-renders.

## 11. Testing strategy

### 11.1 Unit tests (vitest)

- `archive-resolver.test.ts` — probe order, fallback, catalog read errors.
- `resolveCurrentSnapshotId.test.ts` — completed-snapshot selection.
- `theme-bridge.test.ts` — OS theme changes propagate to renderer.
- `problems-filter.test.ts` — filter combinations, preset macros.
- `problem-row-status.test.ts` — icon mapping from coverage flags to `✓/🔒/✗/·`.

### 11.2 Component tests (vitest + @testing-library/react)

- `LibraryShell.test.tsx` — renders empty-state when archive missing; renders table when found.
- `ProblemsTable.test.tsx` — virtualization, row click opens drawer, keyboard nav.
- `FilterSidebar.test.tsx` — preset macros, reset, AND-combination.
- `ProblemDrawer.test.tsx` — tab navigation, sticky header, keyboard close.

### 11.3 Theme contrast checks

- Automated: run `axe-core` against rendered components in both light and dark modes; fail on < AA contrast.
- Manual: screenshot matrix (light/dark × 5 tabs) committed under `docs/superpowers/screenshots/` for visual review.

### 11.4 Packaged E2E

- `tests/gui/desktop-electron-smoke.test.ts` updated to assert `LibraryShell` mounts and `EmptyStateWelcome` mounts on missing archive.
- `smoke:desktop-packaged` verifies the portable exe launches, resolves archive, renders a row.

## 12. Rollout

### 12.1 Order of implementation

1. `resolveArchiveRoot` + IPC + empty-state shell (so `archive:state.found === false` path is end-to-end before any content).
2. Theme token system + light + dark palettes.
3. LibraryShell scaffolding (TopBar, FilterSidebar, ProblemsTable without virtualization first).
4. Virtualized table with row status icons.
5. Problem drawer shell + Statement tab.
6. Remaining drawer tabs (Tests, My submissions, Official, Editorial, Raw data).
7. Operator dropdown + Run full refresh streaming.
8. Retire old shell: delete `dashboard.tsx`, `app-shell.tsx`, `coverage-explorer.tsx`.
9. Update packaged smoke + E2E.

### 12.2 One feature branch

Stays on `feat/full-archive-fix-20260423`. Cumulative commits, not a big-bang rewrite — each of the steps above is its own commit with its own tests, so `npm run verify` can be green at every step.

## 13. Out of scope (parkable)

- Fielded search operators (`grade:9 state:incomplete`) — free text only for v1; can add later.
- Filter state persistence across restarts — session-only for v1.
- Custom user tags / notes per problem.
- Export / import of filter presets.
- A separate "history of crawls" view with timeline.
- Notes / annotations per problem.

## 14. Open decisions (can be resolved during implementation)

- Exact accent color for light vs. dark (will pick once I see both palettes against real problem pages).
- Whether the "Tags" column should be truncated to 3 chips or scrollable.
- Whether the drawer's "Statement" tab should offer a serif / sans toggle for reading preference.

None of these block implementation; they're polish knobs.
