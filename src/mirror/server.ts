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

  app.get('/__not-archived', (request, response) => {
    const originalParam = typeof request.query.original === 'string' ? request.query.original : '';
    const parsedOriginal = parseLiveFallbackUrl(originalParam);
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.send(renderArchiveTruthStub(parsedOriginal, snapshot.snapshotId));
  });

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
      // Archive-truth fallback: render the "not archived yet" stub inline
      // so underlinks in mirrored HTML that target an uncaptured pbinfo
      // route present a branded experience with a button to open the live
      // URL in the user's OS browser. We reconstruct the original live URL
      // only if the request's pathname looks like a pbinfo path; otherwise
      // the stub renders without a live button.
      const liveOriginal = reconstructLivePbinfoUrl(request.path);
      response.status(404);
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.send(renderArchiveTruthStub(liveOriginal, snapshot.snapshotId));
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

const PBINFO_PATH_ALLOWLIST = /^\/(probleme|profil|detalii-evaluare|indicatii|solutii|probleme-categorii)(?:$|\/)/;

function reconstructLivePbinfoUrl(pathname: string): string | null {
  if (typeof pathname !== 'string' || pathname.length === 0) {
    return null;
  }
  if (!PBINFO_PATH_ALLOWLIST.test(pathname)) {
    return null;
  }
  try {
    // Always append to our fixed base. pathname has already been normalized by
    // express (no scheme, no host, no query-string injection into the host).
    const candidate = new URL(pathname, 'https://www.pbinfo.ro/');
    if (candidate.hostname !== 'www.pbinfo.ro') {
      return null;
    }
    return candidate.toString();
  } catch {
    return null;
  }
}

function parseLiveFallbackUrl(candidate: string): string | null {
  if (typeof candidate !== 'string' || candidate.length === 0) {
    return null;
  }
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    if (!/^(www\.)?pbinfo\.ro$/i.test(parsed.hostname)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderArchiveTruthStub(originalLiveUrl: string | null, snapshotId: string): string {
  const liveLinkHtml = originalLiveUrl
    ? `<a class="pbinfo-archive-truth-live" href="${escapeHtml(originalLiveUrl)}" rel="noopener noreferrer">Open on live pbinfo.ro</a>`
    : '<p class="pbinfo-archive-truth-no-live">No live pbinfo.ro URL is known for this route.</p>';
  return [
    '<!doctype html>',
    '<html lang="ro"><head>',
    '<meta charset="utf-8">',
    '<title>Not archived yet · Problem Archive Crawler</title>',
    '<style>',
    'body{font:14px/1.5 system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#0e1014;color:#e9ecef;margin:0;padding:40px;display:flex;justify-content:center}',
    '.wrap{max-width:640px}',
    'h1{font-size:22px;margin:0 0 12px;color:#fff}',
    'p{margin:0 0 12px}',
    'code{background:#1a1d24;padding:2px 6px;border-radius:4px}',
    '.pbinfo-archive-truth-live{display:inline-block;margin-top:12px;padding:10px 18px;background:#4b8bf4;color:#fff;text-decoration:none;border-radius:6px}',
    '.pbinfo-archive-truth-live:hover{background:#3a7ae0}',
    '.pbinfo-archive-truth-no-live{color:#8a919c}',
    'footer{margin-top:32px;color:#6d747e;font-size:12px}',
    '</style>',
    '</head><body><div class="wrap">',
    '<h1>Not archived yet</h1>',
    `<p>This pbinfo.ro route was not captured in snapshot <code>${escapeHtml(snapshotId)}</code>.</p>`,
    '<p>Use the button below to open the original live URL in your OS browser, or continue a crawl to bring the page into the local mirror.</p>',
    liveLinkHtml,
    '<footer>Problem Archive Crawler · archive-truth fallback</footer>',
    '</div></body></html>',
  ].join('\n');
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
