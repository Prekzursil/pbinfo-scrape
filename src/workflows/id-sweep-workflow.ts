import { createCookieFetch } from '../auth/session-store.js';
import { loadLocalConfig } from '../config/local-config.js';
import { resolveSnapshotLayout } from '../archive/storage.js';
import {
  buildProblemIdProbeUrl,
  buildIdSweepIndex,
  detectProblemIdCeiling,
  parseProblemIdProbeResponse,
  readIdSweepRecord,
  recordIdSweepProbe,
  writeIdSweepIndex,
} from '../crawl/problem-id-sweep.js';
import { fetchWithTimeout } from '../crawl/archive-crawler.js';
import type { CrawlQueueInput } from '../types/crawl.js';
import type { ProblemIdSweepRecord } from '../types/records.js';
import {
  createRateLimitedFetch,
  runSeededCrawlWorkflow,
  type CrawlWorkflowOptions,
  type CrawlWorkflowResult,
} from './crawl-workflow.js';

export interface ProblemIdSweepWorkflowOptions extends CrawlWorkflowOptions {
  minId?: number;
  /** Explicit ceiling override; when omitted the ceiling is auto-detected. */
  maxId?: number;
  deadStreakThreshold?: number;
  /** Injectable fetch for tests; probes must honor `redirect: 'manual'`. */
  fetchImpl?: typeof fetch;
}

export interface ProblemIdSweepWorkflowResult extends CrawlWorkflowResult {
  ceiling: number;
  probed: number;
  skippedAlreadyProbed: number;
  liveCount: number;
  deadCount: number;
  cookieShellCount: number;
}

/**
 * Full-ID sweep: enumerate `/probleme/{id}` for every ID up to an
 * auto-detected ceiling (or an explicit `maxId`), classify each ID as
 * live / dead / cookie-shell, and capture every live problem regardless of
 * category — so problems that are hidden from, or miscategorized out of,
 * the category-driven link crawl cannot be missed.
 *
 * The probe phase is public (the live/dead redirect is issued before the
 * JS challenge middleware), but detail-tab capture of gated content needs
 * the pre-authenticated session jar from `auth.sessionCookiesPath`
 * (config or `PBINFO_SESSION_COOKIES_PATH`).
 */
export async function runProblemIdSweepWorkflow(
  workspaceRoot: string,
  options: ProblemIdSweepWorkflowOptions = {},
): Promise<ProblemIdSweepWorkflowResult> {
  const config = loadLocalConfig(workspaceRoot);
  const minId = Math.max(1, options.minId ?? config.crawl.idSweep.minId);
  const maxId = options.maxId ?? config.crawl.idSweep.maxId;
  const deadStreakThreshold =
    options.deadStreakThreshold ?? config.crawl.idSweep.deadStreakThreshold;
  const requestTimeoutMs = config.crawl.requestTimeoutMs;
  // Tests inject their own fetch; live runs probe and capture through the
  // cookie-aware fetch built from the session jar.
  let baseFetch = options.fetchImpl;
  if (!baseFetch) {
    baseFetch = await createCookieFetch(config.auth.sessionCookiesPath);
  }
  const probeFetch = createRateLimitedFetch(baseFetch);
  const now = options.now ?? new Date();

  const sweepStats = {
    ceiling: 0,
    probed: 0,
    skippedAlreadyProbed: 0,
    liveCount: 0,
    deadCount: 0,
    cookieShellCount: 0,
  };
  const probedRecords: ProblemIdSweepRecord[] = [];

  const result = await runSeededCrawlWorkflow(workspaceRoot, config, 'public', [], {
    ...options,
    snapshotId: options.snapshotId,
    mode: options.mode ?? 'incremental',
    fetchImpl: baseFetch,
    prepareSeeds: async ({ queue, snapshot }) => {
      const liveProbe = async (problemId: number): Promise<boolean> => {
        const response = await fetchWithTimeout(
          probeFetch,
          buildProblemIdProbeUrl(problemId),
          { redirect: 'manual' },
          requestTimeoutMs,
        );
        return parseProblemIdProbeResponse(
          problemId,
          response.status,
          response.headers.get('location'),
        ).probe === 'live';
      };

      const ceiling = maxId ?? (await detectProblemIdCeiling(liveProbe, {
        startId: minId,
        deadStreakThreshold,
      })).ceiling;
      sweepStats.ceiling = ceiling;

      if (ceiling < minId) {
        writeIdSweepIndex(
          snapshot,
          buildIdSweepIndex(snapshot.snapshotId, [], ceiling, new Date().toISOString()),
        );
        return;
      }

      const seeds: CrawlQueueInput[] = [];
      for (let problemId = minId; problemId <= ceiling; problemId += 1) {
        const existing = readIdSweepRecord(snapshot, problemId);
        if (existing) {
          // Incremental resume: the ID was already probed (and possibly
          // captured) in an earlier run against this snapshot.
          sweepStats.skippedAlreadyProbed += 1;
          probedRecords.push(existing);
          continue;
        }

        const response = await fetchWithTimeout(
          probeFetch,
          buildProblemIdProbeUrl(problemId),
          { redirect: 'manual' },
          requestTimeoutMs,
        );
        const probeResult = parseProblemIdProbeResponse(
          problemId,
          response.status,
          response.headers.get('location'),
        );
        sweepStats.probed += 1;

        if (probeResult.probe === 'live' && probeResult.canonicalUrl) {
          const url = probeResult.canonicalUrl;
          const key = `page:${url}`;
          seeds.push({ key, url, kind: 'public-page' });
        }

        const record = recordIdSweepProbe(
          snapshot,
          probeResult,
          now.toISOString(),
          probeResult.probe === 'live',
        );
        probedRecords.push(record);
      }

      writeIdSweepIndex(
        snapshot,
        buildIdSweepIndex(snapshot.snapshotId, probedRecords, ceiling, now.toISOString()),
      );

      queue.enqueueMany(seeds);
    },
  });

  // The crawl loop reclassifies live problems while capturing (a captured
  // canonical page that turns out to be a login/challenge shell becomes
  // `cookie-shell`). Re-read the persisted records so the final index and
  // the returned counts reflect post-capture classifications.
  const snapshot = resolveSnapshotLayout(config, result.snapshotId);
  const finalRecords: ProblemIdSweepRecord[] = [];
  for (let problemId = minId; problemId <= sweepStats.ceiling; problemId += 1) {
    // Every ID in range was either probed this run (record written by
    // recordIdSweepProbe) or skipped because a record already existed, so
    // the read is non-null by construction.
    finalRecords.push(readIdSweepRecord(snapshot, problemId)!);
  }

  const index = buildIdSweepIndex(result.snapshotId, finalRecords, sweepStats.ceiling, now.toISOString());
  writeIdSweepIndex(snapshot, index);
  sweepStats.liveCount = index.totals.liveCount;
  sweepStats.deadCount = index.totals.deadCount;
  sweepStats.cookieShellCount = index.totals.cookieShellCount;

  return { ...result, ...sweepStats };
}
