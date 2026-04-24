import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { sanitizeArchiveHtml } from '../../pbinfo/html/sanitize-archive-html.js';

export interface TestCase {
  readonly id: string;
  readonly kind: 'example' | 'visible';
  readonly inputBody: string;
  readonly expectedBody: string;
  readonly evaluationVerdicts?: Record<string, string>;
}

export interface EvaluationSummary {
  readonly evaluationId: number;
  readonly score: number;
  readonly language: string;
  readonly verdict?: string;
  readonly submittedAt?: string;
  readonly runtime?: number;
  readonly memory?: number;
}

export type Language = string;

export interface ProblemDetailPayload {
  readonly problem: {
    readonly problemId: number;
    readonly slug: string;
    readonly name: string;
    readonly statementHtml?: string;
    readonly constraints: readonly string[];
    readonly executionLimits?: {
      readonly timeSeconds?: number;
      readonly memoryMb?: number;
    };
  };
  readonly coverage: {
    readonly problemId: number;
    readonly slug: string;
    readonly name: string;
    readonly statementArchived: boolean;
    readonly officialSourceArchived: boolean;
    readonly officialSourceStatus: string;
    readonly editorialAvailability:
      | 'visible'
      | 'restricted'
      | 'hidden'
      | 'unknown';
    readonly testsCoverageStatus: string;
    readonly evaluationIds: readonly number[];
    readonly userSourceArchived: boolean;
    readonly userSourceLanguages: readonly string[];
  };
  readonly tests: {
    readonly folderPath: string;
    readonly cases: readonly TestCase[];
  };
  readonly submissions: {
    readonly evaluations: readonly EvaluationSummary[];
    readonly sourceBodies: Record<number, string>;
  };
  readonly officialSource: {
    readonly availability: string;
    readonly bodies?: Record<Language, { body: string; filePath: string }>;
  };
  readonly editorial: {
    readonly availability: 'visible' | 'restricted' | 'hidden' | 'unknown';
    readonly htmlBody?: string;
    readonly filePath?: string;
  };
  readonly rawPaths: {
    readonly normalized: string;
    readonly coverage: string;
    readonly evaluations: readonly string[];
    readonly sources: readonly string[];
    readonly rawHtmlPages: readonly string[];
  };
}

interface CoverageFile {
  readonly problemId: number;
  readonly slug: string;
  readonly name: string;
  readonly statementArchived?: boolean;
  readonly officialSourceArchived?: boolean;
  readonly officialSourceStatus?: string;
  readonly officialSourceLanguages?: readonly string[];
  readonly editorialAvailability?:
    | 'visible'
    | 'restricted'
    | 'hidden'
    | 'unknown';
  readonly testsCoverageStatus?: string;
  readonly evaluationIds?: readonly number[];
  readonly userSourceArchived?: boolean;
  readonly userSourceLanguages?: readonly string[];
}

interface ProblemFile {
  readonly problemId: number;
  readonly slug: string;
  readonly name: string;
  readonly statementHtml?: string;
  readonly constraints?: readonly string[];
  readonly executionLimits?: {
    readonly timeSeconds?: number;
    readonly memoryMb?: number;
  };
}

interface EvaluationFile {
  readonly evaluationId: number;
  readonly score: number;
  readonly language: string;
  readonly verdict?: string;
  readonly submittedAt?: string;
  readonly runtime?: number;
  readonly memory?: number;
}

interface TestsFile {
  readonly cases?: readonly TestCase[];
}

