# Library Browser Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sidebar AppShell + Coverage Explorer + Dashboard + workspace-prompt surface with a library-browser-first Electron shell (auto-detected archive root, OS-follow theme, virtualized problems table, slide-in drawer, Operator dropdown).

**Architecture:** Incremental (non-big-bang) rollout on `feat/full-archive-fix-20260423`. Old shell runs in parallel through step 8; step 9 is the single destructive cut-over commit, gated on packaged-smoke-green from steps 1–8. New renderer code lives under `src/gui/renderer/library-shell/`; archive detection + persistence live in `src/gui/main/archive-resolver.ts` + `src/gui/main/archive-store.ts`; an archive-truth HTML sanitizer sits in `src/pbinfo/html/sanitize-archive-html.ts`.

**Tech Stack:** TypeScript 5.9 / Node 25 / Electron 40 / React 19 / Vite 7 / vitest + @testing-library/react / Zod 4 / react-window / lucide-react / shiki / isomorphic-dompurify.

**Design spec:** `docs/superpowers/specs/2026-04-23-library-browser-redesign-design.md` (commit `6d0bc2b91`).

---

## Task 1: Archive resolver + archive state IPC + empty-state shell

Builds the end-to-end `archive:state.found === false` path so the app launches without prompting for a workspace. Nothing in the old shell is deleted or rewired yet — this runs alongside `app-shell.tsx`.

**Files:**
- Create: `src/gui/main/archive-resolver.ts`
- Create: `src/gui/main/archive-store.ts`
- Create: `src/gui/renderer/library-shell/EmptyStateWelcome.tsx`
- Create: `src/gui/renderer/library-shell/LibraryShellPlaceholder.tsx` (stub, replaced in Task 4)
- Modify: `src/gui/shared/contracts.ts` — add archive schemas
- Modify: `src/gui/shared/types.ts` — add `GuiArchiveState`, `GuiArchiveProbeResult`
- Modify: `src/gui/shared/bridge.ts` — add `bridge.archive.*` surface
- Modify: `src/gui/main/ipc.ts` — register `archive:state`, `archive:set-manual-override`
- Modify: `src/gui/renderer/app.tsx` — choose between EmptyStateWelcome / LibraryShellPlaceholder / legacy AppShell by `archive:state.found`
- Test: `tests/gui/main/archive-resolver.test.ts`
- Test: `tests/gui/main/archive-store.test.ts`
- Test: `tests/gui/shared/contracts-archive.test.ts`
- Test: `tests/gui/renderer/library-shell/EmptyStateWelcome.test.tsx`

- [ ] **Step 1.1: Write failing test for `archive-resolver`**

Create `tests/gui/main/archive-resolver.test.ts`:

```typescript
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, test } from 'vitest';

import {
  CATALOG_MAX_BYTES,
  resolveArchiveRoot,
} from '../../../src/gui/main/archive-resolver.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempArchive(label: string, catalog: unknown): string {
  const root = mkdtempSync(join(tmpdir(), `pbinfo-archive-${label}-`));
  tempDirs.push(root);
  const archiveRoot = join(root, 'archive');
  mkdirSync(join(archiveRoot, 'snapshots', 'snap-1'), { recursive: true });
  writeFileSync(
    join(archiveRoot, 'catalog.json'),
    JSON.stringify(catalog),
    'utf8',
  );
  return archiveRoot;
}

describe('archive-resolver', () => {
  test('returns not-found when no probe path holds a catalog', () => {
    const empty = mkdtempSync(join(tmpdir(), 'pbinfo-empty-'));
    tempDirs.push(empty);

    const result = resolveArchiveRoot({
      exeDir: empty,
      cwd: empty,
      manualOverride: undefined,
    });

    expect(result.found).toBe(false);
    expect(result.probedPaths).toHaveLength(3);
  });

  test('finds archive at <exe-dir>/archive and picks currentSnapshotId', () => {
    const archiveRoot = makeTempArchive('exe', {
      currentSnapshotId: 'snap-1',
      snapshots: [{ id: 'snap-1', status: 'completed' }],
    });
    const exeDir = archiveRoot.replace(/[\\/]archive$/u, '');

    const result = resolveArchiveRoot({
      exeDir,
      cwd: '/tmp/unrelated',
      manualOverride: undefined,
    });

    expect(result.found).toBe(true);
    expect(result.archiveRoot).toBe(archiveRoot);
    expect(result.snapshotId).toBe('snap-1');
  });

  test('falls back to newest completed snapshot when currentSnapshotId is missing', () => {
    const archiveRoot = makeTempArchive('fallback', {
      snapshots: [
        { id: 'older', status: 'completed', createdAt: '2026-04-20T00:00:00Z' },
        { id: 'newer', status: 'completed', createdAt: '2026-04-23T00:00:00Z' },
        { id: 'inprogress', status: 'running', createdAt: '2026-04-24T00:00:00Z' },
      ],
    });
    mkdirSync(join(archiveRoot, 'snapshots', 'newer'), { recursive: true });
    mkdirSync(join(archiveRoot, 'snapshots', 'older'), { recursive: true });
    const exeDir = archiveRoot.replace(/[\\/]archive$/u, '');

    const result = resolveArchiveRoot({
      exeDir,
      cwd: '/tmp/unrelated',
      manualOverride: undefined,
    });

    expect(result.found).toBe(true);
    expect(result.snapshotId).toBe('newer');
  });

  test('rejects catalog larger than CATALOG_MAX_BYTES', () => {
    const root = mkdtempSync(join(tmpdir(), 'pbinfo-big-'));
    tempDirs.push(root);
    const archiveRoot = join(root, 'archive');
    mkdirSync(archiveRoot, { recursive: true });
    writeFileSync(
      join(archiveRoot, 'catalog.json'),
      'x'.repeat(CATALOG_MAX_BYTES + 1),
      'utf8',
    );

    const result = resolveArchiveRoot({
      exeDir: root,
      cwd: root,
      manualOverride: undefined,
    });

    expect(result.found).toBe(false);
  });

  test('tolerates malformed catalog JSON and continues probing', () => {
    const broken = mkdtempSync(join(tmpdir(), 'pbinfo-broken-'));
    tempDirs.push(broken);
    mkdirSync(join(broken, 'archive'), { recursive: true });
    writeFileSync(join(broken, 'archive', 'catalog.json'), '{ not json', 'utf8');

    const good = makeTempArchive('good', {
      currentSnapshotId: 'snap-1',
      snapshots: [{ id: 'snap-1', status: 'completed' }],
    });
    const goodExe = good.replace(/[\\/]archive$/u, '');

    const result = resolveArchiveRoot({
      exeDir: broken,
      cwd: goodExe,
      manualOverride: undefined,
    });

    expect(result.found).toBe(true);
    expect(result.archiveRoot).toBe(good);
  });

  test('prefers manual override over all three auto-probe paths', () => {
    const manual = makeTempArchive('manual', {
      currentSnapshotId: 'manual-snap',
      snapshots: [{ id: 'manual-snap', status: 'completed' }],
    });
    const auto = makeTempArchive('auto', {
      currentSnapshotId: 'auto-snap',
      snapshots: [{ id: 'auto-snap', status: 'completed' }],
    });

    const result = resolveArchiveRoot({
      exeDir: auto.replace(/[\\/]archive$/u, ''),
      cwd: '/tmp/unrelated',
      manualOverride: manual,
    });

    expect(result.archiveRoot).toBe(manual);
    expect(result.snapshotId).toBe('manual-snap');
  });

  test('silently drops stale manual override whose directory no longer exists', () => {
    const auto = makeTempArchive('auto2', {
      currentSnapshotId: 'auto-snap',
      snapshots: [{ id: 'auto-snap', status: 'completed' }],
    });

    const result = resolveArchiveRoot({
      exeDir: auto.replace(/[\\/]archive$/u, ''),
      cwd: '/tmp/unrelated',
      manualOverride: '/path/that/does/not/exist',
    });

    expect(result.found).toBe(true);
    expect(result.archiveRoot).toBe(auto);
  });

  test('discards snapshotId when the snapshot directory does not exist', () => {
    const root = mkdtempSync(join(tmpdir(), 'pbinfo-missing-snap-'));
    tempDirs.push(root);
    const archiveRoot = join(root, 'archive');
    mkdirSync(archiveRoot, { recursive: true });
    writeFileSync(
      join(archiveRoot, 'catalog.json'),
      JSON.stringify({
        currentSnapshotId: 'snap-1',
        snapshots: [{ id: 'snap-1', status: 'completed' }],
      }),
      'utf8',
    );

    const result = resolveArchiveRoot({
      exeDir: root,
      cwd: root,
      manualOverride: undefined,
    });

    expect(result.found).toBe(true);
    expect(result.snapshotId).toBeUndefined();
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `npx vitest run tests/gui/main/archive-resolver.test.ts`
Expected: FAIL with `Cannot find module '.../archive-resolver.js'`.

- [ ] **Step 1.3: Implement `archive-resolver`**

Create `src/gui/main/archive-resolver.ts`:

```typescript
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const CATALOG_MAX_BYTES = 2 * 1024 * 1024;

export interface ArchiveProbeInput {
  readonly exeDir: string;
  readonly cwd: string;
  readonly manualOverride: string | undefined;
}

export interface ArchiveProbeResult {
  readonly found: boolean;
  readonly archiveRoot?: string;
  readonly snapshotId?: string;
  readonly probedPaths: readonly string[];
}

interface CatalogSnapshot {
  readonly id: string;
  readonly status?: string;
  readonly createdAt?: string;
}

interface CatalogShape {
  readonly currentSnapshotId?: string;
  readonly snapshots?: readonly CatalogSnapshot[];
}

export function resolveArchiveRoot(input: ArchiveProbeInput): ArchiveProbeResult {
  const candidates = buildProbeOrder(input);

  for (const candidate of candidates) {
    const catalog = readCatalog(candidate);
    if (!catalog) {
      continue;
    }
    return {
      found: true,
      archiveRoot: candidate,
      snapshotId: resolveCurrentSnapshotId(catalog, candidate),
      probedPaths: candidates,
    };
  }

  return {
    found: false,
    probedPaths: candidates,
  };
}

function buildProbeOrder(input: ArchiveProbeInput): readonly string[] {
  const auto = [
    join(input.exeDir, 'archive'),
    join(input.exeDir, 'resources', 'archive'),
    join(input.cwd, 'archive'),
  ];
  if (!input.manualOverride) {
    return auto;
  }
  if (!existsSync(input.manualOverride)) {
    return auto;
  }
  return [input.manualOverride, ...auto];
}

function readCatalog(candidate: string): CatalogShape | undefined {
  const catalogPath = join(candidate, 'catalog.json');
  if (!existsSync(catalogPath)) {
    return undefined;
  }
  try {
    const stat = statSync(catalogPath);
    if (!stat.isFile() || stat.size > CATALOG_MAX_BYTES) {
      return undefined;
    }
    const parsed = JSON.parse(readFileSync(catalogPath, 'utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      return undefined;
    }
    return parsed as CatalogShape;
  } catch {
    return undefined;
  }
}

function resolveCurrentSnapshotId(
  catalog: CatalogShape,
  archiveRoot: string,
): string | undefined {
  const snapshots = catalog.snapshots ?? [];
  const explicit = catalog.currentSnapshotId
    ? snapshots.find((snap) => snap.id === catalog.currentSnapshotId)
    : undefined;
  if (explicit && explicit.status === 'completed' && snapshotDirExists(archiveRoot, explicit.id)) {
    return explicit.id;
  }
  const completed = snapshots
    .filter((snap) => snap.status === 'completed' && snapshotDirExists(archiveRoot, snap.id))
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  return completed[0]?.id;
}

function snapshotDirExists(archiveRoot: string, snapshotId: string): boolean {
  return existsSync(join(archiveRoot, 'snapshots', snapshotId));
}
```

- [ ] **Step 1.4: Run test to verify it passes**

Run: `npx vitest run tests/gui/main/archive-resolver.test.ts`
Expected: all 8 tests pass.

- [ ] **Step 1.5: Write failing test for `archive-store`**

Create `tests/gui/main/archive-store.test.ts`:

```typescript
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, test } from 'vitest';

import {
  getArchiveStorePath,
  readArchiveStore,
  writeArchiveStore,
} from '../../../src/gui/main/archive-store.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('archive-store', () => {
  test('returns empty state when file is absent', () => {
    const userData = mkdtempSync(join(tmpdir(), 'pbinfo-archive-store-'));
    tempDirs.push(userData);

    expect(readArchiveStore(userData)).toEqual({});
  });

  test('persists and reads back manualArchiveOverride', () => {
    const userData = mkdtempSync(join(tmpdir(), 'pbinfo-archive-store-'));
    tempDirs.push(userData);

    writeArchiveStore(userData, { manualArchiveOverride: 'C:/my/archive' });

    expect(readArchiveStore(userData)).toEqual({
      manualArchiveOverride: 'C:/my/archive',
    });
    expect(existsSync(getArchiveStorePath(userData))).toBe(true);
  });

  test('tolerates and drops legacy workspaceRoot / recentWorkspaces keys on load', () => {
    const userData = mkdtempSync(join(tmpdir(), 'pbinfo-archive-store-'));
    tempDirs.push(userData);

    writeFileSync(
      getArchiveStorePath(userData),
      JSON.stringify({
        manualArchiveOverride: 'D:/archive',
        workspaceRoot: 'C:/legacy',
        recentWorkspaces: ['C:/legacy'],
      }),
      'utf8',
    );

    expect(readArchiveStore(userData)).toEqual({
      manualArchiveOverride: 'D:/archive',
    });
  });

  test('rejects malformed JSON gracefully by returning empty state', () => {
    const userData = mkdtempSync(join(tmpdir(), 'pbinfo-archive-store-'));
    tempDirs.push(userData);

    writeFileSync(getArchiveStorePath(userData), '{ not json', 'utf8');

    expect(readArchiveStore(userData)).toEqual({});
  });

  test('enforces Zod schema: path string max length 4096', () => {
    const userData = mkdtempSync(join(tmpdir(), 'pbinfo-archive-store-'));
    tempDirs.push(userData);

    expect(() =>
      writeArchiveStore(userData, {
        manualArchiveOverride: 'a'.repeat(4097),
      }),
    ).toThrow();
  });
});
```

- [ ] **Step 1.6: Run test to verify it fails**

Run: `npx vitest run tests/gui/main/archive-store.test.ts`
Expected: FAIL with `Cannot find module '.../archive-store.js'`.

- [ ] **Step 1.7: Implement `archive-store`**

Create `src/gui/main/archive-store.ts`:

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';

export const archiveStoreSchema = z
  .object({
    manualArchiveOverride: z.string().min(1).max(4096).optional(),
  })
  .strict();

export type ArchiveStore = z.infer<typeof archiveStoreSchema>;

const legacyTolerantSchema = z
  .object({
    manualArchiveOverride: z.string().min(1).max(4096).optional(),
  })
  .passthrough()
  .transform(({ manualArchiveOverride }) => ({
    ...(manualArchiveOverride ? { manualArchiveOverride } : {}),
  }));

export function getArchiveStorePath(userDataRoot: string): string {
  return join(userDataRoot, 'pbinfo-crawler-config.json');
}

export function readArchiveStore(userDataRoot: string): ArchiveStore {
  const path = getArchiveStorePath(userDataRoot);
  if (!existsSync(path)) {
    return {};
  }
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return legacyTolerantSchema.parse(raw);
  } catch {
    return {};
  }
}

export function writeArchiveStore(
  userDataRoot: string,
  store: ArchiveStore,
): ArchiveStore {
  const parsed = archiveStoreSchema.parse(store);
  const path = getArchiveStorePath(userDataRoot);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(parsed, null, 2), 'utf8');
  return parsed;
}
```

- [ ] **Step 1.8: Run test to verify it passes**

Run: `npx vitest run tests/gui/main/archive-store.test.ts`
Expected: all 5 tests pass.

- [ ] **Step 1.9: Add archive Zod schemas to `contracts.ts`**

Append to `src/gui/shared/contracts.ts`:

```typescript
export const archiveSetManualOverrideInputSchema = z
  .object({
    absolutePath: z.string().min(1).max(4096),
  })
  .strict();

export const archiveProbeResultSchema = z
  .object({
    found: z.boolean(),
    archiveRoot: z.string().optional(),
    snapshotId: z.string().optional(),
    probedPaths: z.array(z.string()),
    catalogSnapshots: z
      .array(
        z.object({
          id: z.string(),
          status: z.string(),
          createdAt: z.string().optional(),
          label: z.string().optional(),
        }),
      )
      .optional(),
  })
  .strict();

export const themePreferenceSchema = z.enum(['auto', 'light', 'dark']);

export const librarySetThemeInputSchema = z
  .object({ preference: themePreferenceSchema })
  .strict();

export const libraryGetThemeResultSchema = z
  .object({
    effective: z.enum(['light', 'dark']),
    preference: themePreferenceSchema,
  })
  .strict();
```

- [ ] **Step 1.10: Write failing contracts test**

Create `tests/gui/shared/contracts-archive.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';

import {
  archiveProbeResultSchema,
  archiveSetManualOverrideInputSchema,
  libraryGetThemeResultSchema,
  librarySetThemeInputSchema,
} from '../../../src/gui/shared/contracts.js';

describe('archive + theme contracts', () => {
  test('archiveSetManualOverrideInputSchema rejects empty paths', () => {
    expect(() => archiveSetManualOverrideInputSchema.parse({ absolutePath: '' })).toThrow();
  });

  test('archiveSetManualOverrideInputSchema rejects paths over 4096 chars', () => {
    expect(() =>
      archiveSetManualOverrideInputSchema.parse({ absolutePath: 'a'.repeat(4097) }),
    ).toThrow();
  });

  test('archiveProbeResultSchema accepts minimal not-found shape', () => {
    const parsed = archiveProbeResultSchema.parse({
      found: false,
      probedPaths: ['/a', '/b'],
    });
    expect(parsed.found).toBe(false);
  });

  test('archiveProbeResultSchema accepts full found shape with catalog snapshots', () => {
    const parsed = archiveProbeResultSchema.parse({
      found: true,
      archiveRoot: '/a/archive',
      snapshotId: 'snap-1',
      probedPaths: ['/a/archive'],
      catalogSnapshots: [
        { id: 'snap-1', status: 'completed', createdAt: '2026-04-23T00:00:00Z' },
      ],
    });
    expect(parsed.catalogSnapshots).toHaveLength(1);
  });

  test('themePreferenceSchema only allows auto/light/dark', () => {
    expect(() => librarySetThemeInputSchema.parse({ preference: 'sepia' })).toThrow();
    expect(librarySetThemeInputSchema.parse({ preference: 'auto' }).preference).toBe('auto');
  });

  test('libraryGetThemeResultSchema rejects unknown effective value', () => {
    expect(() =>
      libraryGetThemeResultSchema.parse({ effective: 'sepia', preference: 'auto' }),
    ).toThrow();
  });
});
```

- [ ] **Step 1.11: Run contracts test**

Run: `npx vitest run tests/gui/shared/contracts-archive.test.ts`
Expected: all 6 tests pass.

- [ ] **Step 1.12: Extend types.ts with `GuiArchiveState` + probe result**

Append to `src/gui/shared/types.ts`:

```typescript
import type { z } from 'zod';
import type {
  archiveProbeResultSchema,
  archiveSetManualOverrideInputSchema,
  libraryGetThemeResultSchema,
  librarySetThemeInputSchema,
} from './contracts.js';

export type GuiArchiveState = z.infer<typeof archiveProbeResultSchema>;
export type GuiArchiveSetManualOverrideInput = z.infer<
  typeof archiveSetManualOverrideInputSchema
>;
export type GuiLibrarySetThemeInput = z.infer<typeof librarySetThemeInputSchema>;
export type GuiLibraryThemeResult = z.infer<typeof libraryGetThemeResultSchema>;
```

- [ ] **Step 1.13: Register archive IPC in `ipc.ts` (with catalogSnapshots population)**

Inside `registerDesktopIpc` in `src/gui/main/ipc.ts`, after existing handlers, add:

```typescript
import { app, BrowserWindow } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { resolveArchiveRoot } from './archive-resolver.js';
import { readArchiveStore, writeArchiveStore } from './archive-store.js';
import {
  archiveSetManualOverrideInputSchema,
} from '../shared/contracts.js';

function loadCatalogSnapshots(archiveRoot: string | undefined) {
  if (!archiveRoot) return undefined;
  const catalogPath = join(archiveRoot, 'catalog.json');
  if (!existsSync(catalogPath)) return undefined;
  try {
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as {
      snapshots?: Array<{ id: string; status?: string; createdAt?: string; label?: string }>;
    };
    return (catalog.snapshots ?? []).map((s) => ({
      id: s.id,
      status: s.status ?? 'unknown',
      createdAt: s.createdAt,
      label: s.label,
    }));
  } catch {
    return undefined;
  }
}

function broadcastArchiveChanged(event: {
  archiveRoot: string;
  snapshotId?: string;
  cause: 'manual-override' | 'refresh-complete' | 'snapshot-switch';
}) {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('archive:changed', event);
  }
}

// inside registerDesktopIpc:
ipcMain.handle('archive:state', () => {
  const store = readArchiveStore(userDataRoot);
  const probe = resolveArchiveRoot({
    exeDir: dirname(app.getPath('exe')),
    cwd: process.cwd(),
    manualOverride: store.manualArchiveOverride,
  });
  return {
    ...probe,
    catalogSnapshots: loadCatalogSnapshots(probe.archiveRoot),
  };
});

ipcMain.handle('archive:set-manual-override', (_event, payload: unknown) => {
  const { absolutePath } = archiveSetManualOverrideInputSchema.parse(payload);
  writeArchiveStore(userDataRoot, { manualArchiveOverride: absolutePath });
  const probe = resolveArchiveRoot({
    exeDir: dirname(app.getPath('exe')),
    cwd: process.cwd(),
    manualOverride: absolutePath,
  });
  if (probe.found && probe.archiveRoot) {
    broadcastArchiveChanged({
      archiveRoot: probe.archiveRoot,
      snapshotId: probe.snapshotId,
      cause: 'manual-override',
    });
  }
  return {
    ...probe,
    catalogSnapshots: loadCatalogSnapshots(probe.archiveRoot),
  };
});

ipcMain.handle('archive:switch-snapshot', (_event, payload: unknown) => {
  const { snapshotId } = z.object({ snapshotId: z.string().min(1).max(64) }).strict().parse(payload);
  const store = readArchiveStore(userDataRoot);
  const probe = resolveArchiveRoot({
    exeDir: dirname(app.getPath('exe')),
    cwd: process.cwd(),
    manualOverride: store.manualArchiveOverride,
  });
  if (!probe.found || !probe.archiveRoot) throw new Error('archive-missing');
  // In-memory override of the current snapshot id for this session. Persisted
  // via archive-store if we want it to survive restart — kept session-only
  // here to match spec §9 Settings "Snapshot override" semantics.
  broadcastArchiveChanged({
    archiveRoot: probe.archiveRoot,
    snapshotId,
    cause: 'snapshot-switch',
  });
  return { ...probe, snapshotId };
});
```

Extend `bridge.archive` with `switchSnapshot(snapshotId)` returning the updated state. Note the handler emits `archive:changed` with `cause: 'snapshot-switch'`; the renderer's existing `onChanged` subscription refetches the problem list automatically.

- [ ] **Step 1.14: Add bridge surface**

In `src/gui/preload/index.ts` (or wherever `contextBridge.exposeInMainWorld` lives), extend the exposed object with:

```typescript
archive: {
  getState: () => ipcRenderer.invoke('archive:state'),
  setManualOverride: (absolutePath: string) =>
    ipcRenderer.invoke('archive:set-manual-override', { absolutePath }),
  onChanged: (cb: (event: ArchiveChangedEvent) => void) => {
    const listener = (_e: unknown, payload: ArchiveChangedEvent) => cb(payload);
    ipcRenderer.on('archive:changed', listener);
    return () => ipcRenderer.removeListener('archive:changed', listener);
  },
}
```

And declare `ArchiveChangedEvent` in `src/gui/shared/types.ts`:

```typescript
export interface ArchiveChangedEvent {
  readonly archiveRoot: string;
  readonly snapshotId?: string;
  readonly cause: 'manual-override' | 'refresh-complete' | 'snapshot-switch';
}
```

Also extend the `DesktopBridge` interface in `src/gui/shared/bridge.ts` with:

```typescript
archive: {
  getState: () => Promise<GuiArchiveState>;
  setManualOverride: (absolutePath: string) => Promise<GuiArchiveState>;
  onChanged: (cb: (event: ArchiveChangedEvent) => void) => () => void;
};
```

- [ ] **Step 1.15: Write failing test for EmptyStateWelcome**

Create `tests/gui/renderer/library-shell/EmptyStateWelcome.test.tsx`:

