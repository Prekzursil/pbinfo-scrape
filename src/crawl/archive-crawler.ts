import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { load } from 'cheerio';

import {
  buildAssetFilename,
  buildPageFilename,
  buildPageRecordFilename,
  sanitizeSegment,
} from '../archive/archive-paths.js';
import { mergeJsonRecord, writeJsonRecord } from '../archive/json-store.js';
import type { SnapshotLayout } from '../archive/storage.js';
import type { LoadedLocalConfig } from '../config/local-config.js';
import { parseCategoryPage } from '../pbinfo/parsers/category.js';
import { parseEvaluationPage } from '../pbinfo/parsers/evaluation.js';
import {
  parseOfficialSolutionFragment,
  parseProblemEndpointFragment,
  parseProblemPage,
  parseProblemStatementFragment,
} from '../pbinfo/parsers/problem.js';
import { parseUserSolutionsListPage } from '../pbinfo/parsers/user-solutions.js';
import type { CrawlQueueInput } from '../types/crawl.js';
import type {
  EvaluationRecord,
  MirrorRouteRecord,
  PageRecord,
  ProblemRecord,
  SourceRecord,
} from '../types/records.js';
import { CrawlQueue } from './crawl-queue.js';
import type { BrowserCapture } from './browser-capture.js';

export interface ArchiveCrawlerOptions {
  config: LoadedLocalConfig;
  snapshot: SnapshotLayout;
  queue: CrawlQueue;
  retryDelayMs?: number;
  fetchImpl?: typeof fetch;
  browserCapture?: BrowserCapture;
}

const manifestCache = new Map<string, Record<string, string>>();
const manifestWriteLocks = new Map<string, Promise<void>>();

export class ArchiveCrawler {
  private readonly config: LoadedLocalConfig;
  private readonly snapshot: SnapshotLayout;
  private readonly queue: CrawlQueue;
  private readonly retryDelayMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly browserCapture?: BrowserCapture;

  constructor(options: ArchiveCrawlerOptions) {
    this.config = options.config;
    this.snapshot = options.snapshot;
    this.queue = options.queue;
    this.retryDelayMs = options.retryDelayMs ?? 60_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.browserCapture = options.browserCapture;
  }

