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

function parseScriptedPagination(html: string): {
  inferredTotal: number;
  currentOffset: number;
  pageSize: number;
} | undefined {
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
