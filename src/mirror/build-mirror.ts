import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { load } from 'cheerio';

import { resolveReadableSnapshotLayout } from '../archive/storage.js';
import { loadLocalConfig } from '../config/local-config.js';
import type { MirrorRouteRecord } from '../types/records.js';

export interface MirrorBuildResult {
  routesBuilt: number;
  outputRoot: string;
  snapshotId: string;
}

interface MirrorRouteEntry extends MirrorRouteRecord {
  sourceFile: string;
  mirrorFile: string;
}

export async function buildMirrorArtifacts(
  workspaceRoot: string,
  snapshotId?: string,
): Promise<MirrorBuildResult> {
  const config = loadLocalConfig(workspaceRoot);
  const snapshot = resolveReadableSnapshotLayout(config, snapshotId);
  mkdirSync(snapshot.mirrorRoot, { recursive: true });

  const rebuiltManifests = rebuildRawManifests(snapshot.normalizedRoot);
  const pageManifest = {
    ...readManifest(snapshot.rawPagesManifestPath),
    ...rebuiltManifests.pageManifest,
  };
  const assetManifest = {
    ...readManifest(snapshot.rawAssetsManifestPath),
    ...rebuiltManifests.assetManifest,
  };
  writeFileSync(snapshot.rawPagesManifestPath, JSON.stringify(pageManifest, null, 2), 'utf8');
  writeFileSync(snapshot.rawAssetsManifestPath, JSON.stringify(assetManifest, null, 2), 'utf8');
  const routes = buildRoutes(snapshot.normalizedRoot, pageManifest, snapshot.snapshotId);

  for (const route of routes) {
    const sourcePath = join(snapshot.rawPagesRoot, route.sourceFile);
    if (!existsSync(sourcePath)) {
      continue;
    }

    const rewritten = rewriteMirrorHtml(
      readFileSync(sourcePath, 'utf8'),
      route.sourceUrl ?? `https://www.pbinfo.ro${route.route}`,
      pageManifest,
      assetManifest,
    );
    const mirrorFilePath = join(snapshot.mirrorRoot, route.mirrorFile);
    mkdirSync(dirname(mirrorFilePath), { recursive: true });
    writeFileSync(mirrorFilePath, rewritten, 'utf8');
  }

  routes.sort((left, right) => left.route.localeCompare(right.route));
  writeFileSync(snapshot.routesManifestPath, JSON.stringify(routes, null, 2), 'utf8');
  writeFileSync(join(snapshot.mirrorRoot, 'index.html'), renderMirrorIndex(routes), 'utf8');

  return {
    routesBuilt: routes.length,
    outputRoot: snapshot.mirrorRoot,
    snapshotId: snapshot.snapshotId,
  };
}

function buildRoutes(
  normalizedRoot: string,
  pageManifest: Record<string, string>,
  snapshotId: string,
): MirrorRouteEntry[] {
  const routeRecords = readRouteRecords(join(normalizedRoot, 'routes'));
  if (routeRecords.length > 0) {
    return routeRecords
      .filter((record) => record.sourceFile || record.sourceUrl)
      .map((record) => {
        const sourceUrl = record.sourceUrl ?? findSourceUrl(pageManifest, record.sourceFile ?? '');
        const sourceFile = record.sourceFile ?? (sourceUrl ? pageManifest[sourceUrl] : undefined);
        if (!sourceFile) {
          throw new Error(`Mirror route ${record.route} is missing a source file.`);
        }

        return {
          ...record,
          snapshotId,
          sourceUrl,
          sourceFile,
          mirrorFile: routeToMirrorFile(record.route),
        };
      });
  }

  return Object.entries(pageManifest).map(([url, sourceFile]) => ({
    snapshotId,
    route: `${new URL(url).pathname}${new URL(url).search}`,
    sourceUrl: url,
    sourceFile,
    mirrorFile: routeToMirrorFile(`${new URL(url).pathname}${new URL(url).search}`),
    template: inferTemplate(url),
    entityKey: inferEntityKey(url),
  }));
}

function rewriteMirrorHtml(
  html: string,
  sourceUrl: string,
  pageManifest: Record<string, string>,
  assetManifest: Record<string, string>,
): string {
  const $ = load(html);
  const page = new URL(sourceUrl);

  $('script[src]').each((_, element) => {
    const source = $(element).attr('src');
    const localAsset = rewriteAssetUrl(page, source, assetManifest);
    if (localAsset) {
      $(element).attr('src', localAsset);
      return;
    }

    const resolved = safeResolve(page, source);
    if (resolved && resolved.origin !== page.origin) {
      $(element).remove();
    }
  });

  $('script:not([src])').each((_, element) => {
    const content = $(element).html() ?? '';
    if (
      content.includes('challenge-platform')
      || content.includes('__CF$cv$params')
      || content.includes('window.dataLayer')
      || content.includes('gtag(')
    ) {
      $(element).remove();
    }
  });

  $('link[href], img[src], source[src]').each((_, element) => {
    const attribute = element.tagName === 'link' ? 'href' : 'src';
    const source = $(element).attr(attribute);
    const localAsset = rewriteAssetUrl(page, source, assetManifest);
    if (localAsset) {
      $(element).attr(attribute, localAsset);
      return;
    }

    const resolved = safeResolve(page, source);
    if (resolved && resolved.origin !== page.origin) {
      $(element).remove();
    }
  });

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    const localRoute = rewritePageUrl(page, href, pageManifest);
    if (localRoute) {
      $(element).attr('href', localRoute);
    }
  });

  $('script[src*="googletagmanager"], script[src*="ads"], ins.adsbygoogle, .adsbygoogle, iframe').remove();
  $('form[action*="login"], form[action*="logout"]').removeAttr('action');
  $('body').attr('data-archived-source', sourceUrl);

  return $.html();
}