  async processNext(now: Date): Promise<boolean> {
    const item = this.queue.claimNext(now);
    if (!item) {
      return false;
    }

    const response = await this.fetchImpl(item.url);
    const contentType = response.headers.get('content-type');

    if (looksLikeHtml(contentType)) {
      const body = await response.text();
      if (isTemporaryUnavailable(body)) {
        this.queue.fail(item.id, {
          errorMessage: 'temporarily unavailable',
          nextVisibleAt: new Date(now.getTime() + this.retryDelayMs).toISOString(),
        });
        return true;
      }

      const contentHash = `sha256:${createHash('sha256').update(body).digest('hex')}`;
      const fileName = await this.archiveHtmlPage(item.url, body);
      const browserBodyPath = await this.captureBrowserHtml(item.url);
      this.persistPageRecord({
        snapshotId: this.snapshot.snapshotId,
        url: item.url,
        kind: item.kind,
        httpStatus: response.status,
        contentType: contentType ?? undefined,
        contentHash,
        bodyPath: `raw-pages/${fileName}`,
        browserBodyPath,
        fetchedAt: now.toISOString(),
      });
      this.persistNormalizedHtml(item, body, response.status, contentType ?? undefined);

      const followUps = [
        ...discoverFollowUps(this.config, item.url, body),
        ...discoverNormalizedFollowUps(this.config, item.url, item.kind, body),
      ];
      this.queue.enqueueMany(followUps);
      this.queue.complete(item.id, {
        contentHash,
        httpStatus: response.status,
      });
      return true;
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const contentHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const fileName = await this.archiveAsset(item.url, bytes, contentType);
    this.persistPageRecord({
      snapshotId: this.snapshot.snapshotId,
      url: item.url,
      kind: item.kind,
      httpStatus: response.status,
      contentType: contentType ?? undefined,
      contentHash,
      bodyPath: `raw-assets/${fileName}`,
      fetchedAt: now.toISOString(),
    });
    this.queue.complete(item.id, {
      contentHash,
      httpStatus: response.status,
    });
    return true;
  }

  private async archiveHtmlPage(url: string, body: string): Promise<string> {
    const fileName = buildPageFilename(url);
    mkdirSync(this.snapshot.rawPagesRoot, { recursive: true });
    writeFileSync(join(this.snapshot.rawPagesRoot, fileName), body, 'utf8');
    await this.writeManifestEntry(this.snapshot.rawPagesManifestPath, url, fileName);
    return fileName;
  }

  private async archiveAsset(url: string, bytes: Buffer, contentType: string | null): Promise<string> {
    const fileName = buildAssetFilename(url, contentType);
    mkdirSync(this.snapshot.rawAssetsRoot, { recursive: true });
    writeFileSync(join(this.snapshot.rawAssetsRoot, fileName), bytes);
    await this.writeManifestEntry(this.snapshot.rawAssetsManifestPath, url, fileName);
    return fileName;
  }

  private persistPageRecord(record: PageRecord): void {
    writeJsonRecord(
      join(this.snapshot.normalizedRoot, 'pages'),
      buildPageRecordFilename(record.url),
      record,
    );
  }

  private async captureBrowserHtml(url: string): Promise<string | undefined> {
    if (!this.browserCapture) {
      return undefined;
    }

    try {
      const html = await this.browserCapture.captureHtml(url);
      const fileName = `browser-${buildPageFilename(url)}`;
      const root = join(this.snapshot.snapshotRoot, 'browser-pages');
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, fileName), html, 'utf8');
      return `browser-pages/${fileName}`;
    } catch {
      return undefined;
    }
  }

  private persistNormalizedHtml(
    item: CrawlQueueInput,
    html: string,
    httpStatus: number,
    contentType?: string,
  ): void {
    persistNormalizedSnapshotHtml({
      config: this.config,
      snapshot: this.snapshot,
      item,
      html,
      httpStatus,
      contentType,
      fetchedAt: new Date().toISOString(),
    });
  }

  private persistMirrorRoute(
    url: string,
    template: MirrorRouteRecord['template'],
    entityKey: string,
  ): void {
    const parsedUrl = new URL(url);
    const route = `${parsedUrl.pathname}${parsedUrl.search}`;
    const sourceFile = buildPageFilename(url);
    const fileName = `route-${sanitizeSegment(parsedUrl.pathname || 'root')}${parsedUrl.search ? `-${shortHash(parsedUrl.search)}` : ''}.json`;

    writeJsonRecord<MirrorRouteRecord>(
      join(this.snapshot.normalizedRoot, 'routes'),
      fileName,
      {
        snapshotId: this.snapshot.snapshotId,
        route,
        sourceUrl: url,
        sourceFile,
        template,
        entityKey,
      },
    );
  }

  private async writeManifestEntry(
    manifestPath: string,
    url: string,
    fileName: string,
  ): Promise<void> {
    const prior = manifestWriteLocks.get(manifestPath) ?? Promise.resolve();
    const next = prior
      .catch(() => undefined)
      .then(() => {
        const manifest = {
          ...loadManifest(manifestPath),
          [url]: fileName,
        };
        writeManifestFile(manifestPath, manifest);
      });

    manifestWriteLocks.set(manifestPath, next);
    try {
      await next;
    } finally {
      if (manifestWriteLocks.get(manifestPath) === next) {
        manifestWriteLocks.delete(manifestPath);
      }
    }
  }
}

export interface PersistNormalizedSnapshotHtmlOptions {
  config: LoadedLocalConfig;
  snapshot: SnapshotLayout;
  item: CrawlQueueInput;
  html: string;
  httpStatus: number;
  contentType?: string;
  fetchedAt: string;
}

