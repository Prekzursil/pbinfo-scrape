import type { AnyNode } from 'domhandler';

import type { CategoryLink } from '../../types/records.js';
import { loadHtml, normalizeWhitespace } from './shared.js';

export interface ParsedCategoryPage {
  grade: number;
  categories: Array<CategoryLink & { subcategories: CategoryLink[] }>;
}

export function parseCategoryPage(html: string, grade: number): ParsedCategoryPage {
  const $ = loadHtml(html);
  const anchors = $('a').toArray();
  const categories: Array<CategoryLink & { subcategories: CategoryLink[] }> = [];
  let currentCategory: (CategoryLink & { subcategories: CategoryLink[] }) | undefined;

  for (let index = 0; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    const href = $(anchor).attr('href');
    if (!href) {
      continue;
    }

    const match = href.match(/^\/probleme\/categorii\/(\d+)\/([^/?#]+)/);
    if (!match) {
      continue;
    }

    const id = Number(match[1]);
    const slug = match[2];
    /* v8 ignore next 3 -- regex capture group always present when regex matches */
    if (!slug) {
      continue;
    }
    const name = normalizeWhitespace($(anchor).text());
    const itemListHref = findNextItemListHref($, anchors, index);
    if (!itemListHref) {
      continue;
    }

    const params = new URLSearchParams(itemListHref.split('?')[1] ?? '');
    const subtag = params.get('subtag');
    if (subtag === String(id)) {
      if (!currentCategory) {
        continue;
      }

      currentCategory.subcategories.push({
        id,
        name,
        slug,
        href,
        itemListHref,
      });
      continue;
    }

    if (params.get('tag') === String(id)) {
      currentCategory = {
        id,
        name,
        slug,
        href,
        itemListHref,
        subcategories: [],
      };
      categories.push(currentCategory);
    }
  }

  return {
    grade,
    categories,
  };
}

function findNextItemListHref(
  $: ReturnType<typeof loadHtml>,
  anchors: AnyNode[],
  startIndex: number,
): string | undefined {
  for (let index = startIndex + 1; index < anchors.length; index += 1) {
    const anchor = anchors[index];
    /* v8 ignore next 3 -- TS forces T|undefined on array index; anchor always defined within bounds */
    if (!anchor) {
      continue;
    }

    const href = $(anchor).attr('href');
    if (!href) {
      continue;
    }

    if (href.startsWith('/?pagina=itemi-evaluare-lista')) {
      return href;
    }

    if (href.startsWith('/probleme/categorii/')) {
      return undefined;
    }
  }

  return undefined;
}
