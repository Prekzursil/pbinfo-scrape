import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import type { SnapshotLayout } from '../archive/storage.js';
import type {
  ProblemRecord,
  ProblemTestsRecord,
} from '../types/records.js';

export type MaterializedCaseProvenance = 'example' | 'visible';

export interface MaterializedCase {
  index: number;
  provenanceKinds: MaterializedCaseProvenance[];
  label?: string;
  input: string;
  output: string;
  explanation?: string;
  hash: string;
}

export interface MaterializedProblemTests {
  problemId: number;
  slug: string;
  name: string;
  snapshotId: string;
  generatedAt: string;
  cases: MaterializedCase[];
  /** SHA-256 of the concatenated serialised cases — lets the GUI detect
   *  cross-snapshot changes cheaply. */
  payloadHash: string;
}

export interface MaterializeTestsResult {
  snapshotId: string;
  problemsProcessed: number;
  foldersWritten: number;
  problemsSkipped: number;
  totalCases: number;
  testsRoot: string;
  generatedAt: string;
}

export interface MaterializeTestsOptions {
  now?: Date;
  /** Wipe the destination `tests/` tree before writing so stale folders
   *  from an older snapshot never linger. Defaults to true. */
  clean?: boolean;
}

export async function materializeTestsForSnapshot(
  snapshot: SnapshotLayout,
  options: MaterializeTestsOptions = {},
): Promise<MaterializeTestsResult> {
  const generatedAt = (options.now ?? new Date()).toISOString();
  const testsRoot = join(snapshot.snapshotRoot, 'tests');

  if (options.clean !== false && existsSync(testsRoot)) {
    rmSync(testsRoot, { recursive: true, force: true });
  }
  mkdirSync(testsRoot, { recursive: true });

  const problemRecords = readJsonDirectory<ProblemRecord>(
    join(snapshot.normalizedRoot, 'problems'),
  );
  const testsRecords = readJsonDirectory<ProblemTestsRecord>(
    join(snapshot.normalizedRoot, 'tests'),
  );
  const testsByProblemId = new Map<number, ProblemTestsRecord>();
  for (const record of testsRecords) {
    testsByProblemId.set(record.problemId, record);
  }

  let foldersWritten = 0;
  let problemsSkipped = 0;
  let totalCases = 0;

  for (const problem of problemRecords) {
    const testsRecord = testsByProblemId.get(problem.id);
    const cases = mergeAndRenumber(problem, testsRecord);
    if (cases.length === 0) {
      problemsSkipped += 1;
      continue;
    }

    const materialized: MaterializedProblemTests = {
      problemId: problem.id,
      slug: problem.slug,
      name: problem.name,
      snapshotId: snapshot.snapshotId,
      generatedAt,
      cases,
      payloadHash: hashCases(cases),
    };

    writeProblemFolder(testsRoot, materialized, problem);
    foldersWritten += 1;
    totalCases += cases.length;
  }

  return {
    snapshotId: snapshot.snapshotId,
    problemsProcessed: problemRecords.length,
    foldersWritten,
    problemsSkipped,
    totalCases,
    testsRoot,
    generatedAt,
  };
}

interface RawCandidate {
  provenance: MaterializedCaseProvenance;
  originalIndex: number;
  label?: string;
  input: string;
  output: string;
  explanation?: string;
}