function rewriteAssetUrl(
  page: URL,
  rawUrl: string | undefined,
  assetManifest: Record<string, string>,
): string | undefined {
  const resolved = safeResolve(page, rawUrl);
  if (!resolved) {
    return undefined;
  }

  const fileName = assetManifest[resolved.toString()];
  return fileName ? `/_assets/${fileName}` : undefined;
}

function rewritePageUrl(
  page: URL,
  rawUrl: string | undefined,
  pageManifest: Record<string, string>,
): string | undefined {
  const resolved = safeResolve(page, rawUrl);
  if (!resolved || resolved.origin !== page.origin) {
    return undefined;
  }

  const route = `${resolved.pathname}${resolved.search}`;
  if (pageManifest[resolved.toString()] || route === '/') {
    return route;
  }

  return route;
}

function safeResolve(base: URL, candidate?: string): URL | undefined {
  if (!candidate || candidate.startsWith('javascript:') || candidate.startsWith('#')) {
    return undefined;
  }

  try {
    const resolved = new URL(candidate, base);
    resolved.hash = '';
    return resolved;
  } catch {
    return undefined;
  }
}

function readRouteRecords(root: string): MirrorRouteRecord[] {
  try {
    return readdirSync(root)
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) => JSON.parse(readFileSync(join(root, entry), 'utf8')) as MirrorRouteRecord);
  } catch {
    return [];
  }
}

function rebuildRawManifests(
  normalizedRoot: string,
): { pageManifest: Record<string, string>; assetManifest: Record<string, string> } {
  const manifests = {
    pageManifest: {} as Record<string, string>,
    assetManifest: {} as Record<string, string>,
  };
  const pagesRoot = join(normalizedRoot, 'pages');

  try {
    for (const entry of readdirSync(pagesRoot).filter((item) => item.endsWith('.json'))) {
      const record = JSON.parse(readFileSync(join(pagesRoot, entry), 'utf8')) as {
        url?: string;
        bodyPath?: string;
      };
      if (!record.url || !record.bodyPath) {
        continue;
      }

      if (record.bodyPath.startsWith('raw-pages/')) {
        manifests.pageManifest[record.url] = record.bodyPath.slice('raw-pages/'.length);
        continue;
      }

      if (record.bodyPath.startsWith('raw-assets/')) {
        manifests.assetManifest[record.url] = record.bodyPath.slice('raw-assets/'.length);
      }
    }
  } catch {
    // Ignore missing normalized pages; callers can fall back to empty manifests.
  }

  return manifests;
}

function findSourceUrl(manifest: Record<string, string>, sourceFile: string): string | undefined {
  return Object.entries(manifest).find(([, fileName]) => fileName === sourceFile)?.[0];
}

function readManifest(manifestPath: string): Record<string, string> {
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

function routeToMirrorFile(route: string): string {
  if (route === '/' || route === '') {
    return join('site', 'root', 'index.html').replace(/\\/g, '/');
  }

  const [pathname, search] = route.split('?');
  const segments = (pathname ?? '/')
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.replace(/[^a-zA-Z0-9_-]/g, '-'));
  const querySuffix = search ? `-${Buffer.from(search).toString('hex').slice(0, 16)}` : '';
  return join('site', ...segments, `index${querySuffix}.html`).replace(/\\/g, '/');
}

function inferTemplate(url: string): MirrorRouteRecord['template'] {
  const parsed = new URL(url);
  if (/^\/detalii-evaluare\/\d+/.test(parsed.pathname)) {
    return 'evaluation';
  }
  if (/^\/(?:profil|solutii\/user)\/[^/]+/.test(parsed.pathname)) {
    return 'user-profile';
  }
  if (/^\/probleme\/\d+\/[^/]+/.test(parsed.pathname)) {
    return 'problem';
  }
  return 'raw-page';
}

function inferEntityKey(url: string): string {
  const parsed = new URL(url);
  const problemMatch = parsed.pathname.match(/^\/probleme\/(\d+)\/([^/]+)/);
  if (problemMatch?.[1]) {
    return `problem:${problemMatch[1]}`;
  }

  const evaluationMatch = parsed.pathname.match(/^\/detalii-evaluare\/(\d+)/);
  if (evaluationMatch?.[1]) {
    return `evaluation:${evaluationMatch[1]}`;
  }

  const userMatch = parsed.pathname.match(/^\/(?:profil|solutii\/user)\/([^/]+)/);
  if (userMatch?.[1]) {
    return `user:${userMatch[1]}`;
  }

  return parsed.pathname || '/';
}

function renderMirrorIndex(routes: MirrorRouteEntry[]): string {
  const links = routes
    .map(
      (route) =>
        `<li><a href="${route.route}" data-source-file="${route.sourceFile}" data-mirror-file="${route.mirrorFile}">${route.route}</a></li>`,
    )
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>PBInfo Offline Mirror</title>
  </head>
  <body>
    <h1>PBInfo Offline Mirror</h1>
    <p>Archived route index generated from rewritten mirror pages.</p>
    <ul>
      ${links}
    </ul>
  </body>
</html>`;
}
