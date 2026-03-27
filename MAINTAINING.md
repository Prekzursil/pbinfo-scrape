# Maintaining Problem Archive Crawler

This runbook defines how the canonical PBInfo archive is owned, verified, and promoted.

## Canonical snapshot ownership

- `acceptance-20260310b` is the current **blessed tracked canonical snapshot** in git.
- Files under `archive/snapshots/acceptance-20260310b/` are the git-owned reference copy.
- Local crawl output that changes the canonical snapshot tree is **generated working state**, not implicitly approved canonical content.
- Do **not** silently commit local crawl drift into `acceptance-20260310b`.
- Noncanonical generated snapshots such as `candidate-*`, `targeted-user-*`, and `smoke-*` should stay local or be published as external artifacts/releases unless you are deliberately promoting them into a tracked canonical state.

## What to do when the local canonical snapshot becomes dirty

1. Back up the current working tree state outside the tracked snapshot path.
   - Recommended location pattern:
     - `.local/archive-backups/<timestamp>-acceptance-20260310b/`
   - Include both:
     - a copy of the current snapshot tree
     - a `git status --porcelain` manifest for the dirty files
2. Restore the tracked canonical snapshot back to the committed state on `main`.
3. Keep the restored tracked snapshot as the blessed reference.
4. Treat the backed-up local output as generated working state until a deliberate promotion flow happens.

## Future crawl policy

- Default future run mode is **Incremental sync**.
  - Reuses the canonical archive.
  - Keeps completed URLs.
  - Fetches only newly discovered or still-missing content by default.
- Use **Fresh recrawl** only when you intentionally want a brand-new snapshot.

## When local archive changes should remain local

Keep local crawl output local/generated when:

- you are still exploring new crawl boundaries
- you have not re-run the final normalization/ranking/mirror/finalize sequence
- the canonical queue is not fully drained
- the mirror integrity checks have not been revalidated
- you have not explicitly decided to promote a future snapshot

## How to verify a canonical snapshot

Run the standard code verification first:

```bash
npm install
npm run verify
npm run test:desktop-electron
npm run desktop:pack
```

Then run the canonical archive checks:

```bash
npm run verify:canonical-snapshot
npm run smoke:desktop-packaged
```

The canonical snapshot is only considered healthy when all of the following are true:

- `npm run cli -- crawl status --snapshot acceptance-20260310b` reports:
  - `status: completed`
  - `pending: 0`
  - `inProgress: 0`
  - `publishEligible: true`
- normalized problem records exist under:
  - `archive/snapshots/acceptance-20260310b/normalized/problems/`
- mirror output exists under:
  - `archive/snapshots/acceptance-20260310b/mirror/`
- the mirror route index contains and resolves the required sample routes:
  - `/probleme/3171/waterreserve`
  - `/profil/Prekzursil`
  - `/detalii-evaluare/63332367`

## How to inspect the canonical archive locally

### Crawl completeness

```bash
npm run cli -- crawl status --snapshot acceptance-20260310b
```

### Structured records on disk

- `archive/snapshots/acceptance-20260310b/normalized/problems/`
- `archive/snapshots/acceptance-20260310b/normalized/evaluations/`
- `archive/snapshots/acceptance-20260310b/normalized/rankings/`
- `archive/snapshots/acceptance-20260310b/normalized/routes/`

### Local mirror

```bash
npm run cli -- serve --snapshot acceptance-20260310b --port 4173
```

Then open:

- `http://127.0.0.1:4173/`

### Desktop viewer

Use the desktop app to open:

- **Data Explorer → Problems / Evaluations / Rankings / Mirror Routes**
- **Open normalized archive folder**
- **Open mirror output folder**
- **Open mirror in browser**

## How to promote a future snapshot

Promotion is explicit. Do not overwrite the blessed tracked canonical snapshot casually.

1. Create or complete a future snapshot using the normal crawl workflow.
2. Drain the queue completely.
3. Run:

```bash
npm run cli -- normalize snapshot --snapshot <future-snapshot-id>
npm run cli -- rank --snapshot <future-snapshot-id>
npm run cli -- build-mirror --snapshot <future-snapshot-id>
npm run cli -- snapshot finalize --snapshot <future-snapshot-id>
```

4. Re-run:

```bash
npm run verify:canonical-snapshot
npm run smoke:desktop-packaged
```

5. Confirm the future snapshot should replace `acceptance-20260310b` as the blessed git-owned reference.
6. Commit the deliberate canonical promotion with updated docs if the canonical snapshot ID changes.

## How to ship a finalized noncanonical snapshot

Sometimes you want to preserve a finalized working snapshot without promoting it into the tracked canonical tree.

Recommended flow:

1. finalize the working snapshot
2. export/package the finalized snapshot outside git history
3. publish it as a release asset or another external downloadable artifact
4. keep the PR/repo focused on:
   - code
   - tests
   - docs
   - release metadata

This keeps git history reviewable while still giving operators a reproducible artifact they can download and inspect.

## Pruning, retention, and backups

- The repository keeps a **single blessed tracked canonical snapshot**.
- Heavy raw artifacts remain outside git and are represented by manifests.
- Local backup directories under `.local/archive-backups/` are for rollback/review and stay out of git.
- If you need to clean old generated state, prune backups intentionally; do not remove the most recent safety copy before the restored canonical tree is verified.

## Release reproducibility

- The lockfile (`package-lock.json`) is authoritative.
- Supported runtime/tooling line:
  - Node `>=25.0.0`
  - npm matching the active Node distribution
  - Electron from the versions pinned in `package.json`
- Trusted release sequence:

```bash
npm ci
npm run verify
npm run test:desktop-electron
npm run desktop:pack
npm run verify:canonical-snapshot
npm run smoke:desktop-packaged
npm run cli -- publish --snapshot acceptance-20260310b --release --upload-desktop-exe
```

- If the release also depends on a large finalized noncanonical snapshot, publish that snapshot as a **separate release asset** instead of committing tens of thousands of generated files to git.

## Privacy and reporting alignment

- The repository stays **private**.
- Follow the reporting guidance in `SECURITY.md`.
- Never include live PBInfo credentials, raw cookies, `.local/` contents, or unnecessary private archive payloads in issues, advisories, or release notes.
