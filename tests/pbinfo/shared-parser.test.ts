import { describe, expect, test } from 'vitest';

import {
  loadHtml,
  normalizeWhitespace,
  parseNumber,
  parseSeconds,
} from '../../src/pbinfo/parsers/shared.js';

describe('shared parser helpers', () => {
  test('loadHtml returns a cheerio root', () => {
    const $ = loadHtml('<div class="x">hi</div>');
    expect($('.x').text()).toBe('hi');
  });

  test('normalizeWhitespace collapses runs of whitespace and trims', () => {
    expect(normalizeWhitespace('  a\n\t  b   c ')).toBe('a b c');
  });

  test('parseNumber extracts numeric values and ignores non-numeric noise', () => {
    expect(parseNumber('1.234 puncte')).toBe(1.234);
    expect(parseNumber('no digits here')).toBeUndefined();
    // Cleans to a non-finite token, returning undefined.
    expect(parseNumber('.-')).toBeUndefined();
  });

  test('parseSeconds parses comma and dot decimals and ignores empty input', () => {
    expect(parseSeconds('0,015 s')).toBe(0.015);
    expect(parseSeconds('1.9s')).toBe(1.9);
    expect(parseSeconds('no time')).toBeUndefined();
  });
});
