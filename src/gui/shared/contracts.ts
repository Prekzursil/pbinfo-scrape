import { z } from 'zod';

import {
  guiArchiveDatasetSchema,
  guiCoverageArchiveStateFilterSchema,
  guiCoverageEditorialFilterSchema,
  guiCoveragePresenceFilterSchema,
  guiCoverageProgressFilterSchema,
  guiCoverageSolvedFilterSchema,
  guiCoverageSortDirSchema,
  guiCoverageSortKeySchema,
  guiCoverageTestsStatusFilterSchema,
  guiCrawlModeSchema,
  guiVerbosityModeSchema,
  guiJobKindSchema,
  persistedCookieSchema,
  profileProvenanceSchema,
} from './types.js';

export const guiWorkspaceSelectionSchema = z
  .object({
    workspaceRoot: z.string().min(1),
  })
  .strict();

export const createProfileInputSchema = z
  .object({
    profileId: z.string().min(1),
    label: z.string().min(1),
    userHandle: z.string().min(1).optional(),
    provenance: profileProvenanceSchema,
    sessionCookies: z.array(persistedCookieSchema),
    encryptedBundlePath: z.string().min(1).optional(),
  })
  .strict();

export const desktopCredentialLoginInputSchema = z
  .object({
    profileId: z.string().min(1),
    label: z.string().min(1),
    userHandle: z.string().min(1).optional(),
    username: z.string().min(1),
    password: z.string().min(1),
    encryptedBundlePath: z.string().min(1).optional(),
  })
  .strict();

export const desktopBrowserImportInputSchema = z
  .object({
    profileId: z.string().min(1),
    label: z.string().min(1),
    userHandle: z.string().min(1).optional(),
    browser: z.enum(['edge', 'chrome']),
    profileName: z.string().min(1).optional(),
    userDataDir: z.string().min(1).optional(),
    encryptedBundlePath: z.string().min(1).optional(),
  })
  .strict();

