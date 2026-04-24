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

// Real archive layout (archive/snapshots/<id>/normalized/) confirmed against
// fresh-20260423-full in Task 11.5:
//
//   problem-coverage/problem-<problemId>.json
//   problems/problem-<problemId>.json
//   evaluations/evaluation-<evalId>.json
//   sources/evaluation-<evalId>.json      — user sources (JSON with sourceCode)
//   sources/official-<problemId>-<lang>-<evalId>.json — official sources
//
// Tests live under archive/snapshots/<id>/tests/<problemId>-<slug>/tests.json
// (outside normalized/).
//
// Some fixtures in early Task 6 tests used flat `<id>.json` filenames; the
// loader accepts both naming conventions to avoid a flag-day change to the
// test suite.

interface CoverageFile {
  readonly problemId: number;
  readonly slug: string;
  readonly name: string;
  readonly statementArchived?: boolean;
  readonly officialSourceArchived?: boolean;
  readonly officialSourceStatus?: string;
  readonly officialSourceIds?: readonly string[];
  readonly officialSourceLanguages?: readonly string[];
  readonly editorialAvailability?:
    | 'visible'
    | 'restricted'
    | 'hidden'
    | 'unknown';
  readonly testsCoverageStatus?: string;
  readonly evaluationIds?: readonly number[];
  readonly userSourceIds?: readonly string[];
  readonly userSourceArchived?: boolean;
  readonly userSourceLanguages?: readonly string[];
}

interface ProblemStatementSection {
  readonly title?: string;
  readonly html?: string;
  readonly text?: string;
}

interface ProblemFile {
  // Real archive keys: id, slug, name, sections[], constraints[], examples[]
  // Older fixtures: problemId, statementHtml
  readonly id?: number;
  readonly problemId?: number;
  readonly slug: string;
  readonly name: string;
  readonly statementHtml?: string;
  readonly sections?: readonly ProblemStatementSection[];
  readonly constraints?: readonly string[];
  readonly executionLimits?: {
    readonly timeSeconds?: number;
    readonly memoryMb?: number;
  };
  readonly editorial?: {
    readonly availability?: string;
    readonly artifactPath?: string;
  };
}

