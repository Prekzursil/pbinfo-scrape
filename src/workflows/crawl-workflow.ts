import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  assertSnapshotRecord,
  buildQueuePath,
  markSnapshotCompleted,
  prepareSnapshot,
  readArchiveCatalog,
  resolveSnapshotLayout,
} from '../archive/storage.js';
import { createCookieFetch } from '../auth/session-store.js';
import {
  matchesConfiguredHandle,
  probePbinfoAuthStatus,
  type PbinfoAuthStatusResult,
} from '../auth/auth-status.js';
import { loadLocalConfig } from '../config/local-config.js';
import { CrawlQueue, readCrawlQueueSnapshot } from '../crawl/crawl-queue.js';
import { ArchiveCrawler } from '../crawl/archive-crawler.js';
import { createPlaywrightBrowserCapture } from '../crawl/browser-capture.js';
import type { CrawlQueueInput } from '../types/crawl.js';

export type CrawlMode = 'incremental' | 'fresh';

export interface CrawlWorkflowOptions {
  maxIterations?: number;
  now?: Date;
  snapshotId?: string;
  checkpoint?: 'canonical' | 'checkpoint';
  mode?: CrawlMode;
  authStatusProbe?: (config: ReturnType<typeof loadLocalConfig>) => Promise<PbinfoAuthStatusResult>;
}

export interface CrawlWorkflowResult {
  processed: number;
  queuePath: string;
  snapshotId: string;
  completed: boolean;
}

export interface OfficialSourceHarvestOptions extends CrawlWorkflowOptions {}

export interface CrawlFailureSummary {
  id: number;
  url: string;
  attemptCount: number;
  lastError: string;
  visibleAt?: string;
}

export interface CrawlStatusResult {
  snapshotId: string;
  queuePath: string;
  pending: number;
  completed: number;
  inProgress: number;
  publishEligible: boolean;
  recentFailures: CrawlFailureSummary[];
}

export async function runCrawlWorkflow(
  workspaceRoot: string,
  scope: 'public' | 'user' | 'all',
  options: CrawlWorkflowOptions = {},
): Promise<CrawlWorkflowResult> {
  const config = loadLocalConfig(workspaceRoot);
  await enforceAuthPreflight(scope, config, options.authStatusProbe);
  return runSeededCrawlWorkflow(workspaceRoot, config, scope, buildSeeds(config, scope), options);
}

export async function runOfficialSourceHarvestWorkflow(
  workspaceRoot: string,
  options: OfficialSourceHarvestOptions = {},
): Promise<CrawlWorkflowResult> {
  const config = loadLocalConfig(workspaceRoot);
  await enforceAuthPreflight('all', config, options.authStatusProbe);
  const catalog = readArchiveCatalog(config.paths.archiveRoot);
  const snapshotId =
    options.snapshotId
    ?? resolveIncrementalSnapshotId(catalog, undefined);
  if (!snapshotId) {
    throw new Error('No snapshot is available for targeted official-source harvest.');
  }

  const seeds = buildOfficialSourceSeeds(config, snapshotId);
  if (seeds.length === 0) {
    throw new Error(
      `No problem source-list URLs were found in snapshot ${snapshotId}; targeted official-source harvest cannot start yet.`,
    );
  }
  return runSeededCrawlWorkflow(workspaceRoot, config, 'all', seeds, {
    ...options,
    snapshotId,
    mode: 'incremental',
  });
}

