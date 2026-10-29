export type CrawlKind =
  | 'public-page'
  | 'public-asset'
  | 'official-source-list'
  | 'problem-statement'
  | 'problem-solution'
  | 'problem-tests'
  | 'user-solutions'
  | 'user-profile'
  | 'evaluation-detail'
  | 'official-evaluation-detail'
  | 'mirror-route';

export interface PageRecord {
  snapshotId: string;
  url: string;
  kind: CrawlKind;
  httpStatus: number;
  contentType?: string;
  contentHash?: string;
  bodyPath?: string;
  browserBodyPath?: string;
  fetchedAt: string;
}

export interface CategoryLink {
  id: number;
  name: string;
  slug: string;
  href: string;
  itemListHref?: string;
}

export interface CategoryRecord extends CategoryLink {
  grade: number;
  subcategories: CategoryLink[];
}

export interface ProblemStatementSection {
  title: string;
  html: string;
  text: string;
}

export interface ProblemExample {
  input: string;
  output: string;
  explanation?: string;
}

export interface ProblemVisibleTest {
  title: string;
  input: string;
  output: string;
  score?: number;
  exampleLike?: boolean;
}

export interface ProblemEditorialRecord {
  availability: 'visible' | 'restricted' | 'hidden' | 'unknown';
  message?: string;
  artifactPath?: string;
}

export interface OfficialSourceHarvestRecord {
  sourceListHarvested: boolean;
  sourceListPageUrl?: string;
  authorHandle?: string;
  qualifyingEvaluationIds?: number[];
}

export interface ProblemRecord {
  id: number;
  slug: string;
  name: string;
  canonicalUrl?: string;
  grade?: number;
  categoryChain: CategoryLink[];
  tags: string[];
  sections: ProblemStatementSection[];
  examples: ProblemExample[];
  constraints: string[];
  timeLimitSeconds?: number;
  memoryLimitMb?: number;
  author?: string;
  sourceAttribution?: string;
  editorialAvailability: 'visible' | 'restricted' | 'hidden' | 'unknown';
  editorialMessage?: string;
  editorial?: ProblemEditorialRecord;
  officialSolutions: Record<string, string>;
  officialSourceIds?: Record<string, string[]>;
  userSourceIds?: Record<string, string[]>;
  visibleTests: ProblemVisibleTest[];
  linkedAssets: ProblemAssetRecord[];
  sourceListUrl?: string;
  officialSourceHarvest?: OfficialSourceHarvestRecord;
  metadata: Record<string, string>;
}

export interface ProblemAssetRecord {
  url: string;
  localPath: string;
  snapshotId?: string;
  mimeType?: string;
  kind: 'stylesheet' | 'script' | 'image' | 'font' | 'other';
}

export interface EvaluationTestResult {
  index: number;
  runtimeSeconds?: number;
  verdict: string;
  score: number;
  maxScore: number;
  details: string;
}

export interface SubmissionRecord {
  evaluationId: number;
  problemId: number;
  problemSlug: string;
  language: string;
  user: string;
  score: number;
  verdictSummary: string;
  runtimeSeconds?: number;
  memoryKb?: number;
  sourceAvailable: boolean;
  sourceCode?: string;
  suspicionFlags: string[];
  tests: EvaluationTestResult[];
  fetchedAt: string;
  provenance: string[];
}

export interface EvaluationRecord extends SubmissionRecord {
  problemName: string;
  compileLog?: string;
}

export interface SourceRecord {
  sourceId: string;
  kind: 'official' | 'user-evaluation' | 'user-solution-page';
  problemId: number;
  evaluationId?: number;
  userHandle?: string;
  language: string;
  score?: number;
  runtimeSeconds?: number;
  memoryKb?: number;
  sourceAvailable: boolean;
  sourceCode?: string;
  sourceHash?: string;
  normalizedSourceHash?: string;
  sourceLength?: number;
  fetchedAt?: string;
  provenanceType?: 'official-fragment' | 'evaluation-detail' | 'browser-fallback' | 'imported';
  duplicateOf?: string;
  duplicateGroupId?: string;
  suspicionFlags: string[];
  provenance: string[];
}

export interface BestSubmissionRecord {
  problemId: number;
  bestUserOverallEvaluationId?: number;
  bestUserPerLanguage: Record<string, number>;
  bestTrustworthyOverallEvaluationId?: number;
  bestTrustworthyPerLanguage: Record<string, number>;
  bestFastPerLanguage: Record<string, number>;
  bestOfficialPerLanguage: Record<string, string>;
  suspiciousCandidateEvaluationIds: number[];
  duplicateEvaluationIds: number[];
  orderedUserEvaluationIds: number[];
}