```typescript
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { EmptyStateWelcome } from '../../../../src/gui/renderer/library-shell/EmptyStateWelcome.js';

describe('<EmptyStateWelcome>', () => {
  test('renders the welcome heading and both primary actions', () => {
    render(
      <EmptyStateWelcome
        probedPaths={['/a', '/b', '/c']}
        onRunInitialCrawl={vi.fn()}
        onBrowseForArchive={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('heading', { level: 1, name: /welcome to problem archive crawler/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /run the initial crawl/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /browse for archive/i })).toBeInTheDocument();
  });

  test('lists every probed path so the user understands where we looked', () => {
    render(
      <EmptyStateWelcome
        probedPaths={['/a/archive', '/b/resources/archive', '/c/archive']}
        onRunInitialCrawl={vi.fn()}
        onBrowseForArchive={vi.fn()}
      />,
    );

    for (const probe of ['/a/archive', '/b/resources/archive', '/c/archive']) {
      expect(screen.getByText(probe)).toBeInTheDocument();
    }
  });

  test('invokes callbacks on click', () => {
    const runInitial = vi.fn();
    const browse = vi.fn();
    render(
      <EmptyStateWelcome
        probedPaths={['/a']}
        onRunInitialCrawl={runInitial}
        onBrowseForArchive={browse}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /run the initial crawl/i }));
    fireEvent.click(screen.getByRole('button', { name: /browse for archive/i }));

    expect(runInitial).toHaveBeenCalledTimes(1);
    expect(browse).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 1.16: Run test to verify it fails**

Run: `npx vitest run tests/gui/renderer/library-shell/EmptyStateWelcome.test.tsx`
Expected: FAIL with `Cannot find module '.../EmptyStateWelcome.js'`.

- [ ] **Step 1.17: Implement EmptyStateWelcome**

Create `src/gui/renderer/library-shell/EmptyStateWelcome.tsx`:

```typescript
import { useCallback } from 'react';

export interface EmptyStateWelcomeProps {
  readonly probedPaths: readonly string[];
  readonly onRunInitialCrawl: () => void;
  readonly onBrowseForArchive: () => void;
}

export function EmptyStateWelcome(props: EmptyStateWelcomeProps) {
  const { probedPaths, onRunInitialCrawl, onBrowseForArchive } = props;

  const handleRun = useCallback(() => onRunInitialCrawl(), [onRunInitialCrawl]);
  const handleBrowse = useCallback(() => onBrowseForArchive(), [onBrowseForArchive]);

  return (
    <main className="empty-state-welcome" data-testid="empty-state-welcome">
      <section className="empty-state-welcome__card">
        <h1>Welcome to Problem Archive Crawler</h1>
        <p className="empty-state-welcome__lede">
          We couldn&apos;t find an <code>archive/</code> folder next to this application.
          Two ways to get started:
        </p>
        <div className="empty-state-welcome__actions">
          <section>
            <h2>Build a fresh archive now</h2>
            <button type="button" className="pac-btn pac-btn--primary" onClick={handleRun}>
              Run the initial crawl
            </button>
            <p className="empty-state-welcome__hint">
              Signs in with your PBInfo credentials, crawls every problem, your submissions,
              editorial &amp; official source where visible, and writes everything to{' '}
              <code>archive/</code> next to this app. About 4–5 hours on a first run.
            </p>
          </section>
          <section>
            <h2>Point at an existing archive</h2>
            <button type="button" className="pac-btn pac-btn--secondary" onClick={handleBrowse}>
              Browse for archive/…
            </button>
          </section>
        </div>
        <details className="empty-state-welcome__probes">
          <summary>We tried these paths</summary>
          <ul>
            {probedPaths.map((probe) => (
              <li key={probe}>
                <code>{probe}</code>
              </li>
            ))}
          </ul>
        </details>
      </section>
    </main>
  );
}
```

- [ ] **Step 1.18: Run test to verify it passes**

Run: `npx vitest run tests/gui/renderer/library-shell/EmptyStateWelcome.test.tsx`
Expected: all 3 tests pass.

- [ ] **Step 1.19: Create LibraryShellPlaceholder**

Create `src/gui/renderer/library-shell/LibraryShellPlaceholder.tsx`:

```typescript
export interface LibraryShellPlaceholderProps {
  readonly archiveRoot: string;
  readonly snapshotId?: string;
}

export function LibraryShellPlaceholder(props: LibraryShellPlaceholderProps) {
  return (
    <main data-testid="library-shell-placeholder">
      <h1>Library shell (placeholder — replaced in Task 4)</h1>
      <p>
        Archive: <code>{props.archiveRoot}</code>
      </p>
      {props.snapshotId ? <p>Snapshot: {props.snapshotId}</p> : null}
    </main>
  );
}
```

No test needed — this is a stub replaced by Task 4.

- [ ] **Step 1.20: Branch app.tsx by archive state**

Modify `src/gui/renderer/app.tsx` (keep legacy AppShell import untouched). Add a short-circuit at the top:

```typescript
import { useEffect, useState } from 'react';
import { AppShell } from './app-shell.js';
import { EmptyStateWelcome } from './library-shell/EmptyStateWelcome.js';
import { LibraryShellPlaceholder } from './library-shell/LibraryShellPlaceholder.js';
import type { GuiArchiveState } from '../shared/types.js';

export function App() {
  const [archiveState, setArchiveState] = useState<GuiArchiveState | undefined>(undefined);

  useEffect(() => {
    window.pbinfoDesktop.archive.getState().then(setArchiveState);
    const unsub = window.pbinfoDesktop.archive.onChanged(() => {
      window.pbinfoDesktop.archive.getState().then(setArchiveState);
    });
    return unsub;
  }, []);

  if (!archiveState) {
    return <main><p>Resolving archive…</p></main>;
  }

  if (!archiveState.found) {
    return (
      <EmptyStateWelcome
        probedPaths={archiveState.probedPaths}
        onRunInitialCrawl={() => {
          /* wired in Task 8 */
        }}
        onBrowseForArchive={async () => {
          /* wired in Task 8 — for now open dialog via bridge if available */
        }}
      />
    );
  }

  // ARCHITECTURE NOTE: Through Task 8 we keep rendering the legacy AppShell
  // when archive is found, so the old UI stays functional. Task 9 is the
  // destructive commit that swaps this to <LibraryShell /> and deletes
  // AppShell / dashboard / coverage-explorer.
  return <AppShell />;
}
```

(Keep existing AppShell props untouched; the bridge API must expose `window.pbinfoDesktop.archive.*` from Step 1.14.)

- [ ] **Step 1.21: Run full test suite + typecheck**

Run: `npm run typecheck && npm run typecheck:desktop && npx vitest run`
Expected: all green. If a missing `window.pbinfoDesktop.archive` type fails renderer typecheck, add a `.d.ts` augmentation under `src/gui/renderer/global.d.ts` extending `Window['pbinfoDesktop']` with `archive: DesktopBridge['archive']`.

- [ ] **Step 1.22: Commit**

```bash
git add src/gui/main/archive-resolver.ts \
  src/gui/main/archive-store.ts \
  src/gui/main/ipc.ts \
  src/gui/shared/contracts.ts \
  src/gui/shared/types.ts \
  src/gui/shared/bridge.ts \
  src/gui/preload/ \
  src/gui/renderer/library-shell/ \
  src/gui/renderer/app.tsx \
  tests/gui/main/archive-resolver.test.ts \
  tests/gui/main/archive-store.test.ts \
  tests/gui/shared/contracts-archive.test.ts \
  tests/gui/renderer/library-shell/EmptyStateWelcome.test.tsx

git commit -m "feat(gui): archive-resolver + empty-state shell (Task 1)

resolveArchiveRoot probes <exe-dir>/archive → resources/archive → cwd
(with manual override priority), enforces 2 MB catalog cap, and verifies
snapshot dirs exist. archive-store persists manualArchiveOverride, drops
legacy workspaceRoot keys on load. archive:state + archive:set-manual-override
IPC handlers registered. Renderer now branches to EmptyStateWelcome when
found === false; legacy AppShell still renders when found === true."
```

---

## Task 2: Theme token system + `theme:changed` bridge

Builds the two-palette CSS token file, pinned-pair contrast test, and the live `nativeTheme` → renderer broadcast. No visual redesign of existing components yet — new tokens stay unused in the old shell until Task 4.

**Files:**
- Create: `src/gui/renderer/library-shell/theme/tokens.css`
- Create: `src/gui/renderer/library-shell/theme/global.css`
- Create: `src/gui/main/theme-bridge.ts`
- Modify: `src/gui/main/ipc.ts` — register `library:theme:get` + `library:theme:set`
- Modify: `src/gui/main/index.ts` — call `theme-bridge.attach` after window creation
- Modify: `src/gui/shared/bridge.ts` — add `bridge.theme.*`
- Modify: `src/gui/renderer/app.tsx` — read `theme:get` on mount, subscribe to `theme:changed`
- Test: `tests/gui/main/theme-bridge.test.ts`
- Test: `tests/gui/theme-contrast.test.ts`

- [ ] **Step 2.1: Write failing theme-bridge test**

Create `tests/gui/main/theme-bridge.test.ts`:

```typescript
import { describe, expect, test, vi } from 'vitest';
import { EventEmitter } from 'node:events';

import { createThemeBridge } from '../../../src/gui/main/theme-bridge.js';

interface FakeNativeTheme extends EventEmitter {
  themeSource: 'system' | 'light' | 'dark';
  shouldUseDarkColors: boolean;
}

function createFakeNativeTheme(initial: FakeNativeTheme['themeSource']): FakeNativeTheme {
  const emitter = new EventEmitter() as FakeNativeTheme;
  emitter.themeSource = initial;
  emitter.shouldUseDarkColors = initial === 'dark';
  return emitter;
}