function mergeAndRenumber(
  problem: ProblemRecord,
  testsRecord: ProblemTestsRecord | undefined,
): MaterializedCase[] {
  const candidates: RawCandidate[] = [];

  const exampleSource = testsRecord?.examples?.length
    ? testsRecord.examples.map((testCase, index) => ({
        input: testCase.input ?? '',
        output: testCase.output ?? '',
        explanation: testCase.explanation,
        label: testCase.label,
        originalIndex: testCase.index ?? index + 1,
      }))
    : (problem.examples ?? []).map((example, index) => ({
        input: example.input,
        output: example.output,
        explanation: example.explanation,
        label: undefined,
        originalIndex: index + 1,
      }));
  for (const item of exampleSource) {
    if (item.input || item.output) {
      candidates.push({
        provenance: 'example',
        originalIndex: item.originalIndex,
        label: item.label,
        input: normalizeIo(item.input),
        output: normalizeIo(item.output),
        explanation: item.explanation,
      });
    }
  }

  const visibleSource = testsRecord?.visible?.length
    ? testsRecord.visible.map((testCase, index) => ({
        input: testCase.input ?? '',
        output: testCase.output ?? '',
        label: testCase.label,
        originalIndex: testCase.index ?? index + 1,
      }))
    : (problem.visibleTests ?? []).map((visible, index) => ({
        input: visible.input ?? '',
        output: visible.output ?? '',
        label: visible.title,
        originalIndex: index + 1,
      }));
  for (const item of visibleSource) {
    if (item.input || item.output) {
      candidates.push({
        provenance: 'visible',
        originalIndex: item.originalIndex,
        label: item.label,
        input: normalizeIo(item.input),
        output: normalizeIo(item.output),
      });
    }
  }

  // Stable-sort: example first, then visible; preserve original order within each group.
  const sorted = candidates.sort((a, b) => {
    if (a.provenance !== b.provenance) {
      return a.provenance === 'example' ? -1 : 1;
    }
    return a.originalIndex - b.originalIndex;
  });

  // Dedupe by hashed (input \0 output); merge provenance when duplicates exist.
  const byHash = new Map<string, { candidate: RawCandidate; provenanceKinds: Set<MaterializedCaseProvenance> }>();
  for (const candidate of sorted) {
    const key = hashIo(candidate.input, candidate.output);
    const existing = byHash.get(key);
    if (existing) {
      existing.provenanceKinds.add(candidate.provenance);
      if (!existing.candidate.explanation && candidate.explanation) {
        existing.candidate.explanation = candidate.explanation;
      }
      if (!existing.candidate.label && candidate.label) {
        existing.candidate.label = candidate.label;
      }
      continue;
    }
    byHash.set(key, {
      candidate,
      provenanceKinds: new Set([candidate.provenance]),
    });
  }

  const deduped = [...byHash.values()];

  return deduped.map(({ candidate, provenanceKinds }, index) => ({
    index: index + 1,
    provenanceKinds: [...provenanceKinds].sort(),
    label: candidate.label,
    input: candidate.input,
    output: candidate.output,
    explanation: candidate.explanation,
    hash: hashIo(candidate.input, candidate.output),
  }));
}

function writeProblemFolder(
  testsRoot: string,
  record: MaterializedProblemTests,
  problem: ProblemRecord,
): void {
  const folderName = `${record.problemId}-${record.slug}`;
  const folder = join(testsRoot, folderName);
  mkdirSync(folder, { recursive: true });

  for (const materialized of record.cases) {
    const pad = String(materialized.index).padStart(3, '0');
    writeFileSync(join(folder, `${pad}.in`), appendTrailingNewline(materialized.input), 'utf8');
    writeFileSync(join(folder, `${pad}.ok`), appendTrailingNewline(materialized.output), 'utf8');
  }

  writeFileSync(
    join(folder, 'tests.json'),
    JSON.stringify(record, null, 2),
    'utf8',
  );

  writeFileSync(
    join(folder, 'meta.json'),
    JSON.stringify(
      {
        problemId: record.problemId,
        slug: record.slug,
        name: record.name,
        caseCount: record.cases.length,
        snapshotId: record.snapshotId,
        generatedAt: record.generatedAt,
        payloadHash: record.payloadHash,
        provenanceSummary: summarizeProvenance(record.cases),
      },
      null,
      2,
    ),
    'utf8',
  );

  writeFileSync(
    join(folder, 'README.md'),
    buildReadme(record, problem),
    'utf8',
  );
}

