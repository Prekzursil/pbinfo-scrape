import { z } from 'zod';

export const persistedCookieSchema = z
  .object({
    key: z.string().min(1),
    value: z.string(),
    domain: z.string().min(1).optional(),
    path: z.string().min(1).optional(),
    expires: z.union([z.number(), z.string()]).optional(),
    httpOnly: z.boolean().optional(),
    secure: z.boolean().optional(),
    sameSite: z.string().min(1).optional(),
  })
  .strict();

export const profileProvenanceSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('login'),
    })
    .strict(),
  z
    .object({
      type: z.literal('browser-import'),
      browser: z.enum(['edge', 'chrome']),
    })
    .strict(),
  z
    .object({
      type: z.literal('cookie-import'),
      sourcePath: z.string().min(1).optional(),
    })
    .strict(),
]);

export const guiNotificationPreferenceSchema = z
  .object({
    desktopBanners: z.boolean(),
    windowsToast: z.boolean(),
  })
  .strict();

export const guiVerbosityModeSchema = z.enum(['normal', 'verbose', 'raw']);
export const guiCrawlModeSchema = z.enum(['incremental', 'fresh']);
export const guiArchiveDatasetSchema = z.enum([
  'problems',
  'evaluations',
  'tests',
  'rankings',
  'mirror-routes',
]);
export const guiCoverageSolvedFilterSchema = z.enum(['all', 'solved', 'unsolved']);
export const guiCoveragePresenceFilterSchema = z.enum(['all', 'yes', 'no']);
export const guiCoverageEditorialFilterSchema = z.enum([
  'all',
  'visible',
  'restricted',
  'hidden',
  'unknown',
]);
export const guiCoverageTestsStatusFilterSchema = z.enum([
  'all',
  'captured',
  'not-available-upstream',
  'not-captured-yet',
]);
export const guiCoverageArchiveStateFilterSchema = z.enum([
  'all',
  'complete',
  'unsolved',
  'not-archived-yet',
  'missing-official-source',
  'missing-user-source',
  'incomplete',
]);

export const desktopPreferencesRecordSchema = z
  .object({
    workspaceRoot: z.string().min(1).optional(),
    verbosityMode: guiVerbosityModeSchema,
  })
  .strict();

export const profileIdentityFields = {
  profileId: z.string().min(1),
  label: z.string().min(1),
  userHandle: z.string().min(1).optional(),
  provenance: profileProvenanceSchema,
} as const;