function composeStatementHtml(problem: ProblemFile): string | undefined {
  if (typeof problem.statementHtml === 'string' && problem.statementHtml.length > 0) {
    return problem.statementHtml;
  }
  if (problem.sections && problem.sections.length > 0) {
    return problem.sections
      .map((section) => {
        const title = section.title ? `<h3>${escapeHtml(section.title)}</h3>` : '';
        const body = section.html ?? (section.text ? `<p>${escapeHtml(section.text)}</p>` : '');
        return `${title}${body}`;
      })
      .join('\n');
  }
  return undefined;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')
    .replace(/'/gu, '&#39;');
}

interface EvaluationFile {
  readonly evaluationId: number;
  readonly score: number;
  readonly language: string;
  // Real archive stores verdictSummary (e.g., "100 puncte"); older fixtures
  // use verdict.
  readonly verdict?: string;
  readonly verdictSummary?: string;
  readonly submittedAt?: string;
  readonly runtime?: number;
  readonly runtimeSeconds?: number;
  readonly memory?: number;
  readonly memoryKb?: number;
}

interface SourceFile {
  readonly sourceCode?: string;
  readonly kind?: string;
  readonly language?: string;
}

// Real tests.json shape (see archive/snapshots/.../tests/<id>-<slug>/tests.json):
// cases[].index, .provenanceKinds, .label, .input, .output. Older fixtures use
// id, kind, inputBody, expectedBody — accept both.
interface RawTestCase {
  readonly id?: string;
  readonly index?: number;
  readonly label?: string;
  readonly kind?: 'example' | 'visible';
  readonly provenanceKinds?: readonly string[];
  readonly input?: string;
  readonly inputBody?: string;
  readonly output?: string;
  readonly expectedBody?: string;
  readonly evaluationVerdicts?: Record<string, string>;
}

interface TestsFile {
  readonly cases?: readonly RawTestCase[];
}

function normalizeTestCase(raw: RawTestCase): TestCase {
  const id =
    raw.id ?? (typeof raw.index === 'number' ? String(raw.index) : 'case');
  const kind: 'example' | 'visible' =
    raw.kind ??
    (raw.provenanceKinds?.includes('example') ? 'example' : 'visible');
  const inputBody = raw.inputBody ?? raw.input ?? '';
  const expectedBody = raw.expectedBody ?? raw.output ?? '';
  return {
    id,
    kind,
    inputBody,
    expectedBody,
    evaluationVerdicts: raw.evaluationVerdicts,
  };
}

export async function loadProblemDetail(
  archiveRoot: string,
  snapshotId: string,
  problemId: number,
): Promise<ProblemDetailPayload> {
  const base = join(archiveRoot, 'snapshots', snapshotId);
  const normalizedRoot = join(base, 'normalized');

  const coveragePath =
    findFirstExisting(
      join(normalizedRoot, 'problem-coverage', `problem-${problemId}.json`),
      join(normalizedRoot, 'problem-coverage', `${problemId}.json`),
    ) ?? join(normalizedRoot, 'problem-coverage', `problem-${problemId}.json`);
  const normalizedPath =
    findFirstExisting(
      join(normalizedRoot, 'problems', `problem-${problemId}.json`),
      join(normalizedRoot, 'problems', `${problemId}.json`),
    ) ?? join(normalizedRoot, 'problems', `problem-${problemId}.json`);

  const coverage = readJson<CoverageFile>(coveragePath);
  const problemRaw = readJson<ProblemFile>(normalizedPath);
  if (!coverage || !problemRaw) {
    throw new Error(
      `Problem ${problemId} is not present in snapshot ${snapshotId}`,
    );
  }

  const rawStatement = composeStatementHtml(problemRaw);
  const statementHtml = rawStatement
    ? sanitizeArchiveHtml(rawStatement)
    : undefined;

  const evaluations: EvaluationSummary[] = [];
  const sourceBodies: Record<number, string> = {};
  const evaluationFiles: string[] = [];
  const explicitUserSourceIds =
    coverage.userSourceIds && coverage.userSourceIds.length > 0
      ? new Set(
          coverage.userSourceIds.map((id) => normalizeSourceIdToNumber(id)),
        )
      : undefined;
  // Fallback rule: when coverage doesn't enumerate userSourceIds (older
  // fixtures + tests), populate source bodies for every 100-pt evaluation,
  // matching the operator's "only 100-pt sources are archived" rule.
  const shouldPopulateSource = (ev: EvaluationFile): boolean =>
    explicitUserSourceIds
      ? explicitUserSourceIds.has(ev.evaluationId)
      : ev.score === 100;
  for (const evalId of coverage.evaluationIds ?? []) {
    const evalPath =
      findFirstExisting(
        join(normalizedRoot, 'evaluations', `evaluation-${evalId}.json`),
        join(normalizedRoot, 'evaluations', `${evalId}.json`),
      ) ?? join(normalizedRoot, 'evaluations', `evaluation-${evalId}.json`);
    const parsed = readJson<EvaluationFile>(evalPath);
    if (!parsed) continue;
    evaluations.push({
      evaluationId: parsed.evaluationId,
      score: parsed.score,
      language: parsed.language,
      verdict: parsed.verdict ?? parsed.verdictSummary,
      submittedAt: parsed.submittedAt,
      runtime: parsed.runtime ?? parsed.runtimeSeconds,
      memory: parsed.memory ?? parsed.memoryKb,
    });
    evaluationFiles.push(evalPath);

    if (!shouldPopulateSource(parsed)) continue;
    const userSourcePath =
      findFirstExisting(
        join(normalizedRoot, 'sources', `evaluation-${parsed.evaluationId}.json`),
        join(normalizedRoot, 'sources', 'user', `${parsed.evaluationId}.${parsed.language}`),
      );
    if (!userSourcePath) continue;
    if (userSourcePath.endsWith('.json')) {
      const wrapper = readJson<SourceFile>(userSourcePath);
      if (wrapper?.sourceCode) {
        sourceBodies[parsed.evaluationId] = wrapper.sourceCode;
      }
    } else {
      sourceBodies[parsed.evaluationId] = readFileSync(userSourcePath, 'utf8');
    }
  }

  const officialBodies: Record<Language, { body: string; filePath: string }> =
    {};
  const officialPrefix = `official-${coverage.problemId}-`;
  const sourcesDir = join(normalizedRoot, 'sources');
  if (coverage.officialSourceArchived && existsSync(sourcesDir)) {
    const entries = readdirSync(sourcesDir);
    for (const entry of entries) {
      if (!entry.startsWith(officialPrefix) || !entry.endsWith('.json')) {
        continue;
      }
      const wrapper = readJson<SourceFile>(join(sourcesDir, entry));
      if (!wrapper?.sourceCode || !wrapper.language) continue;
      if (!officialBodies[wrapper.language]) {
        officialBodies[wrapper.language] = {
          body: wrapper.sourceCode,
          filePath: join(sourcesDir, entry),
        };
      }
    }
  }
  // Legacy fixture path used by older tests: sources/official/<id>-<slug>.<lang>
  if (coverage.officialSourceArchived && coverage.officialSourceLanguages) {
    for (const lang of coverage.officialSourceLanguages) {
      if (officialBodies[lang]) continue;
      const legacyPath = join(
        sourcesDir,
        'official',
        `${coverage.problemId}-${coverage.slug}.${lang}`,
      );
      if (existsSync(legacyPath)) {
        officialBodies[lang] = {
          body: readFileSync(legacyPath, 'utf8'),
          filePath: legacyPath,
        };
      }
    }
  }

  const editorialAvailability = coverage.editorialAvailability ?? 'unknown';
  // The real archive stores editorial HTML at the path in
  // problem.editorial.artifactPath (relative to the snapshot root), e.g.,
  // raw-pages/page-https-www-pbinfo-ro-ajx-module-ajx-problema-afisare-solutie-*.html
  // Raw pages are frequently excluded from what lands on disk (too large),
  // so this resolution is best-effort: if the artifact isn't present, the
  // EditorialTab renders the spec §8.2 banner explaining it needs a refresh.
  let editorialFilePath: string | undefined;
  const editorialArtifactPath = problemRaw.editorial?.artifactPath;
  if (editorialArtifactPath) {
    const candidate = join(base, editorialArtifactPath);
    if (existsSync(candidate)) editorialFilePath = candidate;
  }
  if (!editorialFilePath) {
    editorialFilePath = findFirstExisting(
      join(normalizedRoot, 'editorials', `problem-${coverage.problemId}.html`),
      join(
        normalizedRoot,
        'editorials',
        `${coverage.problemId}-${coverage.slug}.html`,
      ),
    );
  }
  let editorialHtmlBody: string | undefined;
  if (
    editorialAvailability === 'visible' &&
    editorialFilePath &&
    existsSync(editorialFilePath)
  ) {
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

  const sourceFiles: string[] = [];
  if (existsSync(sourcesDir)) {
    for (const entry of readdirSync(sourcesDir)) {
      sourceFiles.push(join(sourcesDir, entry));
    }
  }

  const resolvedProblemId = problemRaw.problemId ?? problemRaw.id ?? problemId;

  return {
    problem: {
      problemId: resolvedProblemId,
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
      cases: (testsJson?.cases ?? []).map(normalizeTestCase),
    },
    submissions: {
      evaluations,
      sourceBodies,
    },
    officialSource: {
      availability: coverage.officialSourceStatus ?? 'unknown',
      bodies:
        Object.keys(officialBodies).length > 0 ? officialBodies : undefined,
    },
    editorial: {
      availability: editorialAvailability,
      htmlBody: editorialHtmlBody,
      filePath: editorialFilePath,
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

function findFirstExisting(
  ...candidates: readonly string[]
): string | undefined {
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function readJson<T>(path: string): T | undefined {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

function normalizeSourceIdToNumber(sourceId: string): number {
  // coverage.userSourceIds entries look like 'evaluation-7268103' — strip
  // the prefix and parse the trailing int.
  const match = sourceId.match(/(\d+)$/u);
  return match ? parseInt(match[1] ?? '0', 10) : 0;
}
