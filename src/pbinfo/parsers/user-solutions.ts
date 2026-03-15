import { loadHtml, normalizeWhitespace, parseNumber } from './shared.js';

export interface UserSolutionListEntry {
  user: string;
  problemId: number;
  problemSlug: string;
  problemName: string;
  evaluationId: number;
}

export interface ParsedUserSolutionsListPage {
  totalMatches?: number;
  throttled: boolean;
  pageSize?: number;
  currentOffset?: number;
  nextPageUrls: string[];
  entries: UserSolutionListEntry[];
}

export function parseUserSolutionsListPage(
  html: string,
  pageUrl?: string,
): ParsedUserSolutionsListPage {
  const $ = loadHtml(html);
  const totalMatchesText = normalizeWhitespace($('.bold.mb-3').first().text());
  const totalMatches = parseNumber(totalMatchesText);
  const fullText = normalizeWhitespace($.root().text()).toLowerCase();
  const throttled = fullText.includes('resursă indisponibilă temporar')
    || fullText.includes('resursa indisponibila temporar');
  const anchors = $('a').toArray();
  const entries: UserSolutionListEntry[] = [];

  for (let index = 0; index < anchors.length; index += 1) {
    const profileHref = $(anchors[index]).attr('href');
    const profileMatch = profileHref?.match(/^\/profil\/([^/]+)$/);
    if (!profileMatch) {
      continue;
    }

    const problemHref = $(anchors[index + 1]).attr('href');
    const problemMatch = problemHref?.match(/^\/probleme\/(\d+)\/([^/]+)$/);
    const evaluationHref = $(anchors[index + 2]).attr('href');
    const evaluationMatch = evaluationHref?.match(/^\/detalii-evaluare\/(\d+)$/);
    if (!problemMatch || !evaluationMatch) {
      continue;
    }

    entries.push({
      user: normalizeWhitespace(profileMatch[1] || $(anchors[index]).text()),
      problemId: Number(problemMatch[1]),
      problemSlug: problemMatch[2] ?? '',
      problemName: normalizeWhitespace($(anchors[index + 1]).text()),
      evaluationId: Number(evaluationMatch[1]),
    });
  }

  const paginationMetadata = parsePaginationMetadata(html, pageUrl, totalMatches);

  return {
    totalMatches,
    throttled,
    pageSize: paginationMetadata?.pageSize,
    currentOffset: paginationMetadata?.currentOffset,
    nextPageUrls: paginationMetadata?.nextPageUrls ?? [],
    entries,
  };
}

function parsePaginationMetadata(
  html: string,
  pageUrl: string | undefined,
  totalMatches: number | undefined,
): {
  pageSize: number;
  currentOffset: number;
  nextPageUrls: string[];
} | undefined {
  const paginationMatch = html.match(/Paginare\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/i);
  if (!paginationMatch?.[1] || !paginationMatch[2] || !paginationMatch[3]) {
    return undefined;
  }

  const inferredTotal = Number(paginationMatch[1]);
  const currentOffset = Number(paginationMatch[2]);
  const pageSize = Number(paginationMatch[3]);
  if (
    !Number.isFinite(inferredTotal)
    || !Number.isFinite(currentOffset)
    || !Number.isFinite(pageSize)
    || pageSize <= 0
  ) {
    return undefined;
  }

  const resolvedTotal = totalMatches ?? inferredTotal;
  const nextPageUrls: string[] = [];
  if (pageUrl) {
    const base = new URL(pageUrl);
    const nextBase = new URL(base.toString());
    for (
      let offset = currentOffset + pageSize;
      offset < resolvedTotal;
      offset += pageSize
    ) {
      nextBase.searchParams.set('start', String(offset));
      nextPageUrls.push(nextBase.toString());
    }
  }

  return {
    pageSize,
    currentOffset,
    nextPageUrls,
  };
}