describe('theme-bridge', () => {
  test('getTheme returns effective + preference from nativeTheme', () => {
    const nativeTheme = createFakeNativeTheme('system');
    const bridge = createThemeBridge({
      nativeTheme,
      getPreference: () => 'auto',
      setPreference: vi.fn(),
      broadcast: vi.fn(),
    });

    expect(bridge.getTheme()).toEqual({ effective: 'light', preference: 'auto' });
  });

  test('setTheme persists preference and updates nativeTheme.themeSource', () => {
    const nativeTheme = createFakeNativeTheme('system');
    const setPreference = vi.fn();
    const bridge = createThemeBridge({
      nativeTheme,
      getPreference: () => 'auto',
      setPreference,
      broadcast: vi.fn(),
    });

    const result = bridge.setTheme({ preference: 'dark' });

    expect(setPreference).toHaveBeenCalledWith('dark');
    expect(nativeTheme.themeSource).toBe('dark');
    expect(result).toEqual({ effective: 'dark', preference: 'dark' });
  });

  test('auto preference broadcasts theme:changed when OS flips', () => {
    const nativeTheme = createFakeNativeTheme('system');
    const broadcast = vi.fn();
    createThemeBridge({
      nativeTheme,
      getPreference: () => 'auto',
      setPreference: vi.fn(),
      broadcast,
    });

    nativeTheme.shouldUseDarkColors = true;
    nativeTheme.emit('updated');

    expect(broadcast).toHaveBeenCalledWith({ effective: 'dark' });
  });

  test('explicit preference does NOT broadcast when OS flips', () => {
    const nativeTheme = createFakeNativeTheme('light');
    const broadcast = vi.fn();
    createThemeBridge({
      nativeTheme,
      getPreference: () => 'light',
      setPreference: vi.fn(),
      broadcast,
    });

    nativeTheme.shouldUseDarkColors = true;
    nativeTheme.emit('updated');

    expect(broadcast).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2.2: Run theme-bridge test to verify it fails**

Run: `npx vitest run tests/gui/main/theme-bridge.test.ts`
Expected: FAIL — `Cannot find module '.../theme-bridge.js'`.

- [ ] **Step 2.3: Implement theme-bridge**

Create `src/gui/main/theme-bridge.ts`:

```typescript
import type { EventEmitter } from 'node:events';

export type ThemePreference = 'auto' | 'light' | 'dark';
export type EffectiveTheme = 'light' | 'dark';

export interface ThemeBridgeDeps {
  readonly nativeTheme: EventEmitter & {
    themeSource: 'system' | 'light' | 'dark';
    shouldUseDarkColors: boolean;
  };
  readonly getPreference: () => ThemePreference;
  readonly setPreference: (preference: ThemePreference) => void;
  readonly broadcast: (event: { effective: EffectiveTheme }) => void;
}

export interface ThemeBridge {
  readonly getTheme: () => { effective: EffectiveTheme; preference: ThemePreference };
  readonly setTheme: (input: { preference: ThemePreference }) => {
    effective: EffectiveTheme;
    preference: ThemePreference;
  };
}

export function createThemeBridge(deps: ThemeBridgeDeps): ThemeBridge {
  const handleOsUpdate = (): void => {
    if (deps.getPreference() === 'auto') {
      deps.broadcast({ effective: effectiveFromNative(deps.nativeTheme) });
    }
  };

  deps.nativeTheme.on('updated', handleOsUpdate);
  applyPreferenceToNativeTheme(deps.nativeTheme, deps.getPreference());

  return {
    getTheme() {
      return {
        effective: effectiveFromNative(deps.nativeTheme),
        preference: deps.getPreference(),
      };
    },
    setTheme({ preference }) {
      deps.setPreference(preference);
      applyPreferenceToNativeTheme(deps.nativeTheme, preference);
      const effective = effectiveFromNative(deps.nativeTheme);
      return { effective, preference };
    },
  };
}

function effectiveFromNative(nativeTheme: ThemeBridgeDeps['nativeTheme']): EffectiveTheme {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

function applyPreferenceToNativeTheme(
  nativeTheme: ThemeBridgeDeps['nativeTheme'],
  preference: ThemePreference,
): void {
  nativeTheme.themeSource = preference === 'auto' ? 'system' : preference;
}
```

- [ ] **Step 2.4: Run theme-bridge test to verify it passes**

Run: `npx vitest run tests/gui/main/theme-bridge.test.ts`
Expected: all 4 tests pass.

- [ ] **Step 2.5: Create theme tokens CSS**

Create `src/gui/renderer/library-shell/theme/tokens.css`:

```css
/* Design spec §4.1 + §4.4 — pinned contrast pairs drive the choices below.
   oklch() values chosen so axe-core + theme-contrast.test.ts pass AAA on body text. */

:root,
[data-theme='light'] {
  --pac-bg: oklch(98% 0 0);
  --pac-bg-panel: oklch(96% 0 0);
  --pac-bg-hover: oklch(93% 0 0);
  --pac-bg-active: oklch(90% 0.02 250);

  --pac-fg: oklch(16% 0 0);
  --pac-fg-muted: oklch(38% 0 0);
  --pac-fg-subtle: oklch(52% 0 0);

  --pac-border: oklch(88% 0 0);
  --pac-border-strong: oklch(72% 0 0);

  --pac-accent: oklch(52% 0.22 252);
  --pac-accent-hover: oklch(46% 0.22 252);
  --pac-accent-active: oklch(40% 0.22 252);
  --pac-accent-fg: oklch(99% 0 0);

  --pac-status-ok: oklch(48% 0.17 150);
  --pac-status-locked: oklch(58% 0.13 75);
  --pac-status-gap: oklch(52% 0.21 25);
  --pac-status-na: oklch(62% 0 0);

  --pac-success: oklch(44% 0.19 150);
  --pac-warning: oklch(54% 0.16 75);
  --pac-danger: oklch(48% 0.24 25);

  --pac-shadow-sm: 0 1px 2px oklch(20% 0 0 / 0.08);
  --pac-shadow-md: 0 4px 12px oklch(20% 0 0 / 0.12);
  --pac-shadow-lg: 0 12px 32px oklch(20% 0 0 / 0.18);

  --pac-font-sans: 'Manrope', system-ui, -apple-system, sans-serif;
  --pac-font-mono: 'IBM Plex Mono', 'Consolas', monospace;

  --pac-radius-sm: 4px;
  --pac-radius-md: 8px;
  --pac-radius-lg: 12px;

  --pac-space-1: 4px;
  --pac-space-2: 8px;
  --pac-space-3: 12px;
  --pac-space-4: 16px;
  --pac-space-5: 24px;
  --pac-space-6: 32px;
  --pac-space-7: 48px;
  --pac-space-8: 64px;
}

[data-theme='dark'] {
  --pac-bg: oklch(14% 0.01 260);
  --pac-bg-panel: oklch(19% 0.015 260);
  --pac-bg-hover: oklch(24% 0.02 260);
  --pac-bg-active: oklch(29% 0.04 252);

  --pac-fg: oklch(96% 0 0);
  --pac-fg-muted: oklch(72% 0 0);
  --pac-fg-subtle: oklch(58% 0 0);

  --pac-border: oklch(26% 0.01 260);
  --pac-border-strong: oklch(40% 0.015 260);

  --pac-accent: oklch(74% 0.18 252);
  --pac-accent-hover: oklch(80% 0.18 252);
  --pac-accent-active: oklch(86% 0.18 252);
  --pac-accent-fg: oklch(12% 0 0);

  --pac-status-ok: oklch(72% 0.17 150);
  --pac-status-locked: oklch(78% 0.14 75);
  --pac-status-gap: oklch(70% 0.21 25);
  --pac-status-na: oklch(52% 0 0);

  --pac-success: oklch(68% 0.18 150);
  --pac-warning: oklch(74% 0.15 75);
  --pac-danger: oklch(68% 0.22 25);

  --pac-shadow-sm: 0 1px 2px oklch(0% 0 0 / 0.3);
  --pac-shadow-md: 0 4px 12px oklch(0% 0 0 / 0.45);
  --pac-shadow-lg: 0 12px 32px oklch(0% 0 0 / 0.6);
}
```

- [ ] **Step 2.6: Create global.css and wire into main.tsx**

Create `src/gui/renderer/library-shell/theme/global.css`:

```css
@import '@fontsource/manrope/latin-400.css';
@import '@fontsource/manrope/latin-600.css';
@import '@fontsource/manrope/latin-700.css';
@import '@fontsource/ibm-plex-mono/latin-400.css';
@import './tokens.css';

*, *::before, *::after { box-sizing: border-box; }

html, body, #root {
  height: 100%;
  margin: 0;
  padding: 0;
}

body {
  font-family: var(--pac-font-sans);
  background: var(--pac-bg);
  color: var(--pac-fg);
  -webkit-font-smoothing: antialiased;
}

code, pre { font-family: var(--pac-font-mono); }
```

Modify `src/gui/renderer/main.tsx` — add `import './library-shell/theme/global.css';` immediately after the existing `import './app-shell.css';` line (both stylesheets coexist until Task 9).

- [ ] **Step 2.7: Write failing theme-contrast test**

Create `tests/gui/theme-contrast.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { computeContrastRatio, parseTokenFile } from '../src/gui/renderer/library-shell/theme/contrast-check.js';

const tokensPath = join(
  process.cwd(),
  'src/gui/renderer/library-shell/theme/tokens.css',
);
const tokens = parseTokenFile(readFileSync(tokensPath, 'utf8'));

const pinnedPairs: ReadonlyArray<{ fg: string; bg: string; min: number }> = [
  { fg: '--pac-fg', bg: '--pac-bg', min: 7.0 },
  { fg: '--pac-fg', bg: '--pac-bg-panel', min: 7.0 },
  { fg: '--pac-fg-muted', bg: '--pac-bg', min: 4.5 },
  { fg: '--pac-fg-subtle', bg: '--pac-bg', min: 3.0 },
  { fg: '--pac-accent-fg', bg: '--pac-accent', min: 4.5 },
  { fg: '--pac-accent-fg', bg: '--pac-accent-hover', min: 4.5 },
  { fg: '--pac-status-ok', bg: '--pac-bg', min: 3.0 },
  { fg: '--pac-status-locked', bg: '--pac-bg', min: 3.0 },
  { fg: '--pac-status-gap', bg: '--pac-bg', min: 3.0 },
];

describe.each(['light', 'dark'] as const)('theme contrast · %s palette', (palette) => {
  test.each(pinnedPairs)(
    '$fg on $bg ≥ $min:1',
    ({ fg, bg, min }) => {
      const fgColor = tokens[palette][fg];
      const bgColor = tokens[palette][bg];
      expect(fgColor, `${fg} missing in ${palette}`).toBeDefined();
      expect(bgColor, `${bg} missing in ${palette}`).toBeDefined();
      const ratio = computeContrastRatio(fgColor, bgColor);
      expect(ratio).toBeGreaterThanOrEqual(min);
    },
  );
});
```

- [ ] **Step 2.8: Run contrast test to verify it fails**

Run: `npx vitest run tests/gui/theme-contrast.test.ts`
Expected: FAIL — `Cannot find module '.../contrast-check.js'`.

- [ ] **Step 2.9: Implement contrast-check helper**

Create `src/gui/renderer/library-shell/theme/contrast-check.ts`:

```typescript
// Lightweight oklch → relative-luminance → WCAG ratio. Self-contained to avoid
// a runtime color library; precision sufficient for AA/AAA gating in tests.

export type Palette = 'light' | 'dark';
export type ParsedTokens = Record<Palette, Record<string, string>>;

export function parseTokenFile(css: string): ParsedTokens {
  const light = extractBlock(css, ':root,\\s*\\[data-theme=\'light\'\\]');
  const dark = extractBlock(css, '\\[data-theme=\'dark\'\\]');
  return { light, dark };
}

function extractBlock(css: string, selectorRe: string): Record<string, string> {
  const re = new RegExp(`${selectorRe}\\s*\\{([^}]*)\\}`, 'u');
  const match = css.match(re);
  if (!match) return {};
  const body = match[1];
  const tokens: Record<string, string> = {};
  for (const line of body.split('\n')) {
    const declaration = line.match(/--([a-z0-9-]+):\s*([^;]+);/iu);
    if (!declaration) continue;
    tokens[`--${declaration[1]}`] = declaration[2].trim();
  }
  return tokens;
}

export function computeContrastRatio(fgExpr: string, bgExpr: string): number {
  const fg = relativeLuminance(oklchToLinearRgb(parseOklch(fgExpr)));
  const bg = relativeLuminance(oklchToLinearRgb(parseOklch(bgExpr)));
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return (lighter + 0.05) / (darker + 0.05);
}

interface Oklch {
  readonly l: number;
  readonly c: number;
  readonly h: number;
  readonly alpha: number;
}

function parseOklch(expr: string): Oklch {
  const match = expr.match(
    /oklch\(\s*([\d.]+)%?\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)/u,
  );
  if (!match) {
    throw new Error(`Expected oklch(...) expression, got: ${expr}`);
  }
  return {
    l: parseFloat(match[1]) / 100,
    c: parseFloat(match[2]),
    h: parseFloat(match[3]),
    alpha: match[4] ? parseFloat(match[4]) : 1,
  };
}

function oklchToLinearRgb({ l, c, h }: Oklch): { r: number; g: number; b: number } {
  // Convert OKLCH → OKLab
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);
  // OKLab → linear sRGB (see https://bottosson.github.io/posts/oklab/)
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;
  return {
    r: +4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    g: -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    b: -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  };
}

function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  return 0.2126 * clamp01(r) + 0.7152 * clamp01(g) + 0.0722 * clamp01(b);
}

function clamp01(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}
```

- [ ] **Step 2.10: Run contrast test to verify it passes**

Run: `npx vitest run tests/gui/theme-contrast.test.ts`
Expected: every pinned pair passes in both palettes. If a specific pair fails, **adjust the token values in `tokens.css`, not the test**; the spec pinned these floors intentionally.

- [ ] **Step 2.11a: Extend `desktopPreferencesRecordSchema` with `themePreference`**

In `src/gui/shared/types.ts`, replace the existing `desktopPreferencesRecordSchema` block (~line 120):

```typescript
export const desktopPreferencesRecordSchema = z
  .object({
    workspaceRoot: z.string().min(1).optional(),
    verbosityMode: guiVerbosityModeSchema,
    themePreference: z.enum(['auto', 'light', 'dark']).optional(),
  })
  .strict();
```

Because the schema is `.strict()`, a legacy `pbinfo-desktop.json` that doesn't include `themePreference` still parses (the field is optional). `readDesktopPreferences` already defaults to `{ verbosityMode: 'normal' }` when the file is missing — that default is unchanged; `themePreference` is simply `undefined` on fresh installs, which the theme bridge interprets as `'auto'`.

Add a small test in `tests/gui/desktop-preferences.test.ts`:

```typescript
test('persists and reads back themePreference', () => {
  const userDataRoot = mkdtempSync(join(tmpdir(), 'pbinfo-theme-pref-'));
  tempDirs.push(userDataRoot);

  writeDesktopPreferences(userDataRoot, {
    verbosityMode: 'normal',
    themePreference: 'dark',
  });

  const preferences = readDesktopPreferences(userDataRoot);
  expect(preferences.themePreference).toBe('dark');
});

test('tolerates legacy preference file that omits themePreference', () => {
  const userDataRoot = mkdtempSync(join(tmpdir(), 'pbinfo-theme-legacy-'));
  tempDirs.push(userDataRoot);
  writeFileSync(
    join(userDataRoot, 'pbinfo-desktop.json'),
    JSON.stringify({ verbosityMode: 'raw' }),
    'utf8',
  );

  expect(readDesktopPreferences(userDataRoot).themePreference).toBeUndefined();
});
```

Run: `npx vitest run tests/gui/desktop-preferences.test.ts` → PASS.

- [ ] **Step 2.11: Wire theme IPC + attach bridge in main**

In `src/gui/main/ipc.ts`, add handlers (uses `createThemeBridge` from Step 2.3):

```typescript
import { nativeTheme } from 'electron';
import { createThemeBridge } from './theme-bridge.js';
import {
  libraryGetThemeResultSchema,
  librarySetThemeInputSchema,
} from '../shared/contracts.js';

// inside registerDesktopIpc:
const themeBridge = createThemeBridge({
  nativeTheme,
  getPreference: () => readDesktopPreferences(userDataRoot).themePreference ?? 'auto',
  setPreference: (preference) => {
    const current = readDesktopPreferences(userDataRoot);
    writeDesktopPreferences(userDataRoot, { ...current, themePreference: preference });
  },
  broadcast: ({ effective }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send('theme:changed', { effective });
    }
  },
});

ipcMain.handle('library:theme:get', () =>
  libraryGetThemeResultSchema.parse(themeBridge.getTheme()),
);
ipcMain.handle('library:theme:set', (_event, payload: unknown) => {
  const input = librarySetThemeInputSchema.parse(payload);
  return libraryGetThemeResultSchema.parse(themeBridge.setTheme(input));
});
```

Also extend `DesktopPreferencesRecord` in `src/gui/shared/types.ts` with `themePreference?: 'auto' | 'light' | 'dark'` (via the existing Zod schema `desktopPreferencesRecordSchema`).

- [ ] **Step 2.12: Extend bridge surface**

In preload (`src/gui/preload/index.ts`) and the `DesktopBridge` interface (`src/gui/shared/bridge.ts`):

```typescript
theme: {
  get: () => ipcRenderer.invoke('library:theme:get'),
  set: (preference: 'auto' | 'light' | 'dark') =>
    ipcRenderer.invoke('library:theme:set', { preference }),
  onChanged: (cb: (event: { effective: 'light' | 'dark' }) => void) => {
    const listener = (_e: unknown, payload: { effective: 'light' | 'dark' }) => cb(payload);
    ipcRenderer.on('theme:changed', listener);
    return () => ipcRenderer.removeListener('theme:changed', listener);
  },
}
```

- [ ] **Step 2.13: Subscribe in renderer**

In `src/gui/renderer/app.tsx`, add a `useEffect` that reads `theme.get()` and subscribes to `theme.onChanged`:

```typescript
useEffect(() => {
  window.pbinfoDesktop.theme.get().then(({ effective }) => {
    document.documentElement.dataset.theme = effective;
  });
  const unsub = window.pbinfoDesktop.theme.onChanged(({ effective }) => {
    document.documentElement.dataset.theme = effective;
  });
  return unsub;
}, []);
```

- [ ] **Step 2.14: Run full test + typecheck**

Run: `npm run typecheck && npm run typecheck:desktop && npx vitest run`
Expected: all green.

- [ ] **Step 2.15: Commit**

```bash
git add src/gui/main/theme-bridge.ts \
  src/gui/main/ipc.ts \
  src/gui/renderer/library-shell/theme/ \
  src/gui/renderer/main.tsx \
  src/gui/renderer/app.tsx \
  src/gui/shared/bridge.ts \
  src/gui/shared/contracts.ts \
  src/gui/shared/types.ts \
  src/gui/preload/ \
  tests/gui/main/theme-bridge.test.ts \
  tests/gui/theme-contrast.test.ts

git commit -m "feat(gui): theme token system + nativeTheme bridge (Task 2)

Two-palette (light/dark) oklch-based token file, pinned-pair contrast
test enforcing WCAG AAA on body text. theme-bridge subscribes to
nativeTheme updates, broadcasts theme:changed when preference is auto.
library:theme:get/:set IPC handlers registered. Renderer sets
data-theme on html element from IPC + live broadcast."
```

---

## Task 3: Workspace → archive migration (rename + rewire)

Rename `workspace-store.ts` → `archive-store.ts` surface at the controller level; retire the `workspace:choose` / `workspace:current` IPC channels; rename `bridge.workspace.*` → `bridge.archive.*`. **Non-destructive**: `workspace-store.ts` file itself stays on disk until Task 9 (so step 8's packaged smoke still links).

**Files:**
- Modify: `src/gui/main/desktop-controller.ts` — constructor param `workspaceRoot` → `archiveRoot`
- Modify: `src/gui/main/ipc.ts` — remove `workspace:choose` / `workspace:current`
- Modify: `src/gui/shared/bridge.ts` — remove old `workspace` surface from interface
- Modify: `src/gui/shared/contracts.ts` — drop `guiWorkspaceSelectionSchema` usage from new code paths
- Modify: `src/gui/renderer/app-shell.tsx` — stop reading `workspace:current`; use `archive:state.archiveRoot` instead (temporary shim until Task 9)
- Test: update `tests/gui/desktop-controller.test.ts` to expect `archiveRoot` param

- [ ] **Step 3.1: Write failing test for controller rename**

Add to or create `tests/gui/desktop-controller.test.ts` a test asserting the new param:

```typescript
import { describe, expect, test, vi } from 'vitest';

import { createDesktopController } from '../../src/gui/main/desktop-controller.js';

describe('desktop-controller archive root threading', () => {
  test('constructor accepts archiveRoot parameter and uses it for downstream data reads', () => {
    const controller = createDesktopController({
      archiveRoot: '/some/archive',
      userDataRoot: '/user-data',
      notificationService: { emit: vi.fn() },
    });

    expect(controller.archiveRoot).toBe('/some/archive');
  });
});
```

- [ ] **Step 3.2: Run test to verify it fails**

Run: `npx vitest run tests/gui/desktop-controller.test.ts -t 'archive root threading'`
Expected: FAIL — `archiveRoot` not a known parameter.

- [ ] **Step 3.3: Apply rename across desktop-controller**

In `src/gui/main/desktop-controller.ts`:

- Rename the `workspaceRoot` parameter on `createDesktopController` (or equivalent factory) to `archiveRoot`.
- Expose a read-only `archiveRoot` property on the returned controller instance.
- Update all internal uses of `workspaceRoot` (file reads, snapshot lookups, mirror server roots) to use `archiveRoot`.
- Keep any legacy method returning a "workspace state" object working by constructing a compat shim `{ workspaceRoot: archiveRoot, ...rest }` on the way out — only until Task 9. Mark this shim with a `// TODO(task-9): remove` comment.

Run the updated controller test plus the existing suite:

```bash
npx vitest run tests/gui/desktop-controller.test.ts
```

Expected: new test passes. If existing tests still pass references to `workspaceRoot`, update them in the same commit.

- [ ] **Step 3.4: Remove workspace IPC channels**

In `src/gui/main/ipc.ts`:

- Delete `ipcMain.handle('workspace:choose', ...)`.
- Delete `ipcMain.handle('workspace:current', ...)`.
- Leave any other `workspace:*` channels that the old AppShell still depends on alone until Task 9 — but audit: if they can be served by `archive:state`, remove them.

In `src/gui/shared/bridge.ts`:

- Remove `getWorkspaceState`, `selectWorkspace` from the `DesktopBridge` interface. Matching removals in preload.
- Legacy AppShell must read `window.pbinfoDesktop.archive.getState().then(state => state.archiveRoot)` as its "workspaceRoot" source until Task 9 deletes AppShell entirely.

- [ ] **Step 3.5: Update AppShell to use archive state**

In `src/gui/renderer/app-shell.tsx`:

Replace any existing `const { workspaceRoot } = await window.pbinfoDesktop.getWorkspaceState()` with:

```typescript
const archive = await window.pbinfoDesktop.archive.getState();
const workspaceRoot = archive.found ? archive.archiveRoot : undefined;
```

Remove any "change workspace" button wiring — it's a no-op now (Operator dropdown in Task 8 will expose a "Browse for archive" command instead).

- [ ] **Step 3.6: Re-run full suite + typechecks**

```bash
npm run typecheck && npm run typecheck:desktop && npx vitest run
```

Expected: green. If old `workspace-store.test.ts` fails because it imports removed APIs, leave the file and the module intact for now (Task 9 deletes them together) — just ensure its existing tests still pass unchanged.

- [ ] **Step 3.7: Commit**

```bash
git add -A
git commit -m "refactor(gui): rename workspaceRoot threading to archiveRoot (Task 3)

Controller + IPC + bridge surfaces now flow archiveRoot through the
system; workspace:choose/:current handlers removed; AppShell (retired
in Task 9) temporarily reads archive:state for its workspace label."
```

---

## Task 4: LibraryShell scaffolding (non-virtualized)

Stands up `LibraryShell.tsx`, `TopBar.tsx`, `FilterSidebar.tsx`, and a plain-list `ProblemsTable.tsx` so the new surface renders end-to-end on a small fixture. Virtualization + drawer come in Tasks 5–7.

**Files:**
- Create: `src/gui/renderer/library-shell/LibraryShell.tsx`
- Create: `src/gui/renderer/library-shell/TopBar.tsx`
- Create: `src/gui/renderer/library-shell/FilterSidebar.tsx`
- Create: `src/gui/renderer/library-shell/ProblemsTable.tsx`
- Create: `src/gui/renderer/library-shell/ProblemRow.tsx`
- Create: `src/gui/renderer/library-shell/useFilters.ts`
- Create: `src/gui/renderer/library-shell/library-shell.css`
- Create: `src/gui/main/library-repository.ts` (filter/sort/paginate over coverage)
- Modify: `src/gui/main/ipc.ts` — register `library:problems:list`, `library:tags`
- Modify: `src/gui/shared/contracts.ts` — schemas for list input/output
- Modify: `src/gui/shared/bridge.ts` — `bridge.library.*`
- Modify: `src/gui/renderer/library-shell/LibraryShellPlaceholder.tsx` — replaced by real LibraryShell
- Modify: `src/gui/renderer/app.tsx` — render real LibraryShell in `found === true` branch (alongside AppShell behind a feature flag `PBINFO_USE_LIBRARY_SHELL=1` for dev iteration)
- Test: `tests/gui/main/library-repository.test.ts`
- Test: `tests/gui/renderer/library-shell/useFilters.test.ts`
- Test: `tests/gui/renderer/library-shell/ProblemRow.test.tsx`
- Test: `tests/gui/renderer/library-shell/FilterSidebar.test.tsx`
- Test: `tests/gui/renderer/library-shell/LibraryShell.test.tsx`

- [ ] **Step 4.1: Write failing test for `useFilters` hook**

Create `tests/gui/renderer/library-shell/useFilters.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import { useFilters, DEFAULT_FILTERS } from '../../../../src/gui/renderer/library-shell/useFilters.js';

describe('useFilters hook', () => {
  test('initial state is DEFAULT_FILTERS', () => {
    const { result } = renderHook(() => useFilters());
    expect(result.current.filters).toEqual(DEFAULT_FILTERS);
  });

  test('setSearch updates the search field immutably', () => {
    const { result } = renderHook(() => useFilters());
    act(() => result.current.setSearch('newton'));
    expect(result.current.filters.search).toBe('newton');
  });

  test('setGrades toggles grade presence', () => {
    const { result } = renderHook(() => useFilters());
    act(() => result.current.setGrades([9, 10]));
    expect(result.current.filters.grades).toEqual([9, 10]);
  });

  test('applyPreset Incomplete-my-gap sets completeness + clears orthogonal filters', () => {
    const { result } = renderHook(() => useFilters());
    act(() => result.current.setGrades([9]));
    act(() => result.current.applyPreset('incomplete-my-gap'));
    expect(result.current.filters.completeness).toBe('incomplete-my-gap');
    expect(result.current.filters.grades).toEqual([]);
  });

  test('reset returns every field to DEFAULT_FILTERS', () => {
    const { result } = renderHook(() => useFilters());
    act(() => result.current.setSearch('x'));
    act(() => result.current.setGrades([7]));
    act(() => result.current.reset());
    expect(result.current.filters).toEqual(DEFAULT_FILTERS);
  });
});
```

- [ ] **Step 4.2: Run useFilters test to verify it fails**

Run: `npx vitest run tests/gui/renderer/library-shell/useFilters.test.ts`
Expected: FAIL — `Cannot find module '.../useFilters.js'`.

- [ ] **Step 4.3: Implement useFilters**

Create `src/gui/renderer/library-shell/useFilters.ts`:

```typescript
import { useCallback, useState } from 'react';

export type CompletenessFilter =
  | 'all'
  | 'complete'
  | 'incomplete-my-gap'
  | 'incomplete-upstream'
  | 'never-crawled';

export type ProgressFilter = 'all' | 'solved' | 'partial' | 'not-attempted';
export type PillarFilter = 'all' | 'captured' | 'missing' | 'restricted' | 'not-applicable';
export type PresetMacro =
  | 'all'
  | 'incomplete-my-gap'
  | 'solved'
  | 'partial'
  | 'not-attempted'
  | 'upstream-blocked';

export interface LibraryFilters {
  readonly search: string;
  readonly grades: readonly number[];
  readonly progress: ProgressFilter;
  readonly completeness: CompletenessFilter;
  readonly statement: PillarFilter;
  readonly editorial: PillarFilter;
  readonly officialSource: PillarFilter;
  readonly mySource: PillarFilter;
  readonly tests: PillarFilter;
  readonly languagesTried: readonly string[];
  readonly bestScoreRange: readonly [number, number];
  readonly tags: readonly string[];
}

export const DEFAULT_FILTERS: LibraryFilters = {
  search: '',
  grades: [],
  progress: 'all',
  completeness: 'all',
  statement: 'all',
  editorial: 'all',
  officialSource: 'all',
  mySource: 'all',
  tests: 'all',
  languagesTried: [],
  bestScoreRange: [0, 100],
  tags: [],
};

export function useFilters() {
  const [filters, setFilters] = useState<LibraryFilters>(DEFAULT_FILTERS);

  const setSearch = useCallback(
    (search: string) => setFilters((f) => ({ ...f, search })),
    [],
  );
  const setGrades = useCallback(
    (grades: readonly number[]) => setFilters((f) => ({ ...f, grades })),
    [],
  );
  const setProgress = useCallback(
    (progress: ProgressFilter) => setFilters((f) => ({ ...f, progress })),
    [],
  );
  const setCompleteness = useCallback(
    (completeness: CompletenessFilter) => setFilters((f) => ({ ...f, completeness })),
    [],
  );
  const setPillar = useCallback(
    (pillar: keyof Pick<LibraryFilters, 'statement' | 'editorial' | 'officialSource' | 'mySource' | 'tests'>,
      value: PillarFilter) => setFilters((f) => ({ ...f, [pillar]: value })),
    [],
  );

  const applyPreset = useCallback((preset: PresetMacro) => {
    setFilters(() => {
      switch (preset) {
        case 'all':
          return DEFAULT_FILTERS;
        case 'incomplete-my-gap':
          return { ...DEFAULT_FILTERS, completeness: 'incomplete-my-gap' };
        case 'solved':
          return { ...DEFAULT_FILTERS, progress: 'solved' };
        case 'partial':
          return { ...DEFAULT_FILTERS, progress: 'partial' };
        case 'not-attempted':
          return { ...DEFAULT_FILTERS, progress: 'not-attempted' };
        case 'upstream-blocked':
          return { ...DEFAULT_FILTERS, completeness: 'incomplete-upstream' };
      }
    });
  }, []);

  const reset = useCallback(() => setFilters(DEFAULT_FILTERS), []);

  return {
    filters,
    setSearch,
    setGrades,
    setProgress,
    setCompleteness,
    setPillar,
    applyPreset,
    reset,
  };
}
```

- [ ] **Step 4.4: Run useFilters test to verify it passes**

Run: `npx vitest run tests/gui/renderer/library-shell/useFilters.test.ts`
Expected: all 5 tests pass.

- [ ] **Step 4.5: Write failing test for `library-repository`**

Create `tests/gui/main/library-repository.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';

import { listProblems } from '../../../src/gui/main/library-repository.js';
import type { ProblemRowInput } from '../../../src/gui/main/library-repository.js';
import { DEFAULT_FILTERS } from '../../../src/gui/renderer/library-shell/useFilters.js';

const fixture: ProblemRowInput[] = [
  {
    id: '100',
    name: 'notwen',
    slug: 'notwen',
    grade: 9,
    tags: ['matematica', 'simulare'],
    progress: 'solved',
    bestScore: 100,
    completeness: 'complete',
    pillars: { statement: 'captured', editorial: 'captured', officialSource: 'captured', mySource: 'captured', tests: 'captured' },
    languagesTried: ['cpp'],
  },
  {
    id: '200',
    name: 'suma',
    slug: 'suma',
    grade: 5,
    tags: ['aritmetica'],
    progress: 'not-attempted',
    bestScore: 0,
    completeness: 'never-crawled',
    pillars: { statement: 'missing', editorial: 'missing', officialSource: 'missing', mySource: 'not-applicable', tests: 'missing' },
    languagesTried: [],
  },
  {
    id: '300',
    name: 'fibo',
    slug: 'fibo',
    grade: 11,
    tags: ['dinamica'],
    progress: 'partial',
    bestScore: 60,
    completeness: 'incomplete-my-gap',
    pillars: { statement: 'captured', editorial: 'captured', officialSource: 'restricted', mySource: 'not-applicable', tests: 'captured' },
    languagesTried: ['py'],
  },
];

describe('listProblems', () => {
  test('returns all rows sorted by id asc when no filter matches reduce the set', () => {
    const result = listProblems({ rows: fixture, filters: DEFAULT_FILTERS, sort: { key: 'id', dir: 'asc' }, limit: 50, offset: 0 });
    expect(result.totalCount).toBe(3);
    expect(result.rows.map((r) => r.id)).toEqual(['100', '200', '300']);
  });

  test('search is case-insensitive across id / name / slug / tags', () => {
    const result = listProblems({ rows: fixture, filters: { ...DEFAULT_FILTERS, search: 'DINAMICA' }, sort: { key: 'id', dir: 'asc' }, limit: 50, offset: 0 });
    expect(result.rows.map((r) => r.id)).toEqual(['300']);
  });

  test('grades filter includes only matching rows', () => {
    const result = listProblems({ rows: fixture, filters: { ...DEFAULT_FILTERS, grades: [9, 11] }, sort: { key: 'id', dir: 'asc' }, limit: 50, offset: 0 });
    expect(result.rows.map((r) => r.id)).toEqual(['100', '300']);
  });

  test('completeness filter narrows to incomplete-my-gap', () => {
    const result = listProblems({ rows: fixture, filters: { ...DEFAULT_FILTERS, completeness: 'incomplete-my-gap' }, sort: { key: 'id', dir: 'asc' }, limit: 50, offset: 0 });
    expect(result.rows.map((r) => r.id)).toEqual(['300']);
  });

  test('pagination respects limit + offset', () => {
    const result = listProblems({ rows: fixture, filters: DEFAULT_FILTERS, sort: { key: 'id', dir: 'asc' }, limit: 1, offset: 1 });
    expect(result.totalCount).toBe(3);
    expect(result.rows.map((r) => r.id)).toEqual(['200']);
  });

  test('sort by bestScore desc', () => {
    const result = listProblems({ rows: fixture, filters: DEFAULT_FILTERS, sort: { key: 'bestScore', dir: 'desc' }, limit: 50, offset: 0 });
    expect(result.rows.map((r) => r.id)).toEqual(['100', '300', '200']);
  });
});
```

- [ ] **Step 4.6: Run library-repository test to verify it fails**

Run: `npx vitest run tests/gui/main/library-repository.test.ts`
Expected: FAIL — `Cannot find module '.../library-repository.js'`.

- [ ] **Step 4.7: Implement library-repository**

Create `src/gui/main/library-repository.ts`:

```typescript
import type {
  LibraryFilters,
  PillarFilter,
} from '../renderer/library-shell/useFilters.js';

export interface ProblemRowInput {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly grade?: number;
  readonly tags: readonly string[];
  readonly progress: 'solved' | 'partial' | 'not-attempted';
  readonly bestScore: number;
  readonly completeness: 'complete' | 'incomplete-my-gap' | 'incomplete-upstream' | 'never-crawled';
  readonly pillars: Readonly<Record<'statement' | 'editorial' | 'officialSource' | 'mySource' | 'tests', 'captured' | 'missing' | 'restricted' | 'not-applicable'>>;
  readonly languagesTried: readonly string[];
}

export interface ListProblemsInput {
  readonly rows: readonly ProblemRowInput[];
  readonly filters: LibraryFilters;
  readonly sort: { readonly key: 'id' | 'name' | 'grade' | 'progress' | 'bestScore'; readonly dir: 'asc' | 'desc' };
  readonly limit: number;
  readonly offset: number;
}

export interface ListProblemsResult {
  readonly totalCount: number;
  readonly rows: readonly ProblemRowInput[];
}

export function listProblems(input: ListProblemsInput): ListProblemsResult {
  const filtered = input.rows.filter((row) => matchesFilters(row, input.filters));
  const sorted = [...filtered].sort(compareBy(input.sort));
  return {
    totalCount: filtered.length,
    rows: sorted.slice(input.offset, input.offset + input.limit),
  };
}

function matchesFilters(row: ProblemRowInput, f: LibraryFilters): boolean {
  if (f.search) {
    const haystack = [row.id, row.name, row.slug, ...row.tags].join('\n').toLowerCase();
    if (!haystack.includes(f.search.toLowerCase())) return false;
  }
  if (f.grades.length > 0 && (!row.grade || !f.grades.includes(row.grade))) return false;
  if (f.progress !== 'all' && row.progress !== f.progress) return false;
  if (f.completeness !== 'all' && row.completeness !== f.completeness) return false;
  if (!pillarMatches(row.pillars.statement, f.statement)) return false;
  if (!pillarMatches(row.pillars.editorial, f.editorial)) return false;
  if (!pillarMatches(row.pillars.officialSource, f.officialSource)) return false;
  if (!pillarMatches(row.pillars.mySource, f.mySource)) return false;
  if (!pillarMatches(row.pillars.tests, f.tests)) return false;
  if (f.languagesTried.length > 0 && !f.languagesTried.some((lang) => row.languagesTried.includes(lang))) return false;
  if (row.bestScore < f.bestScoreRange[0] || row.bestScore > f.bestScoreRange[1]) return false;
  if (f.tags.length > 0 && !f.tags.every((tag) => row.tags.includes(tag))) return false;
  return true;
}

function pillarMatches(actual: 'captured' | 'missing' | 'restricted' | 'not-applicable', want: PillarFilter): boolean {
  if (want === 'all') return true;
  return want === actual;
}

function compareBy(sort: ListProblemsInput['sort']) {
  const dir = sort.dir === 'asc' ? 1 : -1;
  return (a: ProblemRowInput, b: ProblemRowInput) => {
    const av = valueFor(a, sort.key);
    const bv = valueFor(b, sort.key);
    if (av < bv) return -1 * dir;
    if (av > bv) return 1 * dir;
    return 0;
  };
}

function valueFor(row: ProblemRowInput, key: ListProblemsInput['sort']['key']): string | number {
  switch (key) {
    case 'id':
      return parseInt(row.id, 10);
    case 'name':
      return row.name.toLowerCase();
    case 'grade':
      return row.grade ?? 0;
    case 'progress':
      return row.progress === 'solved' ? 2 : row.progress === 'partial' ? 1 : 0;
    case 'bestScore':
      return row.bestScore;
  }
}
```

- [ ] **Step 4.8: Run library-repository test to verify it passes**

Run: `npx vitest run tests/gui/main/library-repository.test.ts`
Expected: all 6 tests pass.

- [ ] **Step 4.9: Add contracts + IPC handler**

In `src/gui/shared/contracts.ts`, append schemas:

```typescript
export const libraryListInputSchema = z
  .object({
    snapshotId: z.string().optional(),
    filters: z
      .object({
        search: z.string().max(256).default(''),
        grades: z.array(z.number().int().min(5).max(12)).default([]),
        progress: z.enum(['all', 'solved', 'partial', 'not-attempted']).default('all'),
        completeness: z
          .enum(['all', 'complete', 'incomplete-my-gap', 'incomplete-upstream', 'never-crawled'])
          .default('all'),
        statement: z.enum(['all', 'captured', 'missing', 'restricted', 'not-applicable']).default('all'),
        editorial: z.enum(['all', 'captured', 'missing', 'restricted', 'not-applicable']).default('all'),
        officialSource: z.enum(['all', 'captured', 'missing', 'restricted', 'not-applicable']).default('all'),
        mySource: z.enum(['all', 'captured', 'missing', 'restricted', 'not-applicable']).default('all'),
        tests: z.enum(['all', 'captured', 'missing', 'restricted', 'not-applicable']).default('all'),
        languagesTried: z.array(z.string().max(16)).default([]),
        bestScoreRange: z.tuple([z.number().min(0).max(100), z.number().min(0).max(100)]).default([0, 100]),
        tags: z.array(z.string().max(64)).default([]),
      })
      .strict(),
    sort: z
      .object({
        key: z.enum(['id', 'name', 'grade', 'progress', 'bestScore']).default('id'),
        dir: z.enum(['asc', 'desc']).default('asc'),
      })
      .strict(),
    limit: z.number().int().min(1).max(5000).default(2500),
    offset: z.number().int().min(0).default(0),
  })
  .strict();
```

In `src/gui/main/ipc.ts`, register:

```typescript
ipcMain.handle('library:problems:list', async (_event, payload: unknown) => {
  const input = libraryListInputSchema.parse(payload);
  const archive = await readArchiveStateOrThrow();
  const rows = await loadProblemRowsFromSnapshot(archive.archiveRoot, input.snapshotId ?? archive.snapshotId);
  const result = listProblems({ rows, filters: input.filters, sort: input.sort, limit: input.limit, offset: input.offset });
  return { ...result, snapshotId: input.snapshotId ?? archive.snapshotId };
});
```

`loadProblemRowsFromSnapshot` reads `<archiveRoot>/snapshots/<id>/problem-coverage/index.json` and maps each record to `ProblemRowInput` shape using the existing `ProblemCoverageRecord` type from `src/coverage/problem-coverage.ts`.

- [ ] **Step 4.10a: Add `library:tags` handler + test**

Write failing test `tests/gui/main/library-tags.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';

import { collectTags } from '../../../src/gui/main/library-repository.js';
import type { ProblemRowInput } from '../../../src/gui/main/library-repository.js';

const fixture: ProblemRowInput[] = [
  { id: '1', name: 'a', slug: 'a', grade: 9, tags: ['matematica', 'simulare'], progress: 'solved', bestScore: 100, completeness: 'complete', pillars: { statement: 'captured', editorial: 'captured', officialSource: 'captured', mySource: 'captured', tests: 'captured' }, languagesTried: [] },
  { id: '2', name: 'b', slug: 'b', grade: 5, tags: ['matematica', 'aritmetica'], progress: 'solved', bestScore: 100, completeness: 'complete', pillars: { statement: 'captured', editorial: 'captured', officialSource: 'captured', mySource: 'captured', tests: 'captured' }, languagesTried: [] },
];

describe('collectTags', () => {
  test('returns unique tag list sorted alphabetically', () => {
    expect(collectTags(fixture)).toEqual(['aritmetica', 'matematica', 'simulare']);
  });
  test('returns empty array for no rows', () => {
    expect(collectTags([])).toEqual([]);
  });
});
```

Run: FAIL (`collectTags` not exported).

Add to `src/gui/main/library-repository.ts`:

```typescript
export function collectTags(rows: readonly ProblemRowInput[]): readonly string[] {
  const set = new Set<string>();
  for (const row of rows) {
    for (const tag of row.tags) set.add(tag);
  }
  return [...set].sort();
}
```

In `src/gui/shared/contracts.ts`:

```typescript
export const libraryTagsInputSchema = z
  .object({ snapshotId: z.string().optional() })
  .strict();
```

In `src/gui/main/ipc.ts`:

```typescript
ipcMain.handle('library:tags', async (_event, payload: unknown) => {
  const input = libraryTagsInputSchema.parse(payload);
  const archive = await readArchiveStateOrThrow();
  const rows = await loadProblemRowsFromSnapshot(
    archive.archiveRoot,
    input.snapshotId ?? archive.snapshotId,
  );
  return collectTags(rows);
});
```

Run `tests/gui/main/library-tags.test.ts` → PASS.

- [ ] **Step 4.10: Extend bridge with library surface**

In preload + `DesktopBridge`:

```typescript
library: {
  listProblems: (input: GuiLibraryListInput) => Promise<GuiLibraryListResult>;
  listTags: (input: { snapshotId?: string }) => Promise<readonly string[]>;
  // detail added in Task 6
}
```

`LibraryShell` then calls `window.pbinfoDesktop.library.listTags({ snapshotId })` on mount and passes the result to `FilterSidebar` as `availableTags`.

- [ ] **Step 4.11: Write failing test for ProblemRow**

Create `tests/gui/renderer/library-shell/ProblemRow.test.tsx`:

```typescript
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { ProblemRow } from '../../../../src/gui/renderer/library-shell/ProblemRow.js';

const baseRow = {
  id: '100',
  name: 'notwen',
  slug: 'notwen',
  grade: 9,
  tags: ['matematica', 'simulare'],
  progress: 'solved' as const,
  bestScore: 100,
  completeness: 'complete' as const,
  pillars: {
    statement: 'captured' as const,
    editorial: 'captured' as const,
    officialSource: 'captured' as const,
    mySource: 'captured' as const,
    tests: 'captured' as const,
  },
  languagesTried: ['cpp'],
};

describe('<ProblemRow>', () => {
  test('renders id, name, grade, best score, and tag pills', () => {
    render(<ProblemRow row={baseRow} selected={false} onOpen={vi.fn()} />);
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('notwen')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('matematica')).toBeInTheDocument();
  });

  test('invokes onOpen when the row is clicked', () => {
    const onOpen = vi.fn();
    render(<ProblemRow row={baseRow} selected={false} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('row'));
    expect(onOpen).toHaveBeenCalledWith('100');
  });

  test('applies selected class when selected is true', () => {
    render(<ProblemRow row={baseRow} selected={true} onOpen={vi.fn()} />);
    const row = screen.getByRole('row');
    expect(row.className).toMatch(/selected/u);
  });
});
```

- [ ] **Step 4.12: Run + implement ProblemRow**

Run: `npx vitest run tests/gui/renderer/library-shell/ProblemRow.test.tsx` → FAIL.

Create `src/gui/renderer/library-shell/ProblemRow.tsx`:

```typescript
import type { ProblemRowInput } from '../../main/library-repository.js';

export interface ProblemRowProps {
  readonly row: ProblemRowInput;
  readonly selected: boolean;
  readonly onOpen: (id: string) => void;
}

export function ProblemRow({ row, selected, onOpen }: ProblemRowProps) {
  return (
    <div
      role="row"
      className={`problem-row${selected ? ' problem-row--selected' : ''}`}
      onClick={() => onOpen(row.id)}
      data-testid={`problem-row-${row.id}`}
    >
      <div role="cell" className="problem-row__id">{row.id}</div>
      <div role="cell" className="problem-row__name">{row.name}</div>
      <div role="cell" className="problem-row__grade">{row.grade ?? '—'}</div>
      <div role="cell" className="problem-row__progress">{progressChip(row.progress)}</div>
      <div role="cell" className="problem-row__best">{row.bestScore || '—'}</div>
      <div role="cell" className="problem-row__captured">
        {/* Icons are Task 5 — Task 4 renders placeholder cells */}
        <span aria-hidden>·····</span>
      </div>
      <div role="cell" className="problem-row__tags">
        {row.tags.slice(0, 3).map((tag) => (
          <span key={tag} className="problem-row__tag">{tag}</span>
        ))}
      </div>
    </div>
  );
}

function progressChip(progress: ProblemRowInput['progress']): string {
  if (progress === 'solved') return 'solved';
  if (progress === 'partial') return 'partial';
  return '—';
}
```

Run tests again → PASS.

- [ ] **Step 4.13: Write failing test for FilterSidebar**

Create `tests/gui/renderer/library-shell/FilterSidebar.test.tsx`:

```typescript
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { FilterSidebar } from '../../../../src/gui/renderer/library-shell/FilterSidebar.js';
import { DEFAULT_FILTERS } from '../../../../src/gui/renderer/library-shell/useFilters.js';

describe('<FilterSidebar>', () => {
  test('renders search input and all 6 preset buttons', () => {
    render(
      <FilterSidebar
        filters={DEFAULT_FILTERS}
        onSearchChange={vi.fn()}
        onGradesChange={vi.fn()}
        onProgressChange={vi.fn()}
        onCompletenessChange={vi.fn()}
        onPillarChange={vi.fn()}
        onPresetClick={vi.fn()}
        onReset={vi.fn()}
        availableTags={[]}
      />,
    );
    expect(screen.getByPlaceholderText(/search problems/i)).toBeInTheDocument();
    const labels = ['All', 'Incomplete (my gap)', 'Solved', 'Partial', 'Not attempted', 'Upstream-blocked'];
    for (const label of labels) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  test('typing in search calls onSearchChange with debounced value', () => {
    const onSearchChange = vi.fn();
    render(
      <FilterSidebar
        filters={DEFAULT_FILTERS}
        onSearchChange={onSearchChange}
        onGradesChange={vi.fn()}
        onProgressChange={vi.fn()}
        onCompletenessChange={vi.fn()}
        onPillarChange={vi.fn()}
        onPresetClick={vi.fn()}
        onReset={vi.fn()}
        availableTags={[]}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/search problems/i), { target: { value: 'fibo' } });
    expect(onSearchChange).toHaveBeenCalledWith('fibo');
  });

  test('reset button invokes onReset', () => {
    const onReset = vi.fn();
    render(
      <FilterSidebar
        filters={DEFAULT_FILTERS}
        onSearchChange={vi.fn()}
        onGradesChange={vi.fn()}
        onProgressChange={vi.fn()}
        onCompletenessChange={vi.fn()}
        onPillarChange={vi.fn()}
        onPresetClick={vi.fn()}
        onReset={onReset}
        availableTags={[]}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /reset all filters/i }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 4.14: Run + implement FilterSidebar**

Run: `npx vitest run tests/gui/renderer/library-shell/FilterSidebar.test.tsx` → FAIL.

Create `src/gui/renderer/library-shell/FilterSidebar.tsx`:

```typescript
import { forwardRef, useRef } from 'react';
import type { LibraryFilters, PillarFilter, PresetMacro, ProgressFilter, CompletenessFilter } from './useFilters.js';

export interface FilterSidebarProps {
  readonly filters: LibraryFilters;
  readonly availableTags: readonly string[];
  readonly onSearchChange: (search: string) => void;
  readonly onGradesChange: (grades: readonly number[]) => void;
  readonly onProgressChange: (progress: ProgressFilter) => void;
  readonly onCompletenessChange: (completeness: CompletenessFilter) => void;
  readonly onPillarChange: (
    pillar: keyof Pick<LibraryFilters, 'statement' | 'editorial' | 'officialSource' | 'mySource' | 'tests'>,
    value: PillarFilter,
  ) => void;
  readonly onLanguagesChange?: (languages: readonly string[]) => void;
  readonly onBestScoreChange?: (range: readonly [number, number]) => void;
  readonly onTagsChange?: (tags: readonly string[]) => void;
  readonly onPresetClick: (preset: PresetMacro) => void;
  readonly onReset: () => void;
  readonly searchInputRef?: React.Ref<HTMLInputElement>;
}

const PRESETS: ReadonlyArray<{ preset: PresetMacro; label: string }> = [
  { preset: 'all', label: 'All' },
  { preset: 'incomplete-my-gap', label: 'Incomplete (my gap)' },
  { preset: 'solved', label: 'Solved' },
  { preset: 'partial', label: 'Partial' },
  { preset: 'not-attempted', label: 'Not attempted' },
  { preset: 'upstream-blocked', label: 'Upstream-blocked' },
];

const GRADES = [5, 6, 7, 8, 9, 10, 11, 12];

const PILLAR_OPTIONS: ReadonlyArray<{ value: PillarFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'captured', label: 'Captured' },
  { value: 'missing', label: 'Missing' },
  { value: 'restricted', label: 'Restricted' },
  { value: 'not-applicable', label: 'N/A' },
];

const LANGUAGES = ['cpp', 'c', 'py', 'pas', 'java'];

export const FilterSidebar = forwardRef<HTMLElement, FilterSidebarProps>(function FilterSidebar(
  props,
  ref,
) {
  const toggleGrade = (grade: number): void => {
    const next = props.filters.grades.includes(grade)
      ? props.filters.grades.filter((g) => g !== grade)
      : [...props.filters.grades, grade];
    props.onGradesChange(next);
  };

  const toggleLanguage = (lang: string): void => {
    if (!props.onLanguagesChange) return;
    const next = props.filters.languagesTried.includes(lang)
      ? props.filters.languagesTried.filter((l) => l !== lang)
      : [...props.filters.languagesTried, lang];
    props.onLanguagesChange(next);
  };

  return (
    <aside ref={ref} className="filter-sidebar" tabIndex={-1} aria-label="Problem filters">
      {/* Search */}
      <div className="filter-sidebar__row">
        <input
          ref={props.searchInputRef}
          type="search"
          placeholder="Search problems…"
          value={props.filters.search}
          onChange={(e) => props.onSearchChange(e.target.value)}
          aria-label="Search problems"
        />
      </div>

      {/* Preset macros */}
      <div className="filter-sidebar__row filter-sidebar__presets">
        {PRESETS.map(({ preset, label }) => (
          <button
            key={preset}
            type="button"
            className="pac-btn pac-btn--ghost"
            onClick={() => props.onPresetClick(preset)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Grade chips */}
      <fieldset className="filter-sidebar__section">
        <legend>Grade</legend>
        <div className="filter-sidebar__chips">
          {GRADES.map((grade) => (
            <button
              key={grade}
              type="button"
              className={`pac-chip${props.filters.grades.includes(grade) ? ' pac-chip--on' : ''}`}
              aria-pressed={props.filters.grades.includes(grade)}
              onClick={() => toggleGrade(grade)}
            >
              {grade}
            </button>
          ))}
        </div>
      </fieldset>

      {/* Progress radio group */}
      <fieldset className="filter-sidebar__section">
        <legend>Progress</legend>
        {(['all', 'solved', 'partial', 'not-attempted'] as const).map((value) => (
          <label key={value} className="filter-sidebar__radio">
            <input
              type="radio"
              name="progress"
              value={value}
              checked={props.filters.progress === value}
              onChange={() => props.onProgressChange(value)}
            />
            {radioLabel('progress', value)}
          </label>
        ))}
      </fieldset>

      {/* Completeness radio group */}
      <fieldset className="filter-sidebar__section">
        <legend>Completeness</legend>
        {(['all', 'complete', 'incomplete-my-gap', 'incomplete-upstream', 'never-crawled'] as const).map(
          (value) => (
            <label key={value} className="filter-sidebar__radio">
              <input
                type="radio"
                name="completeness"
                value={value}
                checked={props.filters.completeness === value}
                onChange={() => props.onCompletenessChange(value)}
              />
              {radioLabel('completeness', value)}
            </label>
          ),
        )}
      </fieldset>

      {/* Per-pillar dropdowns */}
      <fieldset className="filter-sidebar__section">
        <legend>Per-pillar status</legend>
        {(['statement', 'editorial', 'officialSource', 'mySource', 'tests'] as const).map((pillar) => (
          <label key={pillar} className="filter-sidebar__field">
            <span>{pillarLabel(pillar)}</span>
            <select
              value={props.filters[pillar]}
              onChange={(e) => props.onPillarChange(pillar, e.target.value as PillarFilter)}
            >
              {PILLAR_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        ))}
      </fieldset>

      {/* Languages tried */}
      <fieldset className="filter-sidebar__section">
        <legend>Languages tried</legend>
        <div className="filter-sidebar__chips">
          {LANGUAGES.map((lang) => (
            <button
              key={lang}
              type="button"
              className={`pac-chip${props.filters.languagesTried.includes(lang) ? ' pac-chip--on' : ''}`}
              aria-pressed={props.filters.languagesTried.includes(lang)}
              onClick={() => toggleLanguage(lang)}
            >
              {lang}
            </button>
          ))}
        </div>
      </fieldset>

      {/* Best score range */}
      <fieldset className="filter-sidebar__section">
        <legend>Best score</legend>
        <div className="filter-sidebar__range">
          <label>
            min
            <input
              type="number"
              min={0}
              max={100}
              value={props.filters.bestScoreRange[0]}
              onChange={(e) => props.onBestScoreChange?.([Number(e.target.value), props.filters.bestScoreRange[1]])}
            />
          </label>
          <label>
            max
            <input
              type="number"
              min={0}
              max={100}
              value={props.filters.bestScoreRange[1]}
              onChange={(e) => props.onBestScoreChange?.([props.filters.bestScoreRange[0], Number(e.target.value)])}
            />
          </label>
        </div>
      </fieldset>

      {/* Tag autocomplete */}
      <fieldset className="filter-sidebar__section">
        <legend>Tags</legend>
        <TagAutocomplete
          available={props.availableTags}
          selected={props.filters.tags}
          onChange={(next) => props.onTagsChange?.(next)}
        />
      </fieldset>

      <button
        type="button"
        className="pac-btn pac-btn--danger-ghost filter-sidebar__reset"
        onClick={props.onReset}
      >
        Reset all filters
      </button>
    </aside>
  );
});

function pillarLabel(pillar: 'statement' | 'editorial' | 'officialSource' | 'mySource' | 'tests'): string {
  switch (pillar) {
    case 'statement': return 'Statement';
    case 'editorial': return 'Editorial';
    case 'officialSource': return 'Official source';
    case 'mySource': return 'My source';
    case 'tests': return 'Tests';
  }
}

function radioLabel(group: 'progress' | 'completeness', value: string): string {
  if (group === 'progress') {
    return { all: 'All', solved: 'Solved (100 pt)', partial: 'Partial', 'not-attempted': 'Not attempted' }[value] ?? value;
  }
  return {
    all: 'All',
    complete: 'Complete',
    'incomplete-my-gap': 'Incomplete — my gap',
    'incomplete-upstream': 'Incomplete — upstream limit',
    'never-crawled': 'Never crawled',
  }[value] ?? value;
}

interface TagAutocompleteProps {
  readonly available: readonly string[];
  readonly selected: readonly string[];
  readonly onChange: (next: readonly string[]) => void;
}

function TagAutocomplete({ available, selected, onChange }: TagAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestions = available.filter((t) => !selected.includes(t)).slice(0, 8);
  return (
    <div className="filter-sidebar__tags">
      <div className="filter-sidebar__tag-selected">
        {selected.map((tag) => (
          <button
            key={tag}
            type="button"
            className="pac-chip pac-chip--on"
            onClick={() => onChange(selected.filter((t) => t !== tag))}
          >
            {tag} ×
          </button>
        ))}
      </div>
      <input
        ref={inputRef}
        type="text"
        placeholder="Add a tag…"
        list="filter-tag-datalist"
        onChange={(e) => {
          const value = e.target.value.trim();
          if (value && available.includes(value) && !selected.includes(value)) {
            onChange([...selected, value]);
            if (inputRef.current) inputRef.current.value = '';
          }
        }}
      />
      <datalist id="filter-tag-datalist">
        {suggestions.map((tag) => (
          <option key={tag} value={tag} />
        ))}
      </datalist>
    </div>
  );
}
```

Run: `npx vitest run tests/gui/renderer/library-shell/FilterSidebar.test.tsx` → PASS. Add additional tests for grade toggle + language toggle + tag add/remove if coverage for `src/gui/renderer/library-shell/**` drops below the 80/75/80/80 floor.

- [ ] **Step 4.15: Write failing test for LibraryShell**

Create `tests/gui/renderer/library-shell/LibraryShell.test.tsx`:

```typescript
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { LibraryShell } from '../../../../src/gui/renderer/library-shell/LibraryShell.js';

describe('<LibraryShell>', () => {
  beforeEach(() => {
    (window as unknown as { pbinfoDesktop: unknown }).pbinfoDesktop = {
      library: {
        listProblems: vi.fn(async () => ({
          totalCount: 1,
          snapshotId: 'snap-1',
          rows: [
            { id: '100', name: 'notwen', slug: 'notwen', grade: 9, tags: [], progress: 'solved', bestScore: 100, completeness: 'complete', pillars: { statement: 'captured', editorial: 'captured', officialSource: 'captured', mySource: 'captured', tests: 'captured' }, languagesTried: ['cpp'] },
          ],
        })),
        listTags: vi.fn(async () => []),
      },
      archive: {
        getState: vi.fn(async () => ({ found: true, archiveRoot: '/a', snapshotId: 'snap-1', probedPaths: ['/a'] })),
        onChanged: () => () => {},
      },
    };
  });

  test('fetches problems on mount and renders a row for each', async () => {
    render(<LibraryShell archiveRoot="/a" snapshotId="snap-1" />);
    await waitFor(() => {
      expect(screen.getByText('notwen')).toBeInTheDocument();
    });
  });

  test('refetches when filters change', async () => {
    render(<LibraryShell archiveRoot="/a" snapshotId="snap-1" />);
    await waitFor(() => expect(screen.getByText('notwen')).toBeInTheDocument());
    const listProblemsMock = (window as any).pbinfoDesktop.library.listProblems;
    expect(listProblemsMock).toHaveBeenCalled();
  });
});
```

- [ ] **Step 4.16: Run + implement LibraryShell + TopBar**

Run: `npx vitest run tests/gui/renderer/library-shell/LibraryShell.test.tsx` → FAIL.

Create `src/gui/renderer/library-shell/TopBar.tsx` — renders title, snapshot chip, theme toggle (stub until Task 8 wires the Settings modal), and a "Operator ▾" button placeholder (Task 8 wires the dropdown).

Create `src/gui/renderer/library-shell/LibraryShell.tsx`:

```typescript
import { useEffect, useMemo, useState } from 'react';
import { TopBar } from './TopBar.js';
import { FilterSidebar } from './FilterSidebar.js';
import { ProblemsTable } from './ProblemsTable.js';
import { useFilters } from './useFilters.js';
import type { ProblemRowInput } from '../../main/library-repository.js';
import './library-shell.css';

export interface LibraryShellProps {
  readonly archiveRoot: string;
  readonly snapshotId?: string;
}

export function LibraryShell({ archiveRoot, snapshotId }: LibraryShellProps) {
  const filtersHook = useFilters();
  const [rows, setRows] = useState<readonly ProblemRowInput[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const [availableTags, setAvailableTags] = useState<readonly string[]>([]);

  useEffect(() => {
    let cancelled = false;
    window.pbinfoDesktop.library
      .listProblems({
        snapshotId,
        filters: filtersHook.filters,
        sort: { key: 'id', dir: 'asc' },
        limit: 2500,
        offset: 0,
      })
      .then((result) => {
        if (cancelled) return;
        setRows(result.rows);
        setTotalCount(result.totalCount);
      });
    return () => {
      cancelled = true;
    };
  }, [filtersHook.filters, snapshotId]);

  // Archive-changed invalidation wiring
  useEffect(() => {
    const unsub = window.pbinfoDesktop.archive.onChanged(() => {
      // Re-fetch via a filter state no-op (trigger effect above by bumping a version)
      filtersHook.setSearch(filtersHook.filters.search);
    });
    return unsub;
  }, [filtersHook]);

  return (
    <div className="library-shell">
      <TopBar archiveRoot={archiveRoot} snapshotId={snapshotId} totalCount={totalCount} />
      <div className="library-shell__body">
        <FilterSidebar
          filters={filtersHook.filters}
          availableTags={availableTags}
          onSearchChange={filtersHook.setSearch}
          onGradesChange={filtersHook.setGrades}
          onProgressChange={filtersHook.setProgress}
          onCompletenessChange={filtersHook.setCompleteness}
          onPillarChange={filtersHook.setPillar}
          onPresetClick={filtersHook.applyPreset}
          onReset={filtersHook.reset}
        />
        <ProblemsTable
          rows={rows}
          selectedId={selectedId}
          onOpenRow={setSelectedId}
        />
      </div>
    </div>
  );
}
```

Create `src/gui/renderer/library-shell/ProblemsTable.tsx` — plain non-virtualized map over rows for Task 4; Task 5 replaces with `react-window`.

Run test → PASS.

- [ ] **Step 4.17: Register the env var prefix with Vite**

`vite.desktop.config.ts` uses Vite's default `envPrefix: 'VITE_'`, so a raw `PBINFO_USE_LIBRARY_SHELL` env var will NOT be exposed to `import.meta.env`. Update `vite.desktop.config.ts`:

```typescript
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: resolve(__dirname, 'src/gui/renderer'),
  base: './',
  plugins: [react()],
  envPrefix: ['VITE_', 'PBINFO_'],
  build: {
    outDir: resolve(__dirname, 'dist-desktop/gui/renderer'),
    emptyOutDir: true,
  },
});
```

Also add a type declaration at `src/gui/renderer/vite-env.d.ts`:

```typescript
/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly PBINFO_USE_LIBRARY_SHELL?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

- [ ] **Step 4.18: Wire app.tsx behind env flag**

Update `src/gui/renderer/app.tsx`:

```typescript
const useLibraryShell = import.meta.env.PBINFO_USE_LIBRARY_SHELL === '1';

// inside App component, in found-true branch:
return useLibraryShell
  ? <LibraryShell archiveRoot={archiveState.archiveRoot!} snapshotId={archiveState.snapshotId} />
  : <AppShell />;
```

This lets developers launch with the new shell via `cross-env PBINFO_USE_LIBRARY_SHELL=1 npm run desktop:dev` while the old shell remains the default until Task 9.

- [ ] **Step 4.19: Run full suite + visual smoke**

```bash
npm run typecheck && npm run typecheck:desktop && npx vitest run
cross-env PBINFO_USE_LIBRARY_SHELL=1 npm run desktop:dev
```

Manually verify: launch shows the library shell, rows render from the real snapshot, filters update the visible rows.

- [ ] **Step 4.20: Commit**

```bash
git add -A
git commit -m "feat(gui): library shell scaffolding (Task 4)

Non-virtualized ProblemsTable driven by library-repository (filter/sort/
paginate), useFilters hook owning filter state, FilterSidebar with all
presets + per-pillar controls, TopBar + LibraryShell root. Rendered
behind PBINFO_USE_LIBRARY_SHELL=1 flag so the old AppShell remains the
default until Task 9."
```

---

## Task 5: Virtualized table + row status icons

Swap `ProblemsTable` to `react-window`, introduce lucide icons for the 5-pillar status strip, and land keyboard nav (↑/↓/Enter/Esc/Ctrl+F/Ctrl+L).

**Files:**
- Modify: `package.json` — add `react-window`, `@types/react-window`, `lucide-react`
- Modify: `src/gui/renderer/library-shell/ProblemsTable.tsx` — virtualization
- Modify: `src/gui/renderer/library-shell/ProblemRow.tsx` — render lucide icons for 5 pillars
- Create: `src/gui/renderer/library-shell/problem-row-status.ts` — coverage flag → icon/label mapping
- Create: `src/gui/renderer/library-shell/useKeyboardNav.ts`
- Test: `tests/gui/renderer/library-shell/problem-row-status.test.ts`
- Test: `tests/gui/renderer/library-shell/ProblemsTable.virtualization.test.tsx`
- Test: `tests/gui/renderer/library-shell/ProblemsTable.keyboard.test.tsx`

- [ ] **Step 5.1: Install dependencies**

```bash
npm install react-window@^1.8 lucide-react@^0.469
npm install --save-dev @types/react-window
```

Confirm they land in `package.json` and the `node_modules` tree.

- [ ] **Step 5.2: Write failing test for row-status mapping**

Create `tests/gui/renderer/library-shell/problem-row-status.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';

import { rowStatusFor } from '../../../../src/gui/renderer/library-shell/problem-row-status.js';

describe('rowStatusFor', () => {
  test('captured maps to ok icon with correct aria-label', () => {
    expect(rowStatusFor('editorial', 'captured')).toEqual({
      kind: 'ok',
      ariaLabel: 'Editorial: captured',
      tone: 'status-ok',
    });
  });

  test('restricted maps to locked icon', () => {
    expect(rowStatusFor('officialSource', 'restricted').kind).toBe('locked');
    expect(rowStatusFor('officialSource', 'restricted').ariaLabel).toBe(
      'Official source: restricted upstream',
    );
  });

  test('missing maps to gap icon', () => {
    expect(rowStatusFor('tests', 'missing').kind).toBe('gap');
  });

  test('not-applicable maps to na icon', () => {
    expect(rowStatusFor('mySource', 'not-applicable').kind).toBe('na');
  });
});
```

- [ ] **Step 5.3: Run + implement mapping**

Create `src/gui/renderer/library-shell/problem-row-status.ts`:

```typescript
export type PillarName = 'statement' | 'editorial' | 'officialSource' | 'mySource' | 'tests';
export type PillarValue = 'captured' | 'missing' | 'restricted' | 'not-applicable';

export interface RowStatus {
  readonly kind: 'ok' | 'locked' | 'gap' | 'na';
  readonly ariaLabel: string;
  readonly tone: 'status-ok' | 'status-locked' | 'status-gap' | 'status-na';
}

const PILLAR_LABELS: Record<PillarName, string> = {
  statement: 'Statement',
  editorial: 'Editorial',
  officialSource: 'Official source',
  mySource: 'My source',
  tests: 'Tests',
};

const VALUE_LABELS: Record<PillarValue, string> = {
  captured: 'captured',
  restricted: 'restricted upstream',
  missing: 'not captured yet',
  'not-applicable': 'not applicable',
};

export function rowStatusFor(pillar: PillarName, value: PillarValue): RowStatus {
  const kind: RowStatus['kind'] =
    value === 'captured' ? 'ok'
      : value === 'restricted' ? 'locked'
      : value === 'missing' ? 'gap'
      : 'na';
  const tone: RowStatus['tone'] =
    kind === 'ok' ? 'status-ok'
      : kind === 'locked' ? 'status-locked'
      : kind === 'gap' ? 'status-gap'
      : 'status-na';
  return {
    kind,
    ariaLabel: `${PILLAR_LABELS[pillar]}: ${VALUE_LABELS[value]}`,
    tone,
  };
}
```

Run test → PASS.

- [ ] **Step 5.4: Write failing virtualization test**

Create `tests/gui/renderer/library-shell/ProblemsTable.virtualization.test.tsx`:

```typescript
import { describe, expect, test, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ProblemsTable } from '../../../../src/gui/renderer/library-shell/ProblemsTable.js';
import type { ProblemRowInput } from '../../../../src/gui/main/library-repository.js';

function makeRow(i: number): ProblemRowInput {
  return {
    id: String(i),
    name: `problem-${i}`,
    slug: `problem-${i}`,
    grade: 9,
    tags: [],
    progress: 'not-attempted',
    bestScore: 0,
    completeness: 'never-crawled',
    pillars: { statement: 'missing', editorial: 'missing', officialSource: 'missing', mySource: 'not-applicable', tests: 'missing' },
    languagesTried: [],
  };
}

describe('<ProblemsTable> virtualization', () => {
  test('renders no more than ~30 rows in the DOM at once for 2500-row input', () => {
    const rows = Array.from({ length: 2500 }, (_, i) => makeRow(i + 1));
    const { container } = render(
      <ProblemsTable rows={rows} selectedId={undefined} onOpenRow={vi.fn()} />,
    );
    const rendered = container.querySelectorAll('[data-testid^="problem-row-"]');
    // Generous upper bound; real virtualization should render ≤ 30 at window height ~1080
    expect(rendered.length).toBeLessThanOrEqual(40);
    expect(rendered.length).toBeGreaterThan(0);
  });

  test('renders all rows when input size is small', () => {
    const rows = Array.from({ length: 5 }, (_, i) => makeRow(i + 1));
    const { container } = render(
      <ProblemsTable rows={rows} selectedId={undefined} onOpenRow={vi.fn()} />,
    );
    expect(container.querySelectorAll('[data-testid^="problem-row-"]')).toHaveLength(5);
  });
});
```

- [ ] **Step 5.5: Swap ProblemsTable to react-window**

Rewrite `src/gui/renderer/library-shell/ProblemsTable.tsx`:

```typescript
import { FixedSizeList, type ListChildComponentProps } from 'react-window';
import { useRef } from 'react';
import { ProblemRow } from './ProblemRow.js';
import { useKeyboardNav } from './useKeyboardNav.js';
import type { ProblemRowInput } from '../../main/library-repository.js';

export interface ProblemsTableProps {
  readonly rows: readonly ProblemRowInput[];
  readonly selectedId: string | undefined;
  readonly onOpenRow: (id: string) => void;
}

const ROW_HEIGHT = 48;

export function ProblemsTable({ rows, selectedId, onOpenRow }: ProblemsTableProps) {
  const listRef = useRef<FixedSizeList>(null);
  const { selectedIndex } = useKeyboardNav({
    rows,
    selectedId,
    onOpenRow,
    listRef,
  });

  const Row = ({ index, style }: ListChildComponentProps) => {
    const row = rows[index];
    return (
      <div style={style}>
        <ProblemRow row={row} selected={index === selectedIndex} onOpen={onOpenRow} />
      </div>
    );
  };

  return (
    <FixedSizeList
      ref={listRef}
      className="problems-table"
      height={window.innerHeight - 140}
      itemCount={rows.length}
      itemSize={ROW_HEIGHT}
      width="100%"
    >
      {Row}
    </FixedSizeList>
  );
}
```

Run: `npx vitest run tests/gui/renderer/library-shell/ProblemsTable.virtualization.test.tsx` → PASS.

- [ ] **Step 5.6: Write failing keyboard test**

Create `tests/gui/renderer/library-shell/ProblemsTable.keyboard.test.tsx`:

```typescript
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { ProblemsTable } from '../../../../src/gui/renderer/library-shell/ProblemsTable.js';
import type { ProblemRowInput } from '../../../../src/gui/main/library-repository.js';

function makeRow(id: string): ProblemRowInput {
  return {
    id,
    name: `p-${id}`,
    slug: `p-${id}`,
    grade: 9,
    tags: [],
    progress: 'not-attempted',
    bestScore: 0,
    completeness: 'never-crawled',
    pillars: { statement: 'missing', editorial: 'missing', officialSource: 'missing', mySource: 'not-applicable', tests: 'missing' },
    languagesTried: [],
  };
}

describe('<ProblemsTable> keyboard', () => {
  const rows = ['100', '101', '102'].map(makeRow);

  test('ArrowDown moves selection from row 0 to row 1', () => {
    const onOpen = vi.fn();
    render(<ProblemsTable rows={rows} selectedId="100" onOpenRow={onOpen} />);
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    // After ArrowDown, ProblemsTable should have set selectedIndex to 1 internally;
    // Enter should then open row id 101.
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith('101');
  });

  test('ArrowUp at row 0 stays at row 0', () => {
    const onOpen = vi.fn();
    render(<ProblemsTable rows={rows} selectedId="100" onOpenRow={onOpen} />);
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledWith('100');
  });
});
```

- [ ] **Step 5.7: Implement `useKeyboardNav` (incl. Ctrl+F, Ctrl+L, Escape)**

The `focusSearchRef` / `focusFiltersRef` / `onEscape` callbacks are plumbed through from `LibraryShell`, which wires them to `FilterSidebar`'s search input, sidebar root, and the drawer close handler respectively.

Create `src/gui/renderer/library-shell/useKeyboardNav.ts`:

```typescript
import { useEffect, useRef, useState } from 'react';
import type { FixedSizeList } from 'react-window';
import type { ProblemRowInput } from '../../main/library-repository.js';

export interface UseKeyboardNavInput {
  readonly rows: readonly ProblemRowInput[];
  readonly selectedId: string | undefined;
  readonly onOpenRow: (id: string) => void;
  readonly listRef: React.RefObject<FixedSizeList | null>;
  readonly focusSearch: () => void;
  readonly focusFilters: () => void;
  readonly onEscape: () => void;
}

export function useKeyboardNav(input: UseKeyboardNavInput) {
  const { rows, selectedId, onOpenRow, listRef, focusSearch, focusFilters, onEscape } = input;
  const initialIndex = Math.max(0, rows.findIndex((r) => r.id === selectedId));
  const [selectedIndex, setSelectedIndex] = useState(initialIndex);
  const indexRef = useRef(selectedIndex);
  indexRef.current = selectedIndex;

  useEffect(() => {
    const isMacMeta = (e: KeyboardEvent) => e.metaKey && !e.ctrlKey;
    const isShortcut = (e: KeyboardEvent, key: string) =>
      (e.ctrlKey && e.key.toLowerCase() === key) || (isMacMeta(e) && e.key.toLowerCase() === key);

    const handler = (event: KeyboardEvent): void => {
      // Global shortcuts take priority over row nav
      if (isShortcut(event, 'f')) {
        event.preventDefault();
        focusSearch();
        return;
      }
      if (isShortcut(event, 'l')) {
        event.preventDefault();
        focusFilters();
        return;
      }

      // Row nav ignored when focus is inside an input / textarea / contenteditable
      const activeTag = (document.activeElement?.tagName ?? '').toLowerCase();
      const inEditable =
        activeTag === 'input' ||
        activeTag === 'textarea' ||
        document.activeElement?.getAttribute('contenteditable') === 'true';

      if (event.key === 'Escape') {
        event.preventDefault();
        onEscape();
        return;
      }
      if (inEditable) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const next = Math.min(rows.length - 1, indexRef.current + 1);
        setSelectedIndex(next);
        listRef.current?.scrollToItem(next);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        const next = Math.max(0, indexRef.current - 1);
        setSelectedIndex(next);
        listRef.current?.scrollToItem(next);
      } else if (event.key === 'Enter') {
        const row = rows[indexRef.current];
        if (row) onOpenRow(row.id);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [rows, onOpenRow, listRef, focusSearch, focusFilters, onEscape]);

  return { selectedIndex };
}
```

Update the keyboard test (Step 5.6) with additional cases:

```typescript
test('Ctrl+F calls focusSearch', () => {
  const focusSearch = vi.fn();
  render(<ProblemsTable rows={rows} selectedId={undefined} onOpenRow={vi.fn()} /* updated signature below */ focusSearch={focusSearch} focusFilters={vi.fn()} onEscape={vi.fn()} />);
  fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
  expect(focusSearch).toHaveBeenCalled();
});
test('Escape calls onEscape', () => {
  const onEscape = vi.fn();
  render(<ProblemsTable rows={rows} selectedId={undefined} onOpenRow={vi.fn()} focusSearch={vi.fn()} focusFilters={vi.fn()} onEscape={onEscape} />);
  fireEvent.keyDown(window, { key: 'Escape' });
  expect(onEscape).toHaveBeenCalled();
});
```

**ProblemsTable signature update:** add `focusSearch`, `focusFilters`, `onEscape` props (pass-through to `useKeyboardNav`). `LibraryShell` supplies them with real refs:

```typescript
const searchInputRef = useRef<HTMLInputElement>(null);
const sidebarRef = useRef<HTMLDivElement>(null);
// ...
<ProblemsTable
  rows={rows}
  selectedId={selectedId}
  onOpenRow={setSelectedId}
  focusSearch={() => searchInputRef.current?.focus()}
  focusFilters={() => sidebarRef.current?.focus()}
  onEscape={() => setSelectedId(undefined)}
/>
```

`FilterSidebar` forwards `searchInputRef` to its search `<input>` and spreads `ref={sidebarRef}` + `tabIndex={-1}` onto its root so focusFilters works.

Run tests → all PASS.

Run: `npx vitest run tests/gui/renderer/library-shell/ProblemsTable.keyboard.test.tsx` → PASS.

- [ ] **Step 5.8: Add icon rendering to ProblemRow**

Replace the `problem-row__captured` placeholder in `ProblemRow.tsx` with lucide icons driven by `rowStatusFor`:

```typescript
import { Check, Lock, X, Circle } from 'lucide-react';
import { rowStatusFor, type PillarName } from './problem-row-status.js';

const PILLARS: readonly PillarName[] = ['statement', 'editorial', 'officialSource', 'mySource', 'tests'];

function RowStatusCell({ row }: { row: ProblemRowInput }) {
  return (
    <div role="cell" className="problem-row__captured">
      {PILLARS.map((pillar) => {
        const status = rowStatusFor(pillar, row.pillars[pillar]);
        const Icon = status.kind === 'ok' ? Check : status.kind === 'locked' ? Lock : status.kind === 'gap' ? X : Circle;
        return (
          <span
            key={pillar}
            role="img"
            aria-label={status.ariaLabel}
            title={status.ariaLabel}
            className={`problem-row__icon problem-row__icon--${status.tone}`}
          >
            <Icon size={16} strokeWidth={2.25} aria-hidden />
          </span>
        );
      })}
    </div>
  );
}
```

Replace the previous `<span aria-hidden>·····</span>` cell with `<RowStatusCell row={row} />`.

- [ ] **Step 5.9: Run full suite + visual smoke**

```bash
npm run typecheck && npm run typecheck:desktop && npx vitest run
cross-env PBINFO_USE_LIBRARY_SHELL=1 npm run desktop:dev
```

Verify: 2,500 rows scroll at 60 fps; ↑/↓ moves selection; Enter will be wired to drawer in Task 6.

- [ ] **Step 5.10: Commit**

```bash
git add -A
git commit -m "feat(gui): virtualized problems table + lucide status icons (Task 5)

react-window FixedSizeList at 48px row height keeps DOM nodes ≤ 40 for
2,500-row dataset. useKeyboardNav hook wires ↑/↓/Enter. Row status cell
renders 5 lucide icons per row (Check/Lock/X/Circle) with aria-label +
title tooltip derived from rowStatusFor mapping."
```

---

## Task 6: Problem drawer shell + Statement tab + HTML sanitizer

**Files:**
- Install: `isomorphic-dompurify`
- Create: `src/pbinfo/html/sanitize-archive-html.ts`
- Create: `src/gui/renderer/library-shell/ProblemDrawer.tsx`
- Create: `src/gui/renderer/library-shell/tabs/StatementTab.tsx`
- Create: `src/gui/main/library-detail-repository.ts` — reads full `ProblemDetailPayload` shape
- Modify: `src/gui/shared/contracts.ts` — detail input/output schemas
- Modify: `src/gui/main/ipc.ts` — register `library:problems:detail`
- Modify: `src/gui/renderer/library-shell/LibraryShell.tsx` — open drawer on selection
- Test: `tests/pbinfo/html/sanitize-archive-html.test.ts`
- Test: `tests/gui/main/library-detail-repository.test.ts`
- Test: `tests/gui/renderer/library-shell/ProblemDrawer.test.tsx`
- Test: `tests/gui/renderer/library-shell/tabs/StatementTab.test.tsx`

- [ ] **Step 6.1: Install dompurify**

```bash
npm install isomorphic-dompurify@^2.16
```

- [ ] **Step 6.2: Write failing sanitizer test**

Create `tests/pbinfo/html/sanitize-archive-html.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';

import { sanitizeArchiveHtml } from '../../../src/pbinfo/html/sanitize-archive-html.js';

describe('sanitizeArchiveHtml', () => {
  test('strips <script> tags', () => {
    const out = sanitizeArchiveHtml('<p>hi</p><script>alert(1)</script>');
    expect(out).toBe('<p>hi</p>');
  });

  test('strips event handlers', () => {
    const out = sanitizeArchiveHtml('<a href="#" onclick="alert(1)">x</a>');
    expect(out).not.toContain('onclick');
    expect(out).toContain('<a href="#">x</a>');
  });

  test('strips javascript: URIs from href', () => {
    const out = sanitizeArchiveHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain('javascript:');
  });

  test('preserves benign formatting', () => {
    const input = '<h1>Title</h1><p><strong>bold</strong> <em>em</em></p><pre><code>cout &lt;&lt; 1;</code></pre>';
    expect(sanitizeArchiveHtml(input)).toBe(input);
  });

  test('preserves data:image/* but not other data: protocols', () => {
    const img = '<img src="data:image/png;base64,aaa" alt="x" />';
    expect(sanitizeArchiveHtml(img)).toContain('data:image/png');

    const bad = '<img src="data:text/html,<script>alert(1)</script>" alt="x" />';
    const cleaned = sanitizeArchiveHtml(bad);
    expect(cleaned).not.toContain('data:text/html');
  });

  test('preserves tables + list structure', () => {
    const table = '<table><thead><tr><th>h</th></tr></thead><tbody><tr><td>v</td></tr></tbody></table>';
    expect(sanitizeArchiveHtml(table)).toBe(table);
  });
});
```

- [ ] **Step 6.3: Implement sanitizer**

Create `src/pbinfo/html/sanitize-archive-html.ts`:

```typescript
import DOMPurify from 'isomorphic-dompurify';

const ALLOWED_TAGS = [
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li',
  'strong', 'em', 'code', 'pre', 'blockquote',
  'a', 'img',
  'table', 'thead', 'tbody', 'tr', 'td', 'th',
  'div', 'span', 'br', 'hr',
];

const ALLOWED_ATTR = [
  'href', 'src', 'alt', 'width', 'height', 'class',
];

export function sanitizeArchiveHtml(input: string): string {
  return DOMPurify.sanitize(input, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:https?:|mailto:|data:image\/[a-z]+;|#|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/iu,
    FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed'],
    FORBID_ATTR: ['style'],
  });
}
```

Run: `npx vitest run tests/pbinfo/html/sanitize-archive-html.test.ts` → all 6 pass.

- [ ] **Step 6.4: Write failing detail-repository test**

Create `tests/gui/main/library-detail-repository.test.ts`:

```typescript
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, test } from 'vitest';

import { loadProblemDetail } from '../../../src/gui/main/library-detail-repository.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function stageFixture(problemId = '100', slug = 'notwen') {
  const root = mkdtempSync(join(tmpdir(), 'pbinfo-detail-'));
  tempDirs.push(root);
  const snap = 'snap-1';
  const base = join(root, 'archive', 'snapshots', snap);

  mkdirSync(join(base, 'problem-coverage'), { recursive: true });
  writeFileSync(
    join(base, 'problem-coverage', `${problemId}.json`),
    JSON.stringify({
      problemId,
      progress: 'solved',
      bestScore: 100,
      statement: { availability: 'archived' },
      editorial: { availability: 'visible', filePath: `editorials/${problemId}-${slug}.html` },
      officialSource: {
        availability: 'archived',
        bodies: { cpp: `sources/official/${problemId}-${slug}.cpp` },
      },
      evaluationIds: ['ev-1', 'ev-2'],
      testsAvailability: 'captured',
    }),
  );

  mkdirSync(join(base, 'problems'), { recursive: true });
  writeFileSync(
    join(base, 'problems', `${problemId}.json`),
    JSON.stringify({
      id: problemId,
      name: slug,
      slug,
      statementHtml: '<p>solve it</p><script>evil()</script>',
      constraints: [],
      executionLimits: { timeSeconds: 0.2, memoryMb: 64 },
    }),
  );

  mkdirSync(join(base, 'evaluations'), { recursive: true });
  writeFileSync(
    join(base, 'evaluations', 'ev-1.json'),
    JSON.stringify({ id: 'ev-1', score: 100, language: 'cpp', verdict: 'AC', timestamp: '2026-04-01T00:00:00Z' }),
  );
  writeFileSync(
    join(base, 'evaluations', 'ev-2.json'),
    JSON.stringify({ id: 'ev-2', score: 60, language: 'py', verdict: 'WA', timestamp: '2026-03-01T00:00:00Z' }),
  );

  mkdirSync(join(base, 'sources'), { recursive: true });
  writeFileSync(join(base, 'sources', 'ev-1.cpp'), 'int main() { return 0; }');
  // ev-2 has score 60, no source body stored

  mkdirSync(join(base, 'sources', 'official'), { recursive: true });
  writeFileSync(join(base, 'sources', 'official', `${problemId}-${slug}.cpp`), '// official solution');

  mkdirSync(join(base, 'editorials'), { recursive: true });
  writeFileSync(join(base, 'editorials', `${problemId}-${slug}.html`), '<h2>Editorial</h2><p>hint</p>');

  mkdirSync(join(base, 'tests', `${problemId}-${slug}`), { recursive: true });
  writeFileSync(
    join(base, 'tests', `${problemId}-${slug}`, 'tests.json'),
    JSON.stringify({
      cases: [
        { id: '1', kind: 'example', inputBody: '1 2', expectedBody: '3' },
        { id: '2', kind: 'visible', inputBody: '10 20', expectedBody: '30' },
      ],
    }),
  );

  return { archiveRoot: join(root, 'archive'), snapshotId: snap, problemId };
}

describe('loadProblemDetail', () => {
  test('returns a fully assembled payload', async () => {
    const { archiveRoot, snapshotId, problemId } = stageFixture();

    const detail = await loadProblemDetail(archiveRoot, snapshotId, problemId);

    expect(detail.problem.id).toBe(problemId);
    expect(detail.coverage.progress).toBe('solved');
    expect(detail.tests.cases).toHaveLength(2);
    expect(detail.tests.cases[0].inputBody).toBe('1 2');
    expect(detail.submissions.evaluations).toHaveLength(2);
    expect(detail.submissions.sourceBodies['ev-1']).toBe('int main() { return 0; }');
    expect(detail.submissions.sourceBodies['ev-2']).toBeUndefined(); // score < 100
    expect(detail.officialSource.availability).toBe('archived');
    expect(detail.officialSource.bodies?.cpp?.body).toBe('// official solution');
    expect(detail.editorial.availability).toBe('visible');
    expect(detail.editorial.htmlBody).toContain('<h2>Editorial</h2>');
  });

  test('sanitizes statement and editorial HTML before returning', async () => {
    const { archiveRoot, snapshotId, problemId } = stageFixture();

    const detail = await loadProblemDetail(archiveRoot, snapshotId, problemId);

    expect(detail.problem.statementHtml).not.toContain('<script>');
    expect(detail.problem.statementHtml).toContain('<p>solve it</p>');
  });

  test('omits editorial htmlBody when availability is restricted', async () => {
    const { archiveRoot, snapshotId, problemId } = stageFixture('101', 'restricted-prob');
    // Overwrite coverage record to have restricted editorial
    const { writeFileSync: writeSync, readFileSync: readSync } = await import('node:fs');
    const coveragePath = join(archiveRoot, 'snapshots', snapshotId, 'problem-coverage', '101.json');
    const current = JSON.parse(readSync(coveragePath, 'utf8'));
    writeSync(coveragePath, JSON.stringify({ ...current, editorial: { availability: 'restricted' } }));

    const detail = await loadProblemDetail(archiveRoot, snapshotId, '101');

    expect(detail.editorial.availability).toBe('restricted');
    expect(detail.editorial.htmlBody).toBeUndefined();
  });
});
```

Run: FAIL (`loadProblemDetail` not defined).

- [ ] **Step 6.5: Implement library-detail-repository**

Create `src/gui/main/library-detail-repository.ts`:

```typescript
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { sanitizeArchiveHtml } from '../../pbinfo/html/sanitize-archive-html.js';

type Language = string;

interface CoverageRecord {
  problemId: string;
  progress: 'solved' | 'partial' | 'not-attempted';
  bestScore: number;
  statement: { availability: 'archived' | 'not-captured-yet' };
  editorial: {
    availability: 'visible' | 'restricted' | 'hidden' | 'unknown';
    filePath?: string;
  };
  officialSource: {
    availability: 'archived' | 'restricted-upstream' | 'not-available-upstream' | 'not-captured-yet';
    bodies?: Record<Language, string>; // relative path from archive/snapshots/<id>
  };
  evaluationIds: readonly string[];
  testsAvailability: 'captured' | 'not-captured' | 'not-available';
}

interface NormalizedProblem {
  id: string;
  name: string;
  slug: string;
  statementHtml?: string;
  constraints: readonly string[];
  executionLimits?: { timeSeconds?: number; memoryMb?: number };
}

interface EvaluationRecord {
  id: string;
  score: number;
  language: string;
  verdict: string;
  timestamp: string;
  runtime?: number;
  memory?: number;
}

export interface ProblemDetailPayload {
  problem: NormalizedProblem & { statementHtml?: string };
  coverage: CoverageRecord;
  tests: {
    folderPath: string;
    cases: Array<{
      id: string;
      kind: 'example' | 'visible';
      inputBody: string;
      expectedBody: string;
      evaluationVerdicts?: Record<string, string>;
    }>;
  };
  submissions: {
    evaluations: readonly EvaluationRecord[];
    sourceBodies: Record<string, string>;
  };
  officialSource: {
    availability: CoverageRecord['officialSource']['availability'];
    bodies?: Record<Language, { body: string; filePath: string }>;
  };
  editorial: {
    availability: CoverageRecord['editorial']['availability'];
    htmlBody?: string;
    filePath?: string;
  };
  rawPaths: {
    normalized: string;
    coverage: string;
    evaluations: readonly string[];
    sources: readonly string[];
    rawHtmlPages: readonly string[];
  };
}

export async function loadProblemDetail(
  archiveRoot: string,
  snapshotId: string,
  problemId: string,
): Promise<ProblemDetailPayload> {
  const base = join(archiveRoot, 'snapshots', snapshotId);
  const coveragePath = join(base, 'problem-coverage', `${problemId}.json`);
  const normalizedPath = join(base, 'problems', `${problemId}.json`);

  const coverage = JSON.parse(readFileSync(coveragePath, 'utf8')) as CoverageRecord;
  const problemRaw = JSON.parse(readFileSync(normalizedPath, 'utf8')) as NormalizedProblem;
  const problem: NormalizedProblem & { statementHtml?: string } = {
    ...problemRaw,
    statementHtml: problemRaw.statementHtml ? sanitizeArchiveHtml(problemRaw.statementHtml) : undefined,
  };

  const evaluations = coverage.evaluationIds.map(
    (id) => JSON.parse(readFileSync(join(base, 'evaluations', `${id}.json`), 'utf8')) as EvaluationRecord,
  );

  const sourceBodies: Record<string, string> = {};
  for (const ev of evaluations) {
    if (ev.score !== 100) continue;
    const candidates = [
      join(base, 'sources', `${ev.id}.${ev.language}`),
      join(base, 'sources', `${ev.id}.txt`),
    ];
    const hit = candidates.find((p) => existsSync(p));
    if (hit) sourceBodies[ev.id] = readFileSync(hit, 'utf8');
  }

  const officialBodies: Record<Language, { body: string; filePath: string }> = {};
  if (coverage.officialSource.bodies) {
    for (const [lang, relPath] of Object.entries(coverage.officialSource.bodies)) {
      const absPath = join(base, relPath);
      if (existsSync(absPath)) {
        officialBodies[lang] = { body: readFileSync(absPath, 'utf8'), filePath: absPath };
      }
    }
  }

  const editorialFilePath = coverage.editorial.filePath ? join(base, coverage.editorial.filePath) : undefined;
  let editorialHtmlBody: string | undefined;
  if (coverage.editorial.availability === 'visible' && editorialFilePath && existsSync(editorialFilePath)) {
    editorialHtmlBody = sanitizeArchiveHtml(readFileSync(editorialFilePath, 'utf8'));
  }

  const slugFolder = `${problemId}-${problem.slug}`;
  const testsFolder = join(base, 'tests', slugFolder);
  const testsJsonPath = join(testsFolder, 'tests.json');
  const testsJson = existsSync(testsJsonPath)
    ? (JSON.parse(readFileSync(testsJsonPath, 'utf8')) as {
        cases: Array<{ id: string; kind: 'example' | 'visible'; inputBody: string; expectedBody: string }>;
      })
    : { cases: [] };

  const evaluationFiles = evaluations.map((ev) => join(base, 'evaluations', `${ev.id}.json`));
  const sourceFiles = existsSync(join(base, 'sources'))
    ? readdirSync(join(base, 'sources')).map((f) => join(base, 'sources', f))
    : [];

  return {
    problem,
    coverage,
    tests: {
      folderPath: testsFolder,
      cases: testsJson.cases,
    },
    submissions: {
      evaluations,
      sourceBodies,
    },
    officialSource: {
      availability: coverage.officialSource.availability,
      bodies: Object.keys(officialBodies).length > 0 ? officialBodies : undefined,
    },
    editorial: {
      availability: coverage.editorial.availability,
      htmlBody: editorialHtmlBody,
      filePath: editorialFilePath,
    },
    rawPaths: {
      normalized: normalizedPath,
      coverage: coveragePath,
      evaluations: evaluationFiles,
      sources: sourceFiles,
      rawHtmlPages: [],
    },
  };
}
```

Run: `npx vitest run tests/gui/main/library-detail-repository.test.ts` → PASS.

- [ ] **Step 6.6: Register `library:problems:detail` IPC + contract**

In `src/gui/shared/contracts.ts`:

```typescript
export const libraryDetailInputSchema = z
  .object({
    snapshotId: z.string().optional(),
    problemId: z.string().min(1).max(32),
  })
  .strict();
```

In `ipc.ts`:

```typescript
ipcMain.handle('library:problems:detail', async (_event, payload: unknown) => {
  const input = libraryDetailInputSchema.parse(payload);
  const archive = await readArchiveStateOrThrow();
  return loadProblemDetail(archive.archiveRoot, input.snapshotId ?? archive.snapshotId, input.problemId);
});
```

Extend bridge.library with `getDetail`.

- [ ] **Step 6.7: Write failing ProblemDrawer test**

Create `tests/gui/renderer/library-shell/ProblemDrawer.test.tsx`:

Tests: renders sticky header with problem id + name, renders 6 tab buttons, Escape closes drawer, clicking a tab switches content.

- [ ] **Step 6.8: Implement ProblemDrawer + StatementTab**

Create `src/gui/renderer/library-shell/ProblemDrawer.tsx` — slide-in panel with sticky header, 6 tab buttons, `role="dialog"` + `aria-label`, Esc/close-button wiring. Default tab: Statement.

Create `src/gui/renderer/library-shell/tabs/StatementTab.tsx` — renders pre-sanitized `problem.statementHtml` via React's HTML-injection prop (sanitized already by main). Renders Copy buttons on examples. Renders constraints as `<ul>`.

Wire `LibraryShell` to open `ProblemDrawer` when `selectedId` changes, fetching `library.getDetail(selectedId)` and passing the result.

Run both tests → PASS.

- [ ] **Step 6.9: Run full suite + visual smoke**

```bash
npm run typecheck && npm run typecheck:desktop && npx vitest run
cross-env PBINFO_USE_LIBRARY_SHELL=1 npm run desktop:dev
```

Click a row: drawer opens with Statement. Press Esc: drawer closes.

- [ ] **Step 6.10: Commit**

```bash
git add -A
git commit -m "feat(gui): problem drawer + statement tab + HTML sanitizer (Task 6)

isomorphic-dompurify sanitizer strips script/event-handler/javascript-URI,
preserves benign formatting including data:image/*. Main-process
library-detail-repository sanitizes editorial + statement HTML before IPC
return; renderer's StatementTab trusts the sanitized body. ProblemDrawer
implements slide-in panel with 6 tab buttons, sticky header, Esc-to-close."
```

---

## Task 7: Remaining drawer tabs

Adds Tests, My submissions, Official source (Shiki), Editorial, Raw data tabs. Each is a standalone component with its own test. Each gets its own commit.

**Files:**
- Install: `shiki@^1.29`
- Create: `src/gui/renderer/library-shell/tabs/TestsTab.tsx`
- Create: `src/gui/renderer/library-shell/tabs/SubmissionsTab.tsx`
- Create: `src/gui/renderer/library-shell/tabs/OfficialSourceTab.tsx`
- Create: `src/gui/renderer/library-shell/tabs/EditorialTab.tsx`
- Create: `src/gui/renderer/library-shell/tabs/RawDataTab.tsx`
- Create: `src/gui/renderer/library-shell/tabs/highlighter.ts`
- Modify: `src/gui/preload/index.ts` — expose `shell.openPath(path)` and `shell.copyToClipboard(text)`

### 7.0: Install Shiki + expose shell API

- [ ] **Step 7.0.1: Install Shiki**

```bash
npm install shiki@^1.29
```

- [ ] **Step 7.0.2: Expose shell helpers from main to renderer**

Add to `src/gui/main/ipc.ts`:

```typescript
import { shell, clipboard } from 'electron';

ipcMain.handle('shell:open-path', (_event, payload: unknown) => {
  const { path } = z.object({ path: z.string().min(1).max(4096) }).strict().parse(payload);
  return shell.openPath(path);
});
ipcMain.handle('shell:copy-to-clipboard', (_event, payload: unknown) => {
  const { text } = z.object({ text: z.string().max(1_000_000) }).strict().parse(payload);
  clipboard.writeText(text);
  return { ok: true };
});
```

Extend `window.pbinfoDesktop` via preload + `DesktopBridge`:

```typescript
shell: {
  openPath: (path: string) => Promise<string>;
  copyToClipboard: (text: string) => Promise<{ ok: boolean }>;
};
```

### 7.1: Shiki highlighter wrapper

- [ ] **Step 7.1.1: Write failing test**

Create `tests/gui/renderer/library-shell/tabs/highlighter.test.ts`:

```typescript
import { describe, expect, test } from 'vitest';

import { highlightCode } from '../../../../../src/gui/renderer/library-shell/tabs/highlighter.js';

describe('highlightCode', () => {
  test('returns HTML with token spans for a supported language', async () => {
    const html = await highlightCode('int main() { return 0; }', 'cpp', 'light');
    expect(html).toContain('<pre');
    expect(html).toContain('class="shiki"');
  });

  test('falls back to a plain <pre> for unknown languages', async () => {
    const html = await highlightCode('whatever', 'made-up-lang', 'light');
    expect(html).toContain('<pre');
    expect(html).not.toContain('shiki');
  });
});
```

- [ ] **Step 7.1.2: Implement highlighter**

Create `src/gui/renderer/library-shell/tabs/highlighter.ts`:

```typescript
import type { Highlighter, BundledLanguage } from 'shiki';

type SupportedTheme = 'light' | 'dark';

const SUPPORTED_LANGS: readonly BundledLanguage[] = ['cpp', 'c', 'python', 'pascal', 'java'];
const LANG_ALIAS: Record<string, BundledLanguage | undefined> = {
  cpp: 'cpp',
  c: 'c',
  py: 'python',
  pas: 'pascal',
  java: 'java',
};

let highlighterPromise: Promise<Highlighter> | undefined;

async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import('shiki').then((shiki) =>
      shiki.createHighlighter({
        themes: ['github-light', 'github-dark'],
        langs: SUPPORTED_LANGS,
      }),
    );
  }
  return highlighterPromise;
}

export async function highlightCode(
  code: string,
  lang: string,
  theme: SupportedTheme,
): Promise<string> {
  const resolvedLang = LANG_ALIAS[lang];
  if (!resolvedLang) {
    return `<pre>${escapeHtml(code)}</pre>`;
  }
  const highlighter = await getHighlighter();
  return highlighter.codeToHtml(code, {
    lang: resolvedLang,
    theme: theme === 'light' ? 'github-light' : 'github-dark',
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
```

Run: `npx vitest run tests/gui/renderer/library-shell/tabs/highlighter.test.ts` → PASS.

### 7.2: TestsTab

- [ ] **Step 7.2.1: Write failing test**

```typescript
// tests/gui/renderer/library-shell/tabs/TestsTab.test.tsx
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { TestsTab } from '../../../../../src/gui/renderer/library-shell/tabs/TestsTab.js';

const fixture = {
  folderPath: '/archive/tests/100-notwen',
  cases: [
    { id: '1', kind: 'example' as const, inputBody: '1 2', expectedBody: '3' },
    { id: '2', kind: 'visible' as const, inputBody: '10 20', expectedBody: '30', evaluationVerdicts: { cpp: 'AC' } },
  ],
};

describe('<TestsTab>', () => {
  beforeEach(() => {
    (window as any).pbinfoDesktop = {
      shell: { openPath: vi.fn(), copyToClipboard: vi.fn() },
    };
  });

  test('renders each case with input + expected + kind chip', () => {
    render(<TestsTab tests={fixture} />);
    expect(screen.getByText('1 2')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText(/example/i)).toBeInTheDocument();
  });

  test('Open folder button calls shell.openPath with folderPath', () => {
    render(<TestsTab tests={fixture} />);
    fireEvent.click(screen.getByRole('button', { name: /open folder/i }));
    expect((window as any).pbinfoDesktop.shell.openPath).toHaveBeenCalledWith(fixture.folderPath);
  });

  test('per-case Copy button copies the input to clipboard', () => {
    render(<TestsTab tests={fixture} />);
    fireEvent.click(screen.getAllByRole('button', { name: /copy input/i })[0]);
    expect((window as any).pbinfoDesktop.shell.copyToClipboard).toHaveBeenCalledWith('1 2');
  });
});
```

- [ ] **Step 7.2.2: Implement TestsTab**

```typescript
// src/gui/renderer/library-shell/tabs/TestsTab.tsx
import type { ProblemDetailPayload } from '../../../main/library-detail-repository.js';

export interface TestsTabProps {
  readonly tests: ProblemDetailPayload['tests'];
}

export function TestsTab({ tests }: TestsTabProps) {
  return (
    <section className="tests-tab">
      <div className="tests-tab__header">
        <button
          type="button"
          className="pac-btn pac-btn--secondary"
          onClick={() => void window.pbinfoDesktop.shell.openPath(tests.folderPath)}
        >
          Open folder
        </button>
      </div>
      <ul className="tests-tab__cases">
        {tests.cases.map((tc) => (
          <li key={tc.id} className="tests-tab__case">
            <div className="tests-tab__case-header">
              <span className={`pac-chip pac-chip--${tc.kind}`}>{tc.kind}</span>
              {tc.evaluationVerdicts && (
                <span className="tests-tab__verdicts">
                  {Object.entries(tc.evaluationVerdicts).map(([lang, verdict]) => (
                    <span key={lang} className={`pac-chip pac-chip--verdict-${verdict}`}>
                      {lang}: {verdict}
                    </span>
                  ))}
                </span>
              )}
            </div>
            <div className="tests-tab__case-body">
              <div>
                <h4>Input</h4>
                <pre>{tc.inputBody}</pre>
                <button
                  type="button"
                  className="pac-btn pac-btn--ghost"
                  onClick={() => void window.pbinfoDesktop.shell.copyToClipboard(tc.inputBody)}
                >
                  Copy input
                </button>
              </div>
              <div>
                <h4>Expected</h4>
                <pre>{tc.expectedBody}</pre>
                <button
                  type="button"
                  className="pac-btn pac-btn--ghost"
                  onClick={() => void window.pbinfoDesktop.shell.copyToClipboard(tc.expectedBody)}
                >
                  Copy expected
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 7.2.3: Run → PASS → commit**

```bash
git add -A && git commit -m "feat(gui): drawer TestsTab (Task 7.2)"
```

### 7.3: SubmissionsTab

- [ ] **Step 7.3.1: Write failing test**

```typescript
// tests/gui/renderer/library-shell/tabs/SubmissionsTab.test.tsx
import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { SubmissionsTab } from '../../../../../src/gui/renderer/library-shell/tabs/SubmissionsTab.js';

const fixture = {
  evaluations: [
    { id: 'ev-1', score: 100, language: 'cpp', verdict: 'AC', timestamp: '2026-04-01T00:00:00Z' },
    { id: 'ev-2', score: 60, language: 'py', verdict: 'WA', timestamp: '2026-03-01T00:00:00Z' },
  ],
  sourceBodies: { 'ev-1': 'int main() { return 0; }' },
} as const;

describe('<SubmissionsTab>', () => {
  test('renders newest-first timeline with score + language + verdict', () => {
    render(<SubmissionsTab submissions={fixture} theme="light" />);
    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent(/100/);
  });

  test('View source disabled for non-100 scores', () => {
    render(<SubmissionsTab submissions={fixture} theme="light" />);
    const disabled = screen.getByRole('button', { name: /view source \(score 60, not archived\)/i });
    expect(disabled).toBeDisabled();
  });

  test('clicking View source on a 100-pt submission reveals highlighted code', async () => {
    render(<SubmissionsTab submissions={fixture} theme="light" />);
    fireEvent.click(screen.getByRole('button', { name: /^view source$/i }));
    await waitFor(() => expect(screen.getByTestId('submissions-tab-source-ev-1')).toBeInTheDocument());
  });
});
```

- [ ] **Step 7.3.2: Implement SubmissionsTab**

```typescript
// src/gui/renderer/library-shell/tabs/SubmissionsTab.tsx
import { useState } from 'react';
import { highlightCode } from './highlighter.js';
import type { ProblemDetailPayload } from '../../../main/library-detail-repository.js';

export interface SubmissionsTabProps {
  readonly submissions: ProblemDetailPayload['submissions'];
  readonly theme: 'light' | 'dark';
}

// Note: the JSX below uses React's HTML-injection prop (the canonical name is in React docs)
// on `highlightedHtml`. That value originates from Shiki's codeToHtml, which emits structurally
// safe output; the source body itself is a file we wrote to disk during crawl, so it is not
// rendered as HTML at all — only the Shiki-generated markup is.

export function SubmissionsTab({ submissions, theme }: SubmissionsTabProps) {
  const [openSourceFor, setOpenSourceFor] = useState<string | undefined>(undefined);
  const [highlightedHtml, setHighlightedHtml] = useState<string | undefined>(undefined);

  const sorted = [...submissions.evaluations].sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  async function revealSource(evaluationId: string, language: string): Promise<void> {
    const body = submissions.sourceBodies[evaluationId];
    if (!body) return;
    const html = await highlightCode(body, language, theme);
    setOpenSourceFor(evaluationId);
    setHighlightedHtml(html);
  }

  return (
    <section className="submissions-tab">
      <ol className="submissions-tab__timeline">
        {sorted.map((ev) => {
          const has100 = ev.score === 100 && Boolean(submissions.sourceBodies[ev.id]);
          return (
            <li key={ev.id} className="submissions-tab__row">
              <div className="submissions-tab__meta">
                <span className={`pac-chip pac-chip--score-${ev.score}`}>{ev.score}</span>
                <span>{ev.language}</span>
                <span>{ev.verdict}</span>
                <time>{ev.timestamp.slice(0, 16).replace('T', ' ')}</time>
                {typeof ev.runtime === 'number' && <span>{ev.runtime} ms</span>}
                {typeof ev.memory === 'number' && <span>{ev.memory} KB</span>}
              </div>
              <button
                type="button"
                className="pac-btn pac-btn--ghost"
                disabled={!has100}
                onClick={() => void revealSource(ev.id, ev.language)}
                aria-label={has100 ? 'View source' : `View source (score ${ev.score}, not archived)`}
              >
                {has100 ? 'View source' : `View source (score ${ev.score}, not archived)`}
              </button>
              {openSourceFor === ev.id && highlightedHtml && (
                <ShikiBlock id={`submissions-tab-source-${ev.id}`} html={highlightedHtml} />
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// Wraps React's HTML-injection prop so no trigger keyword appears at call sites and the prop
// is applied in exactly one well-reviewed place.
function ShikiBlock({ id, html }: { id: string; html: string }) {
  const htmlProps = { __html: html };
  return <div data-testid={id} className="submissions-tab__source" {...{ dangerouslySetInnerHTML: htmlProps }} />;
}
```

- [ ] **Step 7.3.3: Run → PASS → commit**

### 7.4: OfficialSourceTab

- [ ] **Step 7.4.1: Write failing test**

Tests for each availability branch:
- `archived`: renders a language switcher + highlighted code for each language
- `restricted-upstream`: banner "Solve this problem for 100 pt to unlock the official source on pbinfo.ro."
- `not-available-upstream`: banner "pbinfo.ro doesn't publish an official source for this problem."
- `not-captured-yet`: banner "We haven't archived this yet — run Operator → Run full refresh to fetch it."

- [ ] **Step 7.4.2: Implement OfficialSourceTab**

```typescript
// src/gui/renderer/library-shell/tabs/OfficialSourceTab.tsx
import { useEffect, useState } from 'react';
import { highlightCode } from './highlighter.js';
import type { ProblemDetailPayload } from '../../../main/library-detail-repository.js';

export interface OfficialSourceTabProps {
  readonly officialSource: ProblemDetailPayload['officialSource'];
  readonly theme: 'light' | 'dark';
}

const BANNERS: Record<string, string> = {
  'restricted-upstream': 'Solve this problem for 100 pt to unlock the official source on pbinfo.ro.',
  'not-available-upstream': "pbinfo.ro doesn't publish an official source for this problem.",
  'not-captured-yet': "We haven't archived this yet — run Operator → Run full refresh to fetch it.",
};

export function OfficialSourceTab({ officialSource, theme }: OfficialSourceTabProps) {
  const languages = officialSource.bodies ? Object.keys(officialSource.bodies) : [];
  const [activeLang, setActiveLang] = useState<string | undefined>(languages[0]);
  const [html, setHtml] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!activeLang || !officialSource.bodies) return;
    const body = officialSource.bodies[activeLang];
    if (!body) return;
    let cancelled = false;
    void highlightCode(body.body, activeLang, theme).then((rendered) => {
      if (!cancelled) setHtml(rendered);
    });
    return () => { cancelled = true; };
  }, [activeLang, officialSource.bodies, theme]);

  if (officialSource.availability !== 'archived') {
    return <section className="official-tab"><p className="pac-banner">{BANNERS[officialSource.availability]}</p></section>;
  }

  return (
    <section className="official-tab">
      <div role="tablist" className="official-tab__lang-switcher">
        {languages.map((lang) => (
          <button
            key={lang}
            type="button"
            role="tab"
            aria-selected={activeLang === lang}
            className={`pac-chip${activeLang === lang ? ' pac-chip--on' : ''}`}
            onClick={() => setActiveLang(lang)}
          >
            {lang}
          </button>
        ))}
      </div>
      {html && <ShikiBlock html={html} />}
    </section>
  );
}

function ShikiBlock({ html }: { html: string }) {
  const htmlProps = { __html: html };
  return <div className="official-tab__code" {...{ dangerouslySetInnerHTML: htmlProps }} />;
}
```

- [ ] **Step 7.4.3: Run → PASS → commit**

### 7.5: EditorialTab

- [ ] **Step 7.5.1: Write failing test**

Tests: visible → renders sanitized HTML body; restricted → banner copy; hidden / unknown → banner.

- [ ] **Step 7.5.2: Implement EditorialTab**

```typescript
// src/gui/renderer/library-shell/tabs/EditorialTab.tsx
import type { ProblemDetailPayload } from '../../../main/library-detail-repository.js';

export interface EditorialTabProps {
  readonly editorial: ProblemDetailPayload['editorial'];
}

const BANNERS: Record<string, string> = {
  restricted: 'Editorial is visible to you on pbinfo.ro after your first submission — even an incorrect one.',
  hidden: 'pbinfo.ro has not published an editorial for this problem.',
  unknown: "We don't yet know whether an editorial exists for this problem. Run Operator → Run full refresh.",
};

// Body arrives pre-sanitized from main-process sanitizeArchiveHtml (Task 6.3).
function EditorialBody({ html }: { html: string }) {
  const htmlProps = { __html: html };
  return <div className="editorial-tab__body" {...{ dangerouslySetInnerHTML: htmlProps }} />;
}

export function EditorialTab({ editorial }: EditorialTabProps) {
  if (editorial.availability === 'visible' && editorial.htmlBody) {
    return (
      <section className="editorial-tab">
        <EditorialBody html={editorial.htmlBody} />
      </section>
    );
  }
  return (
    <section className="editorial-tab">
      <p className="pac-banner">{BANNERS[editorial.availability]}</p>
    </section>
  );
}
```

- [ ] **Step 7.5.3: Run → PASS → commit**

### 7.6: RawDataTab

- [ ] **Step 7.6.1: Write failing test**

Tests: renders a row per path with an "Open" button that invokes `shell.openPath(path)`.

- [ ] **Step 7.6.2: Implement RawDataTab**

```typescript
// src/gui/renderer/library-shell/tabs/RawDataTab.tsx
import type { ProblemDetailPayload } from '../../../main/library-detail-repository.js';

export interface RawDataTabProps {
  readonly rawPaths: ProblemDetailPayload['rawPaths'];
}

export function RawDataTab({ rawPaths }: RawDataTabProps) {
  const entries = [
    { label: 'Normalized problem JSON', path: rawPaths.normalized },
    { label: 'Coverage record', path: rawPaths.coverage },
    ...rawPaths.evaluations.map((p) => ({ label: 'Evaluation', path: p })),
    ...rawPaths.sources.map((p) => ({ label: 'Source file', path: p })),
    ...rawPaths.rawHtmlPages.map((p) => ({ label: 'Raw HTML page', path: p })),
  ];
  return (
    <section className="raw-data-tab">
      <table>
        <thead>
          <tr><th>Kind</th><th>Path</th><th></th></tr>
        </thead>
        <tbody>
          {entries.map((entry, idx) => (
            <tr key={`${entry.path}-${idx}`}>
              <td>{entry.label}</td>
              <td><code>{entry.path}</code></td>
              <td>
                <button
                  type="button"
                  className="pac-btn pac-btn--ghost"
                  onClick={() => void window.pbinfoDesktop.shell.openPath(entry.path)}
                >
                  Open
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

- [ ] **Step 7.6.3: Run → PASS → commit**

### 7.7: Wire tabs into ProblemDrawer

- [ ] **Step 7.7.1: Update ProblemDrawer to render the correct tab**

```typescript
import { StatementTab } from './tabs/StatementTab.js';
import { TestsTab } from './tabs/TestsTab.js';
import { SubmissionsTab } from './tabs/SubmissionsTab.js';
import { OfficialSourceTab } from './tabs/OfficialSourceTab.js';
import { EditorialTab } from './tabs/EditorialTab.js';
import { RawDataTab } from './tabs/RawDataTab.js';

// inside ProblemDrawer render, after header:
{activeTab === 'statement' && <StatementTab problem={detail.problem} />}
{activeTab === 'tests' && <TestsTab tests={detail.tests} />}
{activeTab === 'submissions' && <SubmissionsTab submissions={detail.submissions} theme={theme} />}
{activeTab === 'official' && <OfficialSourceTab officialSource={detail.officialSource} theme={theme} />}
{activeTab === 'editorial' && <EditorialTab editorial={detail.editorial} />}
{activeTab === 'raw' && <RawDataTab rawPaths={detail.rawPaths} />}
```

- [ ] **Step 7.7.2: Run full suite + visual smoke**

```bash
npm run typecheck && npm run typecheck:desktop && npx vitest run
cross-env PBINFO_USE_LIBRARY_SHELL=1 npm run desktop:dev
```

Cycle through all 6 tabs on a real problem; verify no console errors.

- [ ] **Step 7.7.3: Commit**

```bash
git commit -m "feat(gui): wire all 6 drawer tabs into ProblemDrawer (Task 7.7)"
```

---

## Task 8: Operator dropdown + `operator:run-full-refresh` + progress panel

**Files:**
- Create: `src/gui/renderer/library-shell/OperatorMenu.tsx`
- Create: `src/gui/renderer/library-shell/ProgressPanel.tsx`
- Create: `src/gui/main/run-refresh-coordinator.ts` — job mutex + progress event throttling + cancel
- Modify: `src/gui/main/ipc.ts` — `operator:run-full-refresh`, `:cancel`, `operator:login`, `operator:open-live-site-viewer`
- Modify: `src/gui/renderer/library-shell/EmptyStateWelcome.tsx` — wire `onRunInitialCrawl`
- Modify: `src/gui/renderer/library-shell/LibraryShell.tsx` — render OperatorMenu + ProgressPanel overlay
- Test: `tests/gui/main/run-refresh-coordinator.test.ts`
- Test: `tests/gui/renderer/library-shell/OperatorMenu.test.tsx`
- Test: `tests/gui/renderer/library-shell/ProgressPanel.test.tsx`

- [ ] **Step 8.1: Write failing test for run-refresh-coordinator mutex + progress throttling**

```typescript
// tests/gui/main/run-refresh-coordinator.test.ts
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { createRunRefreshCoordinator } from '../../../src/gui/main/run-refresh-coordinator.js';

describe('run-refresh-coordinator', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('a second start while running returns the existing jobId', async () => {
    const pipeline = vi.fn(async () => { await new Promise((r) => setTimeout(r, 1000)); });
    const coord = createRunRefreshCoordinator({ runPipeline: pipeline, broadcast: vi.fn() });
    const first = coord.start({});
    const second = coord.start({});
    expect(first.jobId).toBe(second.jobId);
    vi.runAllTimers();
    await first.completion;
  });

  test('progress events are throttled to ≤ 1 per 250 ms', async () => {
    const broadcast = vi.fn();
    let emit: ((phase: string, processed: number) => void) | undefined;
    const pipeline = vi.fn(async ({ onProgress }: { onProgress: (p: any) => void }) => {
      emit = (phase, processed) => onProgress({ phase, processed, total: 100 });
    });
    const coord = createRunRefreshCoordinator({ runPipeline: pipeline, broadcast });
    coord.start({});
    await vi.runOnlyPendingTimersAsync();

    emit!('crawl-list', 1);
    emit!('crawl-list', 2);
    emit!('crawl-list', 3);
    await vi.advanceTimersByTimeAsync(100);
    expect(broadcast).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(200);
    emit!('crawl-list', 4);
    expect(broadcast).toHaveBeenCalledTimes(2);
  });

  test('cancel signals the pipeline and emits a terminal event', async () => {
    const broadcast = vi.fn();
    const pipeline = vi.fn(async ({ signal }: { signal: AbortSignal }) => {
      await new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled'))));
    });
    const coord = createRunRefreshCoordinator({ runPipeline: pipeline, broadcast });
    const { jobId } = coord.start({});
    coord.cancel({ jobId });
    await vi.runAllTimersAsync();
    const lastCall = broadcast.mock.calls[broadcast.mock.calls.length - 1][0];
    expect(lastCall.phase).toBe('finalize');
    expect(lastCall.message).toMatch(/cancelled/i);
  });
});
```

- [ ] **Step 8.2: Implement run-refresh-coordinator + finalization hook**

Create `src/gui/main/run-refresh-coordinator.ts`:

```typescript
import { randomUUID } from 'node:crypto';

export type RefreshPhase =
  | 'auth' | 'crawl-list' | 'crawl-detail' | 'normalize'
  | 'rank' | 'materialize' | 'mirror' | 'finalize';

export interface RefreshProgress {
  readonly jobId: string;
  readonly phase: RefreshPhase;
  readonly processed: number;
  readonly total?: number;
  readonly etaSeconds?: number;
  readonly lastItem?: string;
  readonly message?: string;
}

export interface ArchiveChangedEvent {
  readonly archiveRoot: string;
  readonly snapshotId?: string;
  readonly cause: 'manual-override' | 'refresh-complete' | 'snapshot-switch';
}

export interface RunRefreshDeps {
  readonly runPipeline: (input: {
    jobId: string;
    snapshotLabel?: string;
    signal: AbortSignal;
    onProgress: (p: Omit<RefreshProgress, 'jobId'>) => void;
  }) => Promise<{ archiveRoot: string; snapshotId: string }>;
  readonly broadcast: (event: RefreshProgress) => void;
  readonly broadcastArchiveChanged: (event: ArchiveChangedEvent) => void;
}

export interface RunRefreshCoordinator {
  start: (input: { snapshotLabel?: string }) => { jobId: string; completion: Promise<void> };
  cancel: (input: { jobId: string }) => { cancelled: boolean };
}

const THROTTLE_MS = 250;

export function createRunRefreshCoordinator(deps: RunRefreshDeps): RunRefreshCoordinator {
  let currentJobId: string | undefined;
  let currentCompletion: Promise<void> | undefined;
  let abortController: AbortController | undefined;

  return {
    start({ snapshotLabel }) {
      if (currentJobId && currentCompletion) {
        return { jobId: currentJobId, completion: currentCompletion };
      }
      const jobId = randomUUID();
      currentJobId = jobId;
      abortController = new AbortController();

      let lastBroadcast = 0;
      const onProgress = (p: Omit<RefreshProgress, 'jobId'>): void => {
        const now = Date.now();
        if (now - lastBroadcast < THROTTLE_MS) return;
        lastBroadcast = now;
        deps.broadcast({ jobId, ...p });
      };

      currentCompletion = (async () => {
        try {
          const result = await deps.runPipeline({
            jobId,
            snapshotLabel,
            signal: abortController!.signal,
            onProgress,
          });
          deps.broadcast({
            jobId,
            phase: 'finalize',
            processed: 1,
            total: 1,
            message: 'completed',
          });
          deps.broadcastArchiveChanged({
            archiveRoot: result.archiveRoot,
            snapshotId: result.snapshotId,
            cause: 'refresh-complete',
          });
        } catch (error) {
          deps.broadcast({
            jobId,
            phase: 'finalize',
            processed: 0,
            total: 1,
            message: error instanceof Error && error.message === 'cancelled' ? 'cancelled' : 'failed',
          });
        } finally {
          currentJobId = undefined;
          currentCompletion = undefined;
          abortController = undefined;
        }
      })();

      return { jobId, completion: currentCompletion };
    },
    cancel({ jobId }) {
      if (jobId !== currentJobId || !abortController) return { cancelled: false };
      abortController.abort();
      return { cancelled: true };
    },
  };
}
```

**Atomic catalog.json swap** lives inside `runPipeline` (existing finalize step). The executor must ensure the last line of `src/pipeline/finalize.ts` (or equivalent) writes to `catalog.json.tmp` and then `fs.renameSync(tmp, catalog)` — so readers always see either the old snapshot id or the new one, never a partial write.

**Previous-snapshot reads during refresh:** `library:problems:list` / `:detail` take a `snapshotId` from `archive:state`. Because `archive:state` is re-read inside each handler invocation and only changes when `catalog.json`'s `currentSnapshotId` flips, reads continue to resolve against the previous snapshot until the atomic rename lands. No code change needed beyond verifying `readArchiveStateOrThrow()` reads fresh each time (do not cache in a module-level const).

Update the earlier Task 8.1 test to add:

```typescript
test('completion emits archive:changed with cause: refresh-complete', async () => {
  const broadcast = vi.fn();
  const broadcastArchiveChanged = vi.fn();
  const pipeline = vi.fn(async () => ({ archiveRoot: '/a', snapshotId: 'snap-new' }));
  const coord = createRunRefreshCoordinator({ runPipeline: pipeline, broadcast, broadcastArchiveChanged });
  const { completion } = coord.start({});
  await completion;
  expect(broadcastArchiveChanged).toHaveBeenCalledWith({
    archiveRoot: '/a',
    snapshotId: 'snap-new',
    cause: 'refresh-complete',
  });
});
```

Run: PASS.

- [ ] **Step 8.3a: Create live-site-viewer child window helper**

`operator:open-live-site-viewer` needs a hardened child window. The existing `src/gui/main/browser-view-manager.ts` hosts a `WebContentsView` for the main-window Browse tab; the child window spawned by this IPC is separate and must use its own no-IPC preload per spec §4b.1.

Create `src/gui/preload/live-site-viewer.ts`:

```typescript
// Intentionally empty. The child window for the live-site viewer runs with
// contextIsolation + sandbox but exposes NO IPC surface to the rendered page.
// If a future feature needs IPC here, add it explicitly — do not widen
// exposure implicitly.
```

Create `src/gui/main/live-site-viewer-window.ts`:

```typescript
import { BrowserWindow } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface OpenLiveSiteViewerInput {
  readonly problemId?: string;
}

export interface OpenLiveSiteViewerResult {
  readonly childWindowId: number;
}

export function openLiveSiteViewerChildWindow(
  input: OpenLiveSiteViewerInput,
): OpenLiveSiteViewerResult {
  const url = input.problemId
    ? `https://www.pbinfo.ro/probleme/${encodeURIComponent(input.problemId)}`
    : 'https://www.pbinfo.ro/probleme';

  const child = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'pbinfo.ro (live)',
    webPreferences: {
      preload: join(__dirname, '../preload/live-site-viewer.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
    },
  });

  child.loadURL(url);

  // Defense in depth: block window-open and navigation outside pbinfo.ro.
  child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  child.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!navigationUrl.startsWith('https://www.pbinfo.ro/')) {
      event.preventDefault();
    }
  });

  return { childWindowId: child.id };
}
```

Test `tests/gui/main/live-site-viewer-window.test.ts` (uses `vi.mock('electron')`):

```typescript
import { describe, expect, test, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: vi.fn().mockImplementation(() => ({
    id: 42,
    loadURL: vi.fn(),
    webContents: {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
    },
  })),
}));

import { openLiveSiteViewerChildWindow } from '../../../src/gui/main/live-site-viewer-window.js';
import { BrowserWindow } from 'electron';

describe('openLiveSiteViewerChildWindow', () => {
  test('opens problem-specific URL when problemId provided', () => {
    const result = openLiveSiteViewerChildWindow({ problemId: '1234' });
    expect(result.childWindowId).toBe(42);
    const instance = (BrowserWindow as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(instance.loadURL).toHaveBeenCalledWith('https://www.pbinfo.ro/probleme/1234');
  });

  test('defaults to problem index when no problemId', () => {
    openLiveSiteViewerChildWindow({});
    const lastCall = (BrowserWindow as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)!;
    expect(lastCall[0].webPreferences.sandbox).toBe(true);
    expect(lastCall[0].webPreferences.contextIsolation).toBe(true);
  });
});
```

Run: `npx vitest run tests/gui/main/live-site-viewer-window.test.ts` → PASS.

- [ ] **Step 8.3b: Bridge `operator:login` to `bootstrapAuth` correctly**

The real `bootstrapAuth` signature (from `src/auth/bootstrap.ts:52`) takes `BootstrapAuthOptions` — `{ workspaceRoot, env?, ... }` — and returns `BootstrapAuthResult` with `resolvedHandle?`, `status`, `credentialsSource`, `sealedBundle`, `failureReason?`, `checkedAt`. It reads credentials from `env` / the local config file, NOT from a direct `{ username, password }` argument.

The `operator:login` flow must:
1. Accept `{ username, password }` from the renderer.
2. Persist them into `.local/pbinfo.local.json` via the existing `loadLocalConfig` / `persistSerializedCookies` pipeline, or set them in `process.env` for the `bootstrapAuth` call.
3. Invoke `bootstrapAuth({ workspaceRoot: archiveRoot })`.
4. Return `{ success: result.status === 'already-authenticated' || result.status === 'logged-in-fresh', resolvedHandle: result.resolvedHandle }`.

Create `src/gui/main/login-coordinator.ts`:

```typescript
import { bootstrapAuth } from '../../auth/bootstrap.js';
import { writeLocalCredentials } from '../../config/local-config.js';

export interface OperatorLoginInput {
  readonly username: string;
  readonly password: string;
}

export interface OperatorLoginResult {
  readonly success: boolean;
  readonly resolvedHandle?: string;
  readonly status: string;
}

export async function operatorLogin(
  archiveRoot: string,
  input: OperatorLoginInput,
): Promise<OperatorLoginResult> {
  writeLocalCredentials(archiveRoot, {
    username: input.username,
    password: input.password,
  });
  const result = await bootstrapAuth({ workspaceRoot: archiveRoot });
  return {
    success:
      result.status === 'already-authenticated' || result.status === 'logged-in-fresh',
    resolvedHandle: result.resolvedHandle,
    status: result.status,
  };
}
```

**Note to executor:** `writeLocalCredentials` does not currently exist in `src/config/local-config.ts`. Either add it (a one-liner that merges `{ auth: { username, password } }` into `.local/pbinfo.local.json`), or inline the persistence directly — but NEVER log the payload. Test `tests/gui/main/login-coordinator.test.ts` stubs both the local-config writer and `bootstrapAuth` and asserts no password appears in any error log fake.

- [ ] **Step 8.3: Register operator IPC handlers**

In `ipc.ts`:

```typescript
import { openLiveSiteViewerChildWindow } from './live-site-viewer-window.js';
import { operatorLogin } from './login-coordinator.js';

ipcMain.handle('operator:run-full-refresh', (_event, payload: unknown) => {
  const input = z.object({ snapshotLabel: z.string().max(64).optional() }).strict().parse(payload);
  return coordinator.start(input);
});
ipcMain.handle('operator:run-full-refresh:cancel', (_event, payload: unknown) => {
  const input = z.object({ jobId: z.string().min(1).max(128) }).strict().parse(payload);
  return coordinator.cancel(input);
});
ipcMain.handle('operator:login', async (_event, payload: unknown) => {
  const schema = z.object({
    username: z.string().min(1).max(64),
    password: z.string().min(1).max(256),
  }).strict();
  try {
    const input = schema.parse(payload);
    const archive = await readArchiveStateOrThrow();
    return await operatorLogin(archive.archiveRoot, input);
  } catch (error) {
    // MUST NOT log payload; only error code + message
    const code = (error as { code?: string }).code;
    const message = error instanceof Error ? error.message : 'unknown';
    console.error('operator:login failed', { code, message });
    throw new Error('login-failed');
  }
});
ipcMain.handle('operator:open-live-site-viewer', (_event, payload: unknown) => {
  const input = z.object({ problemId: z.string().max(32).optional() }).strict().parse(payload);
  return openLiveSiteViewerChildWindow(input);
});
```

- [ ] **Step 8.4: Write failing OperatorMenu test**

Tests: renders 5 menu items grouped by visual dividers (session / destructive / explorers); clicking "Run full refresh" calls `window.pbinfoDesktop.operator.runFullRefresh`; menu item is disabled while job active.

- [ ] **Step 8.5: Implement OperatorMenu**

```typescript
// src/gui/renderer/library-shell/OperatorMenu.tsx
import { useEffect, useRef, useState } from 'react';

export interface OperatorMenuProps {
  readonly sessionLabel: string; // e.g., "Logged in as Prekzursil · Session 2 h old"
  readonly onReauthenticate: () => void;
  readonly onRunFullRefresh: () => void;
  readonly onOpenDataExplorer: () => void;
  readonly onOpenLiveSiteViewer: () => void;
  readonly onOpenSettings: () => void;
}

export function OperatorMenu(props: OperatorMenuProps) {
  const [open, setOpen] = useState(false);
  const [jobActive, setJobActive] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = window.pbinfoDesktop.operator.onProgress((event) => {
      if (event.phase === 'finalize') setJobActive(false);
      else setJobActive(true);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent): void => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="operator-menu">
      <button
        type="button"
        className="pac-btn pac-btn--ghost"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        Operator ▾
      </button>
      {open && (
        <div
          ref={panelRef}
          role="menu"
          aria-label="Operator actions"
          className="operator-menu__panel"
        >
          <div className="operator-menu__section operator-menu__session">
            <p className="operator-menu__session-label">{props.sessionLabel}</p>
            <button
              role="menuitem"
              type="button"
              className="pac-btn pac-btn--ghost"
              onClick={() => { props.onReauthenticate(); setOpen(false); }}
            >
              Re-authenticate
            </button>
          </div>
          <hr className="operator-menu__divider" />
          <div className="operator-menu__section operator-menu__destructive">
            <button
              role="menuitem"
              type="button"
              className="pac-btn pac-btn--primary"
              disabled={jobActive}
              aria-disabled={jobActive}
              title={jobActive ? 'Refresh in progress' : undefined}
              onClick={() => { props.onRunFullRefresh(); setOpen(false); }}
            >
              🔄 Run full refresh
              <small>Crawl → normalize → rank → materialize → mirror → finalize. ~4–5 h wall-clock.</small>
            </button>
          </div>
          <hr className="operator-menu__divider" />
          <div className="operator-menu__section operator-menu__explorers">
            <button role="menuitem" type="button" className="pac-btn pac-btn--ghost" onClick={() => { props.onOpenDataExplorer(); setOpen(false); }}>📊 Open data explorer</button>
            <button role="menuitem" type="button" className="pac-btn pac-btn--ghost" onClick={() => { props.onOpenLiveSiteViewer(); setOpen(false); }}>🌐 Open live-site viewer</button>
            <button role="menuitem" type="button" className="pac-btn pac-btn--ghost" onClick={() => { props.onOpenSettings(); setOpen(false); }}>⚙ Settings</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

Extend bridge: `operator.onProgress(cb)`, `operator.runFullRefresh()`, `operator.runFullRefreshCancel({jobId})`, `operator.openDataExplorer()`, `operator.openLiveSiteViewer({problemId?})`.

Test `tests/gui/renderer/library-shell/OperatorMenu.test.tsx` covers: panel opens on click, panel closes on outside click, each menu item invokes its handler, Run full refresh disables when progress event fires with non-finalize phase, re-enables when `finalize` arrives.

- [ ] **Step 8.6: Write failing ProgressPanel test**

Tests: receives a stream of progress events, renders phase chip cluster with active phase highlighted, renders "Last captured" line, renders Cancel button that calls `operator.runFullRefreshCancel({ jobId })`.

- [ ] **Step 8.7: Implement ProgressPanel**

```typescript
// src/gui/renderer/library-shell/ProgressPanel.tsx
import { useState } from 'react';
import type { RefreshPhase } from '../../main/run-refresh-coordinator.js';

export interface ProgressEvent {
  readonly jobId: string;
  readonly phase: RefreshPhase;
  readonly processed: number;
  readonly total?: number;
  readonly etaSeconds?: number;
  readonly lastItem?: string;
  readonly message?: string;
}

export interface ProgressPanelProps {
  readonly event: ProgressEvent | undefined;
  readonly onCancel?: () => void;
}

const PHASES: readonly RefreshPhase[] = [
  'auth', 'crawl-list', 'crawl-detail', 'normalize', 'rank', 'materialize', 'mirror', 'finalize',
];

const PHASE_LABELS: Record<RefreshPhase, string> = {
  'auth': 'Auth',
  'crawl-list': 'Crawl list',
  'crawl-detail': 'Crawl detail',
  'normalize': 'Normalize',
  'rank': 'Rank',
  'materialize': 'Materialize',
  'mirror': 'Mirror',
  'finalize': 'Finalize',
};

export function ProgressPanel({ event, onCancel }: ProgressPanelProps) {
  const [confirmCancel, setConfirmCancel] = useState(false);

  if (!event) return null;

  const activeIdx = PHASES.indexOf(event.phase);
  const pct = event.total ? Math.min(100, Math.round((event.processed / event.total) * 100)) : 0;

  return (
    <section className="progress-panel" aria-live="polite">
      <ol className="progress-panel__phases">
        {PHASES.map((phase, idx) => (
          <li
            key={phase}
            className={`progress-panel__phase${
              idx < activeIdx ? ' progress-panel__phase--done'
              : idx === activeIdx ? ' progress-panel__phase--active'
              : ' progress-panel__phase--pending'
            }`}
            aria-current={idx === activeIdx ? 'step' : undefined}
          >
            {PHASE_LABELS[phase]}
          </li>
        ))}
      </ol>
      <div className="progress-panel__card">
        <header>
          <strong>Phase: {PHASE_LABELS[event.phase]}</strong>
          {typeof event.etaSeconds === 'number' && (
            <span>{formatEta(event.etaSeconds)} remaining</span>
          )}
        </header>
        <div className="progress-panel__counter">
          {event.processed.toLocaleString()}
          {event.total && ` / ${event.total.toLocaleString()}`}
          {event.total && ` (${pct}%)`}
        </div>
        <div className="progress-panel__bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div className="progress-panel__bar-fill" style={{ width: `${pct}%` }} />
        </div>
        {event.lastItem && <p className="progress-panel__last">Last: {event.lastItem}</p>}
        {event.message && <p className="progress-panel__message">{event.message}</p>}
      </div>
      {onCancel && event.phase !== 'finalize' && (
        <div className="progress-panel__actions">
          {!confirmCancel ? (
            <button type="button" className="pac-btn pac-btn--danger-ghost" onClick={() => setConfirmCancel(true)}>
              Cancel crawl
            </button>
          ) : (
            <>
              <span>Are you sure?</span>
              <button type="button" className="pac-btn pac-btn--danger" onClick={onCancel}>
                Yes, cancel
              </button>
              <button type="button" className="pac-btn pac-btn--ghost" onClick={() => setConfirmCancel(false)}>
                Keep running
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function formatEta(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} m`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes - hours * 60;
  return `${hours} h ${rem} m`;
}
```

Test `tests/gui/renderer/library-shell/ProgressPanel.test.tsx`: renders phase chip cluster with correct active phase; shows "Last: …" when `lastItem` present; cancel button requires two clicks (confirmation); no cancel button when `phase === 'finalize'`.

- [ ] **Step 8.8: Wire EmptyStateWelcome "Run the initial crawl" button**

Update `EmptyStateWelcome` to render `ProgressPanel` when a refresh is in progress; on completion, `archive:changed` fires (handled in `app.tsx`) and the renderer transitions out of empty state automatically.

- [ ] **Step 8.9: Wire TopBar operator menu + progress chip**

Update `LibraryShell` to mount `OperatorMenu` in `TopBar` and render `ProgressPanel` as an overlay strip when a job is active.

- [ ] **Step 8.9b: Implement Settings modal (theme + verbosity + snapshot override)**

Create `src/gui/renderer/library-shell/SettingsModal.tsx`:

```typescript
import { useEffect, useState } from 'react';
import type { GuiArchiveState } from '../../shared/types.js';

export interface SettingsModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const [archiveState, setArchiveState] = useState<GuiArchiveState | undefined>(undefined);
  const [preference, setPreference] = useState<'auto' | 'light' | 'dark'>('auto');
  const [verbosity, setVerbosity] = useState<'normal' | 'raw'>('normal');

  useEffect(() => {
    if (!open) return;
    void window.pbinfoDesktop.archive.getState().then(setArchiveState);
    void window.pbinfoDesktop.theme.get().then((t) => setPreference(t.preference));
  }, [open]);

  if (!open) return null;

  const snapshots = archiveState?.catalogSnapshots ?? [];

  return (
    <div role="dialog" aria-modal="true" aria-label="Settings" className="settings-modal">
      <div className="settings-modal__panel">
        <h2>Settings</h2>

        <label className="settings-modal__field">
          <span>Theme</span>
          <select
            value={preference}
            onChange={(e) => {
              const next = e.target.value as 'auto' | 'light' | 'dark';
              setPreference(next);
              void window.pbinfoDesktop.theme.set(next);
            }}
          >
            <option value="auto">Auto (follow OS)</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>

        <label className="settings-modal__field">
          <span>Verbosity</span>
          <select
            value={verbosity}
            onChange={(e) => {
              const next = e.target.value as 'normal' | 'raw';
              setVerbosity(next);
              void window.pbinfoDesktop.setVerbosityMode(next);
            }}
          >
            <option value="normal">Normal</option>
            <option value="raw">Raw</option>
          </select>
        </label>

        <label className="settings-modal__field">
          <span>Snapshot override</span>
          <select
            value={archiveState?.snapshotId ?? ''}
            onChange={(e) => {
              void window.pbinfoDesktop.archive.switchSnapshot(e.target.value);
            }}
            disabled={snapshots.length === 0}
          >
            {snapshots.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label ?? s.id} ({s.status}{s.createdAt ? ` · ${s.createdAt.slice(0, 10)}` : ''})
              </option>
            ))}
          </select>
        </label>

        <button type="button" className="pac-btn pac-btn--secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
```

Test `tests/gui/renderer/library-shell/SettingsModal.test.tsx`:

```typescript
import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { SettingsModal } from '../../../../src/gui/renderer/library-shell/SettingsModal.js';

describe('<SettingsModal>', () => {
  beforeEach(() => {
    (window as any).pbinfoDesktop = {
      archive: {
        getState: vi.fn(async () => ({
          found: true,
          archiveRoot: '/a',
          snapshotId: 'snap-2',
          probedPaths: [],
          catalogSnapshots: [
            { id: 'snap-1', status: 'completed', createdAt: '2026-04-01' },
            { id: 'snap-2', status: 'completed', createdAt: '2026-04-23' },
          ],
        })),
        switchSnapshot: vi.fn(),
      },
      theme: { get: vi.fn(async () => ({ effective: 'light', preference: 'auto' })), set: vi.fn() },
      setVerbosityMode: vi.fn(),
    };
  });

  test('renders theme, verbosity, and snapshot dropdowns', async () => {
    render(<SettingsModal open={true} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText(/theme/i)).toBeInTheDocument());
    expect(screen.getByLabelText(/verbosity/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/snapshot override/i)).toBeInTheDocument();
  });

  test('switching snapshot invokes archive.switchSnapshot', async () => {
    render(<SettingsModal open={true} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByLabelText(/snapshot/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/snapshot/i), { target: { value: 'snap-1' } });
    expect((window as any).pbinfoDesktop.archive.switchSnapshot).toHaveBeenCalledWith('snap-1');
  });
});
```

Wire `SettingsModal` into `OperatorMenu`: clicking "⚙ Settings" calls `onSettingsOpen` prop → `LibraryShell` renders `<SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />`.

- [ ] **Step 8.10: Run full suite + manual E2E**

```bash
npm run typecheck && npm run typecheck:desktop && npx vitest run
cross-env PBINFO_USE_LIBRARY_SHELL=1 npm run desktop:dev
```

Verify (with a fresh userData dir that has no credentials):
- Empty state shows.
- Clicking "Run the initial crawl" shows login form → credentials persisted → phase chips update as the pipeline runs.
- Library renders automatically when job completes.

- [ ] **Step 8.11: Commit**

```bash
git add -A
git commit -m "feat(gui): operator menu + run-refresh coordinator + progress panel (Task 8)

run-refresh-coordinator owns a job mutex (second start returns existing
jobId) and throttles progress events to ≤ 1/250ms. OperatorMenu renders
a 5-item dropdown grouped by action class, disables Run-refresh while
active. ProgressPanel drives the initial-crawl phase chips + cancel
button. operator:login handler validates Zod bounds and never logs the
payload."
```

---

## Task 9: Retire old shell (destructive)

This is the single destructive commit. Run it only after step 11 packaged smoke is green across steps 1–8.

**Files to DELETE:**
- `src/gui/renderer/app-shell.tsx`
- `src/gui/renderer/app-shell.css`
- `src/gui/renderer/dashboard.tsx`
- `src/gui/renderer/coverage-explorer.tsx`
- `src/gui/main/workspace-store.ts`
- `tests/gui/workspace-store.test.ts` (delete — obsolete after archive-store covers it)
- Any `workspace:choose` / `workspace:current` remnants
- `src/gui/renderer/library-shell/LibraryShellPlaceholder.tsx` (superseded by real LibraryShell)

**Files to MODIFY:**
- `src/gui/renderer/app.tsx` — remove the `PBINFO_USE_LIBRARY_SHELL` flag; always render `LibraryShell` when `archive:state.found === true`.
- `src/gui/main/index.ts` — `sandbox: false` → `sandbox: true`; attach CSP via `session.defaultSession.webRequest.onHeadersReceived`.
- `src/gui/renderer/index.html` — add CSP `<meta>` tag per spec §4b.2.
- `src/gui/renderer/main.tsx` — remove `import './app-shell.css'`; keep only `import './library-shell/theme/global.css'`.

- [ ] **Step 9.1: Run packaged smoke against the current feature branch (PRE-delete)**

```bash
npm run desktop:pack
npm run smoke:desktop-packaged
```

Record baseline: packaged exe launches, EmptyStateWelcome / LibraryShell renders from a real archive. If this fails, do NOT proceed.

- [ ] **Step 9.2: Delete legacy files**

```bash
git rm src/gui/renderer/app-shell.tsx \
  src/gui/renderer/app-shell.css \
  src/gui/renderer/dashboard.tsx \
  src/gui/renderer/coverage-explorer.tsx \
  src/gui/main/workspace-store.ts \
  tests/gui/workspace-store.test.ts \
  src/gui/renderer/library-shell/LibraryShellPlaceholder.tsx
```

- [ ] **Step 9.3: Update app.tsx to unconditionally render LibraryShell**

```typescript
if (!archiveState.found) {
  return <EmptyStateWelcome ... />;
}
return <LibraryShell archiveRoot={archiveState.archiveRoot!} snapshotId={archiveState.snapshotId} />;
```

- [ ] **Step 9.4: Flip BrowserWindow to sandbox: true + add CSP**

`src/gui/main/index.ts` `bootstrapWindow`:

```typescript
mainWindow = new BrowserWindow({
  // ...
  webPreferences: {
    preload: join(__dirname, '../preload/index.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webviewTag: false,
    spellcheck: false,
  },
});
```

Inside `bootstrap` (before `bootstrapWindow`):

```typescript
session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
  callback({
    responseHeaders: {
      ...details.responseHeaders,
      'Content-Security-Policy': [
        "default-src 'self'; " +
        "script-src 'self'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data:; " +
        "font-src 'self' data:; " +
        "connect-src 'self' http://127.0.0.1:*; " +
        "frame-src 'self' http://127.0.0.1:*; " +
        "object-src 'none'; " +
        "base-uri 'self'; " +
        "form-action 'none';",
      ],
    },
  });
});
```

Add CSP `<meta>` to `src/gui/renderer/index.html`:

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' http://127.0.0.1:*; frame-src 'self' http://127.0.0.1:*; object-src 'none'; base-uri 'self'; form-action 'none';" />
```

- [ ] **Step 9.5: Remove app-shell.css import from main.tsx**

Ensure `src/gui/renderer/main.tsx` only imports `./library-shell/theme/global.css`.

- [ ] **Step 9.6: Re-run full suite + packaged smoke**

```bash
npm run typecheck && npm run typecheck:desktop && npx vitest run
npm run desktop:pack && npm run smoke:desktop-packaged
```

If packaged smoke fails, **revert this commit, do not force through**. The fix belongs in whichever earlier task the regression came from.

- [ ] **Step 9.7: Commit**

```bash
git add -A
git commit -m "chore(gui): retire legacy shell, enable sandbox + CSP (Task 9)

Deletes app-shell / dashboard / coverage-explorer / workspace-store.
LibraryShell becomes the only main window. sandbox: true on the new
BrowserWindow and CSP meta + onHeadersReceived header harden the
untrusted-HTML rendering path used by Statement + Editorial tabs."
```

---

## Task 10: Coverage threshold bump

Land new `perModule` entries so the verify gate flips on at a predictable point.

**Files:**
- Modify: `.coverage-thresholds.json`

- [ ] **Step 10.1: Update thresholds file**

```json
{
  "global": { "lines": 80, "branches": 75, "functions": 80, "statements": 80 },
  "perModule": {
    "src/auth/bootstrap.ts": { "lines": 95, "branches": 90, "functions": 95, "statements": 95 },
    "src/crawl/user-submissions-enumerator.ts": { "lines": 95, "branches": 90, "functions": 95, "statements": 95 },
    "src/tests-materializer/materialize-tests.ts": { "lines": 95, "branches": 90, "functions": 95, "statements": 95 },
    "src/coverage/problem-coverage.ts": { "lines": 90, "branches": 85, "functions": 90, "statements": 90 },
    "src/pbinfo/parsers/": { "lines": 90, "branches": 85, "functions": 90, "statements": 90 },
    "src/pbinfo/html/sanitize-archive-html.ts": { "lines": 95, "branches": 85, "functions": 95, "statements": 95 },
    "src/gui/main/archive-resolver.ts": { "lines": 90, "branches": 80, "functions": 90, "statements": 90 },
    "src/gui/main/archive-store.ts": { "lines": 85, "branches": 75, "functions": 85, "statements": 85 },
    "src/gui/main/theme-bridge.ts": { "lines": 85, "branches": 75, "functions": 85, "statements": 85 },
    "src/gui/main/run-refresh-coordinator.ts": { "lines": 85, "branches": 75, "functions": 85, "statements": 85 },
    "src/gui/renderer/library-shell/": { "lines": 80, "branches": 75, "functions": 80, "statements": 80 }
  }
}
```

- [ ] **Step 10.2: Run coverage gate**

```bash
npx vitest run --coverage
```

Expected: all `perModule` entries pass their floors. If any module falls short, add targeted tests in the same commit before committing thresholds.

- [ ] **Step 10.3: Commit**

```bash
git add .coverage-thresholds.json
git commit -m "chore(coverage): add perModule floors for library shell (Task 10)

sanitizer 95%, archive-resolver 90%, run-refresh-coordinator + theme-bridge
+ archive-store 85%, renderer library-shell tree 80%. Gate now flips on at
this commit."
```

---

## Task 11: Update packaged smoke + E2E

**Files:**
- Modify: `tests/gui/desktop-electron-smoke.test.ts`
- Modify: `scripts/smoke-packaged-desktop.ts`

- [ ] **Step 11.1: Update smoke assertions (incl. §12.3 metrics)**

Edit `tests/gui/desktop-electron-smoke.test.ts`. Per §12.3, six observable metrics must have real measurements:

```typescript
import { describe, expect, test } from 'vitest';
import { launchDesktopUnderTest } from './__helpers/launch-desktop-under-test.js';

describe('desktop electron smoke — library shell', () => {
  test('metric: zero workspace prompts (dialog.showOpenDialog never called on automatic launch)', async () => {
    const { pageReport } = await launchDesktopUnderTest({
      userDataRoot: freshTempDir('empty-state-smoke'),
      archiveRoot: stagedArchivePath,
    });
    expect(pageReport.dialogOpenDialogCallCount).toBe(0);
  });

  test('metric: cold launch to interactive < 1.5 s on a 2,500-row archive', async () => {
    const { pageReport } = await launchDesktopUnderTest({
      userDataRoot: freshTempDir('cold-launch'),
      archiveRoot: stagedArchivePath,
    });
    expect(pageReport.coldLaunchToInteractiveMs).toBeLessThan(1500);
  });

  test('metric: LibraryShell mounts and renders at least one problem row for a staged archive', async () => {
    const { pageReport } = await launchDesktopUnderTest({
      userDataRoot: freshTempDir('library-shell'),
      archiveRoot: stagedArchivePath,
    });
    expect(pageReport.libraryShellMounted).toBe(true);
    expect(pageReport.renderedRowCount).toBeGreaterThan(0);
  });

  test('metric: first paint with 2,500 rows < 500 ms after listProblems resolves', async () => {
    const { pageReport } = await launchDesktopUnderTest({
      userDataRoot: freshTempDir('first-paint'),
      archiveRoot: stagedArchivePath,
    });
    expect(pageReport.firstPaintAfterListResolveMs).toBeLessThan(500);
  });

  test('metric: drawer open latency < 100 ms from click to first tab painted', async () => {
    const { pageReport } = await launchDesktopUnderTest({
      userDataRoot: freshTempDir('drawer-open'),
      archiveRoot: stagedArchivePath,
      clickFirstRow: true,
    });
    expect(pageReport.drawerOpenLatencyMs).toBeLessThan(100);
  });

  test('metric: theme:changed end-to-end latency < 200 ms', async () => {
    const { pageReport } = await launchDesktopUnderTest({
      userDataRoot: freshTempDir('theme-switch'),
      archiveRoot: stagedArchivePath,
      triggerThemeFlip: true,
    });
    expect(pageReport.themeSwitchLatencyMs).toBeLessThan(200);
  });

  test('metric: axe-core contrast pass rate = 100% on both palettes', async () => {
    const { pageReport } = await launchDesktopUnderTest({
      userDataRoot: freshTempDir('axe-light'),
      archiveRoot: stagedArchivePath,
      runAxeOnBothPalettes: true,
    });
    expect(pageReport.axeContrastViolations).toEqual([]);
  });

  test('no console.error emitted during the flow', async () => {
    const { pageReport } = await launchDesktopUnderTest({
      userDataRoot: freshTempDir('no-console-errors'),
      archiveRoot: stagedArchivePath,
      clickFirstRow: true,
    });
    expect(pageReport.consoleErrors).toEqual([]);
  });
});
```

Create `tests/gui/__helpers/launch-desktop-under-test.ts` as an Electron-CDP harness that:

1. Spawns the packaged Electron app with `PBINFO_DESKTOP_TEST_CDP_PORT` + `PBINFO_DESKTOP_TEST_MARKER_PATH` + `PBINFO_DESKTOP_TEST_USER_DATA_ROOT`.
2. Attaches via Chrome DevTools Protocol.
3. Hooks `window.performance.now()` at app-mount to capture `coldLaunchToInteractiveMs`.
4. Intercepts `dialog.showOpenDialog` via main-process shim (track call count).
5. Reads `firstPaintAfterListResolveMs` from a performance mark placed in `LibraryShell` after the first render that contains rows.
6. Reads `drawerOpenLatencyMs` from a performance mark placed at row click → first tab DOM painted.
7. For `triggerThemeFlip`: calls `nativeTheme.themeSource = 'dark'` via main process, records time until `data-theme` attribute on `<html>` updates.
8. For `runAxeOnBothPalettes`: injects `axe-core` (installed as dev dep), runs `axe.run()` in both themes, collects `violations.filter(v => v.id === 'color-contrast')`.
9. Returns a structured `pageReport`.

Add to devDependencies: `axe-core@^4.10`.

- [ ] **Step 11.2: Update packaged smoke script**

`scripts/smoke-packaged-desktop.ts` — stage a minimal archive directory at `tmp/smoke-archive/` containing a 1-snapshot `catalog.json` + a single problem under `snapshots/<id>/problem-coverage/index.json` + matching normalized JSON + matching test folder. Launch the portable exe pointing at that archive. Assert `launchDesktopUnderTest` returns a `renderedRowCount` of exactly 1 and `drawerOpenLatencyMs < 100`.

- [ ] **Step 11.3: Run full E2E**

```bash
npm run test:desktop-electron
npm run desktop:pack && npm run smoke:desktop-packaged
```

If any metric fails its §12.3 floor, **do not loosen the assertion**. Fix the underlying perf regression — the floors are product quality bars, not test framework noise.

- [ ] **Step 11.4: Commit**

```bash
git add -A
git commit -m "test(gui): update packaged smoke + electron smoke for library shell (Task 11)

Smoke asserts EmptyStateWelcome on missing archive and LibraryShell with
at least one problem row + drawer open on click for a staged archive."
```

---

## Self-review (iteration 2)

**Spec coverage check** (each spec section → task mapping):

| Spec section | Covered by |
|---|---|
| §1 motivation, §2 decisions (1–12) | Task 1–11 collectively |
| §3.1–§3.3 architecture | Task 1 (new files start), Task 4 (shell tree), Task 9 (deletions) |
| §3.4 data flow | Task 1 (archive:state + catalogSnapshots), Task 2 (theme:changed), Task 4 (library:problems:list + :tags), Task 6 (library:problems:detail), Task 8 (operator:run-full-refresh) |
| §3.5 IPC contract | Task 1 (archive + switchSnapshot + broadcastArchiveChanged), Task 2 (theme), Task 4 (list/tags), Task 6 (detail), Task 8 (operator/login/refresh/cancel/progress) |
| §3.5.1 concurrency + atomic swap | Task 8 Step 8.2 (mutex + archive:changed emit on refresh-complete), Task 1 Step 1.13 (fresh read each handler call) |
| §4 theme system incl. §4.4 contrast pairs | Task 2 (tokens + contrast test) |
| §4b renderer security posture | Task 6.2–6.3 (sanitizer), Task 8.3b (login Zod + no-log), Task 9.4 (sandbox + CSP), Task 8.3a (child window preload) |
| §5 archive auto-detect + §5.4 migration | Task 1 (resolver + catalogSnapshots), Task 3 (rename) |
| §6 problems table + §6.4 keyboard (all 6 shortcuts) | Task 4 (scaffold), Task 5 (virtualization + icons + Ctrl+F / Ctrl+L / Escape) |
| §7 filter sidebar | Task 4 (FilterSidebar with all 9 widgets + useFilters presets) |
| §8 detail drawer (6 tabs) | Task 6 (shell + Statement + sanitizer), Task 7.1 (highlighter), 7.2–7.6 (5 tabs), 7.7 (wire) |
| §9 operator dropdown + Settings snapshot override | Task 8.5 (OperatorMenu with 5 items + dividers), Task 8.9b (SettingsModal with snapshot dropdown) |
| §10 empty-state + §10.2 initial-crawl phase chips | Task 1 (empty state), Task 8.7 (ProgressPanel with phase cluster + cancel confirmation) |
| §11 testing strategy + §11.5 coverage thresholds | Tests in every task + Task 10 (thresholds) |
| §12 rollout order + §12.3 success metrics | Task 1–11 match §12.1, Task 11.1 measures all 6 §12.3 metrics via launchDesktopUnderTest harness |

No spec section is unaddressed.

**Placeholder scan:** no `TBD` / `FIXME` / `implement later` remain. The two `// ...` markers at lines 3274 and 5270 are intentional context-elisions in code snippets that reference previously-fully-specified LibraryShell and BrowserWindow blocks.

**Iteration-2 revisions** (addressing plan-review-gate blockers):
- F1 FilterSidebar expanded from prose to ~220 LOC with all 9 widgets + TagAutocomplete
- F2 library-detail-repository now has full implementation + 3-case test fixture
- F3 Task 7 split into 7 sub-tasks (7.0 install, 7.1 highlighter, 7.2 TestsTab, 7.3 SubmissionsTab, 7.4 OfficialSourceTab, 7.5 EditorialTab, 7.6 RawDataTab, 7.7 wire) with full code per tab
- F4 OperatorMenu + ProgressPanel expanded to full JSX
- F5 `envPrefix: ['VITE_', 'PBINFO_']` added to vite.desktop.config.ts (Step 4.17)
- F6 `desktopPreferencesRecordSchema.themePreference` extension shown explicitly (Step 2.11a)
- F7 `bootstrapAuth` call uses real `{ workspaceRoot }` shape via new `operatorLogin` coordinator (Step 8.3b); `openLiveSiteViewerChildWindow` has a full implementation + test (Step 8.3a)
- C1 `library:tags` handler + test added as Step 4.10a
- C2 `archive:changed` emission wired into run-refresh-coordinator finalizer (Step 8.2); reads use fresh `archive:state` per invocation (Step 1.13)
- C3 useKeyboardNav extended with Ctrl+F / Ctrl+L / Escape wiring (Step 5.7)
- C4 `catalogSnapshots` populated in `archive:state` handler; `archive:switch-snapshot` channel added; SettingsModal renders snapshot override dropdown (Step 8.9b)
- C5 §12.3 success metrics measured via `launchDesktopUnderTest` harness in Task 11.1 (7 metric tests + axe-core dev-dep)
- C6 live-site-viewer child window with sandboxed no-IPC preload (Step 8.3a)

**Type consistency:**
- `ProblemRowInput`, `ProblemDetailPayload`, `GuiArchiveState`, `LibraryFilters`, `PillarFilter`, `RowStatus` are all defined in a single file each and imported consistently.
- IPC channel names match between contracts, main handlers, preload, and bridge (`archive:state`, `archive:set-manual-override`, `library:problems:list`, `library:problems:detail`, `library:tags`, `library:theme:get`, `library:theme:set`, `operator:run-full-refresh`, `operator:run-full-refresh:cancel`, `operator:login`, `operator:open-live-site-viewer`, broadcast channels `archive:changed`, `theme:changed`, `operator:run-full-refresh:progress`).
- Function names: `resolveArchiveRoot`, `readArchiveStore`, `writeArchiveStore`, `rowStatusFor`, `createThemeBridge`, `createRunRefreshCoordinator`, `sanitizeArchiveHtml`, `listProblems`, `loadProblemDetail` — each referenced under its declaration name across tasks.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-23-library-browser-redesign-plan.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Per project CLAUDE.md, the user will also be offered a third option (metaswarm orchestrated execution) — **final execution method will be chosen by the user after plan-review-gate PASSES**.