async function runSeededCrawlWorkflow(
  workspaceRoot: string,
  config: ReturnType<typeof loadLocalConfig>,
  scope: 'public' | 'user' | 'all',
  seeds: CrawlQueueInput[],
  options: CrawlWorkflowOptions = {},
): Promise<CrawlWorkflowResult> {
  const now = options.now ?? new Date();
  const catalog = readArchiveCatalog(config.paths.archiveRoot);
  const resolvedSnapshotId =
    options.mode === 'incremental'
      ? resolveIncrementalSnapshotId(catalog, options.snapshotId)
      : options.snapshotId;
  const snapshot = prepareSnapshot(config, {
    now,
    snapshotId: resolvedSnapshotId,
    scope,
    checkpoint: options.checkpoint,
  });
  const queuePath = buildQueuePath(config.paths.localRoot, snapshot.snapshotId);
  mkdirSync(dirname(queuePath), { recursive: true });
  const queue = new CrawlQueue(queuePath);
  queue.requeueInProgress();
  queue.enqueueMany(seeds);
  const fetchImpl =
    config.auth.strategy !== 'none' || config.auth.sessionCookiesPath
      ? await createCookieFetch(config.auth.sessionCookiesPath)
      : fetch;
  let browserCapture:
    | Awaited<ReturnType<typeof createPlaywrightBrowserCapture>>
    | undefined;
  if (config.crawl.crossCheckWithBrowser) {
    try {
      browserCapture = await createPlaywrightBrowserCapture(
        config.auth.sessionCookiesPath,
      );
    } catch {
      browserCapture = undefined;
    }
  }

  const crawler = new ArchiveCrawler({
    config,
    snapshot,
    queue,
    scope,
    fetchImpl: createRateLimitedFetch(fetchImpl),
    browserCapture,
    retryDelayMs: config.crawl.retryDelayMs,
    requestTimeoutMs: config.crawl.requestTimeoutMs,
  });

  const maxIterations = options.maxIterations ?? Number.POSITIVE_INFINITY;
  let processed = 0;
  let remainingBudget = maxIterations;
  const concurrency = Math.max(
    1,
    Number.isFinite(maxIterations)
      ? Math.min(config.crawl.maxConcurrency, maxIterations)
      : config.crawl.maxConcurrency,
  );

  try {
    await Promise.all(
      Array.from({ length: concurrency }, async () => {
        while (consumeBudget()) {
          const didProcess = await crawler.processNext(new Date());
          if (!didProcess) {
            restoreBudget();
            return;
          }
          processed += 1;
        }
      }),
    );
  } finally {
    await browserCapture?.close();
    queue.close();
  }

  const queueState = queue.getSnapshot();
  const completed = queueState.pending === 0 && queueState.inProgress === 0;
  if (completed) {
    markSnapshotCompleted(config, snapshot.snapshotId);
  }

  return {
    processed,
    queuePath,
    snapshotId: snapshot.snapshotId,
    completed,
  };

  function consumeBudget(): boolean {
    if (remainingBudget <= 0) {
      return false;
    }

    remainingBudget -= 1;
    return true;
  }

  function restoreBudget(): void {
    if (Number.isFinite(maxIterations)) {
      remainingBudget += 1;
    }
  }
}

async function enforceAuthPreflight(
  scope: 'public' | 'user' | 'all',
  config: ReturnType<typeof loadLocalConfig>,
  customProbe?: (config: ReturnType<typeof loadLocalConfig>) => Promise<PbinfoAuthStatusResult>,
): Promise<void> {
  if (scope === 'public') {
    return;
  }

  const configuredHandle = config.crawl.userHandle?.trim();
  if (!configuredHandle) {
    throw new Error(
      `Authenticated crawl scope "${scope}" requires crawl.userHandle in .local/pbinfo.local.json.`,
    );
  }

  const authStatus = customProbe
    ? await customProbe(config)
    : await probePbinfoAuthStatus(config);

  if (!authStatus.loggedIn || authStatus.status === 'cookie-missing' || authStatus.status === 'guest') {
    throw new Error(
      [
        `Authenticated crawl preflight failed: PBInfo session is not logged in (status=${authStatus.status}).`,
        ...authStatus.remediation,
      ].join(' '),
    );
  }

  if (!matchesConfiguredHandle(configuredHandle, authStatus.resolvedHandle)) {
    throw new Error(
      [
        `Authenticated crawl preflight failed: configured handle "${configuredHandle}" does not match active session "${authStatus.resolvedHandle ?? 'unknown'}".`,
        ...authStatus.remediation,
      ].join(' '),
    );
  }
}

