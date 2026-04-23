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