export const guiJobStartInputSchema = z
  .object({
    kind: guiJobKindSchema.exclude([
      'auth-login',
      'auth-import-browser',
      'mirror-serve',
    ]),
    snapshotId: z.string().min(1).optional(),
    profileId: z.string().min(1).optional(),
    detail: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export const guiCrawlJobDetailSchema = z
  .object({
    scope: z.enum(['public', 'user', 'all']),
    mode: guiCrawlModeSchema.default('incremental'),
  })
  .strict();

export const guiCrawlStatusInputSchema = z
  .object({
    snapshotId: z.string().min(1).optional(),
  })
  .strict();

export const guiJobEventsInputSchema = z
  .object({
    jobId: z.string().min(1),
    limit: z.number().int().positive().max(200).optional(),
  })
  .strict();

export const guiArchiveSummaryInputSchema = z
  .object({
    snapshotId: z.string().min(1).optional(),
  })
  .strict();

export const guiArchiveListInputSchema = z
  .object({
    snapshotId: z.string().min(1).optional(),
    dataset: guiArchiveDatasetSchema,
    query: z.string().min(1).optional(),
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().max(100).optional(),
  })
  .strict();

export const guiArchiveDetailInputSchema = z
  .object({
    snapshotId: z.string().min(1).optional(),
    dataset: guiArchiveDatasetSchema,
    recordId: z.string().min(1),
  })
  .strict();

export const guiCoverageSummaryInputSchema = z
  .object({
    snapshotId: z.string().min(1).optional(),
  })
  .strict();

export const guiCoverageListInputSchema = z
  .object({
    snapshotId: z.string().min(1).optional(),
    query: z.string().min(1).optional(),
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().max(500).optional(),
    solved: guiCoverageSolvedFilterSchema.optional(),
    testsFragmentArchived: guiCoveragePresenceFilterSchema.optional(),
    visibleTestsCaptured: guiCoveragePresenceFilterSchema.optional(),
    testsCoverageStatus: guiCoverageTestsStatusFilterSchema.optional(),
    officialSourceArchived: guiCoveragePresenceFilterSchema.optional(),
    userSourceArchived: guiCoveragePresenceFilterSchema.optional(),
    editorialAvailability: guiCoverageEditorialFilterSchema.optional(),
    archiveCompletenessStatus: guiCoverageArchiveStateFilterSchema.optional(),
    grade: z.number().int().positive().optional(),
    progressState: guiCoverageProgressFilterSchema.optional(),
    languagesTried: z.array(z.string().min(1)).optional(),
    bestScoreMin: z.number().min(0).max(100).optional(),
    bestScoreMax: z.number().min(0).max(100).optional(),
    sortBy: guiCoverageSortKeySchema.optional(),
    sortDir: guiCoverageSortDirSchema.optional(),
  })
  .strict();

export const guiCoverageDetailInputSchema = z
  .object({
    snapshotId: z.string().min(1).optional(),
    problemId: z.number().int().positive(),
  })
  .strict();

export const guiOpenExternalInputSchema = z
  .object({
    url: z.string().url(),
  })
  .strict();

export const guiOpenPathInputSchema = z
  .object({
    path: z.string().min(1),
  })
  .strict();

export const desktopPreferencesUpdateSchema = z
  .object({
    verbosityMode: guiVerbosityModeSchema,
  })
  .strict();

export const viewerNavigateInputSchema = z
  .object({
    url: z.string().url(),
  })
  .strict();

export const viewerSetBoundsInputSchema = z
  .object({
    x: z.number().int().nonnegative(),
    y: z.number().int().nonnegative(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

export const viewerSnapshotSchema = z
  .object({
    url: z.string(),
    canGoBack: z.boolean(),
    canGoForward: z.boolean(),
  })
  .strict();

export type GuiWorkspaceSelectionInput = z.infer<
  typeof guiWorkspaceSelectionSchema
>;
export type CreateProfileInput = z.infer<typeof createProfileInputSchema>;
export type DesktopCredentialLoginInput = z.infer<
  typeof desktopCredentialLoginInputSchema
>;
export type DesktopBrowserImportInput = z.infer<
  typeof desktopBrowserImportInputSchema
>;
export type GuiJobStartInput = z.infer<typeof guiJobStartInputSchema>;
export type GuiCrawlJobDetailInput = z.infer<typeof guiCrawlJobDetailSchema>;
export type GuiArchiveSummaryInput = z.infer<typeof guiArchiveSummaryInputSchema>;
export type GuiArchiveListInput = z.infer<typeof guiArchiveListInputSchema>;
export type GuiArchiveDetailInput = z.infer<typeof guiArchiveDetailInputSchema>;
export type GuiCoverageSummaryInput = z.infer<
  typeof guiCoverageSummaryInputSchema
>;
export type GuiCoverageListInput = z.infer<typeof guiCoverageListInputSchema>;
export type GuiCoverageDetailInput = z.infer<typeof guiCoverageDetailInputSchema>;
export type ViewerNavigateInput = z.infer<typeof viewerNavigateInputSchema>;
export type ViewerSetBoundsInput = z.infer<typeof viewerSetBoundsInputSchema>;
export type ViewerSnapshot = z.infer<typeof viewerSnapshotSchema>;
export type DesktopPreferencesUpdateInput = z.infer<
  typeof desktopPreferencesUpdateSchema
>;

// Library browser redesign (2026-04-23) — archive + theme IPC contracts.

export const archiveSetManualOverrideInputSchema = z
  .object({
    absolutePath: z.string().min(1).max(4096),
  })
  .strict();

export const archiveSwitchSnapshotInputSchema = z
  .object({
    snapshotId: z.string().min(1).max(64),
  })
  .strict();

export const archiveProbeResultSchema = z
  .object({
    found: z.boolean(),
    archiveRoot: z.string().optional(),
    snapshotId: z.string().optional(),
    probedPaths: z.array(z.string()),
    catalogSnapshots: z
      .array(
        z.object({
          id: z.string(),
          status: z.string(),
          createdAt: z.string().optional(),
          label: z.string().optional(),
        }),
      )
      .optional(),
  })
  .strict();

export const themePreferenceSchema = z.enum(['auto', 'light', 'dark']);

export const librarySetThemeInputSchema = z
  .object({ preference: themePreferenceSchema })
  .strict();

export const libraryGetThemeResultSchema = z
  .object({
    effective: z.enum(['light', 'dark']),
    preference: themePreferenceSchema,
  })
  .strict();

export type ArchiveSetManualOverrideInput = z.infer<
  typeof archiveSetManualOverrideInputSchema
>;
export type ArchiveSwitchSnapshotInput = z.infer<
  typeof archiveSwitchSnapshotInputSchema
>;
export type ArchiveProbeResultContract = z.infer<typeof archiveProbeResultSchema>;
export type LibrarySetThemeInput = z.infer<typeof librarySetThemeInputSchema>;
export type LibraryGetThemeResult = z.infer<typeof libraryGetThemeResultSchema>;

const pillarFilterSchema = z
  .enum(['all', 'captured', 'missing', 'restricted', 'not-applicable'])
  .default('all');

export const libraryListInputSchema = z
  .object({
    snapshotId: z.string().optional(),
    filters: z
      .object({
        search: z.string().max(256).default(''),
        grades: z.array(z.number().int().min(5).max(12)).default([]),
        progress: z
          .enum(['all', 'solved', 'partial', 'not-attempted'])
          .default('all'),
        completeness: z
          .enum([
            'all',
            'complete',
            'incomplete-my-gap',
            'incomplete-upstream',
            'never-crawled',
          ])
          .default('all'),
        statement: pillarFilterSchema,
        editorial: pillarFilterSchema,
        officialSource: pillarFilterSchema,
        mySource: pillarFilterSchema,
        tests: pillarFilterSchema,
        languagesTried: z.array(z.string().max(16)).default([]),
        bestScoreRange: z
          .tuple([z.number().min(0).max(100), z.number().min(0).max(100)])
          .default([0, 100]),
        tags: z.array(z.string().max(64)).default([]),
      })
      .strict(),
    sort: z
      .object({
        key: z
          .enum(['id', 'name', 'grade', 'progress', 'bestScore'])
          .default('id'),
        dir: z.enum(['asc', 'desc']).default('asc'),
      })
      .strict(),
    limit: z.number().int().min(1).max(5000).default(2500),
    offset: z.number().int().min(0).default(0),
  })
  .strict();

export const libraryTagsInputSchema = z
  .object({ snapshotId: z.string().optional() })
  .strict();

export const libraryDetailInputSchema = z
  .object({
    snapshotId: z.string().optional(),
    problemId: z.number().int().positive(),
  })
  .strict();

export type LibraryListInput = z.infer<typeof libraryListInputSchema>;
export type LibraryTagsInput = z.infer<typeof libraryTagsInputSchema>;
export type LibraryDetailInput = z.infer<typeof libraryDetailInputSchema>;
