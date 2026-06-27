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
import { parseProblemSourceListPage } from '../pbinfo/parsers/problem-source-list.js';
import {
  parseUserSolutionsListPage,
  type UserSolutionListEntry,
} from '../pbinfo/parsers/user-solutions.js';
import { isOfficialSourceAuthorHandle } from '../pbinfo/official-source-authors.js';
import { buildSourceSignature } from '../ranking/source-normalization.js';
import { detectSuspicionFlags } from './source-suspicion.js';
import type { CrawlQueueInput } from '../types/crawl.js';
import type {
  EvaluationTestResult,
  EvaluationRecord,
  MirrorRouteRecord,
  PageRecord,
  ProblemExample,
  ProblemRecord,
  ProblemTestCaseRecord,
  ProblemTestsRecord,
  ProblemVisibleTest,
  SourceRecord,
} from '../types/records.js';
import { CrawlQueue } from './crawl-queue.js';
import type { BrowserCapture } from './browser-capture.js';

export interface ArchiveCrawlerOptions {
  config: LoadedLocalConfig;
  snapshot: SnapshotLayout;
  queue: CrawlQueue;
  scope?: 'public' | 'user' | 'all';
  retryDelayMs?: number;
  requestTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  browserCapture?: BrowserCapture;
}

const manifestCache = new Map<string, Record<string, string>>();
const manifestWriteLocks = new Map<string, Promise<void>>();

interface UserSolutionsRecord {
  user: string;
  sourceUrl: string;
  pageUrls: string[];
  httpStatus?: number;
  contentType?: string;
  totalMatches?: number;
  throttled: boolean;
  pageSize?: number;
  currentOffset?: number;
  nextPageUrls: string[];
  entries: UserSolutionListEntry[];
}

export class ArchiveCrawler {
  private readonly config: LoadedLocalConfig;
  private readonly snapshot: SnapshotLayout;
  private readonly queue: CrawlQueue;
  private readonly scope: 'public' | 'user' | 'all';
  private readonly retryDelayMs: number;
  private readonly requestTimeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly browserCapture?: BrowserCapture;

  constructor(options: ArchiveCrawlerOptions) {
    this.config = options.config;
    this.snapshot = options.snapshot;
    this.queue = options.queue;
    this.scope = options.scope ?? 'all';
    this.retryDelayMs = options.retryDelayMs ?? 60_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.browserCapture = options.browserCapture;
  }

