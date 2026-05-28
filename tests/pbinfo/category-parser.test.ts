import { describe, expect, test } from 'vitest';

import { parseCategoryPage } from '../../src/pbinfo/parsers/category.js';

describe('parseCategoryPage', () => {
  test('builds categories with nested subcategories from anchor sequences', () => {
    const html = `
      <a>no href anchor</a>
      <a href="/about">unrelated link</a>
      <a href="/probleme/categorii/10/recursivitate">Recursivitate</a>
      <a href="/?pagina=itemi-evaluare-lista&tag=10">Lista</a>
      <a href="/probleme/categorii/11/divide-et-impera">Divide</a>
      <a href="/?pagina=itemi-evaluare-lista&subtag=10">Sub list ignored</a>
      <a href="/probleme/categorii/12/backtracking">Backtracking</a>
      <a href="/?pagina=itemi-evaluare-lista&subtag=12">Backtracking sub</a>
    `;

    const result = parseCategoryPage(html, 11);

    expect(result.grade).toBe(11);
    expect(result.categories).toHaveLength(1);
    expect(result.categories[0]).toMatchObject({ id: 10, slug: 'recursivitate' });
  });

  test('attaches a subcategory to the current category when subtag matches', () => {
    const html = `
      <a href="/probleme/categorii/20/grafuri">Grafuri</a>
      <a href="/?pagina=itemi-evaluare-lista&tag=20">List</a>
      <a href="/probleme/categorii/21/parcurgeri">Parcurgeri</a>
      <a href="/?pagina=itemi-evaluare-lista&subtag=21">Sub</a>
    `;

    const result = parseCategoryPage(html, 9);

    expect(result.categories).toHaveLength(1);
    expect(result.categories[0]!.subcategories).toEqual([
      expect.objectContaining({ id: 21, slug: 'parcurgeri' }),
    ]);
  });

  test('ignores a leading subtag entry that has no current category', () => {
    const html = `
      <a href="/probleme/categorii/30/dp">DP</a>
      <a href="/?pagina=itemi-evaluare-lista&subtag=30">Sub before any tag</a>
    `;

    const result = parseCategoryPage(html, 12);
    expect(result.categories).toEqual([]);
  });

  test('skips category anchors that lack a following item-list link', () => {
    const html = `
      <a href="/probleme/categorii/40/sortari">Sortari</a>
      <a href="/probleme/categorii/41/cautari">Cautari</a>
    `;

    const result = parseCategoryPage(html, 10);
    expect(result.categories).toEqual([]);
  });

  test('skips intervening anchors without an href when locating the item list', () => {
    const html = `
      <a href="/probleme/categorii/50/stive">Stive</a>
      <a>placeholder without href</a>
      <a href="/about">unrelated</a>
      <a href="/?pagina=itemi-evaluare-lista&tag=50">List</a>
    `;

    const result = parseCategoryPage(html, 9);

    expect(result.categories).toHaveLength(1);
    expect(result.categories[0]).toMatchObject({ id: 50, slug: 'stive' });
  });
});