export function persistNormalizedSnapshotHtml(
  options: PersistNormalizedSnapshotHtmlOptions,
): void {
  persistMirrorRouteRecord(
    options.snapshot,
    options.item.url,
    inferTemplate(options.item.url, options.item.kind),
    inferEntityKey(options.item.url, options.item.kind),
  );

  const linkedProblem = resolveLinkedProblem(options.item);
  const problemMatch = options.item.url.match(/\/probleme\/(\d+)\/([^/?#]+)/);
  if (options.item.kind === 'public-page' && problemMatch?.[1]) {
    const record = parseProblemPage(options.html, options.item.url);
    mergeJsonRecord<ProblemRecord>(
      join(options.snapshot.normalizedRoot, 'problems'),
      `problem-${record.id}.json`,
      (current) => ({
        ...current,
        ...record,
        editorial: current?.editorial ?? record.editorial,
        officialSolutions: current?.officialSolutions ?? {},
        officialSourceIds: current?.officialSourceIds ?? {},
        visibleTests: current?.visibleTests ?? [],
        editorialAvailability: current?.editorialAvailability ?? record.editorialAvailability,
      }),
    );
    return;
  }

  if (options.item.kind === 'problem-statement' && linkedProblem) {
    const problemId = linkedProblem.id;
    const fragment = parseProblemStatementFragment(options.html);
    mergeJsonRecord<ProblemRecord>(
      join(options.snapshot.normalizedRoot, 'problems'),
      `problem-${problemId}.json`,
      (current) => ({
        ...(current ?? createPlaceholderProblem(problemId, linkedProblem.slug)),
        sections: fragment.sections,
        examples: fragment.examples,
        constraints: fragment.constraints,
        timeLimitSeconds: current?.timeLimitSeconds ?? fragment.executionHints.timeLimitSeconds,
        memoryLimitMb: current?.memoryLimitMb ?? fragment.executionHints.memoryLimitMb,
      }),
    );
    return;
  }

  if (options.item.kind === 'problem-solution' && linkedProblem) {
    const problemId = linkedProblem.id;
    const solution = parseOfficialSolutionFragment(options.html);
    const sourceIds = persistOfficialSources(options.snapshot, problemId, solution.solutions, options.item.url);
    mergeJsonRecord<ProblemRecord>(
      join(options.snapshot.normalizedRoot, 'problems'),
      `problem-${problemId}.json`,
      (current) => ({
        ...(current ?? createPlaceholderProblem(problemId, linkedProblem.slug)),
        editorialAvailability: solution.access,
        editorialMessage: solution.message,
        editorial: {
          availability: solution.access,
          message: solution.message,
          artifactPath: resolveRawPageBodyPath(options.snapshot, options.item.url),
        },
        officialSolutions: mergeLanguageSolutions(current?.officialSolutions ?? {}, solution.solutions),
        officialSourceIds: {
          ...(current?.officialSourceIds ?? {}),
          ...sourceIds,
        },
      }),
    );
    return;
  }

  if (options.item.kind === 'problem-tests' && linkedProblem) {
    const problemId = linkedProblem.id;
    const fragment = parseProblemEndpointFragment(options.html);
    mergeJsonRecord<ProblemRecord>(
      join(options.snapshot.normalizedRoot, 'problems'),
      `problem-${problemId}.json`,
      (current) => ({
        ...(current ?? createPlaceholderProblem(problemId, linkedProblem.slug)),
        editorialAvailability:
          current?.editorialAvailability === 'visible'
            ? current.editorialAvailability
            : fragment.access,
        editorialMessage: current?.editorialMessage ?? fragment.message,
        visibleTests: fragment.visibleTests,
      }),
    );
    return;
  }

  const evaluationMatch = options.item.url.match(/\/detalii-evaluare\/(\d+)/);
  if (options.item.kind === 'evaluation-detail' && evaluationMatch?.[1]) {
    try {
      const record = parseEvaluationPage(options.html, Number(evaluationMatch[1]));
      const suspicious = detectSuspicionFlags(record.sourceCode);
      const evaluation: EvaluationRecord = {
        ...record,
        fetchedAt: options.fetchedAt,
        provenance: [options.item.url],
        suspicionFlags: suspicious,
      };
      writeJsonRecord(
        join(options.snapshot.normalizedRoot, 'evaluations'),
        `evaluation-${evaluation.evaluationId}.json`,
        evaluation,
      );
      persistEvaluationSource(options.snapshot, evaluation);
    } catch (error) {
      writeJsonRecord(
        join(options.snapshot.normalizedRoot, 'evaluation-errors'),
        `evaluation-${evaluationMatch[1]}.json`,
        {
          evaluationId: Number(evaluationMatch[1]),
          sourceUrl: options.item.url,
          fetchedAt: options.fetchedAt,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
    return;
  }

  const solutionsMatch = options.item.url.match(/\/solutii\/user\/([^/?#]+)/);
  if (options.item.kind === 'user-solutions' && solutionsMatch?.[1]) {
    const record = parseUserSolutionsListPage(options.html);
    writeJsonRecord(
      join(options.snapshot.normalizedRoot, 'user-solutions'),
      `user-${sanitizeSegment(solutionsMatch[1]).toLowerCase()}.json`,
      {
        user: solutionsMatch[1],
        sourceUrl: options.item.url,
        httpStatus: options.httpStatus,
        contentType: options.contentType,
        ...record,
      },
    );
    return;
  }

  const categoryMatch = options.item.url.match(/\/probleme-categorii\/(\d+)/);
  if (options.item.kind === 'public-page' && categoryMatch?.[1]) {
    const record = parseCategoryPage(options.html, Number(categoryMatch[1]));
    writeJsonRecord(
      join(options.snapshot.normalizedRoot, 'categories'),
      `grade-${record.grade}.json`,
      record,
    );
  }
}

function resolveLinkedProblem(
  item: CrawlQueueInput,
): { id: number; slug: string } | undefined {
  if (!item.kind.startsWith('problem-')) {
    return undefined;
  }

  const sourceMatch = item.key.match(/https:\/\/www\.pbinfo\.ro\/probleme\/(\d+)\/([^/?#]+)/);
  if (sourceMatch?.[1] && sourceMatch[2]) {
    return {
      id: Number(sourceMatch[1]),
      slug: sourceMatch[2],
    };
  }

  const url = new URL(item.url);
  const id = url.searchParams.get('id');
  if (!id) {
    return undefined;
  }

  return {
    id: Number(id),
    slug: `problem-${id}`,
  };
}

function persistMirrorRouteRecord(
  snapshot: SnapshotLayout,
  url: string,
  template: MirrorRouteRecord['template'],
  entityKey: string,
): void {
  const parsedUrl = new URL(url);
  const route = `${parsedUrl.pathname}${parsedUrl.search}`;
  const sourceFile = readManifestValue(snapshot.rawPagesManifestPath, url);
  const fileName = `route-${sanitizeSegment(parsedUrl.pathname || 'root')}${parsedUrl.search ? `-${shortHash(parsedUrl.search)}` : ''}.json`;

  writeJsonRecord<MirrorRouteRecord>(
    join(snapshot.normalizedRoot, 'routes'),
    fileName,
    {
      snapshotId: snapshot.snapshotId,
      route,
      sourceUrl: url,
      sourceFile,
      template,
      entityKey,
    },
  );
}

function persistOfficialSources(
  snapshot: SnapshotLayout,
  problemId: number,
  solutions: Record<string, string>,
  sourceUrl: string,
): Record<string, string> {
  const sourceIds: Record<string, string> = {};
  for (const [languageLabel, sourceCode] of Object.entries(solutions)) {
    const language = normalizeSourceLanguage(languageLabel);
    const sourceId = `official-${problemId}-${sanitizeSegment(language).toLowerCase()}`;
    const sourceRecord: SourceRecord = {
      sourceId,
      kind: 'official',
      problemId,
      language,
      sourceAvailable: Boolean(sourceCode),
      sourceCode,
      suspicionFlags: detectSuspicionFlags(sourceCode),
      provenance: [sourceUrl],
    };
    writeJsonRecord(
      join(snapshot.normalizedRoot, 'sources'),
      `${sourceId}.json`,
      sourceRecord,
    );
    sourceIds[language] = sourceId;
  }

  return sourceIds;
}

function persistEvaluationSource(
  snapshot: SnapshotLayout,
  evaluation: EvaluationRecord,
): void {
  if (!evaluation.sourceAvailable) {
    return;
  }

  const language = normalizeSourceLanguage(evaluation.language);
  const sourceId = `evaluation-${evaluation.evaluationId}`;
  const sourceRecord: SourceRecord = {
    sourceId,
    kind: 'user-evaluation',
    problemId: evaluation.problemId,
    evaluationId: evaluation.evaluationId,
    userHandle: evaluation.user,
    language,
    score: evaluation.score,
    runtimeSeconds: evaluation.runtimeSeconds,
    memoryKb: evaluation.memoryKb,
    sourceAvailable: evaluation.sourceAvailable,
    sourceCode: evaluation.sourceCode,
    suspicionFlags: evaluation.suspicionFlags,
    provenance: evaluation.provenance,
  };
  writeJsonRecord(
    join(snapshot.normalizedRoot, 'sources'),
    `${sourceId}.json`,
    sourceRecord,
  );
}

function resolveRawPageBodyPath(
  snapshot: SnapshotLayout,
  url: string,
): string | undefined {
  const fileName = buildPageFilename(url);
  return existsSync(join(snapshot.rawPagesRoot, fileName))
    ? `raw-pages/${fileName}`
    : undefined;
}

function discoverFollowUps(
  config: LoadedLocalConfig,
  baseUrl: string,
  html: string,
): CrawlQueueInput[] {
  const document = load(html);
  const base = new URL(baseUrl);
  const queued = new Map<string, CrawlQueueInput>();

  document('a[href]').each((_, element) => {
    const href = document(element).attr('href');
    const normalized = normalizeNavigableUrl(config, base, href);
    if (!normalized) {
      return;
    }

    queued.set(`page:${normalized}`, {
      key: `page:${normalized}`,
      url: normalized,
      kind: inferPageKind(normalized),
    });
  });

  for (const selector of ['link[href]', 'script[src]', 'img[src]', 'source[src]']) {
    document(selector).each((_, element) => {
      const attribute = selector.startsWith('link') ? 'href' : 'src';
      const rawUrl = document(element).attr(attribute);
      const normalized = normalizeAssetUrl(config, base, rawUrl);
      if (!normalized) {
        return;
      }

      queued.set(`asset:${normalized}`, {
        key: `asset:${normalized}`,
        url: normalized,
        kind: 'public-asset',
      });
    });
  }

  const problemMatch = base.pathname.match(/^\/probleme\/(\d+)\/([^/?#]+)/);
  if (problemMatch?.[1] && problemMatch[2]) {
    const problemId = Number(problemMatch[1]);
    const slug = problemMatch[2];
    const endpointBase = 'https://www.pbinfo.ro/ajx-module';
    const problemUrl = new URL(base.toString());
    queued.set(`problem-statement:${base.toString()}`, {
      key: `problem-statement:${base.toString()}`,
      url: `${endpointBase}/ajx-problema-afisare-enunt.php?id=${problemId}`,
      kind: 'problem-statement',
    });
    queued.set(`problem-solution:${base.toString()}`, {
      key: `problem-solution:${base.toString()}`,
      url: `${endpointBase}/ajx-problema-afisare-solutie.php?id=${problemId}`,
      kind: 'problem-solution',
    });
    queued.set(`problem-tests:${base.toString()}`, {
      key: `problem-tests:${base.toString()}`,
      url: `${endpointBase}/ajx-problema-afisare-teste.php?id=${problemId}`,
      kind: 'problem-tests',
    });
    queued.set(`page:https://www.pbinfo.ro/solutii/problema/${problemId}/${slug}`, {
      key: `page:https://www.pbinfo.ro/solutii/problema/${problemId}/${slug}`,
      url: `https://www.pbinfo.ro/solutii/problema/${problemId}/${slug}`,
      kind: 'public-page',
    });
    problemUrl.hash = '';
  }

  return [...queued.values()];
}

function discoverNormalizedFollowUps(
  config: LoadedLocalConfig,
  baseUrl: string,
  kind: CrawlQueueInput['kind'],
  html: string,
): CrawlQueueInput[] {
  if (kind !== 'user-solutions') {
    return [];
  }

  const baseMatch = new URL(baseUrl).pathname.match(/^\/solutii\/user\/([^/?#]+)/);
  if (!matchesConfiguredUserHandle(config, baseMatch?.[1])) {
    return [];
  }

  const parsed = parseUserSolutionsListPage(html);
  return parsed.entries
    .filter((entry) => matchesConfiguredUserHandle(config, entry.user))
    .map((entry) => ({
      key: `evaluation:${entry.evaluationId}`,
      url: new URL(`/detalii-evaluare/${entry.evaluationId}`, baseUrl).toString(),
      kind: 'evaluation-detail',
    }));
}

function normalizeNavigableUrl(
  config: LoadedLocalConfig,
  base: URL,
  candidate?: string,
): string | null {
  if (
    !candidate
    || candidate.startsWith('#')
    || candidate.startsWith('javascript:')
    || candidate.startsWith('mailto:')
    || candidate.startsWith('tel:')
    || candidate.startsWith('data:')
  ) {
    return null;
  }

  const resolved = new URL(normalizeSiteRelativeCandidate(candidate), base);
  if (resolved.origin !== base.origin) {
    return null;
  }

  resolved.hash = '';
  stripTrackingQueryParameters(resolved);
  canonicalizeQueryParameters(resolved);
  if (!isMeaningfulNavigableUrl(config, resolved)) {
    return null;
  }
  return resolved.toString();
}

function stripTrackingQueryParameters(url: URL): void {
  for (const key of [...url.searchParams.keys()]) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey.startsWith('utm_')
      || normalizedKey === 'fbclid'
      || normalizedKey === 'gclid'
      || normalizedKey === 'yclid'
      || normalizedKey === 'mc_cid'
      || normalizedKey === 'mc_eid'
      || normalizedKey === 'ref'
      || normalizedKey === 'source'
    ) {
      url.searchParams.delete(key);
    }
  }
}

function canonicalizeQueryParameters(url: URL): void {
  const entries = [...url.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    const keyCompare = leftKey.localeCompare(rightKey);
    if (keyCompare !== 0) {
      return keyCompare;
    }
    return leftValue.localeCompare(rightValue);
  });

  url.search = '';
  for (const [key, value] of entries) {
    url.searchParams.append(key, value);
  }
}

function isMeaningfulNavigableUrl(
  config: LoadedLocalConfig,
  url: URL,
): boolean {
  const pathname = normalizePathname(url.pathname);
  if (
    pathname.startsWith('/articole')
    || pathname.startsWith('/ajutor')
    || pathname.startsWith('/editare-cont')
    || pathname.startsWith('/resurse')
    || pathname === '/php/gravatar.php'
  ) {
    return false;
  }

  if (/^\/detalii-evaluare\/\d+$/.test(pathname)) {
    return false;
  }

  const profileMatch = pathname.match(/^\/profil\/([^/]+)(?:\/([^/]+))?$/);
  if (profileMatch?.[1]) {
    if (!matchesConfiguredUserHandle(config, profileMatch[1])) {
      return false;
    }

    return !profileMatch[2] || profileMatch[2] === 'probleme' || profileMatch[2] === 'jurnal';
  }

  const solutionsMatch = pathname.match(/^\/solutii\/user\/([^/]+)$/);
  if (solutionsMatch?.[1]) {
    return matchesConfiguredUserHandle(config, solutionsMatch[1]);
  }

  const pagina = url.searchParams.get('pagina')?.toLowerCase();
  if (url.searchParams.size > 0 && !pagina) {
    return false;
  }
  if (pagina?.startsWith('itemi-evaluare')) {
    return false;
  }
  if (pagina && pagina !== 'probleme-lista') {
    return false;
  }
  if (pagina === 'probleme-lista') {
    const allowedParams = new Set(['pagina', 'clasa', 'tag']);
    for (const key of url.searchParams.keys()) {
      if (!allowedParams.has(key.toLowerCase())) {
        return false;
      }
    }
  }

  return true;
}

function matchesConfiguredUserHandle(
  config: LoadedLocalConfig,
  candidate?: string,
): boolean {
  const configured = config.crawl.userHandle?.trim().toLowerCase();
  if (!configured || !candidate) {
    return false;
  }

  return configured === candidate.trim().toLowerCase();
}

function normalizePathname(pathname: string): string {
  if (pathname === '/') {
    return pathname;
  }

  return pathname.replace(/\/+$/, '');
}

function normalizeAssetUrl(
  config: LoadedLocalConfig,
  base: URL,
  candidate?: string,
): string | null {
  if (!candidate || candidate.startsWith('data:') || candidate.startsWith('javascript:')) {
    return null;
  }

  const resolved = new URL(normalizeSiteRelativeCandidate(candidate), base);
  resolved.hash = '';
  const host = resolved.hostname.toLowerCase();
  if (config.mirror.blockedAssetHosts.includes(host)) {
    return null;
  }

  if (isBlockedAssetPath(resolved)) {
    return null;
  }

  if (resolved.origin === base.origin || config.mirror.externalAssetHosts.includes(host)) {
    return resolved.toString();
  }

  return null;
}

function isBlockedAssetPath(url: URL): boolean {
  const pathname = normalizePathname(url.pathname);
  if (pathname === '/php/gravatar.php') {
    return true;
  }

  if (pathname.startsWith('/resurse/ajutor/')) {
    return true;
  }

  if (/^\/resurse\/[^/]+\/articole\//.test(pathname)) {
    return true;
  }

  if (/^\/resurse\/[^/]+\/examene\//.test(pathname)) {
    return true;
  }

  return false;
}

function normalizeSiteRelativeCandidate(candidate: string): string {
  const trimmed = candidate.trim();
  if (/^(?:[a-z]+:|\/\/|\/)/i.test(trimmed)) {
    return trimmed;
  }

  return /^(?:resurse|img|php|descarca-fisier\.php)/i.test(trimmed)
    ? `/${trimmed}`
    : trimmed;
}

function inferPageKind(url: string): CrawlQueueInput['kind'] {
  const parsed = new URL(url);
  if (/^\/profil\/[^/]+/.test(parsed.pathname)) {
    return 'user-profile';
  }
  if (/^\/solutii\/user\/[^/]+/.test(parsed.pathname)) {
    return 'user-solutions';
  }
  if (/^\/detalii-evaluare\/\d+/.test(parsed.pathname)) {
    return 'evaluation-detail';
  }
  return 'public-page';
}

function inferTemplate(
  url: string,
  kind: CrawlQueueInput['kind'],
): MirrorRouteRecord['template'] {
  if (kind === 'evaluation-detail') {
    return 'evaluation';
  }
  if (kind === 'user-profile' || kind === 'user-solutions') {
    return 'user-profile';
  }
  if (/\/probleme\/\d+\//.test(new URL(url).pathname)) {
    return 'problem';
  }
  return 'raw-page';
}

function inferEntityKey(url: string, kind: CrawlQueueInput['kind']): string {
  const parsed = new URL(url);
  const problemMatch = parsed.pathname.match(/^\/probleme\/(\d+)\/([^/?#]+)/);
  if (problemMatch?.[1]) {
    return `problem:${problemMatch[1]}`;
  }
  const evaluationMatch = parsed.pathname.match(/^\/detalii-evaluare\/(\d+)/);
  if (evaluationMatch?.[1]) {
    return `evaluation:${evaluationMatch[1]}`;
  }
  const userMatch = parsed.pathname.match(/^\/(?:profil|solutii\/user)\/([^/?#]+)/);
  if (userMatch?.[1]) {
    return `user:${userMatch[1]}`;
  }
  return `${kind}:${parsed.pathname}`;
}

function createPlaceholderProblem(problemId: number, slug: string): ProblemRecord {
  return {
    id: problemId,
    slug,
    name: slug,
    canonicalUrl: `https://www.pbinfo.ro/probleme/${problemId}/${slug}`,
    categoryChain: [],
    tags: [],
    sections: [],
    examples: [],
    constraints: [],
    editorialAvailability: 'unknown',
    editorial: {
      availability: 'unknown',
    },
    officialSolutions: {},
    officialSourceIds: {},
    visibleTests: [],
    linkedAssets: [],
    metadata: {},
  };
}

function mergeLanguageSolutions(
  current: Record<string, string>,
  incoming: Record<string, string>,
): Record<string, string> {
  return {
    ...current,
    ...incoming,
  };
}

function normalizeSourceLanguage(language: string): string {
  const normalized = language.trim().toLowerCase();
  if (!normalized || normalized === 'unknown') {
    return 'unknown';
  }
  if (normalized.includes('c++') || normalized === 'cpp') {
    return 'cpp';
  }
  if (normalized === 'c') {
    return 'c';
  }
  if (normalized.includes('python') || normalized === 'py') {
    return 'py';
  }
  if (normalized.includes('pascal') || normalized === 'pas') {
    return 'pas';
  }
  if (normalized.includes('java')) {
    return 'java';
  }
  if (normalized.includes('c#') || normalized.includes('csharp')) {
    return 'csharp';
  }

  return sanitizeSegment(normalized).toLowerCase() || 'unknown';
}

function detectSuspicionFlags(sourceCode?: string): string[] {
  if (!sourceCode) {
    return [];
  }

  const flags = new Set<string>();
  const normalized = sourceCode.toLowerCase();
  if (normalized.length < 24) {
    flags.add('tiny-source');
  }

  const printsConstant =
    /(cout\s*<<\s*["'\d]|printf\s*\(\s*["'\d]|print\s*\(\s*["'\d])/.test(normalized);
  const readsInput = /(cin\s*>>|scanf\s*\(|input\s*\(|std::getline|getline\s*\()/i.test(sourceCode);
  if (printsConstant && !readsInput) {
    flags.add('constant-output');
  }

  return [...flags];
}

function readManifestValue(
  manifestPath: string,
  url: string,
): string | undefined {
  return loadManifest(manifestPath)[url];
}

function loadManifest(manifestPath: string): Record<string, string> {
  const cached = manifestCache.get(manifestPath);
  if (cached) {
    return cached;
  }

  const manifest = readManifestFile(manifestPath);
  manifestCache.set(manifestPath, manifest);
  return manifest;
}

function readManifestFile(manifestPath: string): Record<string, string> {
  if (!existsSync(manifestPath)) {
    return {};
  }

  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeManifestFile(manifestPath: string, manifest: Record<string, string>): void {
  mkdirSync(dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  manifestCache.set(manifestPath, manifest);
}

function shortHash(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 10);
}

function looksLikeHtml(contentType: string | null): boolean {
  return contentType?.toLowerCase().includes('html') ?? true;
}

function isTemporaryUnavailable(body: string): boolean {
  return /resurs[ăa]\s+indisponibil[ăa]\s+temporar/i.test(body)
    || /temporar\s+indisponibil/i.test(body);
}


