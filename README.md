# Problem Archive Crawler

PBInfo archival operator console for the `pbinfo-scrape` package: hybrid PBInfo archive crawling, ranking, encrypted auth-bundle workflow, localhost mirror serving, and a Windows desktop operator app.

## Security

This repository stays **private**. Supported reporting instructions live in [SECURITY.md](./SECURITY.md).

## Quick Start

```bash
npm install
npm run verify
npm run cli -- --help
```

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
npm run cli -- serve --port 4173

# Export heavy raw artifacts and publish the repo with a tagged GitHub release
npm run cli -- publish --snapshot acceptance-20260310b --release --upload-desktop-exe
```

## Desktop App

The Windows desktop app is branded as `Problem Archive Crawler`. It wraps the same archive engine with a persistent operator GUI for workspace selection, PBInfo profile login/browser import, crawl control, rankings, mirror preview, and snapshot finalization. GitHub publish intentionally stays CLI-only.

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
```

Desktop build outputs:

- `dist-desktop/gui/main/index.js`: Electron main entry used by the packaged app.
- `dist-desktop/gui/renderer/index.html`: built renderer shell loaded in production.
- `release-desktop/Problem Archive Crawler 0.1.0.exe`: Windows x64 portable executable.

## Where is the archive locally?

There are two different local views of the archive:

- **Mirror view**: browse the captured PBInfo pages like a local website.
- **Normalized archive**: inspect the structured JSON records that power ranking, routing, and the desktop Data Explorer.

### Fastest visual entry point

- Start the desktop app and use the **Mirror Preview** panel to embed the local archive viewer.
- Use the **Data Explorer** panel to inspect the core normalized datasets:
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

### Structured archive on disk

- Normalized records:
  - `archive/snapshots/acceptance-20260310b/normalized/`
- Rewritten mirror output:
  - `archive/snapshots/acceptance-20260310b/mirror/`

The desktop app now exposes direct actions for:

- **Open normalized archive folder**
- **Open mirror output folder**
- **Open mirror in browser**

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
- The mirror rewrites PBInfo page shells to local routes and local vendored assets. Analytics and ad scripts are stripped during mirror build.
- `publish --snapshot <id> --release --upload-desktop-exe` only proceeds when the selected snapshot is canonical, drained, exported, secret-clean, and backed by the final `Problem Archive Crawler *.exe` release asset.
- The desktop Data Explorer reads from the existing normalized archive outputs; it does not create a second archive format.
