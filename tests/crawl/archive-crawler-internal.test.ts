import { describe, expect, test } from 'vitest';

import {
  compareProblemTestCaseRecords,
  dedupeUserSolutionEntries,
  deriveEffectiveProblemTests,
  discoverFollowUps,
  fetchWithTimeout,
  maxDefinedNumber,
  mergeLanguageSolutions,
  mergeLanguageSourceIds,
  normalizeSourceLanguage,
  resolveLinkedProblem,
  resolvePreferredNormalizedHtml,
  shouldSuppressGenericAssetDiscovery,
  shouldSuppressGenericPageNavigation,
} from '../../src/crawl/archive-crawler.js';
import type { LoadedLocalConfig } from '../../src/config/local-config.js';
import type { ProblemTestCaseRecord } from '../../src/types/records.js';

const config = {
  crawl: { userHandle: 'Prekzursil' },
  mirror: { blockedAssetHosts: [], externalAssetHosts: [] },
} as unknown as LoadedLocalConfig;

const testCase = (over: Partial<ProblemTestCaseRecord>): ProblemTestCaseRecord =>
  ({ testId: 't', kind: 'example', ...over }) as ProblemTestCaseRecord;

describe('resolveLinkedProblem', () => {
  test('resolves from key, query id, or returns undefined', () => {
    expect(resolveLinkedProblem({ key: 'page:x', url: 'x', kind: 'public-page' })).toBeUndefined();
    expect(
      resolveLinkedProblem({ key: 'problem-statement:https://www.pbinfo.ro/probleme/3171/water', url: 'u', kind: 'problem-statement' }),
    ).toEqual({ id: 3171, slug: 'water' });
    expect(
      resolveLinkedProblem({ key: 'problem-tests:other', url: 'https://www.pbinfo.ro/x?id=42', kind: 'problem-tests' }),
    ).toEqual({ id: 42, slug: 'problem-42' });
    expect(
      resolveLinkedProblem({ key: 'problem-tests:other', url: 'https://www.pbinfo.ro/x', kind: 'problem-tests' }),
    ).toBeUndefined();
  });
});

describe('test-case ordering and effective derivation', () => {
  test('compareProblemTestCaseRecords orders by evaluation, index, then id', () => {
    expect(compareProblemTestCaseRecords(testCase({ evaluationId: 1 }), testCase({ evaluationId: 2 }))).toBeGreaterThan(0);
    expect(compareProblemTestCaseRecords(testCase({ index: 1 }), testCase({ index: 2 }))).toBeLessThan(0);
    expect(compareProblemTestCaseRecords(testCase({ testId: 'a' }), testCase({ testId: 'b' }))).toBeLessThan(0);
  });

  test('deriveEffectiveProblemTests dedupes by io and resolves provenance precedence', () => {
    const effective = deriveEffectiveProblemTests({
      examples: [testCase({ testId: 'e1', kind: 'example', input: '1', output: '2', exampleLike: true })],
      visible: [
        testCase({ testId: 'v1', kind: 'visible', input: '1', output: '2' }),
        testCase({ testId: 'v2', kind: 'visible', input: '5', output: '6' }),
      ],
      evaluationObserved: [
        testCase({ testId: 'm1', kind: 'evaluationObserved', input: '1', output: '2', sourceTestIds: ['x'], provenanceKinds: ['evaluationObserved'] }),
        testCase({ testId: 'o1', kind: 'evaluationObserved', input: '3', output: '4' }),
        testCase({ testId: 'skip', kind: 'evaluationObserved' }),
      ],
    });
    expect(effective).toHaveLength(3);
    expect(effective.find((c) => c.input === '1')?.kind).toBe('example');
    expect(effective.find((c) => c.input === '5')?.kind).toBe('visible');
    expect(effective.find((c) => c.input === '3')?.kind).toBe('evaluationObserved');
  });
});

