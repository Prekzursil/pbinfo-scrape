import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Express, Request, Response } from 'express';

import type { SnapshotLayout } from '../archive/storage.js';
import type {
  EvaluationTimelineEntry,
  ProblemCoverageRecord,
  ProgressState,
} from '../types/records.js';

export interface OverlayEntry {
  problemId: number;
  slug: string;
  name: string;
  canonicalUrl?: string;
  mirrorRoute: string;
  progressState: ProgressState;
  bestScore: number;
  solvedByMe: boolean;
  officialSourceArchived: boolean;
  officialSourceLanguages: string[];
  userSourceArchived: boolean;
  userSourceLanguages: string[];
  trustworthyLanguages: string[];
  missingTrustworthyLanguages: string[];
  testsCaptured: boolean;
  exampleTestCount: number;
  visibleTestCount: number;
  editorialAvailability: 'visible' | 'restricted' | 'hidden' | 'unknown';
  evaluationCount: number;
  latestTimelineEntry?: EvaluationTimelineEntry;
  lastAttemptAt?: string;
  generatedAt: string;
}

const OVERLAY_PATH = '/__pbinfo-overlay.json';

/**
 * Registers the `/__pbinfo-overlay.json?problemId=N` endpoint on the given
 * Express app. The Electron BrowserView uses this endpoint to render a
 * sticky HUD on top of each mirrored problem page.
 */
export function registerOverlayServerRoute(
  app: Express,
  snapshot: SnapshotLayout,
  options: { now?: () => Date } = {},
): void {
  app.get(OVERLAY_PATH, (request: Request, response: Response) => {
    const problemId = Number(request.query.problemId);
    if (!Number.isFinite(problemId) || problemId <= 0) {
      response.status(400).json({ error: 'problemId is required and must be a positive integer' });
      return;
    }

    const overlay = buildOverlayForProblem(snapshot, problemId, options.now?.() ?? new Date());
    if (!overlay) {
      response.status(404).json({ error: `No coverage record found for problem ${problemId}` });
      return;
    }

    response.setHeader('Cache-Control', 'no-store');
    response.json(overlay);
  });
}

export function buildOverlayForProblem(
  snapshot: SnapshotLayout,
  problemId: number,
  now: Date = new Date(),
): OverlayEntry | null {
  const coverageRecord = readCoverageRecord(snapshot, problemId);
  if (!coverageRecord) {
    return null;
  }

  const timeline = coverageRecord.evaluationTimeline ?? [];
  const progressState: ProgressState =
    coverageRecord.progressState
    ?? (coverageRecord.solvedByMe
      ? 'solved'
      : coverageRecord.evaluationCount > 0
        ? 'partial'
        : 'not-attempted');

  return {
    problemId,
    slug: coverageRecord.slug,
    name: coverageRecord.name,
    canonicalUrl: coverageRecord.canonicalUrl,
    mirrorRoute: coverageRecord.mirrorRoute,
    progressState,
    bestScore: coverageRecord.bestScore ?? (coverageRecord.solvedByMe ? 100 : 0),
    solvedByMe: coverageRecord.solvedByMe,
    officialSourceArchived: coverageRecord.officialSourceArchived,
    officialSourceLanguages: coverageRecord.officialSourceLanguages ?? [],
    userSourceArchived: coverageRecord.userSourceArchived,
    userSourceLanguages: coverageRecord.userSourceLanguages ?? [],
    trustworthyLanguages: coverageRecord.trustworthyUserSourceLanguages ?? [],
    missingTrustworthyLanguages: coverageRecord.missingTrustworthyUserSourceLanguages ?? [],
    testsCaptured: coverageRecord.testsCoverageStatus === 'captured',
    exampleTestCount: coverageRecord.exampleTestsAvailableCount ?? 0,
    visibleTestCount: coverageRecord.visibleTestsCapturedCount ?? 0,
    editorialAvailability: coverageRecord.editorialAvailability,
    evaluationCount: coverageRecord.evaluationCount,
    latestTimelineEntry: timeline[0],
    lastAttemptAt: coverageRecord.lastAttemptAt,
    generatedAt: now.toISOString(),
  };
}

function readCoverageRecord(
  snapshot: SnapshotLayout,
  problemId: number,
): ProblemCoverageRecord | null {
  const filePath = join(
    snapshot.normalizedRoot,
    'problem-coverage',
    `problem-${problemId}.json`,
  );
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as ProblemCoverageRecord;
  } catch {
    return null;
  }
}
