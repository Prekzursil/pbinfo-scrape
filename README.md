# Problem Archive Crawler

Problem Archive Crawler is a **private PBInfo archival operator console** for the `pbinfo-scrape` package. It is built to create and inspect a truthful PBInfo archive across:

- problem statements and mirrorable PBInfo pages
- example / visible / evaluation-observed tests
- official source availability
- your own best trustworthy solutions per solved language
- a local Windows-first desktop audit workflow for continuing crawls and reviewing archive truth

## Security

This repository stays **private**. Supported reporting instructions live in [SECURITY.md](./SECURITY.md).

Maintainer-facing archive ownership and release guidance lives in [MAINTAINING.md](./MAINTAINING.md).

## Quick Start

```bash
npm install
npm run verify
npm run verify:canonical-snapshot
npm run cli -- --help
```

## Latest private release

- Current private tag: `v0.1.3`
- Current packaged desktop executable after `npm run desktop:pack`:
  - `release-desktop/Problem Archive Crawler 0.1.3.exe`
- Current unpacked smoke target after `npm run desktop:pack`:
  - `release-desktop/win-unpacked/Problem Archive Crawler.exe`
- Release notes for the current build live in:
  - [`docs/releases/v0.1.3.md`](./docs/releases/v0.1.3.md)

Latest finalized targeted snapshot delivery:

- GitHub prerelease: `snapshot-targeted-user-20260327-0645`
- Release asset: `targeted-user-20260327-0645.tar.zst`
- Contents:
  - `archive/snapshots/targeted-user-20260327-0645`
  - `archive/artifacts/targeted-user-20260327-0645.json`

## Local Config

Create `.local/pbinfo.local.json` for live runs. The `.local/` directory stays untracked; the repo-safe encrypted bundle flow writes to `archive/secrets/`.

```json
{
  "auth": {
    "strategy": "credentials",
    "username": "YOUR_PBINFO_USERNAME",
    "password": "<set-at-runtime-only>"
  },
  "crawl": {
    "userHandle": "YOUR_PBINFO_HANDLE",
    "maxConcurrency": 2
  }
}
```

## CLI Flow

```bash
# Login or import cookies
npm run cli -- auth login
npm run cli -- auth import-cookies --source path/to/storage-state.json
npm run cli -- auth import-browser --browser edge --profile Default

# Encrypt the local auth/session material for repo-safe storage
npm run cli -- secrets bootstrap

# Crawl, normalize, rank, build the mirror, and finalize the canonical snapshot
npm run cli -- crawl all --acceptance --mode incremental
npm run cli -- crawl status --snapshot acceptance-20260310b
npm run cli -- normalize snapshot --snapshot acceptance-20260310b
npm run cli -- rank --snapshot acceptance-20260310b
npm run cli -- build-mirror --snapshot acceptance-20260310b
npm run cli -- snapshot finalize --snapshot acceptance-20260310b
npm run cli -- serve --snapshot acceptance-20260310b --port 4173

# Export heavy raw artifacts and publish the repo with a tagged GitHub release
npm run cli -- publish --snapshot acceptance-20260310b --release --upload-desktop-exe
```

## Desktop App

The Windows desktop app is branded as `Problem Archive Crawler`. It wraps the same archive engine with a persistent operator GUI for workspace selection, PBInfo profile login/browser import, crawl control, rankings, mirror preview, and snapshot finalization. GitHub publish intentionally stays CLI-only.

### What the app is for

The desktop UI is optimized for three operator questions:

1. **What is solved, unsolved, complete, or still missing?**
2. **Can I open the mirror or the detailed truth record for a problem quickly?**
3. **Is the archive missing something because capture failed, or because PBInfo does not expose it upstream?**

### Main views

- **Overview**
  - fast status board for solved / unsolved / complete / missing official source / missing your source / missing tests
  - one-click drill-down into mirror and coverage detail
  - quick crawl + normalize + rank + mirror + finalize actions
- **Coverage**
  - deeper per-problem audit view with truthful status wording
  - tests coverage, official source status, your source status, archive completeness, editorial visibility
- **Data**
  - raw normalized archive datasets and record payloads
- **Setup**
  - workspace, PBInfo profile, cookie import/login, advanced settings

### Snapshot behavior

- The desktop app now defaults to the **latest available snapshot** when it has not been pinned manually.
- The tracked canonical baseline remains `acceptance-20260310b`.
- Noncanonical generated snapshots are local working state unless explicitly promoted or published as external release assets.

### Crawl modes

- `Incremental sync` is the default in both CLI and desktop. It reuses the canonical snapshot, keeps completed URLs, reseeds the root surfaces, and only fetches newly discovered or still-pending URLs.
- `Fresh recrawl` creates a brand-new snapshot and re-harvests everything from scratch.

```bash
# Generate local brand assets used by the renderer and portable package
npm run desktop:assets

# Build the desktop renderer + Electron main/preload bundles
npm run desktop:build

# Run the real Electron smoke test against the built app
npm run test:desktop-electron

# Run the Electron app in development
npm run desktop:dev

# Start the built Electron app
npm run desktop:start

# Produce the Windows x64 portable executable
npm run desktop:pack

# Run the packaged-app smoke checks against both the unpacked Electron app
# and the release portable executable
npm run smoke:desktop-packaged
```

