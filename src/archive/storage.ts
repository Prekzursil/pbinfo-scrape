import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type { LoadedLocalConfig } from '../config/local-config.js';

export interface SnapshotRecord {
  snapshotId: string;
  createdAt: string;
  scope: 'public' | 'user' | 'all';
  status: 'in_progress' | 'completed';
  checkpoint: 'canonical' | 'checkpoint';
}

export interface ArtifactExportRecord {
  snapshotId: string;
  exportedAt: string;
  manifestPath: string;
  exportRoot: string;
}

export interface ArchiveCatalog {
  currentSnapshotId?: string;
  canonicalSnapshotId?: string;
  snapshots: SnapshotRecord[];
  artifactExports: ArtifactExportRecord[];
}

export interface SnapshotLayout {
  snapshotId: string;
  archiveRoot: string;
  snapshotRoot: string;
  normalizedRoot: string;
  mirrorRoot: string;
  mirrorPagesRoot: string;
  rawPagesRoot: string;
  rawAssetsRoot: string;
  rawPagesManifestPath: string;
  rawAssetsManifestPath: string;
  routesManifestPath: string;
  artifactManifestPath: string;
  metadataPath: string;
}

export interface PrepareSnapshotOptions {
  snapshotId?: string;
  now?: Date;
  scope: 'public' | 'user' | 'all';
  checkpoint?: 'canonical' | 'checkpoint';
}

export interface ArtifactManifest {
  snapshotId: string;
  exportedAt: string;
  rawPagesPath: string;
  rawAssetsPath: string;
  rawPagesManifestPath: string;
  rawAssetsManifestPath: string;
}

export interface ArtifactRelinkEntry {
  snapshotId: string;
  linkedAt: string;
  manifestPath: string;
  rawPagesPath: string;
  rawAssetsPath: string;
  rawPagesManifestPath: string;
  rawAssetsManifestPath: string;
}

interface ArtifactRelinkRegistry {
  entries: ArtifactRelinkEntry[];
}

