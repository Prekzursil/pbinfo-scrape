# Library Browser Redesign — Design Spec

**Date:** 2026-04-23
**Status:** approved, pending implementation plan
**Branch target:** `feat/full-archive-fix-20260423` (same feature branch as the full-archive-fix work)
**Supersedes:** `2026-04-23-pbinfo-full-archive-fix-design.md`:
- §3.6 (Coverage Explorer UX) — fully replaced by §6–§8 of this spec
- §3.7 (Embedded live-site viewer) — kept but demoted to Operator ▾ menu (§9)
- §4 (module change map) — portions touching `dashboard.tsx` / `coverage-explorer.tsx` / `workspace-store.ts` are replaced by §3.1–§3.2 + §5.4 of this spec; crawl/parser/coverage entries remain binding
- Prior spec sections not listed above (auth bootstrap, freshness, acceptance gates for the crawler) remain binding and unmodified

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

Request/response channels (invoke / handle):

| Channel | Payload | Returns |
|---|---|---|
| `archive:state` | `{}` | `{ found, archiveRoot?, snapshotId?, probedPaths, catalogSnapshots?: SnapshotSummary[] }` |
| `archive:set-manual-override` | `{ absolutePath }` | `{ found, archiveRoot?, snapshotId?, probedPaths }` |
| `library:problems:list` | `{ snapshotId?, filters, sort, limit, offset }` | `{ totalCount, rows[], snapshotId }` |
| `library:problems:detail` | `{ snapshotId?, problemId }` | `ProblemDetailPayload` (see below) |
| `library:tags` | `{ snapshotId? }` | `string[]` |
| `library:theme:get` | `{}` | `{ effective: 'light'\|'dark', preference: 'auto'\|'light'\|'dark' }` |
| `library:theme:set` | `{ preference: 'auto'\|'light'\|'dark' }` | `{ effective, preference }` |
| `operator:run-full-refresh` | `{ snapshotLabel? }` | `{ jobId }` (progress streams on `operator:run-full-refresh:progress`; completion on `archive:changed`) |
| `operator:run-full-refresh:cancel` | `{ jobId }` | `{ cancelled: boolean }` |
| `operator:login` | `{ username, password }` | `{ success, resolvedHandle }` |
| `operator:open-live-site-viewer` | `{ problemId? }` | `{ childWindowId }` |

Main→renderer broadcast channels (send / on):

| Channel | Event payload | Emitted when |
|---|---|---|
| `archive:changed` | `{ archiveRoot, snapshotId, cause: 'manual-override'\|'refresh-complete'\|'snapshot-switch' }` | archive root or current snapshot changes for any reason |
| `theme:changed` | `{ effective: 'light'\|'dark' }` | OS `nativeTheme.themeSource` or `shouldUseDarkColors` updates while preference is `auto` |
| `operator:run-full-refresh:progress` | `{ jobId, phase: 'auth'\|'crawl-list'\|'crawl-detail'\|'normalize'\|'rank'\|'materialize'\|'mirror'\|'finalize', processed, total?, etaSeconds?, lastItem?, message? }` | throttled ≤ 1 event / 250 ms during refresh |

**`ProblemDetailPayload` shape** (returned by `library:problems:detail`):

```ts
{
  problem: NormalizedProblem;            // existing shape from coverage/problem-coverage.ts
  coverage: ProblemCoverageRecord;       // existing shape
  tests: {
    folderPath: string;                  // absolute path for "Open folder"
    cases: Array<{
      id: string;
      kind: 'example' | 'visible';
      inputBody: string;                 // already-read from disk in main process
      expectedBody: string;
      evaluationVerdicts?: Record<Language, 'AC'|'WA'|'TLE'|'MLE'|'RE'>;
    }>;
  };
  submissions: {
    evaluations: EvaluationRecord[];     // existing
    sourceBodies: Record<string, string>; // evaluationId → source code (only populated when score === 100)
  };
  officialSource: {
    availability: 'archived' | 'restricted-upstream' | 'not-available-upstream' | 'not-captured-yet';
    bodies?: Record<Language, { body: string; filePath: string }>;
  };
  editorial: {
    availability: 'visible' | 'restricted' | 'hidden' | 'unknown';
    htmlBody?: string;                   // pre-sanitized with DOMPurify in main before return; renderer treats as trusted
    filePath?: string;
  };
  rawPaths: { normalized, coverage, evaluations: string[], sources: string[], rawHtmlPages: string[] };
}
```