export async function resumeCrawlWorkflow(
  workspaceRoot: string,
  options: CrawlWorkflowOptions = {},
): Promise<CrawlWorkflowResult> {
  const config = loadLocalConfig(workspaceRoot);
  const catalog = readArchiveCatalog(config.paths.archiveRoot);
  const snapshot = options.snapshotId
    ? assertSnapshotRecord(catalog, options.snapshotId)
    : findLatestInProgressSnapshot(catalog);

  if (!snapshot) {
    throw new Error('No unfinished snapshot is available to resume.');
  }

  return runCrawlWorkflow(workspaceRoot, snapshot.scope, {
    ...options,
    snapshotId: snapshot.snapshotId,
    checkpoint: snapshot.checkpoint,
    mode: 'incremental',
  });
}

export function getCrawlStatusWorkflow(
  workspaceRoot: string,
  snapshotId?: string,
): CrawlStatusResult {
  const config = loadLocalConfig(workspaceRoot);
  const catalog = readArchiveCatalog(config.paths.archiveRoot);
  const resolvedSnapshotId = snapshotId ?? catalog.currentSnapshotId;
  if (!resolvedSnapshotId) {
    throw new Error('No archived snapshot is available.');
  }

  const snapshotRecord = assertSnapshotRecord(catalog, resolvedSnapshotId);
  const queuePath = buildQueuePath(config.paths.localRoot, resolvedSnapshotId);
  const queueState = readCrawlQueueSnapshot(queuePath);
  const recentFailures = queueState.items
    .filter((item) => item.lastError)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 5)
    .map((item) => ({
      id: item.id,
      url: item.url,
      attemptCount: item.attemptCount,
      lastError: item.lastError!,
      visibleAt: item.visibleAt,
    }));

  return {
    snapshotId: resolvedSnapshotId,
    queuePath,
    pending: queueState.pending,
    completed: queueState.completed,
    inProgress: queueState.inProgress,
    publishEligible:
      queueState.pending === 0 &&
      queueState.inProgress === 0 &&
      snapshotRecord.status === 'completed',
    recentFailures,
  };
}

function buildSeeds(
  config: ReturnType<typeof loadLocalConfig>,
  scope: 'public' | 'user' | 'all',
): CrawlQueueInput[] {
  const queue = new Map<string, CrawlQueueInput>();

  if (scope === 'public' || scope === 'all') {
    for (const url of config.crawl.publicStartUrls) {
      const key = `page:${url}`;
      queue.set(key, {
        key,
        url,
        kind: 'public-page',
      });
    }
  }

  if ((scope === 'user' || scope === 'all') && config.crawl.userHandle) {
    const roots = scope === 'user'
      ? [
          `https://www.pbinfo.ro/solutii/user/${config.crawl.userHandle}`,
        ]
      : [
          `https://www.pbinfo.ro/profil/${config.crawl.userHandle}`,
          `https://www.pbinfo.ro/profil/${config.crawl.userHandle}/probleme`,
          `https://www.pbinfo.ro/solutii/user/${config.crawl.userHandle}`,
        ];
    for (const url of roots) {
      const key = `page:${url}`;
      queue.set(key, {
        key,
        url,
        kind: url.includes('/solutii/') ? 'user-solutions' : 'user-profile',
      });
    }
  }

  return [...queue.values()];
}

function buildOfficialSourceSeeds(
  config: ReturnType<typeof loadLocalConfig>,
  snapshotId: string,
): CrawlQueueInput[] {
  const snapshot = resolveSnapshotLayout(config, snapshotId);
  const problemsRoot = `${snapshot.normalizedRoot}/problems`;
  const problemFiles = readJsonDirectory<{
    id?: number;
    slug?: string;
    sourceListUrl?: string;
    metadata?: Record<string, unknown>;
  }>(problemsRoot);
  const queue = new Map<string, CrawlQueueInput>();
  for (const problem of problemFiles) {
    const sourceListUrl = problem.sourceListUrl?.trim();
    if (!sourceListUrl) {
      continue;
    }
    const authorHandle = extractOfficialAuthorHandle(problem.metadata);
    const targetUrl =
      authorHandle && Number.isFinite(problem.id) && problem.slug
        ? buildAuthorScopedOfficialSourceUrl(sourceListUrl, authorHandle)
        : sourceListUrl;
    const key = `official-source-list:${targetUrl}`;
    queue.set(key, {
      key,
      url: targetUrl,
      kind: 'official-source-list',
    });
  }
  return [...queue.values()];
}

