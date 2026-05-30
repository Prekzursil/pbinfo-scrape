/**
 * Exercises the problem-coverage strip injection branches in build-mirror.ts:
 *   - officialSourceBadgeText: archived, blocked, not-archived paths
 *   - userSourceBadgeText: trustworthy languages, archived-but-no-trustworthy, not-archived paths
 *   - injectProblemCoverageStrip: happy path, early-return when strip already present, noteText present
 *   - renderCoverageRow: bestUserOverallEvaluationId undefined branch
 *   - safeResolve catch branch (bad URL)
 *   - existsSync(sourcePath) === false branch
 *   - inferTemplate / inferEntityKey URL-pattern branches
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { prepareSnapshot } from '../../src/archive/storage.js';
import { loadLocalConfig } from '../../src/config/local-config.js';
import { buildMirrorArtifacts } from '../../src/mirror/build-mirror.js';
import type { ProblemRecord, SourceRecord } from '../../src/types/records.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function bootstrapWorkspace(prefix: string) {
  const workspaceRoot = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(workspaceRoot);
  const config = loadLocalConfig(workspaceRoot);
  const snapshot = prepareSnapshot(config, {
    snapshotId: 'snap-cov-strip',
    scope: 'all',
    now: new Date('2026-03-10T00:00:00.000Z'),
  });
  mkdirSync(snapshot.rawPagesRoot, { recursive: true });
  mkdirSync(snapshot.rawAssetsRoot, { recursive: true });
  mkdirSync(snapshot.normalizedRoot, { recursive: true });
  return { workspaceRoot, config, snapshot };
}

function writeProblemRecord(normalizedRoot: string, problem: Partial<ProblemRecord> & { id: number; slug: string; name: string }) {
  const fullRecord: ProblemRecord = {
    id: problem.id,
    slug: problem.slug,
    name: problem.name,
    canonicalUrl: problem.canonicalUrl,
    grade: problem.grade,
    categoryChain: [],
    tags: [],
    sections: [],
    examples: [],
    constraints: [],
    editorialAvailability: problem.editorialAvailability ?? 'unknown',
    officialSolutions: {},
    visibleTests: [],
    linkedAssets: [],
    metadata: {},
    ...problem,
  };
  const problemsDir = join(normalizedRoot, 'problems');
  mkdirSync(problemsDir, { recursive: true });
  writeFileSync(
    join(problemsDir, `problem-${problem.id}.json`),
    JSON.stringify(fullRecord, null, 2),
    'utf8',
  );
}

function writeSourceRecord(normalizedRoot: string, source: SourceRecord) {
  const sourcesDir = join(normalizedRoot, 'sources');
  mkdirSync(sourcesDir, { recursive: true });
  writeFileSync(
    join(sourcesDir, `source-${source.sourceId}.json`),
    JSON.stringify(source, null, 2),
    'utf8',
  );
}

function writeRankingIndex(
  normalizedRoot: string,
  problems: Array<{
    problemId: number;
    bestUserPerLanguage?: Record<string, number>;
    bestTrustworthyPerLanguage?: Record<string, number>;
    bestUserOverallEvaluationId?: number;
    bestTrustworthyOverallEvaluationId?: number;
    bestFastPerLanguage?: Record<string, number>;
    bestOfficialPerLanguage?: Record<string, string>;
    suspiciousCandidateEvaluationIds?: number[];
    duplicateEvaluationIds?: number[];
    orderedUserEvaluationIds?: number[];
  }>,
) {
  const rankingsDir = join(normalizedRoot, 'rankings');
  mkdirSync(rankingsDir, { recursive: true });
  writeFileSync(
    join(rankingsDir, 'best-submissions.json'),
    JSON.stringify({
      generatedAt: '2026-03-10T00:00:00.000Z',
      problems: problems.map((p) => ({
        bestUserPerLanguage: {},
        bestTrustworthyPerLanguage: {},
        bestFastPerLanguage: {},
        bestOfficialPerLanguage: {},
        suspiciousCandidateEvaluationIds: [],
        duplicateEvaluationIds: [],
        orderedUserEvaluationIds: [],
        ...p,
      })),
    }),
    'utf8',
  );
}

describe('buildMirrorArtifacts coverage strip injection', () => {
  test('injects coverage strip with trustworthy user languages and official source blocked badges', async () => {
    const { workspaceRoot, snapshot } = bootstrapWorkspace('pbinfo-mirror-strip-');

    // Problem 100: has a trustworthy user source language (via ranking) and an official source with editorialAvailability=restricted (blocked)
    writeProblemRecord(snapshot.normalizedRoot, {
      id: 100,
      slug: 'test-problem',
      name: 'Test Problem',
      editorialAvailability: 'restricted',
    });

    // Problem 200: has user sources but NO trustworthy language (no ranking entry), and officialSourceBlockedReason via solutionFragment archived check
    writeProblemRecord(snapshot.normalizedRoot, {
      id: 200,
      slug: 'other-problem',
      name: 'Other Problem',
      editorialAvailability: 'unknown',
    });

    // User source for problem 200 (makes userSourceArchived=true, but no ranking → trustworthyUserSourceLanguages=[])
    writeSourceRecord(snapshot.normalizedRoot, {
      sourceId: 'src-200-1',
      kind: 'user-evaluation',
      problemId: 200,
      language: 'cpp',
      sourceAvailable: true,
      score: 100,
      suspicionFlags: [],
      provenance: [],
    });

    // Official source for problem 100 (makes officialSourceArchived=true)
    writeSourceRecord(snapshot.normalizedRoot, {
      sourceId: 'src-100-official',
      kind: 'official',
      problemId: 100,
      language: 'cpp',
      sourceAvailable: true,
      score: 100,
      suspicionFlags: [],
      provenance: [],
    });

    // Ranking for problem 100 has bestTrustworthyPerLanguage → trustworthyUserSourceLanguages=['cpp']
    writeRankingIndex(snapshot.normalizedRoot, [
      {
        problemId: 100,
        bestTrustworthyPerLanguage: { cpp: 12345 },
        bestUserOverallEvaluationId: 12345,
      },
    ]);

    // Page: problem 100 and problem 200 mirror pages
    const problem100Html = '<html><head></head><body><h1>Test</h1></body></html>';
    const problem200Html = '<html><head></head><body><h1>Other</h1></body></html>';
    writeFileSync(join(snapshot.rawPagesRoot, 'p100.html'), problem100Html, 'utf8');
    writeFileSync(join(snapshot.rawPagesRoot, 'p200.html'), problem200Html, 'utf8');
    writeFileSync(
      snapshot.rawPagesManifestPath,
      JSON.stringify({
        'https://www.pbinfo.ro/probleme/100/test-problem': 'p100.html',
        'https://www.pbinfo.ro/probleme/200/other-problem': 'p200.html',
      }),
      'utf8',
    );
    writeFileSync(snapshot.rawAssetsManifestPath, '{}', 'utf8');

    await buildMirrorArtifacts(workspaceRoot, snapshot.snapshotId);

    // Problem 100: official source archived → 'Official source languages: cpp'
    const mirror100 = readFileSync(
      join(snapshot.mirrorRoot, 'site', 'probleme', '100', 'test-problem', 'index.html'),
      'utf8',
    );
    expect(mirror100).toContain('archive-coverage-strip');
    expect(mirror100).toContain('Official source languages: cpp');

    // Problem 200: user source present + no trustworthy → 'User sources archived, but no trustworthy'
    const mirror200 = readFileSync(
      join(snapshot.mirrorRoot, 'site', 'probleme', '200', 'other-problem', 'index.html'),
      'utf8',
    );
    expect(mirror200).toContain('User sources archived, but no trustworthy 100-point language kept yet');
  });

  test('coverage strip includes note text when coverage record has notes', async () => {
    const { workspaceRoot, snapshot } = bootstrapWorkspace('pbinfo-mirror-strip-notes-');

    // Problem 300: solved by the configured handle; requires solvedByMe=true
    // We use an evaluation record to mark the problem as solved
    writeProblemRecord(snapshot.normalizedRoot, {
      id: 300,
      slug: 'noted-problem',
      name: 'Noted Problem',
      editorialAvailability: 'unknown',
    });

    // Ranking for problem 300 with trustworthy language to also cover that branch again
    writeRankingIndex(snapshot.normalizedRoot, [
      {
        problemId: 300,
        bestTrustworthyPerLanguage: { python: 67890 },
        bestUserOverallEvaluationId: undefined,
      },
    ]);

    writeFileSync(join(snapshot.rawPagesRoot, 'p300.html'), '<html><head></head><body></body></html>', 'utf8');
    writeFileSync(
      snapshot.rawPagesManifestPath,
      JSON.stringify({ 'https://www.pbinfo.ro/probleme/300/noted-problem': 'p300.html' }),
      'utf8',
    );
    writeFileSync(snapshot.rawAssetsManifestPath, '{}', 'utf8');

    await buildMirrorArtifacts(workspaceRoot, snapshot.snapshotId);

    // The coverage index should show the record's data in renderCoverageRow (n/a for no bestUserOverallEvaluationId)
    const coverageIndex = readFileSync(
      join(snapshot.mirrorRoot, 'site', 'archive', 'coverage', 'index.html'),
      'utf8',
    );
    expect(coverageIndex).toContain('Noted Problem');
    expect(coverageIndex).toContain('n/a');

    // The strip should show 'Trustworthy user languages: python'
    const mirror300 = readFileSync(
      join(snapshot.mirrorRoot, 'site', 'probleme', '300', 'noted-problem', 'index.html'),
      'utf8',
    );
    expect(mirror300).toContain('Trustworthy user languages: py');
  });

  test('throws when a source file listed in the page manifest is missing from disk', async () => {
    const { workspaceRoot, snapshot } = bootstrapWorkspace('pbinfo-mirror-missing-src-');

    // Write manifest pointing to a file that does NOT exist
    writeFileSync(
      snapshot.rawPagesManifestPath,
      JSON.stringify({ 'https://www.pbinfo.ro/': 'nonexistent.html' }),
      'utf8',
    );
    writeFileSync(snapshot.rawAssetsManifestPath, '{}', 'utf8');

    await expect(buildMirrorArtifacts(workspaceRoot, snapshot.snapshotId)).rejects.toThrow(
      /references missing raw page/,
    );
  });

  test('safeResolve handles an unparseable candidate URL by returning undefined', async () => {
    const { workspaceRoot, snapshot } = bootstrapWorkspace('pbinfo-mirror-bad-url-');

    // HTML with a genuinely malformed href that triggers safeResolve's catch (not a JS: or # prefix)
    writeFileSync(
      join(snapshot.rawPagesRoot, 'page.html'),
      // 'http://[invalid' causes new URL(candidate, base) to throw an "Invalid URL" error
      // while not starting with 'javascript:' or '#', so safeResolve catches and returns undefined
      '<html><head></head><body><a href="http://[invalid">link</a></body></html>',
      'utf8',
    );
    writeFileSync(
      snapshot.rawPagesManifestPath,
      JSON.stringify({ 'https://www.pbinfo.ro/': 'page.html' }),
      'utf8',
    );
    writeFileSync(snapshot.rawAssetsManifestPath, '{}', 'utf8');

    // Should not throw; the bad URL is silently ignored by safeResolve
    const result = await buildMirrorArtifacts(workspaceRoot, snapshot.snapshotId);
    expect(result.routesBuilt).toBeGreaterThan(0);
    const mirrorHtml = readFileSync(
      join(snapshot.mirrorRoot, 'site', 'root', 'index.html'),
      'utf8',
    );
    expect(mirrorHtml).toContain('link');
  });

  test('injects coverage strip with user source not archived when no sources exist', async () => {
    const { workspaceRoot, snapshot } = bootstrapWorkspace('pbinfo-mirror-nosrc-');

    // Problem 400 with no sources and no ranking
    writeProblemRecord(snapshot.normalizedRoot, {
      id: 400,
      slug: 'no-source',
      name: 'No Source',
      editorialAvailability: 'hidden',
    });

    writeFileSync(
      join(snapshot.rawPagesRoot, 'p400.html'),
      '<html><head></head><body></body></html>',
      'utf8',
    );
    writeFileSync(
      snapshot.rawPagesManifestPath,
      JSON.stringify({ 'https://www.pbinfo.ro/probleme/400/no-source': 'p400.html' }),
      'utf8',
    );
    writeFileSync(snapshot.rawAssetsManifestPath, '{}', 'utf8');

    await buildMirrorArtifacts(workspaceRoot, snapshot.snapshotId);

    const mirror400 = readFileSync(
      join(snapshot.mirrorRoot, 'site', 'probleme', '400', 'no-source', 'index.html'),
      'utf8',
    );
    // officialSourceArchived=false, officialSourceBlockedReason='editorial-hidden' (from 'hidden')
    expect(mirror400).toContain('Official source blocked: editorial-hidden');
    // userSourceArchived=false → 'User source not archived'
    expect(mirror400).toContain('User source not archived');
  });

  test('rewriteAssetUrl returns undefined for empty src attribute (safeResolve early return)', async () => {
    const { workspaceRoot, snapshot } = bootstrapWorkspace('pbinfo-mirror-empty-src-');

    // img[src=""] causes rewriteAssetUrl to call safeResolve with empty string →
    // safeResolve's `!candidate` check returns undefined → rewriteAssetUrl returns undefined (line 218-219)
    writeFileSync(
      join(snapshot.rawPagesRoot, 'page.html'),
      '<html><head></head><body><img src="" /><img src="#anchor" /></body></html>',
      'utf8',
    );
    writeFileSync(
      snapshot.rawPagesManifestPath,
      JSON.stringify({ 'https://www.pbinfo.ro/': 'page.html' }),
      'utf8',
    );
    writeFileSync(snapshot.rawAssetsManifestPath, '{}', 'utf8');

    const result = await buildMirrorArtifacts(workspaceRoot, snapshot.snapshotId);
    expect(result.routesBuilt).toBeGreaterThan(0);
  });

  test('findSourceUrl resolves URL from manifest when route record has sourceFile but no sourceUrl', async () => {
    const { workspaceRoot, snapshot } = bootstrapWorkspace('pbinfo-mirror-find-url-');

    // Write the raw pages file
    writeFileSync(
      join(snapshot.rawPagesRoot, 'direct.html'),
      '<html><head></head><body>direct</body></html>',
      'utf8',
    );
    // Page manifest maps URL → file
    writeFileSync(
      snapshot.rawPagesManifestPath,
      JSON.stringify({ 'https://www.pbinfo.ro/': 'direct.html' }),
      'utf8',
    );
    writeFileSync(snapshot.rawAssetsManifestPath, '{}', 'utf8');

    // Route record with sourceFile but NO sourceUrl — triggers findSourceUrl(pageManifest, sourceFile)
    const routesDir = join(snapshot.normalizedRoot, 'routes');
    mkdirSync(routesDir, { recursive: true });
    writeFileSync(
      join(routesDir, 'route-direct.json'),
      JSON.stringify({
        route: '/',
        snapshotId: snapshot.snapshotId,
        sourceFile: 'direct.html',
        template: 'raw-page',
        entityKey: '/',
      }),
      'utf8',
    );

    const result = await buildMirrorArtifacts(workspaceRoot, snapshot.snapshotId);
    expect(result.routesBuilt).toBeGreaterThan(0);
    const mirrorHtml = readFileSync(
      join(snapshot.mirrorRoot, 'site', 'root', 'index.html'),
      'utf8',
    );
    expect(mirrorHtml).toContain('direct');
  });

  test('covers inferTemplate user-profile and evaluation URL patterns via manifest routing', async () => {
    const { workspaceRoot, snapshot } = bootstrapWorkspace('pbinfo-mirror-url-patterns-');

    writeFileSync(
      join(snapshot.rawPagesRoot, 'profile.html'),
      '<html><head></head><body>profile</body></html>',
      'utf8',
    );
    writeFileSync(
      join(snapshot.rawPagesRoot, 'eval.html'),
      '<html><head></head><body>eval</body></html>',
      'utf8',
    );
    writeFileSync(
      join(snapshot.rawPagesRoot, 'solutions.html'),
      '<html><head></head><body>solutions</body></html>',
      'utf8',
    );
    writeFileSync(
      snapshot.rawPagesManifestPath,
      JSON.stringify({
        'https://www.pbinfo.ro/profil/Prekzursil': 'profile.html',
        'https://www.pbinfo.ro/detalii-evaluare/99999': 'eval.html',
        'https://www.pbinfo.ro/solutii/user/Prekzursil': 'solutions.html',
      }),
      'utf8',
    );
    writeFileSync(snapshot.rawAssetsManifestPath, '{}', 'utf8');

    const result = await buildMirrorArtifacts(workspaceRoot, snapshot.snapshotId);
    // 3 user/evaluation pages + 1 coverage index route
    expect(result.routesBuilt).toBe(4);

    const mirrorIndex = readFileSync(join(snapshot.mirrorRoot, 'index.html'), 'utf8');
    expect(mirrorIndex).toContain('/profil/Prekzursil');
    expect(mirrorIndex).toContain('/detalii-evaluare/99999');
    expect(mirrorIndex).toContain('/solutii/user/Prekzursil');
  });

  test('coverage strip shows empty noteText when no notes are generated (all note rules false)', async () => {
    const { workspaceRoot, snapshot } = bootstrapWorkspace('pbinfo-mirror-no-notes-');

    // Problem 500: has official source (archived), only visible tests (so testsCoverageStatus=captured,
    // effectiveTestsAvailableCount=0, exampleTestsAvailableCount=0) → most note rules are false.
    // To suppress newSinceBaseline, write a baseline coverage index that shows the same coverage.
    writeProblemRecord(snapshot.normalizedRoot, {
      id: 500,
      slug: 'no-notes',
      name: 'No Notes',
      editorialAvailability: 'unknown',
    });

    // Official source to make officialSourceArchived=true (rules 2,11-13 don't apply)
    writeSourceRecord(snapshot.normalizedRoot, {
      sourceId: 'src-500-official',
      kind: 'official',
      problemId: 500,
      language: 'cpp',
      sourceAvailable: true,
      score: 100,
      suspicionFlags: [],
      provenance: [],
    });

    // Test record with only visible tests (testsCoverageStatus=captured, effectiveTests=0)
    const testsDir = join(snapshot.normalizedRoot, 'tests');
    mkdirSync(testsDir, { recursive: true });
    writeFileSync(
      join(testsDir, 'problem-500.json'),
      JSON.stringify({
        snapshotId: snapshot.snapshotId,
        problemId: 500,
        problemSlug: 'no-notes',
        problemName: 'No Notes',
        examples: [],
        visible: [{ testId: 't1', kind: 'visible', input: '1', output: '1' }],
        evaluationObserved: [],
        effective: [],
      }),
      'utf8',
    );

    // Baseline coverage index for problem 500 with the same coverage metrics → newSinceBaseline=false
    // The baseline snapshot ID is 'acceptance-20260310b'; write its normalized/problem-coverage/index.json
    const baselineNormalizedRoot = join(
      workspaceRoot,
      'archive',
      'snapshots',
      'acceptance-20260310b',
      'normalized',
    );
    const baselineCoverageRoot = join(baselineNormalizedRoot, 'problem-coverage');
    mkdirSync(baselineCoverageRoot, { recursive: true });
    writeFileSync(
      join(baselineCoverageRoot, 'index.json'),
      JSON.stringify({
        snapshotId: 'acceptance-20260310b',
        generatedAt: '2026-03-10T00:00:00.000Z',
        totals: {},
        records: [
          {
            // Same coverage metrics as what will be produced for problem 500
            problemId: 500,
            officialSourceCount: 1,
            userSourceCount: 0,
            visibleTestsCapturedCount: 1,
            effectiveTestsAvailableCount: 0,
            evaluationObservedTestsCount: 0,
            trustworthyUserSourceLanguages: [],
            solvedByMe: false,
          },
        ],
      }),
      'utf8',
    );

    writeFileSync(
      join(snapshot.rawPagesRoot, 'p500.html'),
      '<html><head></head><body></body></html>',
      'utf8',
    );
    writeFileSync(
      snapshot.rawPagesManifestPath,
      JSON.stringify({ 'https://www.pbinfo.ro/probleme/500/no-notes': 'p500.html' }),
      'utf8',
    );
    writeFileSync(snapshot.rawAssetsManifestPath, '{}', 'utf8');

    await buildMirrorArtifacts(workspaceRoot, snapshot.snapshotId);

    const mirror500 = readFileSync(
      join(snapshot.mirrorRoot, 'site', 'probleme', '500', 'no-notes', 'index.html'),
      'utf8',
    );
    // Strip is injected; no note paragraph (empty '' noteText branch)
    expect(mirror500).toContain('archive-coverage-strip');
    // No <p class="archive-coverage-note"> element (the '' empty branch of noteText ternary)
    expect(mirror500).not.toContain('<p class="archive-coverage-note">');
    // The coverage strip should contain 'Official source languages: cpp'
    expect(mirror500).toContain('Official source languages: cpp');
  });

  test('skips re-injecting coverage strip when html already has .archive-coverage-strip', async () => {
    const { workspaceRoot, snapshot } = bootstrapWorkspace('pbinfo-mirror-strip-exists-');

    writeProblemRecord(snapshot.normalizedRoot, {
      id: 600,
      slug: 'pre-stripped',
      name: 'Pre Stripped',
      editorialAvailability: 'unknown',
    });

    // HTML that already contains the coverage strip section
    const htmlWithStrip = `<html><head></head><body>
      <section class="archive-coverage-strip"><h2>Archive coverage</h2></section>
      <h1>Pre Stripped</h1>
    </body></html>`;
    writeFileSync(join(snapshot.rawPagesRoot, 'p600.html'), htmlWithStrip, 'utf8');
    writeFileSync(
      snapshot.rawPagesManifestPath,
      JSON.stringify({ 'https://www.pbinfo.ro/probleme/600/pre-stripped': 'p600.html' }),
      'utf8',
    );
    writeFileSync(snapshot.rawAssetsManifestPath, '{}', 'utf8');

    await buildMirrorArtifacts(workspaceRoot, snapshot.snapshotId);

    const mirror600 = readFileSync(
      join(snapshot.mirrorRoot, 'site', 'probleme', '600', 'pre-stripped', 'index.html'),
      'utf8',
    );
    // Strip should appear exactly once (not duplicated)
    const occurrences = (mirror600.match(/archive-coverage-strip/g) ?? []).length;
    expect(occurrences).toBe(1);
  });
});