  async processNext(now: Date): Promise<boolean> {
    const item = this.queue.claimNext(now);
    if (!item) {
      return false;
    }

    let response: Response;
    try {
      response = await fetchWithTimeout(
        this.fetchImpl,
        item.url,
        undefined,
        this.requestTimeoutMs,
      );
    } catch (error) {
      this.queue.fail(item.id, {
        errorMessage: error instanceof Error ? error.message : String(error),
        nextVisibleAt: new Date(now.getTime() + this.retryDelayMs).toISOString(),
      });
      return true;
    }
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
      const browserCapture = await this.captureBrowserHtml(item.url);
      const normalizedHtml = resolvePreferredNormalizedHtml(
        item.kind,
        item.url,
        body,
        browserCapture.html,
      );
      this.persistPageRecord({
        snapshotId: this.snapshot.snapshotId,
        url: item.url,
        kind: item.kind,
        httpStatus: response.status,
        contentType: contentType ?? undefined,
        contentHash,
        bodyPath: `raw-pages/${fileName}`,
        browserBodyPath: browserCapture.bodyPath,
        fetchedAt: now.toISOString(),
      });
      this.persistNormalizedHtml(
        item,
        normalizedHtml.html,
        response.status,
        contentType ?? undefined,
        normalizedHtml.source === 'browser',
      );

      const genericFollowUps = discoverFollowUps(
        this.config,
        this.scope,
        item.url,
        item.kind,
        body,
      );
      const normalizedFollowUps = discoverNormalizedFollowUps(
        this.config,
        this.snapshot,
        item.url,
        item.kind,
        body,
      );
      const followUps =
        item.kind === 'user-solutions'
          || item.kind === 'official-source-list'
          || (item.kind === 'public-page' && isProblemSourceListUrl(item.url))
          ? [...normalizedFollowUps, ...genericFollowUps]
          : [...genericFollowUps, ...normalizedFollowUps];
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

  private async captureBrowserHtml(url: string): Promise<{
    bodyPath?: string;
    html?: string;
  }> {
    if (!this.browserCapture) {
      return {};
    }

    try {
      const html = await this.browserCapture.captureHtml(url);
      const fileName = `browser-${buildPageFilename(url)}`;
      const root = join(this.snapshot.snapshotRoot, 'browser-pages');
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, fileName), html, 'utf8');
      return {
        bodyPath: `browser-pages/${fileName}`,
        html,
      };
    } catch {
      return {};
    }
  }

  private persistNormalizedHtml(
    item: CrawlQueueInput,
    html: string,
    httpStatus: number,
    contentType?: string,
    normalizedFromBrowser = false,
  ): void {
    persistNormalizedSnapshotHtml({
      config: this.config,
      snapshot: this.snapshot,
      item,
      html,
      httpStatus,
      contentType,
      fetchedAt: new Date().toISOString(),
      normalizedFromBrowser,
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
  normalizedFromBrowser?: boolean;
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  requestTimeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const signal = init?.signal
    ? AbortSignal.any([init.signal, controller.signal])
    : controller.signal;
  const timeout = setTimeout(() => {
    controller.abort(new Error(`request timed out after ${requestTimeoutMs}ms`));
  }, requestTimeoutMs);

  try {
    return await Promise.race([
      fetchImpl(input, {
        ...init,
        signal,
      }),
      new Promise<Response>((_, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            reject(
              signal.reason instanceof Error
                ? signal.reason
                : new Error(String(signal.reason ?? 'request aborted')),
            );
          },
          { once: true },
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
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
    persistProblemExamples(
      options.snapshot,
      problemId,
      linkedProblem.slug,
      linkedProblem.slug,
      fragment.examples,
    );
    return;
  }

  if (options.item.kind === 'problem-solution' && linkedProblem) {
    const problemId = linkedProblem.id;
    const solution = parseOfficialSolutionFragment(options.html);
    const sourceIds = persistOfficialSources(
      options.snapshot,
      problemId,
      solution.solutions,
      options.item.url,
      options.fetchedAt,
      options.normalizedFromBrowser ? 'browser-fallback' : 'official-fragment',
    );
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
        officialSourceIds: mergeLanguageSourceIds(current?.officialSourceIds, sourceIds),
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
    persistProblemVisibleTests(
      options.snapshot,
      problemId,
      linkedProblem.slug,
      linkedProblem.slug,
      fragment.visibleTests,
    );
    return;
  }

  const evaluationMatch = options.item.url.match(/\/detalii-evaluare\/(\d+)/);
  if (
    (options.item.kind === 'evaluation-detail'
      || options.item.kind === 'official-evaluation-detail')
    && evaluationMatch?.[1]
  ) {
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
      const sourceKind: SourceRecord['kind'] =
        options.item.kind === 'official-evaluation-detail'
          ? 'official'
          : 'user-evaluation';
      persistEvaluationSource(
        options.snapshot,
        evaluation,
        sourceKind,
        options.normalizedFromBrowser ? 'browser-fallback' : 'evaluation-detail',
      );
      persistEvaluationObservedTests(options.snapshot, evaluation);
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
  const userHandle = solutionsMatch?.[1];
  if (options.item.kind === 'user-solutions' && userHandle) {
    const record = parseUserSolutionsListPage(options.html, options.item.url);
    mergeJsonRecord<UserSolutionsRecord>(
      join(options.snapshot.normalizedRoot, 'user-solutions'),
      `user-${sanitizeSegment(userHandle).toLowerCase()}.json`,
      (current) => {
        const existingEntries = Array.isArray(current?.entries) ? current.entries : [];
        const nextEntries = dedupeUserSolutionEntries([
          ...existingEntries,
          ...record.entries,
        ]);
        const existingPageUrls = Array.isArray(current?.pageUrls) ? current.pageUrls : [];
        return {
          ...current,
          user: userHandle,
          sourceUrl: current?.sourceUrl ?? options.item.url,
          pageUrls: [...new Set([...existingPageUrls, options.item.url])].sort(),
          httpStatus: options.httpStatus,
          contentType: options.contentType,
          totalMatches: maxDefinedNumber(current?.totalMatches, record.totalMatches),
          throttled: Boolean(current?.throttled || record.throttled),
          pageSize: record.pageSize ?? current?.pageSize,
          currentOffset: record.currentOffset ?? current?.currentOffset,
          nextPageUrls: record.nextPageUrls,
          entries: nextEntries,
        };
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
  fetchedAt: string,
  provenanceType: SourceRecord['provenanceType'],
): Record<string, string[]> {
  const sourceIds: Record<string, string[]> = {};
  for (const [languageLabel, sourceCode] of Object.entries(solutions)) {
    const language = normalizeSourceLanguage(languageLabel);
    const sourceId = `official-${problemId}-${sanitizeSegment(language).toLowerCase()}`;
    const signature = buildSourceSignature(sourceCode, language);
    const sourceRecord: SourceRecord = {
      sourceId,
      kind: 'official',
      problemId,
      language,
      score: provenanceType === 'official-fragment' ? 0 : 100,
      sourceAvailable: Boolean(sourceCode),
      sourceCode,
      sourceHash: signature?.sourceHash,
      normalizedSourceHash: signature?.normalizedSourceHash,
      sourceLength: signature?.sourceLength,
      fetchedAt,
      provenanceType,
      suspicionFlags: detectSuspicionFlags(sourceCode),
      provenance: [sourceUrl],
    };
    writeJsonRecord(
      join(snapshot.normalizedRoot, 'sources'),
      `${sourceId}.json`,
      sourceRecord,
    );
    sourceIds[language] = [...new Set([...(sourceIds[language] ?? []), sourceId])].sort();
  }

  return sourceIds;
}

function persistEvaluationSource(
  snapshot: SnapshotLayout,
  evaluation: EvaluationRecord,
  kind: SourceRecord['kind'],
  provenanceType: SourceRecord['provenanceType'],
): void {
  if (!evaluation.sourceAvailable) {
    return;
  }

  const language = normalizeSourceLanguage(evaluation.language);
  const sourceId =
    kind === 'official'
      ? `official-${evaluation.problemId}-${sanitizeSegment(language).toLowerCase()}-${evaluation.evaluationId}`
      : `evaluation-${evaluation.evaluationId}`;
  const signature = buildSourceSignature(evaluation.sourceCode, language);
  const sourceRecord: SourceRecord = {
    sourceId,
    kind,
    problemId: evaluation.problemId,
    evaluationId: evaluation.evaluationId,
    userHandle: evaluation.user,
    language,
    score: evaluation.score,
    runtimeSeconds: evaluation.runtimeSeconds,
    memoryKb: evaluation.memoryKb,
    sourceAvailable: evaluation.sourceAvailable,
    sourceCode: evaluation.sourceCode,
    sourceHash: signature?.sourceHash,
    normalizedSourceHash: signature?.normalizedSourceHash,
    sourceLength: signature?.sourceLength,
    fetchedAt: evaluation.fetchedAt,
    provenanceType,
    suspicionFlags: evaluation.suspicionFlags,
    provenance: evaluation.provenance,
  };
  writeJsonRecord(
    join(snapshot.normalizedRoot, 'sources'),
    `${sourceId}.json`,
    sourceRecord,
  );
  mergeJsonRecord<ProblemRecord>(
    join(snapshot.normalizedRoot, 'problems'),
    `problem-${evaluation.problemId}.json`,
    (current) => {
      const currentIds =
        kind === 'official'
          ? current?.officialSourceIds ?? {}
          : current?.userSourceIds ?? {};
      const currentLanguageIds = currentIds[language] ?? [];
      return {
        ...(current ?? createPlaceholderProblem(evaluation.problemId, evaluation.problemSlug)),
        ...(kind === 'official'
          ? {
              officialSourceIds: {
                ...currentIds,
                [language]: [...new Set([...currentLanguageIds, sourceId])].sort(),
              },
            }
          : {
              userSourceIds: {
                ...currentIds,
                [language]: [...new Set([...currentLanguageIds, sourceId])].sort(),
              },
            }),
      };
    },
  );
}

function persistProblemExamples(
  snapshot: SnapshotLayout,
  problemId: number,
  problemSlug: string,
  fallbackProblemName: string,
  examples: ProblemExample[],
): void {
  const cases: ProblemTestCaseRecord[] = examples.map((example, index) => ({
    testId: `example-${index + 1}`,
    kind: 'example',
    label: `Example ${index + 1}`,
    input: example.input || undefined,
    output: example.output || undefined,
    explanation: example.explanation,
    index: index + 1,
  }));
  mergeJsonRecord<ProblemTestsRecord>(
    join(snapshot.normalizedRoot, 'tests'),
    `problem-${problemId}.json`,
    (current) =>
      withEffectiveProblemTests({
        ...(current ?? createEmptyProblemTestsRecord(snapshot.snapshotId, problemId, problemSlug, fallbackProblemName)),
        examples: cases,
        visible: current?.visible ?? [],
        evaluationObserved: current?.evaluationObserved ?? [],
      }),
  );
}

function persistProblemVisibleTests(
  snapshot: SnapshotLayout,
  problemId: number,
  problemSlug: string,
  fallbackProblemName: string,
  visibleTests: ProblemVisibleTest[],
): void {
  const cases: ProblemTestCaseRecord[] = visibleTests.map((test, index) => ({
    testId: `visible-${index + 1}`,
    kind: 'visible',
    label: test.title || `Visible test ${index + 1}`,
    input: test.input || undefined,
    output: test.output || undefined,
    index: index + 1,
    score: test.score,
    exampleLike: test.exampleLike,
  }));
  mergeJsonRecord<ProblemTestsRecord>(
    join(snapshot.normalizedRoot, 'tests'),
    `problem-${problemId}.json`,
    (current) =>
      withEffectiveProblemTests({
        ...(current ?? createEmptyProblemTestsRecord(snapshot.snapshotId, problemId, problemSlug, fallbackProblemName)),
        examples: current?.examples ?? [],
        visible: cases,
        evaluationObserved: current?.evaluationObserved ?? [],
      }),
  );
}

function persistEvaluationObservedTests(
  snapshot: SnapshotLayout,
  evaluation: EvaluationRecord,
): void {
  const cases: ProblemTestCaseRecord[] = evaluation.tests.map((test) =>
    toEvaluationObservedTestCase(evaluation.evaluationId, test),
  );
  mergeJsonRecord<ProblemTestsRecord>(
    join(snapshot.normalizedRoot, 'tests'),
    `problem-${evaluation.problemId}.json`,
    (current) => {
      const existing = current?.evaluationObserved ?? [];
      const byId = new Map<string, ProblemTestCaseRecord>();
      for (const entry of [...existing, ...cases]) {
        byId.set(entry.testId, entry);
      }
      return withEffectiveProblemTests({
        ...(current ?? createEmptyProblemTestsRecord(snapshot.snapshotId, evaluation.problemId, evaluation.problemSlug, evaluation.problemName)),
        examples: current?.examples ?? [],
        visible: current?.visible ?? [],
        evaluationObserved: [...byId.values()].sort(compareProblemTestCaseRecords),
      });
    },
  );
}

function toEvaluationObservedTestCase(
  evaluationId: number,
  test: EvaluationTestResult,
): ProblemTestCaseRecord {
  return {
    testId: `evaluation-${evaluationId}-test-${test.index}`,
    kind: 'evaluationObserved',
    label: test.details || `Evaluation test ${test.index}`,
    evaluationId,
    index: test.index,
    verdict: test.verdict,
    score: test.score,
    maxScore: test.maxScore,
    details: test.details,
    exampleLike: /exemplu/i.test(test.details),
  };
}

function compareProblemTestCaseRecords(
  left: ProblemTestCaseRecord,
  right: ProblemTestCaseRecord,
): number {
  const leftEvaluation = left.evaluationId ?? Number.MIN_SAFE_INTEGER;
  const rightEvaluation = right.evaluationId ?? Number.MIN_SAFE_INTEGER;
  if (leftEvaluation !== rightEvaluation) {
    return rightEvaluation - leftEvaluation;
  }

  const leftIndex = left.index ?? 0;
  const rightIndex = right.index ?? 0;
  if (leftIndex !== rightIndex) {
    return leftIndex - rightIndex;
  }

  return left.testId.localeCompare(right.testId);
}

function withEffectiveProblemTests(
  record: ProblemTestsRecord,
): ProblemTestsRecord {
  return {
    ...record,
    effective: deriveEffectiveProblemTests(record),
  };
}

function deriveEffectiveProblemTests(
  record: Pick<ProblemTestsRecord, 'examples' | 'visible' | 'evaluationObserved'>,
): ProblemTestCaseRecord[] {
  const effectiveByKey = new Map<string, ProblemTestCaseRecord>();

  for (const testCase of [...record.examples, ...record.visible, ...record.evaluationObserved]) {
    const effectiveKey = buildEffectiveProblemTestKey(testCase);
    if (!effectiveKey) {
      continue;
    }

    const current = effectiveByKey.get(effectiveKey);
    const provenanceKinds = [...new Set([
      ...(current?.provenanceKinds ?? []),
      ...(testCase.provenanceKinds ?? [testCase.kind]),
    ])].sort(compareProvenanceKinds);
    const sourceTestIds = [...new Set([
      ...(current?.sourceTestIds ?? (current ? [current.testId] : [])),
      ...(testCase.sourceTestIds ?? [testCase.testId]),
    ])].sort();

    effectiveByKey.set(effectiveKey, {
      ...(current ?? testCase),
      input: normalizeTestIo(testCase.input),
      output: normalizeTestIo(testCase.output),
      kind: provenanceKinds.includes('example')
        ? 'example'
        : provenanceKinds.includes('visible')
          ? 'visible'
          : 'evaluationObserved',
      exampleLike:
        Boolean(current?.exampleLike)
        || Boolean(testCase.exampleLike)
        || provenanceKinds.includes('example'),
      provenanceKinds,
      sourceTestIds,
    });
  }

  return [...effectiveByKey.values()].sort(compareProblemTestCaseRecords);
}

function buildEffectiveProblemTestKey(
  testCase: ProblemTestCaseRecord,
): string | undefined {
  const input = normalizeTestIo(testCase.input);
  const output = normalizeTestIo(testCase.output);
  if (!input && !output) {
    return undefined;
  }
  return `${input ?? ''}::${output ?? ''}`;
}

function normalizeTestIo(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]+/g, ' ');
}

function compareProvenanceKinds(
  left: ProblemTestCaseRecord['kind'],
  right: ProblemTestCaseRecord['kind'],
): number {
  const order: Array<ProblemTestCaseRecord['kind']> = [
    'example',
    'visible',
    'evaluationObserved',
  ];
  return order.indexOf(left) - order.indexOf(right);
}

function createEmptyProblemTestsRecord(
  snapshotId: string,
  problemId: number,
  problemSlug: string,
  problemName: string,
): ProblemTestsRecord {
  return {
    snapshotId,
    problemId,
    problemSlug,
    problemName,
    examples: [],
    visible: [],
    evaluationObserved: [],
    effective: [],
  };
}

function resolvePreferredNormalizedHtml(
  kind: CrawlQueueInput['kind'],
  sourceUrl: string,
  httpHtml: string,
  browserHtml?: string,
): {
  html: string;
  source: 'http' | 'browser';
} {
  if (!browserHtml) {
    return { html: httpHtml, source: 'http' };
  }

  try {
    if (kind === 'problem-solution') {
      const httpSolutions = Object.keys(parseOfficialSolutionFragment(httpHtml).solutions).length;
      const browserSolutions = Object.keys(parseOfficialSolutionFragment(browserHtml).solutions).length;
      return browserSolutions > httpSolutions
        ? { html: browserHtml, source: 'browser' }
        : { html: httpHtml, source: 'http' };
    }

    if (kind === 'problem-tests') {
      const httpTests = parseProblemEndpointFragment(httpHtml).visibleTests.length;
      const browserTests = parseProblemEndpointFragment(browserHtml).visibleTests.length;
      return browserTests > httpTests
        ? { html: browserHtml, source: 'browser' }
        : { html: httpHtml, source: 'http' };
    }

    if (kind === 'evaluation-detail' || kind === 'official-evaluation-detail') {
      const evaluationId = Number(sourceUrl.match(/\/detalii-evaluare\/(\d+)/)?.[1]);
      if (!Number.isFinite(evaluationId)) {
        return { html: httpHtml, source: 'http' };
      }

      const httpParsed = parseEvaluationPage(httpHtml, evaluationId);
      const browserParsed = parseEvaluationPage(browserHtml, evaluationId);
      return browserParsed.sourceAvailable && !httpParsed.sourceAvailable
        ? { html: browserHtml, source: 'browser' }
        : { html: httpHtml, source: 'http' };
    }

  } catch {
    return { html: browserHtml, source: 'browser' };
  }

  return { html: httpHtml, source: 'http' };
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
  crawlScope: 'public' | 'user' | 'all',
  baseUrl: string,
  kind: CrawlQueueInput['kind'],
  html: string,
): CrawlQueueInput[] {
  const document = load(html);
  const base = new URL(baseUrl);
  const queued = new Map<string, CrawlQueueInput>();
  const suppressGenericPageNavigation = shouldSuppressGenericPageNavigation(
    crawlScope,
    kind,
    baseUrl,
  );
  const suppressGenericAssetDiscovery = shouldSuppressGenericAssetDiscovery(kind);

  if (!suppressGenericPageNavigation) {
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
  }

  if (!suppressGenericAssetDiscovery) {
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
  }

  const problemMatch = base.pathname.match(/^\/probleme\/(\d+)\/([^/?#]+)/);
  if (problemMatch?.[1] && problemMatch[2]) {
    const problemId = Number(problemMatch[1]);
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
    problemUrl.hash = '';
  }

  return [...queued.values()];
}

function shouldSuppressGenericPageNavigation(
  crawlScope: 'public' | 'user' | 'all',
  kind: CrawlQueueInput['kind'],
  baseUrl: string,
): boolean {
  return (
    (crawlScope === 'user' && kind === 'public-page')
    || (crawlScope === 'user' && kind === 'user-profile')
    || kind === 'user-solutions'
    || kind === 'evaluation-detail'
    || kind === 'official-evaluation-detail'
    || kind === 'official-source-list'
    || (kind === 'public-page' && isProblemSourceListUrl(baseUrl))
  );
}

function shouldSuppressGenericAssetDiscovery(kind: CrawlQueueInput['kind']): boolean {
  return (
    kind === 'user-solutions'
    || kind === 'evaluation-detail'
    || kind === 'official-evaluation-detail'
    || kind === 'official-source-list'
  );
}

function discoverNormalizedFollowUps(
  config: LoadedLocalConfig,
  snapshot: SnapshotLayout,
  baseUrl: string,
  kind: CrawlQueueInput['kind'],
  html: string,
): CrawlQueueInput[] {
  if (kind !== 'user-solutions' && kind !== 'official-source-list') {
    return [];
  }

  const queued = new Map<string, CrawlQueueInput>();

  if (kind === 'user-solutions') {
    const parsed = parseUserSolutionsListPage(html, baseUrl);
    const baseMatch = new URL(baseUrl).pathname.match(/^\/solutii\/user\/([^/?#]+)/);
    if (!matchesConfiguredUserHandle(config, baseMatch?.[1])) {
      return [];
    }

    for (const entry of parsed.entries) {
      if (!matchesConfiguredUserHandle(config, entry.user)) {
        continue;
      }

      const problemPageUrl = new URL(
        `/probleme/${entry.problemId}/${entry.problemSlug}`,
        baseUrl,
      ).toString();
      queued.set(`page:${problemPageUrl}`, {
        key: `page:${problemPageUrl}`,
        url: problemPageUrl,
        kind: 'public-page',
      });

      queued.set(`evaluation:${entry.evaluationId}`, {
        key: `evaluation:${entry.evaluationId}`,
        url: new URL(`/detalii-evaluare/${entry.evaluationId}`, baseUrl).toString(),
        kind: 'evaluation-detail',
      });
    }

    for (const nextPageUrl of parsed.nextPageUrls) {
      queued.set(`page:${nextPageUrl}`, {
        key: `page:${nextPageUrl}`,
        url: nextPageUrl,
        kind: 'user-solutions',
      });
    }

    return [...queued.values()];
  }

  if (kind === 'official-source-list') {
    const parsed = parseProblemSourceListPage(html, baseUrl);
    const communitySourceListMatch = new URL(baseUrl).pathname.match(/^\/solutii\/problema\/(\d+)\/([^/?#]+)/);
    if (communitySourceListMatch?.[1] && communitySourceListMatch[2]) {
      if (!parsed.authorHandle) {
        return [];
      }

      const authorScopedUrl = new URL(
        `/solutii/user/${parsed.authorHandle}/problema/${communitySourceListMatch[1]}/${communitySourceListMatch[2]}`,
        baseUrl,
      ).toString();
      const authorScopedKind = isOfficialSourceAuthorHandle(parsed.authorHandle)
        ? 'official-source-list'
        : 'user-solutions';
      const authorScopedKeyPrefix = authorScopedKind === 'official-source-list'
        ? 'official-source-list'
        : 'page';
      queued.set(`${authorScopedKeyPrefix}:${authorScopedUrl}`, {
        key: `${authorScopedKeyPrefix}:${authorScopedUrl}`,
        url: authorScopedUrl,
        kind: authorScopedKind,
      });
      return [...queued.values()];
    }

    persistOfficialSourceHarvest(
      snapshot,
      baseUrl,
      parsed.authorHandle,
      parsed.entries
        .filter((entry) => typeof entry.score !== 'number' || entry.score >= 100)
        .map((entry) => entry.evaluationId),
    );

    for (const entry of parsed.entries) {
      if (typeof entry.score === 'number' && entry.score < 100) {
        continue;
      }

      queued.set(`official-evaluation:${entry.evaluationId}`, {
        key: `official-evaluation:${entry.evaluationId}`,
        url: new URL(`/detalii-evaluare/${entry.evaluationId}`, baseUrl).toString(),
        kind: 'official-evaluation-detail',
      });
    }

    for (const nextPageUrl of parsed.nextPageUrls) {
      queued.set(`official-source-list:${nextPageUrl}`, {
        key: `official-source-list:${nextPageUrl}`,
        url: nextPageUrl,
        kind: 'official-source-list',
      });
    }

    return [...queued.values()];
  }

  return [];
}

function persistOfficialSourceHarvest(
  snapshot: SnapshotLayout,
  sourceListUrl: string,
  authorHandle: string | undefined,
  qualifyingEvaluationIds: number[],
): void {
  const authorScopedMatch = new URL(sourceListUrl).pathname.match(
    /^\/solutii\/user\/([^/?#]+)\/problema\/(\d+)\/([^/?#]+)/,
  );
  if (!authorScopedMatch?.[2] || !authorScopedMatch[3]) {
    return;
  }

  const problemId = Number(authorScopedMatch[2]);
  const slug = authorScopedMatch[3];
  mergeJsonRecord<ProblemRecord>(
    join(snapshot.normalizedRoot, 'problems'),
    `problem-${problemId}.json`,
    (current) => ({
      ...(current ?? createPlaceholderProblem(problemId, slug)),
      officialSourceHarvest: {
        sourceListHarvested: true,
        sourceListPageUrl: sourceListUrl,
        authorHandle: authorHandle ?? authorScopedMatch[1],
        qualifyingEvaluationIds: [...new Set(qualifyingEvaluationIds)].sort((left, right) => left - right),
      },
    }),
  );
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
  // oxlint-disable-next-line unicorn/no-useless-spread -- snapshot keys before delete() mutates the live URLSearchParams iterator below
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
  if (isProblemSourceListUrl(url.toString())) {
    return false;
  }
  if (
    pathname.startsWith('/articole')
    || pathname.startsWith('/ajutor')
    || pathname.startsWith('/clasa-mea')
    || pathname.startsWith('/editare-cont')
    || pathname === '/logout.php'
    || pathname.startsWith('/resurse')
    || pathname.startsWith('/solutii/clasa')
    || pathname.startsWith('/teme/rezolvare')
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

  const normalized = candidate.trim().toLowerCase();
  if (configured === normalized) {
    return true;
  }

  const handleMatch = normalized.match(/\(([^)]+)\)\s*$/);
  if (handleMatch?.[1]) {
    return configured === handleMatch[1].trim().toLowerCase();
  }

  return false;
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
  if (/^\/solutii\/problema\/\d+\/[^/]+/.test(parsed.pathname)) {
    return 'official-source-list';
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
  if (kind === 'evaluation-detail' || kind === 'official-evaluation-detail') {
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

function mergeLanguageSourceIds(
  current: Record<string, string[]> | undefined,
  incoming: Record<string, string[]>,
): Record<string, string[]> {
  const merged: Record<string, string[]> = {};
  for (const language of new Set([
    ...Object.keys(current ?? {}),
    ...Object.keys(incoming),
  ])) {
    merged[language] = [...new Set([
      ...((current ?? {})[language] ?? []),
      ...(incoming[language] ?? []),
    ])].sort();
  }
  return merged;
}

function isProblemSourceListUrl(url: string): boolean {
  return /^\/solutii\/problema\/\d+\/[^/?#]+/i.test(new URL(url).pathname);
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

function dedupeUserSolutionEntries<T extends { evaluationId?: number }>(
  entries: T[],
): T[] {
  const byEvaluationId = new Map<number, T>();
  for (const entry of entries) {
    if (typeof entry.evaluationId !== 'number') {
      continue;
    }
    if (!byEvaluationId.has(entry.evaluationId)) {
      byEvaluationId.set(entry.evaluationId, entry);
    }
  }

  return [...byEvaluationId.values()].sort((left, right) =>
    (right.evaluationId ?? 0) - (left.evaluationId ?? 0),
  );
}

function maxDefinedNumber(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) {
    return right;
  }
  if (right === undefined) {
    return left;
  }
  return Math.max(left, right);
}

export { detectSuspicionFlags } from './source-suspicion.js';

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


