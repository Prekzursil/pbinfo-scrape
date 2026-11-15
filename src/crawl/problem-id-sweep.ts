import { join } from 'node:path';

import { mergeJsonRecord, readJsonRecord, writeJsonRecord } from '../archive/json-store.js';
import type { SnapshotLayout } from '../archive/storage.js';
import type {
  ProblemIdSweepClassification,
  ProblemIdSweepIndex,
  ProblemIdSweepRecord,
  ProblemIdSweepTotals,
} from '../types/records.js';

export const PROBLEM_ID_SWEEP_ORIGIN = 'https://www.pbinfo.ro';

export interface ProblemIdProbeResult {
  problemId: number;
  probe: 'live' | 'dead';
  httpStatus: number;
  slug?: string;
  canonicalUrl?: string;
}

export interface DetectProblemIdCeilingOptions {
  startId?: number;
  deadStreakThreshold?: number;
}

export interface DetectedProblemIdCeiling {
  ceiling: number;
  probedIds: number[];
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * pbinfo.ro problem URLs are canonicalized server-side: a bare
 * `/probleme/{id}` request answers `301 -> /probleme/{id}/{slug}` when a
 * live problem owns that ID, and falls through to the generic shell page
 * (HTTP 200, no redirect) when the ID is dead. The redirect is issued
 * before the JS challenge middleware, so live/dead classification works
 * even for anonymous, non-challenge-cleared clients.
 */
export function buildProblemIdProbeUrl(problemId: number): string {
  return `${PROBLEM_ID_SWEEP_ORIGIN}/probleme/${problemId}`;
}

export function parseProblemIdProbeResponse(
  problemId: number,
  httpStatus: number,
  location: string | null,
): ProblemIdProbeResult {
  // Some servers emit relative Location headers; resolve them against the
  // pbinfo origin before matching the canonical problem shape.
  const resolvedLocation = location
    ? new URL(location, `${PROBLEM_ID_SWEEP_ORIGIN}/`).toString()
    : null;
  const canonicalMatch = resolvedLocation?.match(
    /^https:\/\/www\.pbinfo\.ro\/probleme\/(\d+)\/([^/?#]+)/,
  );
  if (
    REDIRECT_STATUSES.has(httpStatus) &&
    canonicalMatch?.[1] === String(problemId) &&
    canonicalMatch[2]
  ) {
    const slug = canonicalMatch[2];
    return {
      problemId,
      probe: 'live',
      httpStatus,
      slug,
      canonicalUrl: `${PROBLEM_ID_SWEEP_ORIGIN}/probleme/${problemId}/${slug}`,
    };
  }

  return {
    problemId,
    probe: 'dead',
    httpStatus,
  };
}

/**
 * A cookie-shell is any page body that is not real problem content but a
 * gate the anonymous HTTP client cannot pass: pbinfo's SHA-256
 * proof-of-work challenge (`Verificare`) or a login wall. The challenge
 * markers below were verified against the live site: the shell page has
 * `<title>Verificare - pbinfo.ro</title>`, a `#verificare` spinner div,
 * and posts to `/ajx-module/js-challenge.php`.
 */
export function isCookieShellHtml(html: string): boolean {
  return (
    /<title>\s*verificare[^<]*<\/title>/i.test(html) ||
    /id="verificare"/i.test(html) ||
    /\/ajx-module\/js-challenge\.php/i.test(html)
  );
}

/**
 * Auto-detect the highest live problem ID.
 *
 * Strategy: exponential growth from `startId` until `deadStreakThreshold`
 * consecutive dead probes are observed, then binary search between the last
 * live probe and the first dead probe of the streak. The resulting ceiling
 * is the largest live ID observed; rare deletions above the dead streak are
 * possible (documented in the README) and can be overridden with an explicit
 * `maxId`.
 */
export async function detectProblemIdCeiling(
  probe: (problemId: number) => Promise<boolean>,
  options: DetectProblemIdCeilingOptions = {},
): Promise<DetectedProblemIdCeiling> {
  const startId = Math.max(1, options.startId ?? 1);
  const deadStreakThreshold = Math.max(2, options.deadStreakThreshold ?? 8);
  const probedIds: number[] = [];

  let lastLive = 0;
  let firstDeadAfterLive: number | undefined;
  let consecutiveDead = 0;
  let candidate = startId;
  let step = 1;

  // Phase 1: exponential growth until a dead streak (or a live-only run that
  // keeps growing forever is bounded by the caller's rate-limited probe fn).
  while (consecutiveDead < deadStreakThreshold) {
    const live = await probe(candidate);
    probedIds.push(candidate);
    if (live) {
      lastLive = candidate;
      consecutiveDead = 0;
      candidate += step;
      step *= 2;
    } else {
      consecutiveDead += 1;
      if (lastLive > 0 && firstDeadAfterLive === undefined) {
        firstDeadAfterLive = candidate;
      }
      candidate += 1;
    }
  }

  // No live problem at or above startId within the observed window.
  if (lastLive === 0) {
    return { ceiling: 0, probedIds };
  }

  // Phase 2: binary search between the last live ID and the first dead ID
  // of the streak. The guard above guarantees both bounds are defined here.
  let low = lastLive;
  let high = firstDeadAfterLive!;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    const live = await probe(mid);
    probedIds.push(mid);
    if (live) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return { ceiling: low, probedIds };
}

export function idSweepRecordFileName(problemId: number): string {
  return `id-${problemId}.json`;
}

export function idSweepRoot(snapshot: SnapshotLayout): string {
  return join(snapshot.normalizedRoot, 'id-sweep');
}

export function recordIdSweepProbe(
  snapshot: SnapshotLayout,
  result: ProblemIdProbeResult,
  probedAt: string,
  captureQueued: boolean,
): ProblemIdSweepRecord {
  const classification: ProblemIdSweepClassification = result.probe === 'live' ? 'live' : 'dead';
  return mergeJsonRecord<ProblemIdSweepRecord>(
    idSweepRoot(snapshot),
    idSweepRecordFileName(result.problemId),
    (current) => ({
      ...current,
      snapshotId: snapshot.snapshotId,
      problemId: result.problemId,
      classification,
      probe: result.probe,
      probeHttpStatus: result.httpStatus,
      slug: result.slug ?? current?.slug,
      canonicalUrl: result.canonicalUrl ?? current?.canonicalUrl,
      captureQueued,
      captureStatus: current?.captureStatus,
      probedAt,
    }),
  );
}

/**
 * Record the outcome of capturing a live problem's canonical page (or one
 * of its detail-tab endpoints). Only updates records that already exist —
 * capture classification is meaningful only for problems the sweep probed.
 */
export function recordIdSweepCaptureStatus(
  snapshot: SnapshotLayout,
  problemId: number,
  captureStatus: 'content' | 'cookie-shell',
): boolean {
  const current = readIdSweepRecord(snapshot, problemId);
  if (!current) {
    return false;
  }

  mergeJsonRecord<ProblemIdSweepRecord>(
    idSweepRoot(snapshot),
    idSweepRecordFileName(problemId),
    () => ({
      ...current,
      snapshotId: snapshot.snapshotId,
      problemId,
      classification: captureStatus === 'cookie-shell' ? 'cookie-shell' : 'live',
      captureStatus,
    }),
  );
  return true;
}

export function readIdSweepRecord(
  snapshot: SnapshotLayout,
  problemId: number,
): ProblemIdSweepRecord | undefined {
  return readJsonRecord<ProblemIdSweepRecord>(
    join(idSweepRoot(snapshot), idSweepRecordFileName(problemId)),
  );
}

export function buildIdSweepIndex(
  snapshotId: string,
  records: ProblemIdSweepRecord[],
  ceiling: number,
  generatedAt: string,
): ProblemIdSweepIndex {
  const sorted = [...records].sort((left, right) => left.problemId - right.problemId);
  const liveIds = sorted
    .filter((record) => record.classification === 'live')
    .map((r) => r.problemId);
  const deadIds = sorted
    .filter((record) => record.classification === 'dead')
    .map((r) => r.problemId);
  const cookieShellIds = sorted
    .filter((record) => record.classification === 'cookie-shell')
    .map((r) => r.problemId);

  const totals: ProblemIdSweepTotals = {
    probed: sorted.length,
    liveCount: liveIds.length,
    deadCount: deadIds.length,
    cookieShellCount: cookieShellIds.length,
    minId: sorted[0]?.problemId ?? 0,
    maxId: sorted.at(-1)?.problemId ?? 0,
  };

  return {
    snapshotId,
    generatedAt,
    ceiling,
    totals,
    liveIds,
    deadIds,
    cookieShellIds,
  };
}

export function writeIdSweepIndex(snapshot: SnapshotLayout, index: ProblemIdSweepIndex): void {
  writeJsonRecord(idSweepRoot(snapshot), 'index.json', index);
}
