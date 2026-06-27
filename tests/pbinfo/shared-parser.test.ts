import { describe, expect, test } from 'vitest';

import {
  loadHtml,
  normalizeWhitespace,
  parseNumber,
  parseSeconds,
} from '../../src/pbinfo/parsers/shared.js';
import { isOfficialSourceAuthorHandle } from '../../src/pbinfo/official-source-authors.js';

describe('shared parser helpers', () => {
  test('loadHtml returns a cheerio instance over the markup', () => {
    const $ = loadHtml('<p class="x">hi</p>');
    expect($('.x').text()).toBe('hi');
  });

  test('normalizeWhitespace collapses runs of whitespace and trims', () => {
    expect(normalizeWhitespace('  a\n\t  b   c ')).toBe('a b c');
  });

  test('parseNumber extracts numeric content and rejects empty/non-finite input', () => {
    expect(parseNumber('1,234 ms')).toBe(1234);
    expect(parseNumber('abc')).toBeUndefined();
    expect(parseNumber('-.')).toBeUndefined();
  });

  test('parseSeconds reads the first decimal token, normalizing commas', () => {
    expect(parseSeconds('1,5 s')).toBe(1.5);
    expect(parseSeconds('no number here')).toBeUndefined();
  });
});

describe('official source author handles', () => {
  test('matches the pbinfo handle case-insensitively and rejects empty input', () => {
    expect(isOfficialSourceAuthorHandle(' PBInfo ')).toBe(true);
    expect(isOfficialSourceAuthorHandle('someone')).toBe(false);
    expect(isOfficialSourceAuthorHandle(undefined)).toBe(false);
    expect(isOfficialSourceAuthorHandle('')).toBe(false);
  });
});
