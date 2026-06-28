import { describe, expect, test } from 'vitest';

import {
  buildEffectiveProblemTestKey,
  canonicalizeQueryParameters,
  compareProvenanceKinds,
  createPlaceholderProblem,
  inferEntityKey,
  inferPageKind,
  inferTemplate,
  isBlockedAssetPath,
  isMeaningfulNavigableUrl,
  matchesConfiguredUserHandle,
  normalizeAssetUrl,
  normalizeNavigableUrl,
  normalizePathname,
  normalizeSiteRelativeCandidate,
  normalizeTestIo,
  stripTrackingQueryParameters,
} from '../../src/crawl/archive-crawler.js';
import type { LoadedLocalConfig } from '../../src/config/local-config.js';
import type { ProblemTestCaseRecord } from '../../src/types/records.js';

const config = {
  crawl: { userHandle: 'Prekzursil' },
  mirror: { blockedAssetHosts: ['blocked.example.com'], externalAssetHosts: ['cdn.example.com'] },
} as unknown as LoadedLocalConfig;
const noHandleConfig = {
  crawl: {},
  mirror: { blockedAssetHosts: [], externalAssetHosts: [] },
} as unknown as LoadedLocalConfig;
const base = new URL('https://www.pbinfo.ro/');
const url = (path: string) => new URL(path, base);

describe('archive-crawler navigable URL helpers', () => {
  test('normalizeNavigableUrl rejects unsafe schemes, fragments, and cross-origin links', () => {
    for (const candidate of ['#a', 'javascript:x', 'vbscript:x', 'mailto:a@b', 'tel:1', 'data:x', undefined]) {
      expect(normalizeNavigableUrl(config, base, candidate)).toBeNull();
    }
    expect(normalizeNavigableUrl(config, base, 'https://other.example.com/x')).toBeNull();
    expect(normalizeNavigableUrl(config, base, '/articole/x')).toBeNull();
    expect(normalizeNavigableUrl(config, base, '/probleme?utm_source=z')).toBe('https://www.pbinfo.ro/probleme');
  });

  test('stripTrackingQueryParameters and canonicalizeQueryParameters', () => {
    const tracking = url('/x?utm_source=a&fbclid=b&gclid=c&yclid=d&mc_cid=e&mc_eid=f&ref=g&source=h&keep=1');
    stripTrackingQueryParameters(tracking);
    expect(tracking.searchParams.get('keep')).toBe('1');
    expect(tracking.searchParams.has('utm_source')).toBe(false);
    const unsorted = url('/x?b=2&a=1&a=0');
    canonicalizeQueryParameters(unsorted);
    expect(unsorted.search).toBe('?a=0&a=1&b=2');
  });

  test('isMeaningfulNavigableUrl handles section, evaluation, profile, solution, and pagination rules', () => {
    expect(isMeaningfulNavigableUrl(config, url('/solutii/problema/1/sum'))).toBe(false);
    for (const path of ['/articole', '/ajutor', '/clasa-mea', '/editare-cont', '/logout.php', '/resurse', '/solutii/clasa/9', '/teme/rezolvare/1', '/php/gravatar.php']) {
      expect(isMeaningfulNavigableUrl(config, url(path))).toBe(false);
    }
    expect(isMeaningfulNavigableUrl(config, url('/detalii-evaluare/123'))).toBe(false);
    expect(isMeaningfulNavigableUrl(config, url('/profil/Prekzursil'))).toBe(true);
    expect(isMeaningfulNavigableUrl(config, url('/profil/Other'))).toBe(false);
    expect(isMeaningfulNavigableUrl(config, url('/profil/Prekzursil/probleme'))).toBe(true);
    expect(isMeaningfulNavigableUrl(config, url('/profil/Prekzursil/jurnal'))).toBe(true);
    expect(isMeaningfulNavigableUrl(config, url('/profil/Prekzursil/altceva'))).toBe(false);
    expect(isMeaningfulNavigableUrl(config, url('/solutii/user/Prekzursil'))).toBe(true);
    expect(isMeaningfulNavigableUrl(config, url('/solutii/user/Other'))).toBe(false);
    expect(isMeaningfulNavigableUrl(config, url('/probleme?foo=bar'))).toBe(false);
    expect(isMeaningfulNavigableUrl(config, url('/x?pagina=itemi-evaluare-lista'))).toBe(false);
    expect(isMeaningfulNavigableUrl(config, url('/x?pagina=altele'))).toBe(false);
    expect(isMeaningfulNavigableUrl(config, url('/x?pagina=probleme-lista&clasa=9'))).toBe(true);
    expect(isMeaningfulNavigableUrl(config, url('/x?pagina=probleme-lista&bad=1'))).toBe(false);
    expect(isMeaningfulNavigableUrl(config, url('/probleme'))).toBe(true);
  });

  test('matchesConfiguredUserHandle', () => {
    expect(matchesConfiguredUserHandle(noHandleConfig, 'Prekzursil')).toBe(false);
    expect(matchesConfiguredUserHandle(config, undefined)).toBe(false);
    expect(matchesConfiguredUserHandle(config, 'prekzursil')).toBe(true);
    expect(matchesConfiguredUserHandle(config, 'Andrei (Prekzursil)')).toBe(true);
    expect(matchesConfiguredUserHandle(config, 'Someone Else')).toBe(false);
  });

  test('normalizePathname strips trailing slashes but keeps root', () => {
    expect(normalizePathname('/')).toBe('/');
    expect(normalizePathname('/probleme/')).toBe('/probleme');
  });
});