export interface MirrorRouteRecord {
  snapshotId: string;
  route: string;
  sourceUrl?: string;
  sourceFile?: string;
  rewrittenFile?: string;
  template: 'problem' | 'evaluation' | 'user-profile' | 'raw-page' | 'coverage-index';
  entityKey: string;
}

export interface RankedProblemSubmissions {
  bestUserOverallEvaluationId?: number;
  bestUserPerLanguage: Record<string, number>;
  bestTrustworthyOverallEvaluationId?: number;
  bestTrustworthyPerLanguage: Record<string, number>;
  bestFastPerLanguage: Record<string, number>;
  bestOfficialPerLanguage: Record<string, string>;
  suspiciousCandidateEvaluationIds: number[];
  duplicateEvaluationIds: number[];
  orderedUserEvaluationIds: number[];
}

export interface ProblemTestCaseRecord {
  testId: string;
  kind: 'example' | 'visible' | 'evaluationObserved';
  label?: string;
  input?: string;
  output?: string;
  explanation?: string;
  evaluationId?: number;
  index?: number;
  verdict?: string;
  score?: number;
  maxScore?: number;
  details?: string;
  exampleLike?: boolean;
  provenanceKinds?: Array<'example' | 'visible' | 'evaluationObserved'>;
  sourceTestIds?: string[];
}

export interface ProblemTestsRecord {
  snapshotId: string;
  problemId: number;
  problemSlug: string;
  problemName: string;
  examples: ProblemTestCaseRecord[];
  visible: ProblemTestCaseRecord[];
  evaluationObserved: ProblemTestCaseRecord[];
  effective: ProblemTestCaseRecord[];
}

export type ProblemTestsCoverageStatus = 'captured' | 'not-available-upstream' | 'not-captured-yet';

export type ProblemOfficialSourceStatus =
  | 'archived'
  | 'restricted-upstream'
  | 'not-available-upstream'
  | 'not-captured-yet';

export type ProblemArchiveCompletenessStatus =
  | 'complete'
  | 'unsolved'
  | 'not-archived-yet'
  | 'missing-official-source'
  | 'missing-user-source'
  | 'incomplete';

export interface ProblemCoverageRecord {
  snapshotId: string;
  problemId: number;
  slug: string;
  name: string;
  grade?: number;
  canonicalUrl?: string;
  mirrorRoute: string;
  tags: string[];
  solvedByMe: boolean;
  evaluationCount: number;
  solvedEvaluationCount: number;
  rankingPresent: boolean;
  statementArchived: boolean;
  solutionFragmentArchived: boolean;
  testsFragmentArchived: boolean;
  exampleTestsAvailableCount: number;
  visibleTestsCapturedCount: number;
  evaluationObservedTestsCount: number;
  effectiveTestsAvailableCount: number;
  testsCoverageStatus: ProblemTestsCoverageStatus;
  officialSolutionPresent: boolean;
  editorialAvailability: 'visible' | 'restricted' | 'hidden' | 'unknown';
  sourceListUrl?: string;
  officialSourceArchived: boolean;
  officialSourceCount: number;
  officialSourceIds: string[];
  officialSourceLanguages: string[];
  officialSourceStatus: ProblemOfficialSourceStatus;
  userSourceArchived: boolean;
  userSourceCount: number;
  userSourceIds: string[];
  userSourceLanguages: string[];
  requiredTrustworthyUserSourceLanguages: string[];
  trustworthyUserSourceLanguages: string[];
  bestTrustworthyUserPerLanguage: Record<string, number>;
  missingTrustworthyUserSourceLanguages: string[];
  archiveCompletenessStatus: ProblemArchiveCompletenessStatus;
  hasAnyArchivedSource: boolean;
  testsAvailable: boolean;
  unsolvedByConfiguredHandle: boolean;
  officialSourceBlocked: boolean;
  officialSourceBlockedReason?: string;
  notArchivedYet: boolean;
  newSinceBaseline: boolean;
  evaluationIds: number[];
  bestUserOverallEvaluationId?: number;
  notes: string[];
}

export interface ProblemCoverageTotals {
  totalProblems: number;
  solvedByMeCount: number;
  statementArchivedCount: number;
  solutionFragmentArchivedCount: number;
  testsFragmentArchivedCount: number;
  problemsWithExamples: number;
  problemsWithVisibleTestsCaptured: number;
  problemsWithEvaluationObservedTests: number;
  problemsWithEffectiveTests: number;
  problemsWithArchivedSources: number;
  problemsWithOfficialSourceArchived: number;
  problemsWithUserSourceArchived: number;
  editorialVisibleCount: number;
  rankingPresentCount: number;
  newSinceBaselineCount: number;
}

export interface ProblemCoverageIndex {
  snapshotId: string;
  generatedAt: string;
  totals: ProblemCoverageTotals;
  records: ProblemCoverageRecord[];
}