describe('resolvePreferredNormalizedHtml', () => {
  const solution = (n: number) =>
    `<div>${Array.from({ length: n }, (_, i) => `<a href="#l${i}-tab">L${i}</a><div id="l${i}-tab"><pre>code${i}</pre></div>`).join('')}</div>`;

  test('returns http when no browser html exists', () => {
    expect(resolvePreferredNormalizedHtml('problem-solution', 'u', '<div></div>').source).toBe('http');
  });

  test('prefers the richer solution and tests captures', () => {
    expect(resolvePreferredNormalizedHtml('problem-solution', 'u', solution(0), solution(1)).source).toBe('browser');
    expect(resolvePreferredNormalizedHtml('problem-solution', 'u', solution(1), solution(0)).source).toBe('http');
    expect(
      resolvePreferredNormalizedHtml('problem-tests', 'u', '<h3>Test 1</h3><p>Intrare</p><pre>a</pre><p>Ieșire</p><pre>b</pre>', '<h3>Test 1</h3><p>Intrare</p><pre>a</pre><p>Ieșire</p><pre>b</pre><h3>Test 2</h3><p>Intrare</p><pre>c</pre><p>Ieșire</p><pre>d</pre>').source,
    ).toBe('browser');
  });

  test('handles evaluation source availability and non-finite ids and parse errors', () => {
    const withSource = '<div id="rezumat"><a href="/probleme/1/x">x</a></div><textarea>code</textarea>';
    const withoutSource = '<div id="rezumat"><a href="/probleme/1/x">x</a></div>';
    expect(resolvePreferredNormalizedHtml('evaluation-detail', 'https://x/detalii-evaluare/5', withoutSource, withSource).source).toBe('browser');
    expect(resolvePreferredNormalizedHtml('evaluation-detail', 'https://x/no-id', withoutSource, withSource).source).toBe('http');
    expect(resolvePreferredNormalizedHtml('evaluation-detail', 'https://x/detalii-evaluare/5', '<div>broken</div>', withSource).source).toBe('browser');
    expect(resolvePreferredNormalizedHtml('evaluation-detail', 'https://x/detalii-evaluare/5', withSource, withSource).source).toBe('http');
    expect(resolvePreferredNormalizedHtml('public-page', 'u', '<div>a</div>', '<div>b</div>').source).toBe('http');
  });

  test('keeps the http tests capture when the browser capture is not richer', () => {
    const tests = '<h3>Test 1</h3><p>Intrare</p><pre>a</pre><p>Ieșire</p><pre>b</pre>';
    expect(resolvePreferredNormalizedHtml('problem-tests', 'u', tests, tests).source).toBe('http');
  });
});

describe('fetchWithTimeout', () => {
  test('honors a caller-provided abort signal and reports non-Error abort reasons', async () => {
    const okController = new AbortController();
    const response = await fetchWithTimeout(
      (async () => new Response('ok')) as typeof fetch,
      'https://x/',
      { signal: okController.signal },
      5_000,
    );
    expect(await response.text()).toBe('ok');

    const abortController = new AbortController();
    const pending = fetchWithTimeout(
      (() => new Promise<Response>(() => undefined)) as typeof fetch,
      'https://x/',
      { signal: abortController.signal },
      5_000,
    );
    abortController.abort('string reason');
    await expect(pending).rejects.toThrow('string reason');

    const emptyReason = new AbortController();
    const emptyPending = fetchWithTimeout(
      (() => new Promise<Response>(() => undefined)) as typeof fetch,
      'https://x/',
      { signal: emptyReason.signal },
      5_000,
    );
    emptyReason.abort(null);
    await expect(emptyPending).rejects.toThrow('request aborted');
  });

  test('aborts via the internal timeout when the fetch hangs', async () => {
    await expect(
      fetchWithTimeout((() => new Promise<Response>(() => undefined)) as typeof fetch, 'https://x/', undefined, 5),
    ).rejects.toThrow(/timed out/);
  });
});