function summarizeProvenance(cases: MaterializedCase[]): {
  example: number;
  visible: number;
  exampleAndVisible: number;
} {
  const summary = { example: 0, visible: 0, exampleAndVisible: 0 };
  for (const testCase of cases) {
    const hasExample = testCase.provenanceKinds.includes('example');
    const hasVisible = testCase.provenanceKinds.includes('visible');
    if (hasExample && hasVisible) {
      summary.exampleAndVisible += 1;
    } else if (hasExample) {
      summary.example += 1;
    } else if (hasVisible) {
      summary.visible += 1;
    }
  }
  return summary;
}

function buildReadme(record: MaterializedProblemTests, problem: ProblemRecord): string {
  const canonical = problem.canonicalUrl ?? `https://www.pbinfo.ro/probleme/${record.problemId}/${record.slug}`;
  const lines = [
    `# ${record.name} — tests`,
    '',
    `- Problem: [${record.name}](${canonical})`,
    `- Problem ID: ${record.problemId}`,
    `- Slug: ${record.slug}`,
    `- Snapshot: \`${record.snapshotId}\``,
    `- Generated: ${record.generatedAt}`,
    `- Case count: ${record.cases.length}`,
    '',
    '## Provenance',
    '',
    `- Example only: ${record.cases.filter((c) => onlyHas(c, 'example')).length}`,
    `- Visible only: ${record.cases.filter((c) => onlyHas(c, 'visible')).length}`,
    `- Example & visible (deduplicated): ${
      record.cases.filter(
        (c) => c.provenanceKinds.includes('example') && c.provenanceKinds.includes('visible'),
      ).length
    }`,
    '',
    '## How to run locally',
    '',
    '```bash',
    '# Compile the reference solution, then check every case:',
    'for i in *.in; do',
    '  base="${i%.in}"',
    '  diff <(./solution < "$i") "$base.ok"',
    'done',
    '```',
    '',
    '## Files',
    '',
    '- `NNN.in` — input for case N',
    '- `NNN.ok` — expected output for case N',
    '- `tests.json` — structured record with merged provenance',
    '- `meta.json` — summary / payloadHash for change detection',
    '',
  ];
  return lines.join('\n');
}

function onlyHas(testCase: MaterializedCase, provenance: MaterializedCaseProvenance): boolean {
  return testCase.provenanceKinds.length === 1 && testCase.provenanceKinds[0] === provenance;
}

function normalizeIo(value: string): string {
  if (!value) {
    return '';
  }
  // Trim only trailing whitespace/newlines; preserve interior layout since
  // some problems test whitespace-sensitive I/O.
  return value.replace(/\s+$/u, '');
}

function hashIo(input: string, output: string): string {
  return createHash('sha256').update(`${input} ${output}`, 'utf8').digest('hex');
}

function hashCases(cases: MaterializedCase[]): string {
  const hash = createHash('sha256');
  for (const testCase of cases) {
    hash.update(`${testCase.index}|${testCase.hash}|${testCase.provenanceKinds.join(',')}\n`);
  }
  return hash.digest('hex');
}

function appendTrailingNewline(value: string): string {
  if (value.length === 0) {
    return '\n';
  }
  return value.endsWith('\n') ? value : `${value}\n`;
}

function readJsonDirectory<T>(directory: string): T[] {
  if (!existsSync(directory)) {
    return [];
  }
  const files = readdirSync(directory).filter((name) => name.endsWith('.json'));
  const records: T[] = [];
  for (const file of files) {
    if (file === 'index.json') {
      continue;
    }
    try {
      const parsed = JSON.parse(readFileSync(join(directory, file), 'utf8')) as T;
      records.push(parsed);
    } catch {
      // Skip malformed files — deterministic materialization shouldn't fail
      // the whole snapshot because of one corrupt record.
    }
  }
  return records;
}
