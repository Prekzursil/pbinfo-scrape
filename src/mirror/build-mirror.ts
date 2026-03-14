import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { load } from 'cheerio';

import {
  buildProblemCoverageDataset,
  readProblemCoverageIndex,
} from '../coverage/problem-coverage.js';
import { resolveReadableSnapshotLayout } from '../archive/storage.js';
import { loadLocalConfig } from '../config/local-config.js';
import type {
  MirrorRouteRecord,
  ProblemCoverageIndex,
  ProblemCoverageRecord,
} from '../types/records.js';

export interface MirrorBuildResult {
  routesBuilt: number;
  outputRoot: string;
  snapshotId: string;
}

interface MirrorRouteEntry extends MirrorRouteRecord {
  sourceFile?: string;
  mirrorFile: string;
}

export async function buildMirrorArtifacts(
  workspaceRoot: string,
  snapshotId?: string,
): Promise<MirrorBuildResult> {
  const config = loadLocalConfig(workspaceRoot);
  const snapshot = resolveReadableSnapshotLayout(config, snapshotId);
  mkdirSync(snapshot.mirrorRoot, { recursive: true });
  await buildProblemCoverageDataset(workspaceRoot, snapshot.snapshotId);
  const coverageIndex = readProblemCoverageIndex(snapshot.normalizedRoot);
  const coverageByProblemId = new Map<number, ProblemCoverageRecord>(
    (coverageIndex?.records ?? []).map((record) => [record.problemId, record]),
  );

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
  routes.push(createCoverageIndexRoute(snapshot.snapshotId));

  for (const route of routes) {
    const mirrorFilePath = join(snapshot.mirrorRoot, route.mirrorFile);
    mkdirSync(dirname(mirrorFilePath), { recursive: true });

    if (route.template === 'coverage-index') {
      writeFileSync(
        mirrorFilePath,
        renderCoverageIndex(snapshot.snapshotId, coverageIndex),
        'utf8',
      );
      continue;
    }

    if (!route.sourceFile) {
      continue;
    }

    const sourcePath = join(snapshot.rawPagesRoot, route.sourceFile);
    if (!existsSync(sourcePath)) {
      continue;
    }

    const rewritten = rewriteMirrorHtml(
      readFileSync(sourcePath, 'utf8'),
      route.sourceUrl ?? `https://www.pbinfo.ro${route.route}`,
      pageManifest,
      assetManifest,
      route.template === 'problem'
        ? coverageByProblemId.get(readProblemIdFromEntityKey(route.entityKey))
        : undefined,
    );
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
  coverageRecord?: ProblemCoverageRecord,
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
  if (coverageRecord) {
    injectProblemCoverageStrip($, coverageRecord);
  }

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
        `<li><a href="${route.route}"${route.sourceFile ? ` data-source-file="${escapeHtml(route.sourceFile)}"` : ''} data-mirror-file="${escapeHtml(route.mirrorFile)}">${escapeHtml(route.route)}</a></li>`,
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

function createCoverageIndexRoute(snapshotId: string): MirrorRouteEntry {
  return {
    snapshotId,
    route: '/archive/coverage/',
    template: 'coverage-index',
    entityKey: 'archive:coverage',
    mirrorFile: join('site', 'archive', 'coverage', 'index.html').replace(/\\/g, '/'),
  };
}

function renderCoverageIndex(
  snapshotId: string,
  coverageIndex: ProblemCoverageIndex | undefined,
): string {
  const records = coverageIndex?.records ?? [];
  const grades = [...new Set(records.map((record) => record.grade).filter((grade): grade is number => typeof grade === 'number'))]
    .sort((left, right) => left - right);
  const payload = JSON.stringify(records);
  const initialRows = records
    .map((record) => renderCoverageRow(record))
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Archive coverage</title>
    <style>
      :root { color-scheme: light dark; }
      body { font-family: system-ui, sans-serif; margin: 0; background: #f5efe6; color: #1f1710; }
      main { max-width: 1200px; margin: 0 auto; padding: 2rem 1.5rem 3rem; }
      .hero { display: grid; gap: 1rem; margin-bottom: 1.5rem; }
      .summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 0.75rem; }
      .summary-card, .filter-card, table { background: rgba(255,255,255,0.9); border: 1px solid rgba(77, 53, 28, 0.12); border-radius: 14px; box-shadow: 0 12px 24px rgba(77, 53, 28, 0.08); }
      .summary-card { padding: 1rem; }
      .summary-card strong { display: block; font-size: 1.5rem; margin-top: 0.2rem; }
      .filter-card { padding: 1rem; display: grid; gap: 0.75rem; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); margin-bottom: 1rem; }
      label { display: grid; gap: 0.35rem; font-size: 0.92rem; }
      input, select { padding: 0.55rem 0.65rem; border-radius: 10px; border: 1px solid rgba(77, 53, 28, 0.18); font: inherit; }
      table { width: 100%; border-collapse: collapse; overflow: hidden; }
      th, td { padding: 0.75rem 0.85rem; border-bottom: 1px solid rgba(77, 53, 28, 0.08); text-align: left; vertical-align: top; }
      th { background: rgba(154, 111, 51, 0.1); }
      .badge { display: inline-flex; gap: 0.35rem; padding: 0.2rem 0.55rem; border-radius: 999px; background: rgba(34, 76, 115, 0.1); color: #224c73; font-size: 0.83rem; margin: 0.1rem 0.35rem 0.1rem 0; }
      .muted { color: #6f655a; }
      a { color: #7d4e14; }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <div>
          <p class="muted">Canonical snapshot ${escapeHtml(snapshotId)}</p>
          <h1>Archive coverage</h1>
          <p>Truthful per-problem coverage for solved status, archived fragments, parsed tests, and archived source code.</p>
        </div>
        <div class="summary-grid">
          <article class="summary-card"><span class="muted">Problems</span><strong>${coverageIndex?.totals.totalProblems ?? 0}</strong></article>
          <article class="summary-card"><span class="muted">Solved by archived handle</span><strong>${coverageIndex?.totals.solvedByMeCount ?? 0}</strong></article>
          <article class="summary-card"><span class="muted">Tests fragments archived</span><strong>${coverageIndex?.totals.testsFragmentArchivedCount ?? 0}</strong></article>
          <article class="summary-card"><span class="muted">Archived source coverage</span><strong>${coverageIndex?.totals.problemsWithArchivedSources ?? 0}</strong></article>
        </div>
      </section>
      <section class="filter-card" aria-label="Coverage filters">
        <label>Search
          <input id="coverage-search" placeholder="Search by id, name, slug, tag">
        </label>
        <label>Solved
          <select id="coverage-solved">
            <option value="all">All problems</option>
            <option value="solved">Solved by archived handle</option>
            <option value="unsolved">Unsolved</option>
          </select>
        </label>
        <label>Tests fragment archived
          <select id="coverage-tests-fragment">
            <option value="all">All</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <label>Visible tests captured
          <select id="coverage-visible-tests">
            <option value="all">All</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <label>Official source archived
          <select id="coverage-official-source">
            <option value="all">All</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <label>User source archived
          <select id="coverage-user-source">
            <option value="all">All</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <label>Editorial
          <select id="coverage-editorial">
            <option value="all">All</option>
            <option value="visible">Visible</option>
            <option value="restricted">Restricted</option>
            <option value="hidden">Hidden</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
        <label>Grade
          <select id="coverage-grade">
            <option value="all">All</option>
            ${grades.map((grade) => `<option value="${grade}">${grade}</option>`).join('')}
          </select>
        </label>
      </section>
      <table>
        <thead>
          <tr>
            <th>Problem</th>
            <th>Grade</th>
            <th>Solved</th>
            <th>Evaluations</th>
            <th>Tests fragment</th>
            <th>Visible tests</th>
            <th>Official solution</th>
            <th>Official source</th>
            <th>User source</th>
            <th>Editorial</th>
          </tr>
        </thead>
        <tbody id="coverage-rows">
          ${initialRows}
        </tbody>
      </table>
    </main>
    <script>
      const records = ${payload};
      const rows = document.getElementById('coverage-rows');
      const filters = {
        search: document.getElementById('coverage-search'),
        solved: document.getElementById('coverage-solved'),
        testsFragment: document.getElementById('coverage-tests-fragment'),
        visibleTests: document.getElementById('coverage-visible-tests'),
        officialSource: document.getElementById('coverage-official-source'),
        userSource: document.getElementById('coverage-user-source'),
        editorial: document.getElementById('coverage-editorial'),
        grade: document.getElementById('coverage-grade'),
      };

      function matchesPresence(value, filter) {
        if (filter === 'all') return true;
        return filter === 'yes' ? value : !value;
      }

      function escapeHtml(value) {
        return value
          .replaceAll('&', '&amp;')
          .replaceAll('<', '&lt;')
          .replaceAll('>', '&gt;')
          .replaceAll('"', '&quot;')
          .replaceAll("'", '&#39;');
      }

      function renderRow(record) {
        const noteBadges = (record.notes ?? []).map((note) => \`<span class="badge">\${escapeHtml(note)}</span>\`).join('');
        const evaluationLink = record.bestUserOverallEvaluationId
          ? \`<a href="/detalii-evaluare/\${record.bestUserOverallEvaluationId}">best eval</a>\`
          : '<span class="muted">n/a</span>';
        return \`<tr>
          <td>
            <strong><a href="\${record.mirrorRoute}">#\${record.problemId} \${escapeHtml(record.name)}</a></strong>
            <div class="muted">\${escapeHtml(record.slug)}</div>
            <div>\${noteBadges}</div>
          </td>
          <td>\${record.grade ?? '—'}</td>
          <td>\${record.solvedByMe ? 'Solved by archived handle' : 'Unsolved'}</td>
          <td>\${record.evaluationCount} (\${evaluationLink})</td>
          <td>\${record.testsFragmentArchived ? 'Tests fragment archived' : 'Tests fragment not archived'}</td>
          <td>Visible tests captured: \${record.visibleTestsCapturedCount}</td>
          <td>\${record.officialSolutionPresent ? 'Official solution present' : 'Official solution not archived'}</td>
          <td>\${record.officialSourceArchived ? \`Official source archived: \${record.officialSourceCount}\` : 'Official source not archived'}</td>
          <td>\${record.userSourceArchived ? \`User source archived: \${record.userSourceCount}\` : 'User source not archived'}</td>
          <td>\${record.editorialAvailability}</td>
        </tr>\`;
      }

      function applyFilters() {
        const search = (filters.search.value || '').trim().toLowerCase();
        const next = records.filter((record) => {
          if (filters.solved.value === 'solved' && !record.solvedByMe) return false;
          if (filters.solved.value === 'unsolved' && record.solvedByMe) return false;
          if (!matchesPresence(record.testsFragmentArchived, filters.testsFragment.value)) return false;
          if (!matchesPresence(record.visibleTestsCapturedCount > 0, filters.visibleTests.value)) return false;
          if (!matchesPresence(record.officialSourceArchived, filters.officialSource.value)) return false;
          if (!matchesPresence(record.userSourceArchived, filters.userSource.value)) return false;
          if (filters.editorial.value !== 'all' && record.editorialAvailability !== filters.editorial.value) return false;
          if (filters.grade.value !== 'all' && String(record.grade ?? '') !== filters.grade.value) return false;
          if (!search) return true;
          const haystack = [String(record.problemId), record.name, record.slug, (record.tags ?? []).join(' '), record.mirrorRoute, ...(record.notes ?? [])].join(' ').toLowerCase();
          return haystack.includes(search);
        });
        rows.innerHTML = next.map(renderRow).join('');
      }

      Object.values(filters).forEach((element) => element.addEventListener('input', applyFilters));
      Object.values(filters).forEach((element) => element.addEventListener('change', applyFilters));
    </script>
  </body>
</html>`;
}

function renderCoverageRow(record: ProblemCoverageRecord): string {
  const bestEvaluationLink = record.bestUserOverallEvaluationId
    ? `<a href="/detalii-evaluare/${record.bestUserOverallEvaluationId}">best eval</a>`
    : '<span class="muted">n/a</span>';
  const noteBadges = (record.notes ?? [])
    .map((note) => `<span class="badge">${escapeHtml(note)}</span>`)
    .join('');
  return `<tr>
    <td>
      <strong><a href="${escapeHtml(record.mirrorRoute)}">#${record.problemId} ${escapeHtml(record.name)}</a></strong>
      <div class="muted">${escapeHtml(record.slug)}</div>
      <div>${noteBadges}</div>
    </td>
    <td>${record.grade ?? '—'}</td>
    <td>${record.solvedByMe ? 'Solved by archived handle' : 'Unsolved'}</td>
    <td>${record.evaluationCount} (${bestEvaluationLink})</td>
    <td>${record.testsFragmentArchived ? 'Tests fragment archived' : 'Tests fragment not archived'}</td>
    <td>Visible tests captured: ${record.visibleTestsCapturedCount}</td>
    <td>${record.officialSolutionPresent ? 'Official solution present' : 'Official solution not archived'}</td>
    <td>${record.officialSourceArchived ? `Official source archived: ${record.officialSourceCount}` : 'Official source not archived'}</td>
    <td>${record.userSourceArchived ? `User source archived: ${record.userSourceCount}` : 'User source not archived'}</td>
    <td>${escapeHtml(record.editorialAvailability)}</td>
  </tr>`;
}

function injectProblemCoverageStrip(
  $: ReturnType<typeof load>,
  record: ProblemCoverageRecord,
): void {
  if ($('.archive-coverage-strip').length > 0) {
    return;
  }
  if ($('head style[data-archive-coverage-style]').length === 0) {
    $('head').append(`<style data-archive-coverage-style>
      .archive-coverage-strip{margin:1rem auto;padding:0.9rem 1rem;border-radius:16px;border:1px solid rgba(77,53,28,.12);background:rgba(245,239,230,.92);color:#1f1710;box-shadow:0 10px 20px rgba(77,53,28,.08);max-width:1100px;font-family:system-ui,sans-serif}
      .archive-coverage-strip h2{margin:0 0 .55rem;font-size:1rem}
      .archive-coverage-strip .archive-coverage-badges{display:flex;flex-wrap:wrap;gap:.45rem}
      .archive-coverage-strip .archive-coverage-badge{display:inline-flex;padding:.28rem .65rem;border-radius:999px;background:rgba(34,76,115,.1);color:#224c73;font-size:.85rem;text-decoration:none}
      .archive-coverage-strip .archive-coverage-note{margin-top:.55rem;font-size:.9rem;color:#6f655a}
    </style>`);
  }
  const noteText = record.notes.length > 0
    ? `<p class="archive-coverage-note">${escapeHtml(record.notes.join(' • '))}</p>`
    : '';
  const strip = `<section class="archive-coverage-strip" data-problem-id="${record.problemId}">
    <h2>Archive coverage</h2>
    <div class="archive-coverage-badges">
      <a class="archive-coverage-badge" href="/archive/coverage/">Coverage index</a>
      <span class="archive-coverage-badge">${record.solvedByMe ? 'Solved by archived handle' : 'Unsolved by archived handle'}</span>
      <span class="archive-coverage-badge">${record.testsFragmentArchived ? 'Tests fragment archived' : 'Tests fragment not archived'}</span>
      <span class="archive-coverage-badge">Visible tests captured: ${record.visibleTestsCapturedCount}</span>
      <span class="archive-coverage-badge">${record.officialSolutionPresent ? 'Official solution present' : 'Official solution not archived'}</span>
      <span class="archive-coverage-badge">${record.officialSourceArchived ? `Official source archived: ${record.officialSourceCount}` : 'Official source not archived'}</span>
      <span class="archive-coverage-badge">${record.userSourceArchived ? `User source archived: ${record.userSourceCount}` : 'User source not archived'}</span>
      <span class="archive-coverage-badge">Editorial: ${escapeHtml(record.editorialAvailability)}</span>
    </div>
    ${noteText}
  </section>`;
  $('body').prepend(strip);
}

function readProblemIdFromEntityKey(entityKey: string): number {
  const match = entityKey.match(/^problem:(\d+)$/);
  return match?.[1] ? Number(match[1]) : Number.NaN;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