describe('discoverFollowUps', () => {
  test('queues page links, assets, and problem ajx endpoints', () => {
    const followUps = discoverFollowUps(
      config,
      'all',
      'https://www.pbinfo.ro/probleme/1/sum',
      'public-page',
      '<html><head><link rel="stylesheet" href="/a.css"></head><body><a href="/probleme">P</a><img src="/i.png"></body></html>',
    );
    const kinds = followUps.map((f) => f.kind);
    expect(kinds).toContain('problem-statement');
    expect(kinds).toContain('problem-solution');
    expect(kinds).toContain('problem-tests');
    expect(kinds).toContain('public-asset');
  });

  test('suppresses generic navigation and assets for scoped page kinds', () => {
    expect(shouldSuppressGenericPageNavigation('user', 'public-page', 'u')).toBe(true);
    expect(shouldSuppressGenericPageNavigation('user', 'user-profile', 'u')).toBe(true);
    expect(shouldSuppressGenericPageNavigation('all', 'user-solutions', 'u')).toBe(true);
    expect(shouldSuppressGenericPageNavigation('all', 'public-page', 'https://www.pbinfo.ro/solutii/problema/1/x')).toBe(true);
    expect(shouldSuppressGenericPageNavigation('all', 'public-page', 'https://www.pbinfo.ro/probleme')).toBe(false);
    expect(shouldSuppressGenericAssetDiscovery('user-solutions')).toBe(true);
    expect(shouldSuppressGenericAssetDiscovery('public-page')).toBe(false);
    const suppressed = discoverFollowUps(config, 'all', 'https://www.pbinfo.ro/detalii-evaluare/1', 'evaluation-detail', '<a href="/probleme">P</a><img src="/i.png">');
    expect(suppressed).toEqual([]);
  });
});

describe('source language and merge helpers', () => {
  test('normalizeSourceLanguage maps every language family', () => {
    expect(normalizeSourceLanguage('')).toBe('unknown');
    expect(normalizeSourceLanguage('Unknown')).toBe('unknown');
    expect(normalizeSourceLanguage('C++')).toBe('cpp');
    expect(normalizeSourceLanguage('cpp')).toBe('cpp');
    expect(normalizeSourceLanguage('C')).toBe('c');
    expect(normalizeSourceLanguage('Python 3')).toBe('py');
    expect(normalizeSourceLanguage('py')).toBe('py');
    expect(normalizeSourceLanguage('Pascal')).toBe('pas');
    expect(normalizeSourceLanguage('pas')).toBe('pas');
    expect(normalizeSourceLanguage('Java')).toBe('java');
    expect(normalizeSourceLanguage('C#')).toBe('csharp');
    expect(normalizeSourceLanguage('csharp')).toBe('csharp');
    expect(normalizeSourceLanguage('Brainfuck')).toBe('brainfuck');
    expect(normalizeSourceLanguage('+++')).toBe('root');
  });

  test('mergeLanguageSourceIds and mergeLanguageSolutions combine entries', () => {
    expect(mergeLanguageSourceIds(undefined, { cpp: ['a'] })).toEqual({ cpp: ['a'] });
    expect(mergeLanguageSourceIds({ cpp: ['a'] }, { cpp: ['b'], c: ['x'] })).toEqual({ cpp: ['a', 'b'], c: ['x'] });
    // A language present only in the current map (absent from incoming) exercises the incoming fallback.
    expect(mergeLanguageSourceIds({ java: ['j'] }, { cpp: ['b'] })).toEqual({ java: ['j'], cpp: ['b'] });
    expect(mergeLanguageSolutions({ cpp: 'old' }, { py: 'new' })).toEqual({ cpp: 'old', py: 'new' });
  });

  test('dedupeUserSolutionEntries and maxDefinedNumber', () => {
    const entries = dedupeUserSolutionEntries([
      { evaluationId: 2 },
      { evaluationId: 2 },
      { evaluationId: 5 },
      { evaluationId: undefined },
    ]);
    expect(entries.map((e) => e.evaluationId)).toEqual([5, 2]);
    expect(maxDefinedNumber(undefined, 3)).toBe(3);
    expect(maxDefinedNumber(4, undefined)).toBe(4);
    expect(maxDefinedNumber(4, 9)).toBe(9);
  });
});
