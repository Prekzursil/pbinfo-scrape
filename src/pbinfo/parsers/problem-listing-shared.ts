import { loadHtml, normalizeWhitespace, parseNumber, type HtmlNode } from './shared.js';

type Cheerio = ReturnType<typeof loadHtml>;

const PROBLEM_HREF_PATTERN = /^\/probleme\/(\d+)\/([^/?#]+)$/;
const EVALUATION_HREF_PATTERN = /^\/detalii-evaluare\/(\d+)$/;
const PROFILE_HREF_PATTERN = /^\/profil\/([^/?#]+)$/;

export interface ProblemListingMatch {
  problemId: number;
  problemSlug: string;
  evaluationId: number;
}

export interface PaginationMetadata {
  pageSize: number;
  currentOffset: number;
  nextPageUrls: string[];
}

/**
 * Scans `<tr>` rows for a "Postată de" header cell and returns the profile
 * handle found in the adjacent value cell. Shared by the problem-source-list and
 * problem-statement parsers, which surface the same "posted by" summary table.
 */
export function extractPostedByHandleFromRows($: Cheerio): string | undefined {
  let handle: string | undefined;
  $('tr').each((_, row) => {
    const headers = $(row).children('th');
    const values = $(row).children('td');
    if (headers.length === 0 || values.length === 0) {
      return;
    }

    headers.each((index, headerCell) => {
      const header = normalizeWhitespace($(headerCell).text()).toLowerCase();
      if (!header.includes('postată de') && !header.includes('postata de')) {
        return;
      }

      const found = matchProfileHref(
        values.eq(index).find('a[href^="/profil/"]').first().attr('href'),
      )?.[1];
      if (found) {
        handle = found;
      }
    });
  });

  return handle;
}

export function parseTotalMatches($: Cheerio): number | undefined {
  return parseNumber(normalizeWhitespace($('.bold.mb-3').first().text()));
}

export function isThrottledPage($: Cheerio): boolean {
  const fullText = normalizeWhitespace($.root().text()).toLowerCase();
  return (
    fullText.includes('resursă indisponibilă temporar') ||
    fullText.includes('resursa indisponibila temporar')
  );
}

export function matchProblemHref(href: string | undefined): RegExpMatchArray | null | undefined {
  return href?.match(PROBLEM_HREF_PATTERN);
}

export function matchEvaluationHref(href: string | undefined): RegExpMatchArray | null | undefined {
  return href?.match(EVALUATION_HREF_PATTERN);
}

export function matchProfileHref(href: string | undefined): RegExpMatchArray | null | undefined {
  return href?.match(PROFILE_HREF_PATTERN);
}

/**
 * Resolves the problem id / slug / evaluation id triple shared by both listing
 * formats. Returns undefined when the anchors don't form a valid record.
 */
export function resolveProblemListingMatch(
  problemHref: string | undefined,
  evaluationHref: string | undefined,
): ProblemListingMatch | undefined {
  const problemMatch = matchProblemHref(problemHref);
  const evaluationMatch = matchEvaluationHref(evaluationHref);
  if (!problemMatch?.[1] || !problemMatch[2] || !evaluationMatch?.[1]) {
    return undefined;
  }

  const evaluationId = Number(evaluationMatch[1]);
  if (!Number.isFinite(evaluationId)) {
    return undefined;
  }

  return {
    problemId: Number(problemMatch[1]),
    problemSlug: problemMatch[2],
    evaluationId,
  };
}

export interface ProblemListingEntryBase {
  user: string | undefined;
  problemId: number;
  problemSlug: string;
  problemName: string;
  evaluationId: number;
}

/**
 * Builds the common listing-entry fields from a resolved match. Both listing
 * parsers share this shape and only differ in how the user handle is resolved.
 */
export function buildProblemListingEntry(
  match: ProblemListingMatch,
  user: string | undefined,
  problemName: string,
): ProblemListingEntryBase {
  return {
    user,
    problemId: match.problemId,
    problemSlug: match.problemSlug,
    problemName: normalizeWhitespace(problemName),
    evaluationId: match.evaluationId,
  };
}

export interface ProblemListingRow {
  match: ProblemListingMatch;
  profileAnchor: ReturnType<Cheerio>;
  problemAnchor: ReturnType<Cheerio>;
  score?: number;
}

/**
 * Iterates `table tr` rows, resolves the problem/evaluation triple, dedupes by
 * evaluation id, and invokes `onRow` with the resolved match plus the profile
 * and problem anchors. Shared by both listing parsers, which differ only in how
 * they normalize the user handle.
 */
export function forEachProblemListingRow(
  $: Cheerio,
  onRow: (row: ProblemListingRow) => void,
): void {
  const seen = new Set<number>();
  $('table tr').each((_, row) => {
    const profileAnchor = $(row).find('a[href^="/profil/"]').first();
    const problemAnchor = $(row).find('a[href^="/probleme/"]').first();
    const evaluationAnchor = $(row).find('a[href^="/detalii-evaluare/"]').first();

    const match = resolveProblemListingMatch(
      problemAnchor.attr('href'),
      evaluationAnchor.attr('href'),
    );
    if (!match || seen.has(match.evaluationId)) {
      return;
    }
    seen.add(match.evaluationId);
    onRow({ match, profileAnchor, problemAnchor, score: extractRowScore($, row) });
  });
}

export function extractRowScore($: Cheerio, row: HtmlNode): number | undefined {
  const cells = $(row).find('td');
  if (cells.length === 0) {
    return undefined;
  }

  return parseNumber(normalizeWhitespace(cells.last().text())) ?? undefined;
}

export function extractCurrentOffset(pageUrl: string | undefined): number {
  if (!pageUrl) {
    return 0;
  }

  const value = Number(new URL(pageUrl).searchParams.get('start') ?? '0');
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export function extractExplicitPaginationUrls($: Cheerio, pageUrl: string | undefined): string[] {
  if (!pageUrl) {
    return [];
  }

  const base = new URL(pageUrl);
  const currentOffset = extractCurrentOffset(pageUrl);
  const urls = new Set<string>();

  $('.pagination a[href], a[href*="start="]').each((_, link) => {
    const href = $(link).attr('href');
    if (!href) {
      return;
    }

    const resolved = new URL(href, base);
    if (resolved.origin !== base.origin || resolved.pathname !== base.pathname) {
      return;
    }

    const start = Number(resolved.searchParams.get('start'));
    if (!Number.isFinite(start) || start <= currentOffset) {
      return;
    }

    urls.add(resolved.toString());
  });

  return [...urls].sort((left, right) => extractCurrentOffset(left) - extractCurrentOffset(right));
}

function parseScriptedPagination(html: string):
  | {
      inferredTotal: number;
      currentOffset: number;
      pageSize: number;
    }
  | undefined {
  const paginationMatch = html.match(/Paginare\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
  if (!paginationMatch?.[1] || !paginationMatch[2] || !paginationMatch[3]) {
    return undefined;
  }

  const inferredTotal = Number(paginationMatch[1]);
  const currentOffset = Number(paginationMatch[2]);
  const pageSize = Number(paginationMatch[3]);
  if (
    !Number.isFinite(inferredTotal) ||
    !Number.isFinite(currentOffset) ||
    !Number.isFinite(pageSize) ||
    pageSize <= 0
  ) {
    return undefined;
  }

  return { inferredTotal, currentOffset, pageSize };
}

function buildScriptedNextPageUrls(
  pageUrl: string | undefined,
  currentOffset: number,
  pageSize: number,
  resolvedTotal: number,
): string[] {
  if (!pageUrl) {
    return [];
  }

  const nextPage = new URL(pageUrl);
  const nextPageUrls: string[] = [];
  for (let offset = currentOffset + pageSize; offset < resolvedTotal; offset += pageSize) {
    nextPage.searchParams.set('start', String(offset));
    nextPageUrls.push(nextPage.toString());
  }
  return nextPageUrls;
}

export function parsePaginationMetadata(
  $: Cheerio,
  html: string,
  pageUrl: string | undefined,
  totalMatches: number | undefined,
): PaginationMetadata | undefined {
  const explicitPaginationUrls = extractExplicitPaginationUrls($, pageUrl);
  if (explicitPaginationUrls.length > 0) {
    return {
      pageSize: explicitPaginationUrls.length,
      currentOffset: extractCurrentOffset(pageUrl),
      nextPageUrls: explicitPaginationUrls,
    };
  }

  const scripted = parseScriptedPagination(html);
  if (!scripted) {
    return undefined;
  }

  const resolvedTotal = totalMatches ?? scripted.inferredTotal;
  return {
    pageSize: scripted.pageSize,
    currentOffset: scripted.currentOffset,
    nextPageUrls: buildScriptedNextPageUrls(
      pageUrl,
      scripted.currentOffset,
      scripted.pageSize,
      resolvedTotal,
    ),
  };
}
