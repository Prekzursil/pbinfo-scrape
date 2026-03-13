import { join } from 'node:path';

import { loadLocalConfig } from '../config/local-config.js';
import {
  exportRawArtifacts,
  importRawArtifacts,
  resolveReadableSnapshotLayout,
} from '../archive/storage.js';

export async function exportRawSnapshotArtifacts(options: {
  workspaceRoot: string;
  snapshotId: string;
  targetPath?: string;
}) {
  const config = loadLocalConfig(options.workspaceRoot);
  const snapshot =
    options.snapshotId === 'latest'
      ? resolveReadableSnapshotLayout(config)
      : resolveReadableSnapshotLayout(config, options.snapshotId);
  const manifest = exportRawArtifacts(config, snapshot, options.targetPath);
  return {
    ...manifest,
    manifestPath: snapshot.artifactManifestPath,
    targetRoot: join(config.artifacts.exportRoot, manifest.snapshotId),
  };
}

export async function importRawSnapshotArtifacts(options: {
  workspaceRoot: string;
  snapshotId: string;
  sourcePath?: string;
}) {
  if (!options.sourcePath) {
    throw new Error('Artifact import requires a manifest path.');
  }

  const config = loadLocalConfig(options.workspaceRoot);
  const manifestPath = options.sourcePath.endsWith('.json')
    ? options.sourcePath
    : join(options.sourcePath, 'manifest.json');
  const manifest = importRawArtifacts(config, manifestPath);
  return {
    ...manifest,
    snapshotRoot: join(config.paths.artifactsRoot, manifest.snapshotId),
  };
}