function buildAuthorScopedOfficialSourceUrl(sourceListUrl: string, authorHandle: string): string {
  const sourceList = new URL(sourceListUrl);
  const match = sourceList.pathname.match(/^\/solutii\/problema\/(\d+)\/([^/?#]+)$/);
  if (!match?.[1] || !match[2]) {
    return sourceListUrl;
  }

  return new URL(
    `/solutii/user/${authorHandle}/problema/${match[1]}/${match[2]}`,
    sourceList,
  ).toString();
}

function extractOfficialAuthorHandle(metadata?: Record<string, unknown>): string | undefined {
  const summaryText = typeof metadata?.['postată de'] === 'string'
    ? metadata['postată de']
    : typeof metadata?.['postata de'] === 'string'
      ? metadata['postata de']
      : undefined;
  const match = summaryText?.match(/\(([^()]+)\)\s*$/);
  const summaryHandle = normalizeHandleCandidate(match?.[1]);
  if (summaryHandle) {
    return summaryHandle;
  }

  return normalizeHandleCandidate(metadata?.authorHandle);
}

function normalizeHandleCandidate(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}
function findLatestInProgressSnapshot(
  catalog: ReturnType<typeof readArchiveCatalog>,
) {
  const current = catalog.currentSnapshotId
    ? catalog.snapshots.find((snapshot) => snapshot.snapshotId === catalog.currentSnapshotId)
    : undefined;
  if (current?.status === 'in_progress') {
    return current;
  }

  return [...catalog.snapshots]
    .filter((snapshot) => snapshot.status === 'in_progress')
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

function resolveIncrementalSnapshotId(
  catalog: ReturnType<typeof readArchiveCatalog>,
  requestedSnapshotId?: string,
): string | undefined {
  if (requestedSnapshotId) {
    return requestedSnapshotId;
  }

  if (catalog.canonicalSnapshotId) {
    return catalog.canonicalSnapshotId;
  }

  if (catalog.currentSnapshotId) {
    return catalog.currentSnapshotId;
  }

  return undefined;
}

function readJsonDirectory<T>(directoryPath: string): T[] {
  try {
    return readdirSync(directoryPath)
      .filter((entry) => entry.endsWith('.json'))
      .map((entry) =>
        JSON.parse(readFileSync(join(directoryPath, entry), 'utf8')) as T,
      );
  } catch {
    return [];
  }
}

function createRateLimitedFetch(
  fetchImpl: typeof fetch,
  minimumDelayMs = 250,
): typeof fetch {
  let nextAvailableAt = 0;
  let queue = Promise.resolve();

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const target = resolveFetchUrl(input);
    if (!target || !isPbinfoHost(target)) {
      return fetchImpl(input, init);
    }

    await (queue = queue.then(async () => {
      const waitFor = nextAvailableAt - Date.now();
      if (waitFor > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitFor));
      }
      nextAvailableAt = Date.now() + minimumDelayMs;
    }));

    return fetchImpl(input, init);
  }) as typeof fetch;
}

function resolveFetchUrl(input: RequestInfo | URL): URL | undefined {
  if (input instanceof URL) {
    return input;
  }

  if (typeof input === 'string') {
    return new URL(input);
  }

  if ('url' in input && typeof input.url === 'string') {
    return new URL(input.url);
  }

  return undefined;
}

function isPbinfoHost(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  return host === 'www.pbinfo.ro' || host === 'pbinfo.ro';
}
