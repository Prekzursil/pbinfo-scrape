import { describe, expect, test } from 'vitest';

import { parseCategoryPage } from '../../src/pbinfo/parsers/category.js';

describe('parseCategoryPage edge cases', () => {
  test('skips anchors without href, without a following item list, or followed by another category', () => {
    const html = `
      <a>no href here</a>
      <a href="/probleme/categorii/5/alpha">Alpha</a>
      <a>still no href</a>
      <a href="/probleme/categorii/6/beta">Beta</a>
    `;

    const parsed = parseCategoryPage(html, 9);
    // Alpha is skipped because findNext hits the Beta category before any item
    // list (also exercising the href-less anchor skip inside findNext); Beta is
    // skipped because nothing follows it.
    expect(parsed).toEqual({ grade: 9, categories: [] });
  });

  test('ignores a subtag item list that appears before any parent category', () => {
    const html = `
      <a href="/probleme/categorii/9/orphan">Orphan</a>
      <a href="/?pagina=itemi-evaluare-lista&disciplina=0&clasa=9&tag=99&subtag=9">Itemi</a>
    `;

    const parsed = parseCategoryPage(html, 9);
    expect(parsed.categories).toEqual([]);
  });

  test('ignores anchors that do not match the category url shape', () => {
    const html = '<a href="/about">About</a><a href="/probleme">List</a>';
    expect(parseCategoryPage(html, 10).categories).toEqual([]);
  });
});