Zod contracts live in `src/gui/shared/contracts.ts` alongside existing schemas. All new handlers use `.strict()` and every string field has `max()` bounds. Password on `operator:login` is `z.string().min(1).max(256)`. Main-process handlers MUST NOT log request payloads on error — only error shape/code.

### 3.5.1 Concurrency & invalidation

- `operator:run-full-refresh` acquires a process-level lock (`jobMutex`); a second invocation returns `{ jobId: <existing> }` instead of starting a second pipeline.
- While a refresh is running, `library:problems:list` / `:detail` continue serving from the **previous** snapshot (reads go through the current `archiveRoot`+`snapshotId` pair, never the in-progress snapshot). The finalizer atomically rewrites `catalog.json`'s `currentSnapshotId`, then emits `archive:changed` with `cause: 'refresh-complete'`.
- Renderer subscribes to `archive:changed` and refetches the problem list + whatever drawer tab is open.
- `archive:set-manual-override` and manual snapshot switches also emit `archive:changed` so the renderer has a single invalidation event to listen on.

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
--pac-accent-hover  — primary action hovered (derived: color-mix(in oklch, var(--pac-accent), black 12%) for light; + white 12% for dark)
--pac-accent-active — primary action pressed (color-mix 20%)
--pac-accent-fg     — text on accent surfaces
--pac-status-ok     — ✓ captured state color (distinct from --pac-success)
--pac-status-locked — 🔒 restricted-upstream color
--pac-status-gap    — ✗ not-yet-captured color
--pac-status-na     — · not-applicable color (muted)
--pac-success / --pac-warning / --pac-danger — semantic (banners, toasts)
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

### 4.4 Contrast test (pinned pairs)

A dedicated `tests/gui/theme-contrast.test.ts` computes WCAG ratios against each token *pair* below and fails if any drops below its floor. `axe-core` (§11.3) supplements this at component level.

| Token pair | Minimum ratio |
|---|---|
| `--pac-fg` on `--pac-bg` | 7.0 (AAA body) |
| `--pac-fg` on `--pac-bg-panel` | 7.0 |
| `--pac-fg-muted` on `--pac-bg` | 4.5 (AA large / metadata) |
| `--pac-fg-subtle` on `--pac-bg` | 3.0 (incidental) |
| `--pac-accent-fg` on `--pac-accent` | 4.5 |
| `--pac-accent-fg` on `--pac-accent-hover` | 4.5 |
| `--pac-status-ok` on `--pac-bg` | 3.0 (icon) |
| `--pac-status-locked` on `--pac-bg` | 3.0 |
| `--pac-status-gap` on `--pac-bg` | 3.0 |

Both palettes (`[data-theme=light]` and `[data-theme=dark]`) are asserted by the same test.

## 4b. Renderer security posture

### 4b.1 BrowserWindow hardening

The new `LibraryShell` window uses:

```ts
new BrowserWindow({
  webPreferences: {
    contextIsolation: true,                  // unchanged from current; MUST stay true
    nodeIntegration: false,                  // unchanged; MUST stay false
    sandbox: true,                           // CHANGED from false → true for the new shell
    preload: path.join(__dirname, 'preload.js'),
    webviewTag: false,
    spellcheck: false,
  },
});
```

- **`sandbox: true` is a deliberate change from the current window config** (`src/gui/main/index.ts:58` currently has `sandbox: false`). The new design renders untrusted HTML (editorial, statement) in the main renderer context; process-level sandbox is the safety net if preload → contextBridge isolation is ever bypassed. The preload script only uses `contextBridge.exposeInMainWorld(...)` + `ipcRenderer.invoke` — both sandbox-compatible.
- Child window for the live-site viewer (§9, §10) uses a **separate** preload that exposes no IPC at all; it's a pure `WebContentsView` host and also runs with `sandbox: true`.