export const guiProfileRecordSchema = z
  .object({
    ...profileIdentityFields,
    sessionCookiesPath: z.string().min(1),
    encryptedBundlePath: z.string().min(1).optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const guiWorkspaceStateSchema = z
  .object({
    version: z.literal(1),
    workspaceRoot: z.string().min(1),
    activeProfileId: z.string().min(1).optional(),
    profiles: z.array(guiProfileRecordSchema),
    notifications: guiNotificationPreferenceSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export const guiJobKindSchema = z.enum([
  'auth-login',
  'auth-import-browser',
  'crawl',
  'normalize',
  'rank',
  'mirror-build',
  'mirror-serve',
  'snapshot-finalize',
]);

export const guiJobStatusSchema = z.enum([
  'queued',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
]);

export const guiJobCountersSchema = z
  .object({
    pending: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    inProgress: z.number().int().nonnegative(),
  })
  .strict();

export const guiCrawlFailureSchema = z
  .object({
    key: z.string().min(1).optional(),
    id: z.number().int().nonnegative().optional(),
    url: z.string().min(1),
    attemptCount: z.number().int().nonnegative(),
    lastError: z.string().min(1),
    visibleAt: z.string().datetime().optional(),
  })
  .strict();

export const guiCrawlStatusSchema = z
  .object({
    snapshotId: z.string().min(1),
    queuePath: z.string().min(1),
    status: z.enum(['in_progress', 'completed']).optional(),
    pending: z.number().int().nonnegative(),
    completed: z.number().int().nonnegative(),
    inProgress: z.number().int().nonnegative(),
    publishEligible: z.boolean(),
    recentFailures: z.array(guiCrawlFailureSchema),
  })
  .strict();

export const guiArchiveDatasetSummarySchema = z
  .object({
    dataset: guiArchiveDatasetSchema,
    label: z.string().min(1),
    count: z.number().int().nonnegative(),
    directoryPath: z.string().min(1),
    description: z.string().min(1),
  })
  .strict();

const mirrorLocationFields = {
  snapshotId: z.string().min(1),
  normalizedRoot: z.string().min(1),
  mirrorRoot: z.string().min(1),
  mirrorServeCommand: z.string().min(1),
  mirrorUrl: z.string().min(1),
} as const;

export const guiArchiveSummarySchema = z
  .object({
    ...mirrorLocationFields,
    datasets: z.array(guiArchiveDatasetSummarySchema),
  })
  .strict();

export const guiArchiveRecordSummarySchema = z
  .object({
    dataset: guiArchiveDatasetSchema,
    recordId: z.string().min(1),
    title: z.string().min(1),
    subtitle: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
    filePath: z.string().min(1),
    mirrorRoute: z.string().min(1).optional(),
  })
  .strict();

export const guiArchiveListingSchema = z
  .object({
    snapshotId: z.string().min(1),
    dataset: guiArchiveDatasetSchema,
    totalCount: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    items: z.array(guiArchiveRecordSummarySchema),
  })
  .strict();

export const guiArchiveRecordDetailSchema = z
  .object({
    snapshotId: z.string().min(1),
    dataset: guiArchiveDatasetSchema,
    recordId: z.string().min(1),
    title: z.string().min(1),
    subtitle: z.string().min(1).optional(),
    filePath: z.string().min(1),
    mirrorRoute: z.string().min(1).optional(),
    payload: z.unknown(),
  })
  .strict();

export const guiCoverageRecordSchema = z
  .object({
    problemId: z.number().int().positive(),
    slug: z.string().min(1),
    name: z.string().min(1),
    grade: z.number().int().positive().optional(),
    mirrorRoute: z.string().min(1),
    tags: z.array(z.string().min(1)),
    solvedByMe: z.boolean(),
    evaluationCount: z.number().int().nonnegative(),
    solvedEvaluationCount: z.number().int().nonnegative(),
    rankingPresent: z.boolean(),
    testsFragmentArchived: z.boolean(),
    exampleTestsAvailableCount: z.number().int().nonnegative(),
    visibleTestsCapturedCount: z.number().int().nonnegative(),
    evaluationObservedTestsCount: z.number().int().nonnegative(),
    effectiveTestsAvailableCount: z.number().int().nonnegative(),
    testsCoverageStatus: z.enum(['captured', 'not-available-upstream', 'not-captured-yet']),
    officialSolutionPresent: z.boolean(),
    officialSourceArchived: z.boolean(),
    officialSourceLanguages: z.array(z.string().min(1)),
    officialSourceStatus: z.enum([
      'archived',
      'restricted-upstream',
      'not-available-upstream',
      'not-captured-yet',
    ]),
    userSourceArchived: z.boolean(),
    userSourceLanguages: z.array(z.string().min(1)),
    requiredTrustworthyUserSourceLanguages: z.array(z.string().min(1)),
    trustworthyUserSourceLanguages: z.array(z.string().min(1)),
    bestTrustworthyUserPerLanguage: z.record(z.string(), z.number().int().positive()),
    missingTrustworthyUserSourceLanguages: z.array(z.string().min(1)),
    archiveCompletenessStatus: z.enum([
      'complete',
      'unsolved',
      'not-archived-yet',
      'missing-official-source',
      'missing-user-source',
      'incomplete',
    ]),
    editorialAvailability: z.enum(['visible', 'restricted', 'hidden', 'unknown']),
    testsAvailable: z.boolean(),
    unsolvedByConfiguredHandle: z.boolean(),
    officialSourceBlocked: z.boolean(),
    officialSourceBlockedReason: z.string().min(1).optional(),
    notArchivedYet: z.boolean(),
    newSinceBaseline: z.boolean(),
    notes: z.array(z.string()),
  })
  .strict();

export const guiCoverageSummarySchema = z
  .object({
    ...mirrorLocationFields,
    coverageRoot: z.string().min(1),
    totalProblems: z.number().int().nonnegative(),
    solvedByMeCount: z.number().int().nonnegative(),
    statementArchivedCount: z.number().int().nonnegative(),
    solutionFragmentArchivedCount: z.number().int().nonnegative(),
    testsFragmentArchivedCount: z.number().int().nonnegative(),
    problemsWithExamples: z.number().int().nonnegative(),
    problemsWithVisibleTestsCaptured: z.number().int().nonnegative(),
    problemsWithEvaluationObservedTests: z.number().int().nonnegative(),
    problemsWithEffectiveTests: z.number().int().nonnegative(),
    problemsWithArchivedSources: z.number().int().nonnegative(),
    problemsWithOfficialSourceArchived: z.number().int().nonnegative(),
    problemsWithUserSourceArchived: z.number().int().nonnegative(),
    editorialVisibleCount: z.number().int().nonnegative(),
    rankingPresentCount: z.number().int().nonnegative(),
    newSinceBaselineCount: z.number().int().nonnegative(),
    completeProblemCount: z.number().int().nonnegative(),
    incompleteSolvedProblemCount: z.number().int().nonnegative(),
    missingOfficialSourceCaptureCount: z.number().int().nonnegative(),
    officialSourceUnavailableUpstreamCount: z.number().int().nonnegative(),
    missingTestsCaptureCount: z.number().int().nonnegative(),
    testsUnavailableUpstreamCount: z.number().int().nonnegative(),
    unsolvedProblemCount: z.number().int().nonnegative().optional(),
    missingOfficialSourceCount: z.number().int().nonnegative().optional(),
    solvedByMeMissingUserSourceCount: z.number().int().nonnegative().optional(),
    unsolvedProblemIds: z.array(z.number().int().positive()).optional(),
    missingOfficialSourceProblemIds: z.array(z.number().int().positive()).optional(),
    solvedByMeMissingUserSourceProblemIds: z.array(z.number().int().positive()).optional(),
  })
  .strict();

export const guiCoverageListingSchema = z
  .object({
    snapshotId: z.string().min(1),
    totalCount: z.number().int().nonnegative(),
    offset: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    items: z.array(guiCoverageRecordSchema),
  })
  .strict();

export const guiCoverageDetailSchema = z
  .object({
    snapshotId: z.string().min(1),
    record: guiCoverageRecordSchema.extend({
      canonicalUrl: z.string().url().optional(),
      sourceListUrl: z.string().url().optional(),
      statementArchived: z.boolean(),
      solutionFragmentArchived: z.boolean(),
      officialSourceCount: z.number().int().nonnegative(),
      userSourceCount: z.number().int().nonnegative(),
      hasAnyArchivedSource: z.boolean(),
      bestUserOverallEvaluationId: z.number().int().positive().optional(),
      evaluationIds: z.array(z.number().int().positive()),
    }),
    coverageFilePath: z.string().min(1),
    rawRecordLinks: z
      .object({
        coverageFilePath: z.string().min(1),
        problemFilePath: z.string().min(1),
        rankingFilePath: z.string().min(1).optional(),
        evaluationFilePaths: z.array(z.string().min(1)),
        officialSourceFilePaths: z.array(z.string().min(1)),
        userSourceFilePaths: z.array(z.string().min(1)),
      })
      .strict(),
  })
  .strict();

export const guiJobEventSchema = z
  .object({
    timestamp: z.string().datetime(),
    level: z.enum(['debug', 'info', 'warn', 'error']),
    stage: z.string().min(1),
    message: z.string().min(1),
    counters: guiJobCountersSchema.optional(),
    detail: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const guiJobRecordSchema = z
  .object({
    jobId: z.string().min(1),
    kind: guiJobKindSchema,
    status: guiJobStatusSchema,
    profileId: z.string().min(1).optional(),
    snapshotId: z.string().min(1).optional(),
    detail: z.record(z.string(), z.unknown()).optional(),
    logPath: z.string().min(1),
    resumable: z.boolean(),
    latestCounters: guiJobCountersSchema.optional(),
    latestEvent: guiJobEventSchema.optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();

export type PersistedCookie = z.infer<typeof persistedCookieSchema>;
export type GuiProfileProvenance = z.infer<typeof profileProvenanceSchema>;
export type GuiNotificationPreference = z.infer<typeof guiNotificationPreferenceSchema>;
export type GuiVerbosityMode = z.infer<typeof guiVerbosityModeSchema>;
export type GuiCrawlMode = z.infer<typeof guiCrawlModeSchema>;
export type GuiArchiveDataset = z.infer<typeof guiArchiveDatasetSchema>;
export type GuiCoverageSolvedFilter = z.infer<typeof guiCoverageSolvedFilterSchema>;
export type GuiCoveragePresenceFilter = z.infer<typeof guiCoveragePresenceFilterSchema>;
export type GuiCoverageEditorialFilter = z.infer<typeof guiCoverageEditorialFilterSchema>;
export type GuiCoverageTestsStatusFilter = z.infer<typeof guiCoverageTestsStatusFilterSchema>;
export type GuiCoverageArchiveStateFilter = z.infer<typeof guiCoverageArchiveStateFilterSchema>;

/**
 * Filter/pagination inputs shared by the coverage listing bridge channel and
 * the main-process coverage explorer query layer.
 */
export interface GuiCoverageQuery {
  snapshotId?: string;
  query?: string;
  offset?: number;
  limit?: number;
  solved?: GuiCoverageSolvedFilter;
  testsFragmentArchived?: GuiCoveragePresenceFilter;
  visibleTestsCaptured?: GuiCoveragePresenceFilter;
  testsCoverageStatus?: GuiCoverageTestsStatusFilter;
  officialSourceArchived?: GuiCoveragePresenceFilter;
  userSourceArchived?: GuiCoveragePresenceFilter;
  editorialAvailability?: GuiCoverageEditorialFilter;
  archiveCompletenessStatus?: GuiCoverageArchiveStateFilter;
  grade?: number;
}

/**
 * Job-start request shared by the bridge `startJob` channel and the main-process
 * desktop controller.
 */
export interface GuiStartJobInput {
  kind: 'crawl' | 'normalize' | 'rank' | 'mirror-build' | 'snapshot-finalize';
  snapshotId?: string;
  profileId?: string;
  detail?: {
    scope?: 'public' | 'user' | 'all';
    mode?: GuiCrawlMode;
    [key: string]: unknown;
  };
  maxIterations?: number;
}

export type DesktopPreferencesRecord = z.infer<typeof desktopPreferencesRecordSchema>;
export type GuiProfileRecord = z.infer<typeof guiProfileRecordSchema>;
export type GuiWorkspaceState = z.infer<typeof guiWorkspaceStateSchema>;
export type GuiJobKind = z.infer<typeof guiJobKindSchema>;
export type GuiJobStatus = z.infer<typeof guiJobStatusSchema>;
export type GuiJobCounters = z.infer<typeof guiJobCountersSchema>;
export type GuiCrawlFailure = z.infer<typeof guiCrawlFailureSchema>;
export type GuiCrawlStatus = z.infer<typeof guiCrawlStatusSchema>;
export type GuiArchiveDatasetSummary = z.infer<typeof guiArchiveDatasetSummarySchema>;
export type GuiArchiveSummary = z.infer<typeof guiArchiveSummarySchema>;
export type GuiArchiveRecordSummary = z.infer<typeof guiArchiveRecordSummarySchema>;
export type GuiArchiveListing = z.infer<typeof guiArchiveListingSchema>;
export type GuiArchiveRecordDetail = z.infer<typeof guiArchiveRecordDetailSchema>;
export type GuiCoverageRecord = z.infer<typeof guiCoverageRecordSchema>;
export type GuiCoverageSummary = z.infer<typeof guiCoverageSummarySchema>;
export type GuiCoverageListing = z.infer<typeof guiCoverageListingSchema>;
export type GuiCoverageDetail = z.infer<typeof guiCoverageDetailSchema>;
export type GuiJobEvent = z.infer<typeof guiJobEventSchema>;
export type GuiJobRecord = z.infer<typeof guiJobRecordSchema>;