export function buildSnapshotId(now = new Date()): string {
  return now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Builds the human-readable fresh-archive-fix snapshot id used by the
 * `--fresh-snapshot` CLI flag. Format: `fresh-YYYYMMDD-full`.
 */
export function buildFreshSnapshotId(now = new Date()): string {
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  return `fresh-${yyyy}${mm}${dd}-full`;
}

export function resolveSnapshotLayout(
  config: LoadedLocalConfig,
  snapshotId: string,
): SnapshotLayout {
  const relinked = resolveRelinkedArtifactManifest(config, snapshotId);
  const snapshotRoot = join(config.paths.snapshotsRoot, snapshotId);
  return {
    snapshotId,
    archiveRoot: config.paths.archiveRoot,
    snapshotRoot,
    normalizedRoot: join(snapshotRoot, 'normalized'),
    mirrorRoot: join(snapshotRoot, 'mirror'),
    mirrorPagesRoot: join(snapshotRoot, 'mirror', 'pages'),
    rawPagesRoot: relinked?.rawPagesPath ?? join(config.paths.artifactsRoot, snapshotId, 'raw-pages'),
    rawAssetsRoot: relinked?.rawAssetsPath ?? join(config.paths.artifactsRoot, snapshotId, 'raw-assets'),
    rawPagesManifestPath:
      relinked?.rawPagesManifestPath
      ?? join(config.paths.artifactsRoot, snapshotId, 'raw-pages', 'manifest.json'),
    rawAssetsManifestPath:
      relinked?.rawAssetsManifestPath
      ?? join(config.paths.artifactsRoot, snapshotId, 'raw-assets', 'manifest.json'),
    routesManifestPath: join(snapshotRoot, 'mirror', 'routes.json'),
    artifactManifestPath: join(config.paths.archiveRoot, 'artifacts', `${snapshotId}.json`),
    metadataPath: join(snapshotRoot, 'metadata.json'),
  };
}

export function buildQueuePath(localRoot: string, snapshotId: string): string {
  return join(localRoot, 'crawl-queues', `${snapshotId}.sqlite`);
}

export function prepareSnapshot(
  config: LoadedLocalConfig,
  options: PrepareSnapshotOptions,
): SnapshotLayout {
  const now = options.now ?? new Date();
  const snapshotId = options.snapshotId ?? buildSnapshotId(now);
  const layout = resolveSnapshotLayout(config, snapshotId);
  mkdirSync(layout.normalizedRoot, { recursive: true });
  mkdirSync(layout.mirrorPagesRoot, { recursive: true });
  mkdirSync(layout.rawPagesRoot, { recursive: true });
  mkdirSync(layout.rawAssetsRoot, { recursive: true });
  mkdirSync(join(config.paths.archiveRoot, 'artifacts'), { recursive: true });

  const catalog = readArchiveCatalog(config.paths.archiveRoot);
  const existing = catalog.snapshots.find((record) => record.snapshotId === snapshotId);
  const snapshot: SnapshotRecord = {
    snapshotId,
    createdAt: existing?.createdAt ?? now.toISOString(),
    scope: existing?.scope ?? options.scope,
    status: 'in_progress',
    checkpoint: existing?.checkpoint ?? options.checkpoint ?? 'canonical',
  };
  upsertSnapshotRecord(catalog, snapshot);
  catalog.currentSnapshotId = snapshotId;
  if (snapshot.checkpoint === 'canonical' && !catalog.canonicalSnapshotId) {
    catalog.canonicalSnapshotId = snapshotId;
  }
  writeArchiveCatalog(config.paths.archiveRoot, catalog);
  writeFileSync(layout.metadataPath, JSON.stringify(snapshot, null, 2), 'utf8');
  return layout;
}

export function markSnapshotCompleted(
  config: LoadedLocalConfig,
  snapshotId: string,
): void {
  const catalog = readArchiveCatalog(config.paths.archiveRoot);
  const existing = catalog.snapshots.find((record) => record.snapshotId === snapshotId);
  if (existing) {
    existing.status = 'completed';
  }
  writeArchiveCatalog(config.paths.archiveRoot, catalog);
  const layout = resolveSnapshotLayout(config, snapshotId);
  if (existsSync(layout.metadataPath)) {
    const metadata = JSON.parse(readFileSync(layout.metadataPath, 'utf8')) as SnapshotRecord;
    metadata.status = 'completed';
    writeFileSync(layout.metadataPath, JSON.stringify(metadata, null, 2), 'utf8');
  }
}

export function resolveReadableSnapshotLayout(
  config: LoadedLocalConfig,
  snapshotId?: string,
): SnapshotLayout {
  const catalog = readArchiveCatalog(config.paths.archiveRoot);
  const resolvedSnapshotId = snapshotId ?? catalog.currentSnapshotId;
  if (!resolvedSnapshotId) {
    throw new Error('No archived snapshot is available.');
  }

  return resolveSnapshotLayout(config, resolvedSnapshotId);
}

export function findSnapshotRecord(
  catalog: ArchiveCatalog,
  snapshotId: string,
): SnapshotRecord | undefined {
  return catalog.snapshots.find((record) => record.snapshotId === snapshotId);
}

export function assertSnapshotRecord(
  catalog: ArchiveCatalog,
  snapshotId: string,
): SnapshotRecord {
  const snapshot = findSnapshotRecord(catalog, snapshotId);
  if (!snapshot) {
    throw new Error(`Snapshot ${snapshotId} was not found in archive/catalog.json`);
  }

  return snapshot;
}

export function markSnapshotCanonical(
  config: LoadedLocalConfig,
  snapshotId: string,
): SnapshotRecord {
  const catalog = readArchiveCatalog(config.paths.archiveRoot);
  const snapshot = assertSnapshotRecord(catalog, snapshotId);
  catalog.currentSnapshotId = snapshotId;
  catalog.canonicalSnapshotId = snapshotId;
  writeArchiveCatalog(config.paths.archiveRoot, catalog);
  return snapshot;
}

export function findArtifactExportRecord(
  catalog: ArchiveCatalog,
  snapshotId: string,
): ArtifactExportRecord | undefined {
  return catalog.artifactExports.find((record) => record.snapshotId === snapshotId);
}

export function assertArtifactExportRecord(
  config: LoadedLocalConfig,
  snapshotId: string,
): ArtifactExportRecord {
  const relinked = resolveRelinkedArtifactManifest(config, snapshotId);
  if (relinked) {
    return {
      snapshotId,
      exportedAt: relinked.exportedAt,
      manifestPath: relinked.manifestPath,
      exportRoot: dirname(relinked.rawPagesPath),
    };
  }

  const catalog = readArchiveCatalog(config.paths.archiveRoot);
  const record = findArtifactExportRecord(catalog, snapshotId);
  if (!record || !existsSync(record.manifestPath)) {
    throw new Error(`Raw artifact export for snapshot ${snapshotId} is missing or unreadable`);
  }

  return record;
}

export function pruneToCanonicalSnapshot(
  config: LoadedLocalConfig,
  canonicalSnapshotId: string,
): {
  removedSnapshots: string[];
  removedQueuePaths: string[];
  removedArtifactPaths: string[];
} {
  const catalog = readArchiveCatalog(config.paths.archiveRoot);
  assertSnapshotRecord(catalog, canonicalSnapshotId);

  const removedSnapshots: string[] = [];
  const removedArtifactPaths: string[] = [];
  for (const snapshot of catalog.snapshots) {
    if (snapshot.snapshotId === canonicalSnapshotId) {
      continue;
    }

    const layout = resolveSnapshotLayout(config, snapshot.snapshotId);
    rmSync(layout.snapshotRoot, {
      recursive: true,
      force: true,
    });
    if (existsSync(join(config.paths.artifactsRoot, snapshot.snapshotId))) {
      rmSync(join(config.paths.artifactsRoot, snapshot.snapshotId), {
        recursive: true,
        force: true,
      });
      removedArtifactPaths.push(join(config.paths.artifactsRoot, snapshot.snapshotId));
    }
    if (existsSync(layout.artifactManifestPath)) {
      rmSync(layout.artifactManifestPath, { force: true });
      removedArtifactPaths.push(layout.artifactManifestPath);
    }
    const exportRecord = catalog.artifactExports.find(
      (record) => record.snapshotId === snapshot.snapshotId,
    );
    if (exportRecord?.exportRoot && existsSync(exportRecord.exportRoot)) {
      rmSync(exportRecord.exportRoot, { recursive: true, force: true });
      removedArtifactPaths.push(exportRecord.exportRoot);
    }
    removedSnapshots.push(snapshot.snapshotId);
  }

  const queueRoot = join(config.paths.localRoot, 'crawl-queues');
  const removedQueuePaths: string[] = [];
  if (existsSync(queueRoot)) {
    for (const entry of readdirSync(queueRoot)) {
      const queuePath = join(queueRoot, entry);
      if (entry === `${canonicalSnapshotId}.sqlite`) {
        continue;
      }

      rmSync(queuePath, { force: true });
      removedQueuePaths.push(queuePath);
    }
  }

  catalog.snapshots = catalog.snapshots.filter(
    (snapshot) => snapshot.snapshotId === canonicalSnapshotId,
  );
  catalog.currentSnapshotId = canonicalSnapshotId;
  catalog.canonicalSnapshotId = canonicalSnapshotId;
  catalog.artifactExports = catalog.artifactExports.filter(
    (record) => record.snapshotId === canonicalSnapshotId,
  );
  writeArchiveCatalog(config.paths.archiveRoot, catalog);

  return {
    removedSnapshots,
    removedQueuePaths,
    removedArtifactPaths,
  };
}

export function readArchiveCatalog(archiveRoot: string): ArchiveCatalog {
  const catalogPath = join(archiveRoot, 'catalog.json');
  if (!existsSync(catalogPath)) {
    return {
      snapshots: [],
      artifactExports: [],
    };
  }

  return JSON.parse(readFileSync(catalogPath, 'utf8')) as ArchiveCatalog;
}

export function writeArchiveCatalog(
  archiveRoot: string,
  catalog: ArchiveCatalog,
): void {
  mkdirSync(archiveRoot, { recursive: true });
  writeFileSync(join(archiveRoot, 'catalog.json'), JSON.stringify(catalog, null, 2), 'utf8');
}

export function exportRawArtifacts(
  config: LoadedLocalConfig,
  layout: SnapshotLayout,
  targetRoot = config.artifacts.exportRoot,
  now = new Date(),
): ArtifactManifest {
  const exportRoot = join(targetRoot, layout.snapshotId);
  mkdirSync(exportRoot, { recursive: true });
  cpSync(layout.rawPagesRoot, join(exportRoot, 'raw-pages'), { recursive: true, force: true });
  cpSync(layout.rawAssetsRoot, join(exportRoot, 'raw-assets'), { recursive: true, force: true });

  const manifest: ArtifactManifest = {
    snapshotId: layout.snapshotId,
    exportedAt: now.toISOString(),
    rawPagesPath: join(exportRoot, 'raw-pages'),
    rawAssetsPath: join(exportRoot, 'raw-assets'),
    rawPagesManifestPath: join(exportRoot, 'raw-pages', 'manifest.json'),
    rawAssetsManifestPath: join(exportRoot, 'raw-assets', 'manifest.json'),
  };

  writeFileSync(layout.artifactManifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  writeFileSync(join(exportRoot, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  const catalog = readArchiveCatalog(config.paths.archiveRoot);
  catalog.artifactExports = catalog.artifactExports.filter(
    (record) => record.snapshotId !== layout.snapshotId,
  );
  catalog.artifactExports.push({
    snapshotId: layout.snapshotId,
    exportedAt: manifest.exportedAt,
    manifestPath: layout.artifactManifestPath,
    exportRoot,
  });
  catalog.currentSnapshotId = layout.snapshotId;
  writeArchiveCatalog(config.paths.archiveRoot, catalog);
  upsertArtifactRelinkEntry(config, {
    snapshotId: layout.snapshotId,
    linkedAt: manifest.exportedAt,
    manifestPath: layout.artifactManifestPath,
    rawPagesPath: manifest.rawPagesPath,
    rawAssetsPath: manifest.rawAssetsPath,
    rawPagesManifestPath: manifest.rawPagesManifestPath,
    rawAssetsManifestPath: manifest.rawAssetsManifestPath,
  });
  return manifest;
}

export function importRawArtifacts(
  config: LoadedLocalConfig,
  manifestPath: string,
): ArtifactManifest {
  const resolvedManifestPath = resolveArtifactManifestPath(manifestPath);
  const manifest = JSON.parse(readFileSync(resolvedManifestPath, 'utf8')) as ArtifactManifest;
  const localRawPagesRoot = join(config.paths.artifactsRoot, manifest.snapshotId, 'raw-pages');
  const localRawAssetsRoot = join(config.paths.artifactsRoot, manifest.snapshotId, 'raw-assets');
  const localRawPagesManifestPath = join(localRawPagesRoot, 'manifest.json');
  const localRawAssetsManifestPath = join(localRawAssetsRoot, 'manifest.json');
  const localArtifactManifestPath = join(
    config.paths.archiveRoot,
    'artifacts',
    `${manifest.snapshotId}.json`,
  );
  mkdirSync(localRawPagesRoot, { recursive: true });
  mkdirSync(localRawAssetsRoot, { recursive: true });
  if (resolve(manifest.rawPagesPath) !== resolve(localRawPagesRoot)) {
    cpSync(manifest.rawPagesPath, localRawPagesRoot, { recursive: true, force: true });
  }
  if (resolve(manifest.rawAssetsPath) !== resolve(localRawAssetsRoot)) {
    cpSync(manifest.rawAssetsPath, localRawAssetsRoot, { recursive: true, force: true });
  }
  const localManifest: ArtifactManifest = {
    ...manifest,
    rawPagesPath: localRawPagesRoot,
    rawAssetsPath: localRawAssetsRoot,
    rawPagesManifestPath: localRawPagesManifestPath,
    rawAssetsManifestPath: localRawAssetsManifestPath,
  };
  writeFileSync(localArtifactManifestPath, JSON.stringify(localManifest, null, 2), 'utf8');
  const catalog = readArchiveCatalog(config.paths.archiveRoot);
  catalog.artifactExports = catalog.artifactExports.filter(
    (record) => record.snapshotId !== manifest.snapshotId,
  );
  catalog.artifactExports.push({
    snapshotId: manifest.snapshotId,
    exportedAt: manifest.exportedAt,
    manifestPath: localArtifactManifestPath,
    exportRoot: join(config.artifacts.exportRoot, manifest.snapshotId),
  });
  writeArchiveCatalog(config.paths.archiveRoot, catalog);
  upsertArtifactRelinkEntry(config, {
    snapshotId: manifest.snapshotId,
    linkedAt: new Date().toISOString(),
    manifestPath: localArtifactManifestPath,
    rawPagesPath: localRawPagesRoot,
    rawAssetsPath: localRawAssetsRoot,
    rawPagesManifestPath: localRawPagesManifestPath,
    rawAssetsManifestPath: localRawAssetsManifestPath,
  });
  return localManifest;
}

export function relinkRawArtifacts(
  config: LoadedLocalConfig,
  snapshotId: string,
  manifestPath: string,
): ArtifactManifest {
  const resolvedManifestPath = resolveArtifactManifestPath(manifestPath);
  const manifest = JSON.parse(readFileSync(resolvedManifestPath, 'utf8')) as ArtifactManifest;
  if (manifest.snapshotId !== snapshotId) {
    throw new Error(
      `Artifact manifest snapshot mismatch (expected ${snapshotId}, found ${manifest.snapshotId}).`,
    );
  }
  ensureArtifactManifestPaths(manifest, snapshotId);
  upsertArtifactRelinkEntry(config, {
    snapshotId,
    linkedAt: new Date().toISOString(),
    manifestPath: resolvedManifestPath,
    rawPagesPath: manifest.rawPagesPath,
    rawAssetsPath: manifest.rawAssetsPath,
    rawPagesManifestPath: manifest.rawPagesManifestPath,
    rawAssetsManifestPath: manifest.rawAssetsManifestPath,
  });
  return manifest;
}

function upsertSnapshotRecord(
  catalog: ArchiveCatalog,
  snapshot: SnapshotRecord,
): void {
  const index = catalog.snapshots.findIndex(
    (record) => record.snapshotId === snapshot.snapshotId,
  );
  if (index >= 0) {
    catalog.snapshots[index] = snapshot;
    return;
  }

  catalog.snapshots.push(snapshot);
  catalog.snapshots.sort((left, right) => left.snapshotId.localeCompare(right.snapshotId));
}

function artifactRelinkRegistryPath(config: LoadedLocalConfig): string {
  return join(config.paths.localRoot, 'artifact-relinks.json');
}

function readArtifactRelinkRegistry(
  config: LoadedLocalConfig,
): ArtifactRelinkRegistry {
  const registryPath = artifactRelinkRegistryPath(config);
  if (!existsSync(registryPath)) {
    return { entries: [] };
  }

  try {
    const parsed = JSON.parse(readFileSync(registryPath, 'utf8')) as ArtifactRelinkRegistry;
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch {
    return { entries: [] };
  }
}

function writeArtifactRelinkRegistry(
  config: LoadedLocalConfig,
  registry: ArtifactRelinkRegistry,
): void {
  const registryPath = artifactRelinkRegistryPath(config);
  mkdirSync(dirname(registryPath), { recursive: true });
  writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf8');
}

function upsertArtifactRelinkEntry(
  config: LoadedLocalConfig,
  entry: ArtifactRelinkEntry,
): void {
  const registry = readArtifactRelinkRegistry(config);
  registry.entries = registry.entries.filter((candidate) => candidate.snapshotId !== entry.snapshotId);
  registry.entries.push(entry);
  registry.entries.sort((left, right) => left.snapshotId.localeCompare(right.snapshotId));
  writeArtifactRelinkRegistry(config, registry);
}

function resolveRelinkedArtifactManifest(
  config: LoadedLocalConfig,
  snapshotId: string,
): (ArtifactManifest & { manifestPath: string }) | undefined {
  const registry = readArtifactRelinkRegistry(config);
  const entry = registry.entries.find((candidate) => candidate.snapshotId === snapshotId);
  if (!entry) {
    return undefined;
  }

  const manifest: ArtifactManifest = {
    snapshotId: entry.snapshotId,
    exportedAt: entry.linkedAt,
    rawPagesPath: entry.rawPagesPath,
    rawAssetsPath: entry.rawAssetsPath,
    rawPagesManifestPath: entry.rawPagesManifestPath,
    rawAssetsManifestPath: entry.rawAssetsManifestPath,
  };

  try {
    ensureArtifactManifestPaths(manifest, snapshotId);
    return {
      ...manifest,
      manifestPath: entry.manifestPath,
    };
  } catch {
    return undefined;
  }
}

function resolveArtifactManifestPath(manifestPath: string): string {
  return manifestPath.endsWith('.json')
    ? manifestPath
    : join(manifestPath, 'manifest.json');
}

function ensureArtifactManifestPaths(
  manifest: ArtifactManifest,
  snapshotId: string,
): void {
  const requiredPaths = [
    manifest.rawPagesPath,
    manifest.rawAssetsPath,
  ];
  for (const path of requiredPaths) {
    if (!existsSync(path)) {
      throw new Error(`Raw artifact path is missing for snapshot ${snapshotId}: ${path}`);
    }
  }
}
