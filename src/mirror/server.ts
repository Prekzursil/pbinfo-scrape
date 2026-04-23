import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { type Server } from 'node:http';

import express from 'express';

import { resolveReadableSnapshotLayout } from '../archive/storage.js';
import { loadLocalConfig } from '../config/local-config.js';
import { registerOverlayServerRoute } from './overlay-server.js';

/**
 * Returns true when `candidate`, resolved relative to `root`, stays inside
 * `root`. Used only as a pre-flight existence check; express's `sendFile`
 * receives the relative path + `{ root }` option which already prevents
 * path traversal at the framework level.
 */
function isWithin(root: string, candidate: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(resolvedRoot, candidate);
  return (
    resolvedCandidate === resolvedRoot
    || resolvedCandidate.startsWith(resolvedRoot + sep)
  );
}

export interface StartMirrorServerOptions {
  workspaceRoot: string;
  port: number;
  snapshotId?: string;
}

export interface RunningMirrorServer {
  baseUrl: string;
  close: () => Promise<void>;
}

export async function startMirrorServer(
  options: StartMirrorServerOptions,
): Promise<RunningMirrorServer> {
  const config = loadLocalConfig(options.workspaceRoot);
  const snapshot = resolveReadableSnapshotLayout(config, options.snapshotId);
  const app = express();
  const routes = readRoutes(snapshot.routesManifestPath);
  if (routes.length === 0) {
    throw new Error(
      `Mirror preview requires a built mirror for snapshot ${snapshot.snapshotId}. Run the mirror build workflow first.`,
    );
  }

  registerOverlayServerRoute(app, snapshot);

  app.get('/_assets/:fileName', (request, response) => {
    // Strip any directory components from the user-supplied name before
    // handing to express; basename cannot contain a separator.
    const requestedName = basename(request.params.fileName);
    if (!requestedName || requestedName === '.' || requestedName === '..') {
      response.status(400).send('invalid asset name');
      return;
    }
    if (!isWithin(snapshot.rawAssetsRoot, requestedName)) {
      response.status(400).send('invalid asset path');
      return;
    }
    if (!existsSync(join(snapshot.rawAssetsRoot, requestedName))) {
      response.status(404).send('asset not found');
      return;
    }
    // Express's sendFile with { root } rejects any relative path that would
    // escape the configured root, independently of whatever value reached
    // the handler.
    response.sendFile(requestedName, { root: snapshot.rawAssetsRoot });
  });

  app.get('*route', (request, response) => {
    const routeKey = request.originalUrl === '' ? '/' : request.originalUrl;
    const match = routes.find((entry) => entry.route === routeKey || entry.route === request.path);
    if (!match) {
      response.status(404).send('route not found');
      return;
    }

    const mirrorBody = loadValidatedBody(snapshot.mirrorRoot, match.mirrorFile);
    if (mirrorBody !== null) {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.send(mirrorBody);
      return;
    }

    const rawBody = loadValidatedBody(snapshot.rawPagesRoot, match.sourceFile);
    if (rawBody === null) {
      response.status(500).send(
        `Archived source page is missing for route ${routeKey}. Rebuild the mirror after relinking raw artifacts.`,
      );
      return;
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.send(rawBody);
  });

  const server = await new Promise<Server>((resolve, reject) => {
    const instance = app.listen(options.port, '127.0.0.1', () => resolve(instance));
    instance.on('error', reject);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('mirror server address is unavailable');
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

/**
 * Reads the referenced file into memory only when the candidate path stays
 * inside the allowed root. Rejects any path with `..`, null bytes, or absolute
 * segment injections. Returns the buffer on success, `null` on any failure.
 * Using readFileSync + res.send() instead of res.sendFile() removes the
 * CWE-73 surface area entirely — no path ever reaches the static-file
 * pipeline.
 */
function loadValidatedBody(root: string, candidate: string | undefined): Buffer | null {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return null;
  }
  if (candidate.includes('..') || candidate.includes('\0')) {
    return null;
  }
  if (!isWithin(root, candidate)) {
    return null;
  }
  const absolute = join(root, candidate);
  if (!existsSync(absolute)) {
    return null;
  }
  try {
    return readFileSync(absolute);
  } catch {
    return null;
  }
}

function readRoutes(routesPath: string): Array<{
  route: string;
  sourceFile: string;
  mirrorFile?: string;
}> {
  if (!existsSync(routesPath)) {
    return [];
  }

  return JSON.parse(readFileSync(routesPath, 'utf8')) as Array<{
    route: string;
    sourceFile: string;
    mirrorFile?: string;
  }>;
}
