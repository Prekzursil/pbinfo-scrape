import { existsSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { type Server } from 'node:http';

import express from 'express';

import { resolveReadableSnapshotLayout } from '../archive/storage.js';
import { loadLocalConfig } from '../config/local-config.js';

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

  app.get('/_assets/:fileName', (request, response) => {
    // basename() strips any path separators / `..` segments so a decoded
    // param can never traverse outside the flat rawAssetsRoot directory.
    const filePath = join(snapshot.rawAssetsRoot, basename(request.params.fileName));
    if (!existsSync(filePath)) {
      response.status(404).send('asset not found');
      return;
    }
    // nosemgrep: javascript.express.security.audit.express-res-sendfile.express-res-sendfile -- path traversal is neutralised above: basename() strips every separator and `..` segment, so filePath is always a direct child of the flat rawAssetsRoot.
    response.sendFile(filePath);
  });

  app.get('*route', (request, response) => {
    const routeKey = request.originalUrl === '' ? '/' : request.originalUrl;
    const match = routes.find((entry) => entry.route === routeKey || entry.route === request.path);
    if (!match) {
      response.status(404).send('route not found');
      return;
    }

    const preferredPath = match.mirrorFile ? join(snapshot.mirrorRoot, match.mirrorFile) : undefined;
    if (preferredPath && existsSync(preferredPath)) {
      response.sendFile(preferredPath);
      return;
    }

    const rawPath = join(snapshot.rawPagesRoot, match.sourceFile);
    if (!existsSync(rawPath)) {
      // Reflect only the trusted manifest route (match.route), never the raw
      // user-supplied URL, and force text/plain so the response can't be
      // interpreted as HTML (avoids reflected XSS).
      response.status(500).type('text/plain').send(
        `Archived source page is missing for route ${match.route}. Rebuild the mirror after relinking raw artifacts.`,
      );
      return;
    }

    response.sendFile(rawPath);
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