### 4b.2 Content-Security-Policy

`src/gui/renderer/index.html` receives a CSP `<meta>` tag (and the same policy is injected via `session.defaultSession.webRequest.onHeadersReceived` as a belt-and-braces):

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';        — React inline styles + highlighter tokens
img-src 'self' data:;
font-src 'self' data:;
connect-src 'self' http://127.0.0.1:*;   — only the local mirror server
frame-src 'self' http://127.0.0.1:*;     — inline-browse-viewer iframe host
object-src 'none';
base-uri 'self';
form-action 'none';
```

No `'unsafe-eval'`, no remote script sources. The local mirror server bind is validated in `src/mirror/server.ts` (existing code — binds to `127.0.0.1`).

### 4b.3 HTML sanitization (Statement & Editorial tabs)

Archived pbinfo HTML is **untrusted** — it originated from user-supplied content on a public site. Both HTML-rendering drawer tabs must sanitize before insertion.

**Policy:** Main process sanitizes once at read time, renderer treats the sanitized result as presentation-safe.

Implementation:
- New util `src/pbinfo/html/sanitize-archive-html.ts` wraps `isomorphic-dompurify` (pinned version in `package.json`).
- Config: permit `p, h1-h6, ul, ol, li, strong, em, code, pre, blockquote, a[href], img[src|alt|width|height], table/thead/tbody/tr/td/th, div[class], span[class]`. Strip `script, iframe, object, embed, style, on*` attrs, any `javascript:` / `data:` / `vbscript:` protocol in `href` / `src` except `data:image/*`.
- Main-process `library:problems:detail` handler calls the sanitizer before returning `editorial.htmlBody` / `problem.statementHtml`.
- Unit test `tests/pbinfo/html/sanitize-archive-html.test.ts` asserts: script tags stripped, event handlers stripped, `javascript:` URIs stripped, benign HTML preserved intact.
- Renderer uses React's HTML-injection prop only on sanitized bodies returned by main (never on raw archive reads). The prop name is intentionally not repeated here to avoid search false-positives — see the React docs for the API — and usage is confined to `StatementTab.tsx` and `EditorialTab.tsx`.

### 4b.4 Operator login handler

`operator:login` IPC handler:
- Schema: `z.object({ username: z.string().min(1).max(64), password: z.string().min(1).max(256) }).strict()`
- Handler MUST NOT log the payload on error. Only `{ code, message }` from an error object is logged; the password is never written to any log, telemetry, or error report.
- Renderer form submits over IPC in one shot; no intermediate state in localStorage/sessionStorage. The renderer clears the form's state immediately on response.
- Success path hands the credential to existing `src/auth/bootstrap.ts` for age-encryption into `.local/pbinfo.local.json` — no change to that pipeline.

### 4b.5 Refresh rate-limiting

- `operator:run-full-refresh` is idempotent: a second call while one is running returns the existing `jobId` (§3.5.1 job mutex). The UI disables the menu item and the empty-state button while a job is active.
- `operator:run-full-refresh:cancel` is the only way to stop an in-flight job; cancellation is cooperative (signals the pipeline, waits for graceful shutdown, writes `status: 'cancelled'` to the snapshot manifest).

## 5. Archive auto-detect

### 5.1 `resolveArchiveRoot()` algorithm

```typescript
const CATALOG_MAX_BYTES = 2 * 1024 * 1024; // 2 MB — catalog.json is metadata-only

function resolveArchiveRoot(): ArchiveProbeResult {
  const exeDir = path.dirname(app.getPath('exe'));
  const manual = readManualArchiveOverride(); // <user-data>/pbinfo-crawler-config.json → { manualArchiveOverride?: string }
  const candidates = [
    ...(manual ? [manual] : []),                 // first priority: user-picked path from §10.3
    path.join(exeDir, 'archive'),                // primary: packaged portable exe, next to archive/
    path.join(exeDir, 'resources', 'archive'),   // electron-builder default resources dir
    path.join(process.cwd(), 'archive'),         // dev mode fallback
  ];
  for (const candidate of candidates) {
    const catalog = path.join(candidate, 'catalog.json');
    if (!existsSync(catalog)) continue;
    try {
      const stat = statSync(catalog);
      if (stat.size > CATALOG_MAX_BYTES) continue;         // DoS guard: malformed or hostile catalog
      if (!stat.isFile()) continue;
      const parsed = JSON.parse(readFileSync(catalog, 'utf8'));
      const snapshotId = resolveCurrentSnapshotId(parsed, candidate);
      return { found: true, archiveRoot: candidate, snapshotId };
    } catch { /* malformed catalog, continue probe */ }
  }
  return { found: false, probedPaths: candidates };
}
```

- `CATALOG_MAX_BYTES = 2 MB` caps synchronous disk+parse on the main thread.
- `resolveCurrentSnapshotId(parsed, archiveRoot)` also verifies `<archiveRoot>/snapshots/<id>/` exists before returning it.
- `readManualArchiveOverride()` reads and validates (Zod `{ manualArchiveOverride: z.string().max(4096) }`) the persisted path from `<app.getPath('userData')>/pbinfo-crawler-config.json`. A stale path (directory no longer exists / wrong catalog) is silently dropped from the probe list, not treated as an error.

### 5.2 Snapshot picking

`resolveCurrentSnapshotId(catalog)`:

1. If `catalog.currentSnapshotId` is set and points to a completed snapshot on disk → use it.
2. Else: pick the newest snapshot with `status === 'completed'`.
3. Else: return undefined (will show empty state).

### 5.3 No workspace config

All existing `workspaceRoot` references in the desktop controller are renamed / removed. The "workspace" concept is gone from the UI entirely. Internally, the archive root derived from `resolveArchiveRoot()` becomes the single source of truth for all file reads. `desktop-preferences.json` still exists for theme + verbosity preferences, but no longer holds a workspace path.

### 5.4 Workspace → archive migration (explicit)

Concrete file-level renames and threading changes (these are plan-visible, not exploratory):

| Old | New | Notes |
|---|---|---|
| `src/gui/main/workspace-store.ts` | `src/gui/main/archive-store.ts` | Persists `manualArchiveOverride` path + `lastKnownSnapshotId` to `<userData>/pbinfo-crawler-config.json`. Replaces workspace-root persistence. |
| `src/gui/main/desktop-controller.ts` param `workspaceRoot` | `archiveRoot` | Constructor + IPC handler signatures updated. |
| `src/gui/main/ipc.ts` channels: `workspace:choose`, `workspace:current` | **removed** (replaced by `archive:state` + `archive:set-manual-override` §3.5) | Renderer no longer prompts for workspace. |
| `src/gui/shared/bridge.ts` → `bridge.workspace.*` surface | `bridge.archive.*` | `getState()`, `setManualOverride(path)`, `onChanged(cb)`. |
| `desktop-preferences.json` keys: `workspaceRoot`, `recentWorkspaces[]` | **migrated away**: both keys dropped on load (ignored if present from old installs) | No read-path code references them after this branch. |

The migration is **forward-only**: on first launch with the new shell, if `desktop-preferences.json` contains the old keys, they're silently dropped (the new shell re-detects archive via `resolveArchiveRoot()`). No schema version bump needed; Zod `.strict()` is relaxed via `.passthrough().transform()` to tolerate legacy keys exactly once.

## 6. Problems table

### 6.1 Columns

| Col | Header | Width | Content | Sortable |
|---|---|---|---|---|
| 1 | `#` | 72 px | problem id | Yes |
| 2 | `Name` | flex | problem name | Yes |
| 3 | `Grade` | 72 px | 5–12 or — | Yes |
| 4 | `Progress` | 112 px | Chip: solved / partial / — | Yes |
| 5 | `Best` | 64 px | numeric 0–100 or — | Yes |
| 6 | `Captured` | 140 px | 5 icons: stmt · editorial · official · mine · tests | No (status filter covers this) |
| 7 | `Tags` | flex | comma-separated top 3 | No |