export async function loadProblemDetail(
  archiveRoot: string,
  snapshotId: string,
  problemId: number,
): Promise<ProblemDetailPayload> {
  const base = join(archiveRoot, 'snapshots', snapshotId);
  const normalizedRoot = join(base, 'normalized');
  const coveragePath = join(
    normalizedRoot,
    'problem-coverage',
    `${problemId}.json`,
  );
  const normalizedPath = join(normalizedRoot, 'problems', `${problemId}.json`);

  const coverage = readJson<CoverageFile>(coveragePath);
  const problemRaw = readJson<ProblemFile>(normalizedPath);
  if (!coverage || !problemRaw) {
    throw new Error(
      `Problem ${problemId} is not present in snapshot ${snapshotId}`,
    );
  }

  const statementHtml = problemRaw.statementHtml
    ? sanitizeArchiveHtml(problemRaw.statementHtml)
    : undefined;

  const evaluations: EvaluationSummary[] = [];
  const sourceBodies: Record<number, string> = {};
  const evaluationFiles: string[] = [];
  for (const evalId of coverage.evaluationIds ?? []) {
    const evalPath = join(normalizedRoot, 'evaluations', `${evalId}.json`);
    const parsed = readJson<EvaluationFile>(evalPath);
    if (!parsed) continue;
    evaluations.push({
      evaluationId: parsed.evaluationId,
      score: parsed.score,
      language: parsed.language,
      verdict: parsed.verdict,
      submittedAt: parsed.submittedAt,
      runtime: parsed.runtime,
      memory: parsed.memory,
    });
    evaluationFiles.push(evalPath);

    if (parsed.score === 100) {
      const candidate = join(
        normalizedRoot,
        'sources',
        'user',
        `${parsed.evaluationId}.${parsed.language}`,
      );
      if (existsSync(candidate)) {
        sourceBodies[parsed.evaluationId] = readFileSync(candidate, 'utf8');
      }
    }
  }

  const officialBodies: Record<Language, { body: string; filePath: string }> =
    {};
  if (coverage.officialSourceArchived && coverage.officialSourceLanguages) {
    for (const lang of coverage.officialSourceLanguages) {
      const candidate = join(
        normalizedRoot,
        'sources',
        'official',
        `${coverage.problemId}-${coverage.slug}.${lang}`,
      );
      if (existsSync(candidate)) {
        officialBodies[lang] = {
          body: readFileSync(candidate, 'utf8'),
          filePath: candidate,
        };
      }
    }
  }

  const editorialAvailability =
    coverage.editorialAvailability ?? 'unknown';
  const editorialFilePath = join(
    normalizedRoot,
    'editorials',
    `${coverage.problemId}-${coverage.slug}.html`,
  );
  let editorialHtmlBody: string | undefined;
  if (editorialAvailability === 'visible' && existsSync(editorialFilePath)) {
    editorialHtmlBody = sanitizeArchiveHtml(
      readFileSync(editorialFilePath, 'utf8'),
    );
  }

  const testsFolder = join(
    base,
    'tests',
    `${coverage.problemId}-${coverage.slug}`,
  );
  const testsJsonPath = join(testsFolder, 'tests.json');
  const testsJson = readJson<TestsFile>(testsJsonPath);

  const sourceDirs = [
    join(normalizedRoot, 'sources', 'user'),
    join(normalizedRoot, 'sources', 'official'),
  ];
  const sourceFiles: string[] = [];
  for (const dir of sourceDirs) {
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      sourceFiles.push(join(dir, entry));
    }
  }

  return {
    problem: {
      problemId: problemRaw.problemId,
      slug: problemRaw.slug,
      name: problemRaw.name,
      statementHtml,
      constraints: problemRaw.constraints ?? [],
      executionLimits: problemRaw.executionLimits,
    },
    coverage: {
      problemId: coverage.problemId,
      slug: coverage.slug,
      name: coverage.name,
      statementArchived: Boolean(coverage.statementArchived),
      officialSourceArchived: Boolean(coverage.officialSourceArchived),
      officialSourceStatus: coverage.officialSourceStatus ?? 'unknown',
      editorialAvailability,
      testsCoverageStatus: coverage.testsCoverageStatus ?? 'unknown',
      evaluationIds: coverage.evaluationIds ?? [],
      userSourceArchived: Boolean(coverage.userSourceArchived),
      userSourceLanguages: coverage.userSourceLanguages ?? [],
    },
    tests: {
      folderPath: testsFolder,
      cases: testsJson?.cases ?? [],
    },
    submissions: {
      evaluations,
      sourceBodies,
    },
    officialSource: {
      availability: coverage.officialSourceStatus ?? 'unknown',
      bodies: Object.keys(officialBodies).length > 0 ? officialBodies : undefined,
    },
    editorial: {
      availability: editorialAvailability,
      htmlBody: editorialHtmlBody,
      filePath: existsSync(editorialFilePath) ? editorialFilePath : undefined,
    },
    rawPaths: {
      normalized: normalizedPath,
      coverage: coveragePath,
      evaluations: evaluationFiles,
      sources: sourceFiles,
      rawHtmlPages: [],
    },
  };
}

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}
