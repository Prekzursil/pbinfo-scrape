import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { prepareSnapshot } from '../../src/archive/storage.js';
import { loadLocalConfig } from '../../src/config/local-config.js';
import { createDesktopController } from '../../src/gui/main/desktop-controller.js';
import { readGuiJob } from '../../src/gui/main/job-store.js';
import type { DesktopNotification } from '../../src/gui/main/notification-service.js';
import { initializeWorkspaceState } from '../../src/gui/main/workspace-store.js';

const tempDirs: string[] = [];
const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        }),
    ),
  );

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('desktop controller', () => {
  test('runs crawl jobs in resumable chunks and persists queue counters between chunks', { timeout: 20_000 }, async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-desktop-crawl-'));
    tempDirs.push(workspaceRoot);
    initializeWorkspaceState(workspaceRoot, {
      now: new Date('2026-03-10T12:00:00.000Z'),
    });
    mkdirSync(join(workspaceRoot, '.local'), { recursive: true });

    const server = createServer((request, response) => {
      if (request.url === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<html><body><a href="/probleme">Probleme</a></body></html>');
        return;
      }

      if (request.url === '/probleme') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<html><body><h1>Probleme</h1></body></html>');
        return;
      }

      response.statusCode = 404;
      response.end('missing');
    });
    servers.push(server);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new TypeError('server address is not available');
    }

    writeFileSync(
      join(workspaceRoot, '.local', 'pbinfo.local.json'),
      JSON.stringify(
        {
          crawl: {
            publicStartUrls: [`http://127.0.0.1:${address.port}/`],
            crossCheckWithBrowser: false,
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const controller = createDesktopController(workspaceRoot);
    const firstChunk = await controller.startJob({
      kind: 'crawl',
      snapshotId: 'desktop-snapshot',
      profileId: 'alpha',
      detail: {
        scope: 'public',
      },
      maxIterations: 1,
      now: new Date('2026-03-10T12:01:00.000Z'),
    });
    const secondChunk = await controller.resumeJob(firstChunk.jobId, {
      maxIterations: 10,
      now: new Date('2026-03-10T12:02:00.000Z'),
    });
    const persisted = readGuiJob(workspaceRoot, firstChunk.jobId);

    expect(firstChunk.status).toBe('paused');
    expect(firstChunk.resumable).toBe(true);
    expect(firstChunk.latestCounters).toEqual({
      pending: 1,
      completed: 1,
      inProgress: 0,
    });
    expect(secondChunk.status).toBe('completed');
    expect(secondChunk.latestCounters).toEqual({
      pending: 0,
      completed: 2,
      inProgress: 0,
    });
    expect(persisted.status).toBe('completed');
    expect(readFileSync(persisted.logPath, 'utf8')).toContain(
      'Crawl snapshot desktop-snapshot',
    );
    expect(controller.getCrawlStatus('desktop-snapshot')).toEqual(
      expect.objectContaining({
        snapshotId: 'desktop-snapshot',
        pending: 0,
        completed: 2,
      }),
    );
    expect(controller.listJobEvents(firstChunk.jobId)).toEqual([
      expect.objectContaining({
        stage: 'crawl',
      }),
      expect.objectContaining({
        stage: 'crawl',
      }),
    ]);
  });

  test('resumes the crawl job for its recorded snapshot instead of the latest unfinished snapshot', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-desktop-resume-specific-'));
    tempDirs.push(workspaceRoot);
    initializeWorkspaceState(workspaceRoot, {
      now: new Date('2026-03-10T12:00:00.000Z'),
    });

    const resumeCrawlWorkflow = vi.fn(async () => ({
      processed: 3,
      queuePath: join(
        workspaceRoot,
        '.local',
        'crawl-queues',
        'acceptance-20260310b.sqlite',
      ),
      snapshotId: 'acceptance-20260310b',
      completed: false,
    }));

    const controller = createDesktopController(workspaceRoot, {
      runCrawlWorkflow: async () => ({
        processed: 1,
        queuePath: join(
          workspaceRoot,
          '.local',
          'crawl-queues',
          'acceptance-20260310b.sqlite',
        ),
        snapshotId: 'acceptance-20260310b',
        completed: false,
      }),
      resumeCrawlWorkflow,
      getCrawlStatusWorkflow: () => ({
        snapshotId: 'acceptance-20260310b',
        queuePath: join(
          workspaceRoot,
          '.local',
          'crawl-queues',
          'acceptance-20260310b.sqlite',
        ),
        pending: 7,
        completed: 5,
        inProgress: 0,
        publishEligible: false,
        recentFailures: [],
      }),
    });

    const firstChunk = await controller.startJob({
      kind: 'crawl',
      snapshotId: 'acceptance-20260310b',
      detail: {
        scope: 'all',
      },
      maxIterations: 1,
      now: new Date('2026-03-10T12:01:00.000Z'),
    });

    await controller.resumeJob(firstChunk.jobId, {
      maxIterations: 10,
      now: new Date('2026-03-10T12:02:00.000Z'),
    });

    expect(resumeCrawlWorkflow).toHaveBeenCalledWith(
      workspaceRoot,
      expect.objectContaining({
        snapshotId: 'acceptance-20260310b',
        maxIterations: 10,
      }),
    );
  });

  test('passes crawl mode through to workflow calls and defaults new crawl jobs to incremental mode', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-desktop-crawl-mode-'));
    tempDirs.push(workspaceRoot);
    initializeWorkspaceState(workspaceRoot, {
      now: new Date('2026-03-10T12:00:00.000Z'),
    });

    const runCrawlWorkflow = vi.fn(async () => ({
      processed: 1,
      queuePath: join(
        workspaceRoot,
        '.local',
        'crawl-queues',
        'acceptance-20260310b.sqlite',
      ),
      snapshotId: 'acceptance-20260310b',
      completed: false,
    }));

    const controller = createDesktopController(workspaceRoot, {
      runCrawlWorkflow,
      getCrawlStatusWorkflow: () => ({
        snapshotId: 'acceptance-20260310b',
        queuePath: join(
          workspaceRoot,
          '.local',
          'crawl-queues',
          'acceptance-20260310b.sqlite',
        ),
        pending: 7,
        completed: 5,
        inProgress: 0,
        publishEligible: false,
        recentFailures: [],
      }),
    });

    await controller.startJob({
      kind: 'crawl',
      snapshotId: 'acceptance-20260310b',
      detail: {
        scope: 'all',
      },
      maxIterations: 1,
      now: new Date('2026-03-10T12:01:00.000Z'),
    });

    await controller.startJob({
      kind: 'crawl',
      snapshotId: 'acceptance-20260310b',
      detail: {
        scope: 'all',
        mode: 'fresh',
      },
      maxIterations: 1,
      now: new Date('2026-03-10T12:02:00.000Z'),
    });

    expect(runCrawlWorkflow).toHaveBeenNthCalledWith(
      1,
      workspaceRoot,
      'all',
      expect.objectContaining({
        snapshotId: 'acceptance-20260310b',
        maxIterations: 1,
        mode: 'incremental',
      }),
    );
    expect(runCrawlWorkflow).toHaveBeenNthCalledWith(
      2,
      workspaceRoot,
      'all',
      expect.objectContaining({
        snapshotId: 'acceptance-20260310b',
        maxIterations: 1,
        mode: 'fresh',
      }),
    );
  });

  test('starts and stops embedded mirror preview servers for a snapshot', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-desktop-mirror-'));
    tempDirs.push(workspaceRoot);

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'mirror-snapshot',
      scope: 'public',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    mkdirSync(snapshot.rawAssetsRoot, { recursive: true });
    mkdirSync(join(snapshot.mirrorRoot, 'site', 'root'), { recursive: true });
    writeFileSync(
      join(snapshot.mirrorRoot, 'site', 'root', 'index.html'),
      '<html><body><h1>Mirror Preview</h1></body></html>',
      'utf8',
    );
    writeFileSync(
      snapshot.routesManifestPath,
      JSON.stringify(
        [
          {
            snapshotId: snapshot.snapshotId,
            route: '/',
            sourceFile: 'page-https-www-pbinfo-ro-root.html',
            template: 'raw-page',
            entityKey: '/',
            mirrorFile: 'site/root/index.html',
          },
        ],
        null,
        2,
      ),
      'utf8',
    );

    const controller = createDesktopController(workspaceRoot);
    const preview = await controller.startMirrorPreview(snapshot.snapshotId, {
      port: 0,
    });
    const response = await fetch(`${preview.baseUrl}/`);
    const persisted = readGuiJob(workspaceRoot, preview.job.jobId);
    await controller.stopMirrorPreview(preview.job.jobId);

    expect(await response.text()).toContain('Mirror Preview');
    expect(preview.job.detail).toEqual(
      expect.objectContaining({
        mirrorPreviewUrl: preview.baseUrl,
      }),
    );
    expect(persisted.detail).toEqual(
      expect.objectContaining({
        mirrorPreviewUrl: preview.baseUrl,
      }),
    );
  });

  test('fails mirror preview clearly when the snapshot has no built mirror yet', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-desktop-mirror-missing-'));
    tempDirs.push(workspaceRoot);

    const config = loadLocalConfig(workspaceRoot);
    prepareSnapshot(config, {
      snapshotId: 'mirror-snapshot',
      scope: 'public',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });

    const controller = createDesktopController(workspaceRoot);

    await expect(
      controller.startMirrorPreview('mirror-snapshot', {
        port: 0,
      }),
    ).rejects.toThrow('Mirror preview requires a built mirror');
    expect(controller.listJobs()).toEqual([
      expect.objectContaining({
        kind: 'mirror-serve',
        status: 'failed',
        detail: expect.objectContaining({
          error: expect.stringContaining('Mirror preview requires a built mirror'),
        }),
      }),
    ]);
  });

  test('records structured terminal events and notifications for finalize jobs', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-desktop-finalize-'));
    tempDirs.push(workspaceRoot);
    initializeWorkspaceState(workspaceRoot, {
      now: new Date('2026-03-10T12:00:00.000Z'),
    });

    const notifications: DesktopNotification[] = [];
    const controller = createDesktopController(workspaceRoot, {
      notificationService: {
        notify: async (message) => {
          notifications.push(message);
        },
      },
      finalizeSnapshotWorkflow: async () => ({
          snapshotId: 'acceptance-20260310b',
          pagesNormalized: 12,
          problemsRanked: 3,
          routesBuilt: 7,
          artifactManifestPath: join(
            workspaceRoot,
            'archive',
            'artifacts',
            'acceptance-20260310b.json',
          ),
          coverageGapReportPath: join(
            workspaceRoot,
            'archive',
            'snapshots',
            'acceptance-20260310b',
            'normalized',
            'problem-coverage',
            'gaps.json',
          ),
          coverageGates: {
            officialSourceGatePassed: true,
            solvedUserSourceGatePassed: true,
          },
        }),
    });
    const completed = await controller.startJob({
      kind: 'snapshot-finalize',
      snapshotId: 'acceptance-20260310b',
      now: new Date('2026-03-10T12:03:00.000Z'),
    });

    expect(completed.status).toBe('completed');
    expect(completed.detail).toEqual(
      expect.objectContaining({
        snapshotId: 'acceptance-20260310b',
        pagesNormalized: 12,
      }),
    );
    expect(notifications).toEqual([
      expect.objectContaining({
        title: 'Snapshot finalized',
      }),
    ]);
  });

  test('exposes archive explorer summaries, listings, and record details from the canonical snapshot', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-desktop-explorer-'));
    tempDirs.push(workspaceRoot);
    initializeWorkspaceState(workspaceRoot, {
      now: new Date('2026-03-10T12:00:00.000Z'),
    });

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'acceptance-20260310b',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    mkdirSync(join(snapshot.normalizedRoot, 'problems'), { recursive: true });
    mkdirSync(join(snapshot.normalizedRoot, 'rankings', 'problems'), {
      recursive: true,
    });
    mkdirSync(join(snapshot.normalizedRoot, 'routes'), { recursive: true });
    mkdirSync(join(snapshot.mirrorRoot), { recursive: true });
    writeFileSync(
      join(snapshot.normalizedRoot, 'problems', 'problem-3171.json'),
      JSON.stringify(
        {
          id: 3171,
          slug: 'waterreserve',
          name: 'waterreserve',
          canonicalUrl: 'https://www.pbinfo.ro/probleme/3171/waterreserve',
          categoryChain: [],
          tags: [],
          sections: [],
          examples: [],
          constraints: [],
          editorialAvailability: 'unknown',
          officialSolutions: {},
          visibleTests: [],
          linkedAssets: [],
          metadata: {},
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'rankings', 'best-submissions.json'),
      JSON.stringify(
        {
          generatedAt: '2026-03-10T12:00:00.000Z',
          problems: [
            {
              problemId: 3171,
              bestUserOverallEvaluationId: 63332367,
              bestUserPerLanguage: {
                cpp: 63332367,
              },
              bestOfficialPerLanguage: {},
              orderedUserEvaluationIds: [63332367],
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(snapshot.mirrorRoot, 'routes.json'),
      JSON.stringify(
        [
          {
            snapshotId: snapshot.snapshotId,
            route: '/probleme/3171/waterreserve',
            sourceUrl: 'https://www.pbinfo.ro/probleme/3171/waterreserve',
            sourceFile: 'page-https-www-pbinfo-ro-probleme-3171-waterreserve.html',
            template: 'problem',
            entityKey: 'problem:3171',
          },
        ],
        null,
        2,
      ),
      'utf8',
    );

    const controller = createDesktopController(workspaceRoot);
    const summary = controller.getArchiveExplorerSummary(snapshot.snapshotId);
    const listing = controller.listArchiveExplorerRecords({
      snapshotId: snapshot.snapshotId,
      dataset: 'problems',
      query: 'water',
    });
    const detail = controller.getArchiveExplorerRecord({
      snapshotId: snapshot.snapshotId,
      dataset: 'problems',
      recordId: '3171',
    });

    expect(summary.normalizedRoot).toContain(
      'archive\\snapshots\\acceptance-20260310b\\normalized',
    );
    expect(summary.datasets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dataset: 'problems',
          count: 1,
        }),
        expect.objectContaining({
          dataset: 'rankings',
          count: 1,
        }),
      ]),
    );
    expect(listing.items).toEqual([
      expect.objectContaining({
        recordId: '3171',
        title: '#3171 waterreserve',
        mirrorRoute: '/probleme/3171/waterreserve',
      }),
    ]);
    expect(detail).toEqual(
      expect.objectContaining({
        recordId: '3171',
        mirrorRoute: '/probleme/3171/waterreserve',
        payload: expect.objectContaining({
          id: 3171,
        }),
      }),
    );
  });

  test('exposes derived coverage explorer summaries, listings, and record details', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-desktop-coverage-'));
    tempDirs.push(workspaceRoot);
    initializeWorkspaceState(workspaceRoot, {
      now: new Date('2026-03-10T12:00:00.000Z'),
    });

    const config = loadLocalConfig(workspaceRoot);
    const snapshot = prepareSnapshot(config, {
      snapshotId: 'acceptance-20260310b',
      scope: 'all',
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    mkdirSync(join(snapshot.normalizedRoot, 'problem-coverage'), { recursive: true });

    writeFileSync(
      join(snapshot.normalizedRoot, 'problem-coverage', 'problem-3716.json'),
      JSON.stringify(
        {
          snapshotId: snapshot.snapshotId,
          problemId: 3716,
          slug: 'crossword',
          name: 'Crossword',
          grade: 11,
          canonicalUrl: 'https://www.pbinfo.ro/probleme/3716/crossword',
          mirrorRoute: '/probleme/3716/crossword',
          tags: ['strings'],
          solvedByMe: true,
          evaluationCount: 1,
          solvedEvaluationCount: 1,
          rankingPresent: true,
          statementArchived: true,
          solutionFragmentArchived: true,
          testsFragmentArchived: true,
          exampleTestsAvailableCount: 0,
          visibleTestsCapturedCount: 0,
          evaluationObservedTestsCount: 1,
          officialSolutionPresent: true,
          editorialAvailability: 'visible',
          sourceListUrl: 'https://www.pbinfo.ro/solutii/problema/3716/crossword',
          officialSourceArchived: false,
          officialSourceCount: 0,
          officialSourceIds: [],
          userSourceArchived: false,
          userSourceCount: 0,
          userSourceIds: [],
          hasAnyArchivedSource: false,
          evaluationIds: [63332367],
          bestUserOverallEvaluationId: 63332367,
          notes: [
            'Tests fragment archived, no visible test cases parsed.',
            'Source list available upstream, no archived source code yet.',
          ],
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(snapshot.normalizedRoot, 'problem-coverage', 'index.json'),
      JSON.stringify(
        {
          snapshotId: snapshot.snapshotId,
          generatedAt: '2026-03-10T00:00:00.000Z',
          totals: {
            totalProblems: 1,
            solvedByMeCount: 1,
            statementArchivedCount: 1,
            solutionFragmentArchivedCount: 1,
            testsFragmentArchivedCount: 1,
            problemsWithExamples: 0,
            problemsWithVisibleTestsCaptured: 0,
            problemsWithEvaluationObservedTests: 1,
            problemsWithArchivedSources: 0,
            problemsWithOfficialSourceArchived: 0,
            problemsWithUserSourceArchived: 0,
            editorialVisibleCount: 1,
            rankingPresentCount: 1,
          },
          records: [
            {
              problemId: 3716,
              slug: 'crossword',
              name: 'Crossword',
              grade: 11,
              mirrorRoute: '/probleme/3716/crossword',
              tags: ['strings'],
              solvedByMe: true,
              evaluationCount: 1,
              solvedEvaluationCount: 1,
              rankingPresent: true,
              statementArchived: true,
              solutionFragmentArchived: true,
              testsFragmentArchived: true,
              exampleTestsAvailableCount: 0,
              visibleTestsCapturedCount: 0,
              evaluationObservedTestsCount: 1,
              officialSolutionPresent: true,
              editorialAvailability: 'visible',
              sourceListUrl: 'https://www.pbinfo.ro/solutii/problema/3716/crossword',
              officialSourceArchived: false,
              officialSourceCount: 0,
              officialSourceIds: [],
              userSourceArchived: false,
              userSourceCount: 0,
              userSourceIds: [],
              hasAnyArchivedSource: false,
              evaluationIds: [63332367],
              bestUserOverallEvaluationId: 63332367,
              notes: [
                'Tests fragment archived, no visible test cases parsed.',
                'Source list available upstream, no archived source code yet.',
              ],
            },
          ],
        },
        null,
        2,
      ),
      'utf8',
    );
    mkdirSync(join(snapshot.normalizedRoot, 'rankings', 'problems'), {
      recursive: true,
    });
    writeFileSync(
      join(snapshot.normalizedRoot, 'rankings', 'problems', 'problem-3716.json'),
      JSON.stringify(
        {
          problemId: 3716,
          bestUserOverallEvaluationId: 63332367,
          bestUserPerLanguage: {
            c: 63332367,
          },
          bestOfficialPerLanguage: {},
          orderedUserEvaluationIds: [63332367],
        },
        null,
        2,
      ),
      'utf8',
    );

    const controller = createDesktopController(workspaceRoot, {
      runProblemCoverageWorkflow: async () => ({
        snapshotId: snapshot.snapshotId,
        generatedAt: '2026-03-10T00:00:00.000Z',
        problemsCovered: 1,
        coverageRoot: join(snapshot.normalizedRoot, 'problem-coverage'),
        indexPath: join(snapshot.normalizedRoot, 'problem-coverage', 'index.json'),
        gapsPath: join(snapshot.normalizedRoot, 'problem-coverage', 'gaps.json'),
        totals: {
          totalProblems: 1,
          solvedByMeCount: 1,
          statementArchivedCount: 1,
          solutionFragmentArchivedCount: 1,
          testsFragmentArchivedCount: 1,
          problemsWithExamples: 0,
          problemsWithVisibleTestsCaptured: 0,
          problemsWithEvaluationObservedTests: 1,
          problemsWithArchivedSources: 0,
          problemsWithOfficialSourceArchived: 0,
          problemsWithUserSourceArchived: 0,
          editorialVisibleCount: 1,
          rankingPresentCount: 1,
        },
      }),
    });
    const summary = await controller.getCoverageSummary(snapshot.snapshotId);
    const listing = await controller.listCoverageRecords({
      snapshotId: snapshot.snapshotId,
      solved: 'solved',
      query: 'cross',
    });
    const detail = await controller.getCoverageRecord({
      snapshotId: snapshot.snapshotId,
      problemId: 3716,
    });

    expect(summary).toEqual(
      expect.objectContaining({
        snapshotId: 'acceptance-20260310b',
        totalProblems: 1,
        solvedByMeCount: 1,
        coverageRoot: expect.stringContaining(
          'archive\\snapshots\\acceptance-20260310b\\normalized\\problem-coverage',
        ),
      }),
    );
    expect(listing.items).toEqual([
      expect.objectContaining({
        problemId: 3716,
        name: 'Crossword',
        solvedByMe: true,
        officialSourceArchived: false,
        userSourceArchived: false,
      }),
    ]);
    expect(detail).toEqual(
      expect.objectContaining({
        record: expect.objectContaining({
          problemId: 3716,
          solvedByMe: true,
        }),
        rawRecordLinks: expect.objectContaining({
          coverageFilePath: expect.stringContaining('problem-3716.json'),
          problemFilePath: expect.stringContaining('problem-3716.json'),
          rankingFilePath: expect.stringContaining(
            'rankings\\problems\\problem-3716.json',
          ),
          evaluationFilePaths: expect.arrayContaining([
            expect.stringContaining('evaluation-63332367.json'),
          ]),
        }),
      }),
    );
  });

  test('emits a stalled crawl warning when a chunk processes no work while pending items remain', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-desktop-stalled-zero-'));
    tempDirs.push(workspaceRoot);
    initializeWorkspaceState(workspaceRoot, {
      now: new Date('2026-03-10T12:00:00.000Z'),
    });

    const notifications: DesktopNotification[] = [];
    const controller = createDesktopController(workspaceRoot, {
      runCrawlWorkflow: async () => ({
        processed: 0,
        queuePath: join(workspaceRoot, '.local', 'crawl-queues', 'acceptance-20260310b.sqlite'),
        snapshotId: 'acceptance-20260310b',
        completed: false,
      }),
      getCrawlStatusWorkflow: () => ({
        snapshotId: 'acceptance-20260310b',
        queuePath: join(workspaceRoot, '.local', 'crawl-queues', 'acceptance-20260310b.sqlite'),
        pending: 25,
        completed: 10,
        inProgress: 0,
        publishEligible: false,
        recentFailures: [],
      }),
      notificationService: {
        notify: async (message) => {
          notifications.push(message);
        },
      },
    });

    const job = await controller.startJob({
      kind: 'crawl',
      snapshotId: 'acceptance-20260310b',
      detail: {
        scope: 'all',
      },
      maxIterations: 25,
      now: new Date('2026-03-10T12:05:00.000Z'),
    });
    const events = controller.listJobEvents(job.jobId);

    expect(job.status).toBe('paused');
    expect(job.latestCounters).toEqual({
      pending: 25,
      completed: 10,
      inProgress: 0,
    });
    expect(events).toEqual([
      expect.objectContaining({
        level: 'warn',
        stage: 'crawl-stalled',
        message: 'Crawl snapshot acceptance-20260310b stalled after chunk',
        detail: expect.objectContaining({
          stallReason: 'no-visible-work',
          processed: 0,
          previousCounters: null,
        }),
      }),
    ]);
    expect(notifications).toEqual([
      expect.objectContaining({
        level: 'warn',
        title: 'Crawl paused/stalled',
        message: expect.stringContaining('acceptance-20260310b'),
      }),
    ]);
  });

  test('emits a stalled crawl warning when a resumed chunk returns with unchanged counters', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-desktop-stalled-counters-'));
    tempDirs.push(workspaceRoot);
    initializeWorkspaceState(workspaceRoot, {
      now: new Date('2026-03-10T12:00:00.000Z'),
    });

    const notifications: DesktopNotification[] = [];
    const controller = createDesktopController(workspaceRoot, {
      runCrawlWorkflow: async () => ({
        processed: 1,
        queuePath: join(workspaceRoot, '.local', 'crawl-queues', 'acceptance-20260310b.sqlite'),
        snapshotId: 'acceptance-20260310b',
        completed: false,
      }),
      resumeCrawlWorkflow: async () => ({
        processed: 2,
        queuePath: join(workspaceRoot, '.local', 'crawl-queues', 'acceptance-20260310b.sqlite'),
        snapshotId: 'acceptance-20260310b',
        completed: false,
      }),
      getCrawlStatusWorkflow: (() => {
        let callCount = 0;
        return () => {
          callCount += 1;
          return {
            snapshotId: 'acceptance-20260310b',
            queuePath: join(
              workspaceRoot,
              '.local',
              'crawl-queues',
              'acceptance-20260310b.sqlite',
            ),
            pending: 8,
            completed: 4,
            inProgress: 0,
            publishEligible: false,
            recentFailures: [],
          };
        };
      })(),
      notificationService: {
        notify: async (message) => {
          notifications.push(message);
        },
      },
    });

    const firstChunk = await controller.startJob({
      kind: 'crawl',
      snapshotId: 'acceptance-20260310b',
      detail: {
        scope: 'all',
      },
      maxIterations: 10,
      now: new Date('2026-03-10T12:05:00.000Z'),
    });
    const resumedChunk = await controller.resumeJob(firstChunk.jobId, {
      maxIterations: 10,
      now: new Date('2026-03-10T12:06:00.000Z'),
    });
    const events = controller.listJobEvents(firstChunk.jobId);

    expect(firstChunk.latestCounters).toEqual({
      pending: 8,
      completed: 4,
      inProgress: 0,
    });
    expect(resumedChunk.status).toBe('paused');
    expect(events).toEqual([
      expect.objectContaining({
        level: 'info',
        stage: 'crawl',
      }),
      expect.objectContaining({
        level: 'warn',
        stage: 'crawl-stalled',
        message: 'Crawl snapshot acceptance-20260310b stalled after chunk',
        detail: expect.objectContaining({
          stallReason: 'unchanged-counters',
          processed: 2,
          previousCounters: {
            pending: 8,
            completed: 4,
            inProgress: 0,
          },
          currentCounters: {
            pending: 8,
            completed: 4,
            inProgress: 0,
          },
        }),
      }),
    ]);
    expect(notifications).toEqual([
      expect.objectContaining({
        level: 'warn',
        title: 'Crawl paused/stalled',
      }),
    ]);
  });

  test('logs in with credentials, creates a workspace profile, and activates it', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-desktop-login-'));
    tempDirs.push(workspaceRoot);
    initializeWorkspaceState(workspaceRoot, {
      now: new Date('2026-03-10T12:00:00.000Z'),
    });

    const notifications: DesktopNotification[] = [];
    const controller = createDesktopController(workspaceRoot, {
      createAuthClient: () =>
        ({
          loginWithCredentials: async () => ({
            success: true,
            redirectUrl: 'https://www.pbinfo.ro/profil/Prekzursil',
            sessionCookies: [
              {
                key: 'PHPSESSID',
                value: 'cookie-value',
                domain: 'www.pbinfo.ro',
                path: '/',
                secure: true,
                httpOnly: true,
              },
            ],
          }),
        }) as never,
      notificationService: {
        notify: async (message) => {
          notifications.push(message);
        },
      },
    });

    const result = await controller.loginProfile({
      profileId: 'alpha',
      label: 'Primary account',
      userHandle: 'Prekzursil',
      username: 'Prekzursil',
      password: 'secret',
      now: new Date('2026-03-10T12:03:00.000Z'),
    });

    const config = loadLocalConfig(workspaceRoot);
    expect(result.workspaceState.activeProfileId).toBe('alpha');
    expect(result.profile.provenance).toEqual({
      type: 'login',
    });
    expect(readFileSync(config.auth.sessionCookiesPath, 'utf8')).toContain('PHPSESSID');
    expect(readFileSync(result.job.logPath, 'utf8')).toContain('Signed in and activated profile alpha');
    expect(notifications).toEqual([
      expect.objectContaining({
        title: 'PBInfo login complete',
      }),
    ]);
  });

  test('imports browser cookies, creates a workspace profile, and activates it', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-desktop-browser-'));
    tempDirs.push(workspaceRoot);
    initializeWorkspaceState(workspaceRoot, {
      now: new Date('2026-03-10T12:00:00.000Z'),
    });

    const controller = createDesktopController(workspaceRoot, {
      importBrowserCookies: async () => [
        {
          name: 'PHPSESSID',
          value: 'browser-cookie',
          domain: 'www.pbinfo.ro',
          path: '/',
          secure: true,
          httpOnly: true,
          sameSite: 'lax',
        },
      ],
    });

    const result = await controller.importBrowserProfile({
      profileId: 'edge-default',
      label: 'Edge profile',
      userHandle: 'Prekzursil',
      browser: 'edge',
      profileName: 'Default',
      now: new Date('2026-03-10T12:05:00.000Z'),
    });

    expect(result.workspaceState.activeProfileId).toBe('edge-default');
    expect(result.profile.provenance).toEqual({
      type: 'browser-import',
      browser: 'edge',
    });
    expect(result.job.status).toBe('completed');
    expect(readFileSync(result.job.logPath, 'utf8')).toContain('Imported 1 cookies');
  });
});