### 6.2 Row icons legend

Icons are SVG components from `lucide-react` (already declared a dependency in the plan; no emoji in production UI — emoji rendering varies across Windows/macOS/Electron packaged builds and fails color-blind users).

| Visual | Icon | Semantic color token | Meaning |
|---|---|---|---|
| ✓ | `lucide:Check` | `--pac-status-ok` | archived / captured / visible for me |
| 🔒 | `lucide:Lock` | `--pac-status-locked` | restricted upstream — submit / solve 100 pt to unlock |
| ✗ | `lucide:X` | `--pac-status-gap` | visible upstream but not yet captured in our archive |
| · | `lucide:Circle` (filled, 4px) | `--pac-status-na` | not applicable (pbinfo doesn't expose this for this problem) |

Each icon cell has `role="img"` and `aria-label="<pillar>: <human-readable state>"` (e.g., `aria-label="Editorial: captured"`), plus a native `title` tooltip for the same text. Screen readers announce the pillar+state combination without relying on color or glyph.

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

- If `officialSourceArchived`: tabbed sub-view per language (cpp / c / py / pas / etc.) with syntax-highlighted code. **Highlighter: Shiki** (uses VS Code TextMate grammars, same parser as VS Code itself, better C++ / Pascal / Python fidelity; bundled only the language grammars actually present in the archive to stay under bundle budget).
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

Visual dividers group the 5 items into three zones: **session** (Re-authenticate) · **destructive long-running** (Run full refresh) · **read-only explorers** (Open data explorer, Open live-site viewer, Settings). This tells the user at a glance which menu item causes background work vs. opens a view.

- **Run full refresh**: starts the full pipeline in the main process; the TopBar shows a live progress chip (e.g., "Crawl: 12,453 / 22,500 · 2 h 12 m remaining") while the refresh runs. User can continue browsing. The menu item is **disabled** (with tooltip "Refresh in progress") while a job is active — prevents accidental double-invocation (§4b.5 job mutex is the correctness guard; this is the UX guard).
- **Re-authenticate**: tiny form (username + password) → writes to `.local/pbinfo.local.json` with the user's existing secret bundle flow. Form state cleared on submit (§4b.4).
- **Settings**: secondary modal with Theme dropdown (Auto / Light / Dark), Verbosity dropdown, Snapshot override dropdown (populated from `archive:state.catalogSnapshots`), About/version.

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
4. Launch the full refresh pipeline in the main process, streaming progress via `operator:run-full-refresh:progress` events (§3.5) to the welcome card.
5. On completion: `archive:changed` fires, renderer refreshes `archive:state`, swaps out of empty-state into the full LibraryShell.

**Progress panel layout during the 4–5h run:**

```
Phase chips (horizontal, one highlights as active):
[ Auth ] → [ Crawl list ] → [ Crawl detail ] → [ Normalize ] → [ Rank ] → [ Materialize ] → [ Mirror ] → [ Finalize ]

Active phase card:
┌──────────────────────────────────────────────┐
│ Phase: Crawl detail  ·  3 h 12 m remaining   │
│ 12,456 / 22,500 pages  (55%)                 │
│ ▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░░░░                     │
│                                              │
│ Last captured: #3842 — 2-colorabil           │
│ Rate: 142 pages/min (avg over last 5 min)    │
└──────────────────────────────────────────────┘

[ Cancel crawl ]   (asks for confirmation, calls operator:run-full-refresh:cancel)
```

Per-phase progress events drive the chip highlight and the rolling "Last captured" line. This prevents the "frozen progress bar for hours" effect.

### 10.3 "Browse for archive/" flow

- Opens native directory picker (`dialog.showOpenDialog`).
- On selection: writes the chosen path to a fallback config file so future launches probe it too.
- Re-runs `archive:state` and re-renders.

## 11. Testing strategy

### 11.1 Unit tests (vitest)

Main-process / pure logic:

- `tests/gui/main/archive-resolver.test.ts` — probe order, manual override priority, 2 MB catalog size cap, malformed JSON, missing snapshots dir, dev-mode cwd fallback.
- `tests/gui/main/resolveCurrentSnapshotId.test.ts` — explicit `currentSnapshotId`, fallback to newest completed, all-in-progress returns undefined.
- `tests/gui/main/archive-store.test.ts` — reads/writes `manualArchiveOverride`, tolerates legacy `workspaceRoot` key on load (drops it), Zod-validates the path string.
- `tests/gui/main/theme-bridge.test.ts` — `nativeTheme.on('updated')` → `theme:changed` broadcast, preference persistence round-trip.
- `tests/gui/main/run-refresh-mutex.test.ts` — second invocation returns existing jobId, cancel path emits terminal progress event.
- `tests/pbinfo/html/sanitize-archive-html.test.ts` — script stripped, event handlers stripped, `javascript:` URIs stripped, benign HTML preserved intact, image `data:` preserved only when `image/*`.
- `tests/gui/theme-contrast.test.ts` — token-pair WCAG ratios at or above the floors in §4.4, both palettes.

Renderer logic (no DOM):

- `tests/gui/renderer/problems-filter.test.ts` — filter combinations, preset macros, AND semantics, reset behavior.
- `tests/gui/renderer/problem-row-status.test.ts` — coverage-flag → icon+label mapping (driven by a fixture table of real `ProblemCoverageRecord` shapes).

### 11.2 Component tests (vitest + @testing-library/react)

- `LibraryShell.test.tsx` — renders empty-state when archive missing; renders table when found.
- `ProblemsTable.test.tsx` — virtualization, row click opens drawer, keyboard nav.
- `FilterSidebar.test.tsx` — preset macros, reset, AND-combination.
- `ProblemDrawer.test.tsx` — tab navigation, sticky header, keyboard close.

### 11.3 Theme contrast checks

- Primary: `tests/gui/theme-contrast.test.ts` (§4.4) computes ratios against pinned token pairs in both palettes — fails CI if any pair drops below its floor.
- Supplement: `axe-core` runs against each rendered component in both light and dark modes during component tests (§11.2) — catches contrast regressions inside actual component compositions.
- Manual: screenshot matrix (light/dark × 5 drawer tabs + TopBar + FilterSidebar + EmptyStateWelcome) committed under `docs/superpowers/screenshots/` for visual review.

### 11.4 Packaged E2E

- `tests/gui/desktop-electron-smoke.test.ts` updated to assert `LibraryShell` mounts and `EmptyStateWelcome` mounts on missing archive.
- `smoke:desktop-packaged` verifies the portable exe launches, resolves archive, renders a row.

### 11.5 Coverage thresholds

`.coverage-thresholds.json` `perModule` gets new entries at the project's standard 80/75/80/80 floor:

```json
{
  "perModule": {
    "src/gui/main/archive-resolver.ts":    { "lines": 90, "branches": 80, "functions": 90, "statements": 90 },
    "src/gui/main/archive-store.ts":       { "lines": 85, "branches": 75, "functions": 85, "statements": 85 },
    "src/gui/main/theme-bridge.ts":        { "lines": 85, "branches": 75, "functions": 85, "statements": 85 },
    "src/gui/renderer/library-shell/**":   { "lines": 80, "branches": 75, "functions": 80, "statements": 80 },
    "src/pbinfo/html/sanitize-archive-html.ts": { "lines": 95, "branches": 85, "functions": 95, "statements": 95 }
  }
}
```

- archive-resolver + sanitizer get **higher floors** (90–95%) because they're security-critical: every branch is a probe path or a sanitization rule.
- The rest hold the project default. `library-shell/**` uses glob because it's a directory of components added incrementally in steps 4–8.
- The threshold bump lands as **step 10** (standalone commit) so the gate flips on at a predictable point; a passing `npm run verify` on that commit proves all new code is above floor.

## 12. Rollout

### 12.1 Order of implementation

1. **archive-resolver + IPC skeleton + empty-state shell.** `resolveArchiveRoot()`, `archive:state`, `archive:set-manual-override`, and the `EmptyStateWelcome` component. End-to-end for `found === false`. Old shell untouched.
2. **Theme token system + `theme:changed` bridge.** Tokens file, both palettes, `theme-contrast.test.ts`, renderer subscription to `theme:changed`. No component styling yet.
3. **Workspace → archive rename (§5.4).** `archive-store.ts` + controller + bridge threading changes. **Non-destructive:** old `workspace-store.ts` deleted only in step 8.
4. **LibraryShell scaffolding.** TopBar + FilterSidebar + ProblemsTable **without** virtualization, renders rows from `library:problems:list`. Keyboard shortcuts wired.
5. **Virtualized table + row status icons (SVG, §6.2).** `react-window` swap; row count fixture fed from real snapshot data.
6. **Problem drawer shell + Statement tab + sanitizer.** `sanitize-archive-html.ts` + unit tests + StatementTab render.
7. **Remaining drawer tabs.** Tests, My submissions, OfficialSource (Shiki), Editorial, Raw data. Each with its own test file.
8. **Operator dropdown + `operator:run-full-refresh` + progress panel (§10.2).** Job mutex, progress event throttling, cancel path.
9. **Retire old shell (destructive, gated on steps 1–8 packaged-smoke-green).** Delete `dashboard.tsx`, `app-shell.tsx`, `app-shell.css`, `coverage-explorer.tsx`, `workspace-store.ts`. Update `main/index.ts` to only import `LibraryShell`. Run packaged smoke + E2E before commit.
10. **Coverage threshold update.** Add `src/gui/renderer/library-shell/**` and `src/gui/main/archive-*.ts` to `.coverage-thresholds.json` `perModule` at the project's standard floor (see §11.5). This is a standalone commit so the coverage gate flips on at a known point.
11. **Update packaged smoke + E2E for the new shell.** Adds `desktop-electron-smoke.test.ts` assertions for `LibraryShell` + `EmptyStateWelcome`.

Steps 1–8 keep the old shell alive and functional. Step 9 is the single destructive commit; if step 11 catches a regression, step 9 is reverted cleanly (no intermediate work is lost). Step 10 can run concurrently with step 11.

### 12.2 One feature branch

Stays on `feat/full-archive-fix-20260423`. Cumulative commits, not a big-bang rewrite — each of the steps above is its own commit with its own tests, so `npm run verify` can be green at every step.

### 12.3 Success metrics

Observable checks run at step 11:

| Metric | Target | How measured |
|---|---|---|
| Cold launch to interactive | < 1.5 s on dev machine | Electron `did-finish-load` timestamp minus `BrowserWindow` create |
| First paint with 2,500 rows | < 500 ms after `library:problems:list` resolves | React DevTools profiler in dev; manual timing in E2E |
| Zero workspace prompts on any launch path | 0 prompts observed | E2E asserts no `dialog.showOpenDialog` called during automatic launch |
| Axe-core contrast pass rate | 100% in both palettes | `tests/gui/theme-contrast.test.ts` + component axe runs |
| Theme-switch end-to-end latency | < 200 ms from OS change to repainted DOM | Instrumented `theme:changed` → `dataset.theme` set timestamp |
| Drawer open latency | < 100 ms from row click to first tab painted | `library:problems:detail` roundtrip + tab render |

## 13. Out of scope (parkable)

- Fielded search operators (`grade:9 state:incomplete`) — free text only for v1; can add later.
- Filter state persistence across restarts — session-only for v1.
- Custom user tags / notes per problem.
- Export / import of filter presets.
- A separate "history of crawls" view with timeline.
- Notes / annotations per problem.

## 14. Open decisions (can be resolved during implementation)

- Exact accent color for light vs. dark (will pick once I see both palettes against real problem pages).
- ~~Whether the "Tags" column should be truncated to 3 chips or scrollable.~~ **Resolved:** truncate to 3 + drawer reveal. Horizontal scroll inside a virtualized row breaks `react-window` measurement.
- Whether the drawer's "Statement" tab should offer a serif / sans toggle for reading preference.
- Whether the filter sidebar collapses to a sheet on < 1024 px window width or hides behind a menu button.

None of these block implementation; they're polish knobs.