describe('archive-crawler asset URL helpers', () => {
  test('normalizeAssetUrl applies scheme, host, and path rules', () => {
    for (const candidate of ['data:x', 'javascript:x', 'vbscript:x', undefined]) {
      expect(normalizeAssetUrl(config, base, candidate)).toBeNull();
    }
    expect(normalizeAssetUrl(config, base, 'https://blocked.example.com/a.css')).toBeNull();
    expect(normalizeAssetUrl(config, base, '/php/gravatar.php')).toBeNull();
    expect(normalizeAssetUrl(config, base, '/static/app.css')).toBe('https://www.pbinfo.ro/static/app.css');
    expect(normalizeAssetUrl(config, base, 'https://cdn.example.com/a.css')).toBe('https://cdn.example.com/a.css');
    expect(normalizeAssetUrl(config, base, 'https://random.example.com/a.css')).toBeNull();
  });

  test('isBlockedAssetPath flags help, articles, exams, and gravatar', () => {
    expect(isBlockedAssetPath(url('/php/gravatar.php'))).toBe(true);
    expect(isBlockedAssetPath(url('/resurse/ajutor/x'))).toBe(true);
    expect(isBlockedAssetPath(url('/resurse/foo/articole/x'))).toBe(true);
    expect(isBlockedAssetPath(url('/resurse/foo/examene/x'))).toBe(true);
    expect(isBlockedAssetPath(url('/static/app.css'))).toBe(false);
  });

  test('normalizeSiteRelativeCandidate prefixes known site-relative roots', () => {
    expect(normalizeSiteRelativeCandidate('https://x/a')).toBe('https://x/a');
    expect(normalizeSiteRelativeCandidate('/abs')).toBe('/abs');
    expect(normalizeSiteRelativeCandidate('//proto')).toBe('//proto');
    expect(normalizeSiteRelativeCandidate('resurse/x')).toBe('/resurse/x');
    expect(normalizeSiteRelativeCandidate('img/x')).toBe('/img/x');
    expect(normalizeSiteRelativeCandidate('foo/bar')).toBe('foo/bar');
  });
});

describe('archive-crawler classification helpers', () => {
  test('inferPageKind', () => {
    expect(inferPageKind('https://www.pbinfo.ro/profil/Bob')).toBe('user-profile');
    expect(inferPageKind('https://www.pbinfo.ro/solutii/user/Bob')).toBe('user-solutions');
    expect(inferPageKind('https://www.pbinfo.ro/solutii/problema/1/sum')).toBe('official-source-list');
    expect(inferPageKind('https://www.pbinfo.ro/detalii-evaluare/5')).toBe('evaluation-detail');
    expect(inferPageKind('https://www.pbinfo.ro/probleme')).toBe('public-page');
  });

  test('inferTemplate', () => {
    expect(inferTemplate('https://www.pbinfo.ro/detalii-evaluare/5', 'evaluation-detail')).toBe('evaluation');
    expect(inferTemplate('https://www.pbinfo.ro/x', 'official-evaluation-detail')).toBe('evaluation');
    expect(inferTemplate('https://www.pbinfo.ro/profil/Bob', 'user-profile')).toBe('user-profile');
    expect(inferTemplate('https://www.pbinfo.ro/solutii/user/Bob', 'user-solutions')).toBe('user-profile');
    expect(inferTemplate('https://www.pbinfo.ro/probleme/1/sum', 'public-page')).toBe('problem');
    expect(inferTemplate('https://www.pbinfo.ro/random', 'public-page')).toBe('raw-page');
  });

  test('inferEntityKey', () => {
    expect(inferEntityKey('https://www.pbinfo.ro/probleme/1/sum', 'public-page')).toBe('problem:1');
    expect(inferEntityKey('https://www.pbinfo.ro/detalii-evaluare/5', 'evaluation-detail')).toBe('evaluation:5');
    expect(inferEntityKey('https://www.pbinfo.ro/profil/Bob', 'user-profile')).toBe('user:Bob');
    expect(inferEntityKey('https://www.pbinfo.ro/solutii/user/Bob', 'user-solutions')).toBe('user:Bob');
    expect(inferEntityKey('https://www.pbinfo.ro/random', 'public-page')).toBe('public-page:/random');
  });

  test('createPlaceholderProblem', () => {
    const problem = createPlaceholderProblem(7, 'demo');
    expect(problem.id).toBe(7);
    expect(problem.slug).toBe('demo');
    expect(problem.canonicalUrl).toContain('/probleme/7/demo');
  });
});

describe('archive-crawler test-case helpers', () => {
  test('compareProvenanceKinds orders by provenance precedence', () => {
    expect(compareProvenanceKinds('example', 'visible')).toBeLessThan(0);
    expect(compareProvenanceKinds('evaluationObserved', 'example')).toBeGreaterThan(0);
    expect(compareProvenanceKinds('visible', 'visible')).toBe(0);
  });

  test('normalizeTestIo collapses whitespace and returns undefined for blanks', () => {
    expect(normalizeTestIo(undefined)).toBeUndefined();
    expect(normalizeTestIo('   ')).toBeUndefined();
    expect(normalizeTestIo('a\r\nb  \nc   d')).toBe('a\nb\nc d');
  });

  test('buildEffectiveProblemTestKey keys by normalized io', () => {
    expect(buildEffectiveProblemTestKey({ input: undefined, output: undefined } as ProblemTestCaseRecord)).toBeUndefined();
    expect(buildEffectiveProblemTestKey({ input: 'a', output: 'b' } as ProblemTestCaseRecord)).toBe('a::b');
    expect(buildEffectiveProblemTestKey({ input: 'a' } as ProblemTestCaseRecord)).toBe('a::');
  });
});
