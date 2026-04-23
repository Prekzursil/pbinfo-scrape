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
  if (
    explicit &&
    explicit.status === 'completed' &&
    snapshotDirExists(archiveRoot, explicit.id)
  ) {
    return explicit.id;
  }
  const completed = snapshots
    .filter(
      (snap) =>
        snap.status === 'completed' && snapshotDirExists(archiveRoot, snap.id),
    )
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  return completed[0]?.id;
}

function snapshotDirExists(archiveRoot: string, snapshotId: string): boolean {
  return existsSync(join(archiveRoot, 'snapshots', snapshotId));
}