Desktop build outputs:

- `dist-desktop/gui/main/index.js`: Electron main entry used by the packaged app.
- `dist-desktop/gui/renderer/index.html`: built renderer shell loaded in production.
- `release-desktop/Problem Archive Crawler 0.1.3.exe`: Windows x64 portable executable for the current private release.
- `release-desktop/win-unpacked/Problem Archive Crawler.exe`: unpacked smoke-test target used by `npm run smoke:desktop-packaged`.

## Canonical snapshot policy

- `acceptance-20260310b` is the current **blessed tracked canonical snapshot**.
- Local crawl changes under `archive/snapshots/acceptance-20260310b/` are treated as **generated working state** until a maintainer explicitly promotes them.
- Do **not** silently recommit local crawl drift into the canonical snapshot. Back it up first, restore the tracked reference, and follow the promotion steps in [MAINTAINING.md](./MAINTAINING.md).

## Where is the archive locally?

There are two different local views of the archive:

- **Mirror view**: browse the captured PBInfo pages like a local website.
- **Normalized archive**: inspect the structured JSON records that power ranking, routing, and the desktop Data Explorer.

### Fastest visual entry points

- Start the desktop app and use the **Overview** status board when you want the fastest problem triage view:
  - solved
  - unsolved
  - complete
  - missing official source
  - missing your source
  - missing tests
- Use the **Coverage Explorer** panel when you want the truthful per-problem audit view:
  - solved by your archived handle
  - tests fragment archived
  - visible tests captured
  - official source archived
  - user source archived
  - editorial visibility
- Use the **Mirror Preview** panel to embed the local archive viewer.
- Use the **Data Explorer** panel when you want raw normalized datasets:
  - Problems
  - Evaluations
  - Rankings
  - Mirror Routes

### Mirror on localhost

```bash
npm run cli -- serve --snapshot acceptance-20260310b --port 4173
```

Then open:

- `http://127.0.0.1:4173/`
- `http://127.0.0.1:4173/archive/coverage/`

The `/archive/coverage/` route is the mirror-friendly coverage index. It links back into mirrored problem pages and uses archive-truth wording such as:

- `Tests fragment archived`
- `Visible tests captured: 0`
- `Official source not archived`

### Structured archive on disk

- Normalized records:
  - `archive/snapshots/acceptance-20260310b/normalized/`
- Rewritten mirror output:
  - `archive/snapshots/acceptance-20260310b/mirror/`

The desktop app now exposes direct actions for:

- **Open normalized archive folder**
- **Open mirror output folder**
- **Open mirror in browser**

### Problem coverage records on disk

The derived per-problem coverage dataset lives under:

- `archive/snapshots/acceptance-20260310b/normalized/problem-coverage/`

This is the fastest structured place to answer the original audit questions:

- which problems are solved by your archived handle
- which problems have archived test fragments
- which problems have visible tests captured
- which problems have archived official or user source code
- which problems have editorial visibility in the canonical archive

### Crawl completeness and integrity checks

High-level queue/crawl truth source:

```bash
npm run cli -- crawl status --snapshot acceptance-20260310b
```

Maintainer-friendly canonical snapshot verification:

```bash
npm run verify:canonical-snapshot
```

## Archive Layout

- `archive/catalog.json`: current snapshot pointer plus retained snapshot/export metadata.
- `archive/snapshots/<snapshot-id>/normalized/`: tracked normalized records, rankings, and mirror route records.
- `archive/snapshots/<snapshot-id>/mirror/`: rewritten shell-preserving mirror pages for localhost serving.
- `archive/artifacts/<snapshot-id>.json`: committed manifest for the heavy raw artifact export.
- `archive/secrets/`: repo-safe age-encrypted auth bundle and recipient metadata.
- `output/artifacts/<snapshot-id>/`: heavy raw pages/assets captured during crawl and rehydrated for mirror replay.
- `.local/`: plaintext config, session cookies, and the local age identity. This directory stays out of git.

## Notes

- The crawler keeps snapshot-specific raw artifacts outside the tracked archive tree so the normalized archive can live in git while heavy raw payloads can be exported separately.
- Noncanonical generated snapshot trees such as `candidate-*`, `targeted-user-*`, and `smoke-*` are ignored locally by default and should be shared as external artifacts or explicit releases, not silently committed into git.
- The mirror rewrites PBInfo page shells to local routes and local vendored assets. Analytics and ad scripts are stripped during mirror build.
- `publish --snapshot <id> --release --upload-desktop-exe` only proceeds when the selected snapshot is canonical, drained, exported, secret-clean, and backed by the final `Problem Archive Crawler *.exe` release asset.
- The desktop Data Explorer reads from the existing normalized archive outputs; it does not create a second archive format.
- Use [MAINTAINING.md](./MAINTAINING.md) for the canonical snapshot ownership policy, backup expectations, promotion flow, and reproducible release sequence.
