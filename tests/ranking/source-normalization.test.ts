import { describe, expect, test } from 'vitest';

import {
  buildSourceSignature,
  normalizeLanguage,
  normalizeSourceCode,
} from '../../src/ranking/source-normalization.js';

describe('normalizeLanguage', () => {
  test('returns undefined for empty or whitespace-only input', () => {
    expect(normalizeLanguage(undefined)).toBeUndefined();
    expect(normalizeLanguage('   ')).toBeUndefined();
  });

  test('maps known language aliases', () => {
    expect(normalizeLanguage('C++')).toBe('cpp');
    expect(normalizeLanguage('cpp')).toBe('cpp');
    expect(normalizeLanguage('Python 3')).toBe('py');
    expect(normalizeLanguage('py3')).toBe('py');
    expect(normalizeLanguage('C#')).toBe('csharp');
    expect(normalizeLanguage('csharp')).toBe('csharp');
    expect(normalizeLanguage('Pascal')).toBe('pas');
    expect(normalizeLanguage('pas')).toBe('pas');
  });

  test('passes through an unknown but non-empty language', () => {
    expect(normalizeLanguage('ruby')).toBe('ruby');
  });
});

describe('normalizeSourceCode', () => {
  test('returns undefined for falsy source', () => {
    expect(normalizeSourceCode(undefined)).toBeUndefined();
  });

  test('strips python comments when language is python', () => {
    const out = normalizeSourceCode('# header\nprint(1)\n# tail', 'python');
    expect(out).toBe('print(1)');
  });

  test('strips C-style line and block comments for non-python languages', () => {
    const out = normalizeSourceCode('int main(){ // x\n/* block */ return 0; }', 'cpp');
    expect(out).toContain('return 0;');
    expect(out).not.toContain('block');
  });

  test('returns undefined when normalization yields only stripped content', () => {
    expect(normalizeSourceCode('// only a comment', 'cpp')).toBeUndefined();
  });
});

describe('buildSourceSignature', () => {
  test('returns undefined when there is no source', () => {
    expect(buildSourceSignature(undefined)).toBeUndefined();
  });

  test('produces hashes and lengths for real source', () => {
    const sig = buildSourceSignature('int main(){ return 0; }', 'cpp');
    expect(sig?.sourceHash).toMatch(/^sha256:/);
    expect(sig?.normalizedSourceHash).toMatch(/^sha256:/);
    expect(sig?.sourceLength).toBeGreaterThan(0);
    expect(sig?.normalizedSourceLength).toBeGreaterThan(0);
  });

  test('omits normalized fields when normalization collapses to nothing', () => {
    const sig = buildSourceSignature('// only comment', 'cpp');
    expect(sig?.normalizedSourceHash).toBeUndefined();
    expect(sig?.normalizedSourceLength).toBeUndefined();
  });
});
