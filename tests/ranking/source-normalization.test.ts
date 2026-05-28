import { describe, expect, test } from 'vitest';

import {
  buildSourceSignature,
  normalizeLanguage,
  normalizeSourceCode,
} from '../../src/ranking/source-normalization.js';

describe('source normalization', () => {
  test('buildSourceSignature returns undefined for empty source', () => {
    expect(buildSourceSignature(undefined)).toBeUndefined();
  });

  test('buildSourceSignature hashes both raw and normalized source', () => {
    const signature = buildSourceSignature('int main() {} // note', 'cpp');
    expect(signature?.sourceHash).toMatch(/^sha256:/);
    expect(signature?.normalizedSourceHash).toMatch(/^sha256:/);
    expect(signature?.sourceLength).toBeGreaterThan(0);
  });

  test('normalizeSourceCode strips comments per language and returns undefined for empty input', () => {
    expect(normalizeSourceCode(undefined)).toBeUndefined();
    expect(normalizeSourceCode('# only a comment\n', 'python')).toBeUndefined();
    expect(normalizeSourceCode('int x; // trailing\n', 'cpp')).toBe('int x;');
    expect(normalizeSourceCode('/* block */\nint y;', 'cpp')).toBe('int y;');
  });

  test('normalizeLanguage maps known aliases and falls back to the lowercased value', () => {
    expect(normalizeLanguage('C++')).toBe('cpp');
    expect(normalizeLanguage('cpp')).toBe('cpp');
    expect(normalizeLanguage('Python 3')).toBe('py');
    expect(normalizeLanguage('py3')).toBe('py');
    expect(normalizeLanguage('C#')).toBe('csharp');
    expect(normalizeLanguage('csharp')).toBe('csharp');
    expect(normalizeLanguage('Pascal')).toBe('pas');
    expect(normalizeLanguage('rust')).toBe('rust');
    expect(normalizeLanguage(undefined)).toBeUndefined();
    expect(normalizeLanguage('   ')).toBeUndefined();
  });
});
