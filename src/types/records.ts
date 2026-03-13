export type CrawlKind =
  | 'public-page'
  | 'public-asset'
  | 'problem-statement'
  | 'problem-solution'
  | 'problem-tests'
  | 'user-solutions'
  | 'user-profile'
  | 'evaluation-detail'
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
}

export interface ProblemEditorialRecord {
  availability: 'visible' | 'restricted' | 'hidden' | 'unknown';
  message?: string;
  artifactPath?: string;
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
  officialSourceIds?: Record<string, string>;
  visibleTests: ProblemVisibleTest[];
  linkedAssets: ProblemAssetRecord[];
  sourceListUrl?: string;
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
  suspicionFlags: string[];
  provenance: string[];
}

export interface BestSubmissionRecord {
  problemId: number;
  bestUserOverallEvaluationId?: number;
  bestUserPerLanguage: Record<string, number>;
  bestOfficialPerLanguage: Record<string, string>;
  orderedUserEvaluationIds: number[];
}

export interface MirrorRouteRecord {
  snapshotId: string;
  route: string;
  sourceUrl?: string;
  sourceFile?: string;
  rewrittenFile?: string;
  template: 'problem' | 'evaluation' | 'user-profile' | 'raw-page';
  entityKey: string;
}

export interface RankedProblemSubmissions {
  bestUserOverallEvaluationId?: number;
  bestUserPerLanguage: Record<string, number>;
  bestOfficialPerLanguage: Record<string, string>;
  orderedUserEvaluationIds: number[];
}
