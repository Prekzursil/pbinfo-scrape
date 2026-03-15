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
  const entriesFromRows = extractEntriesFromRows($);
  const entries =
    entriesFromRows.length > 0 ? entriesFromRows : extractEntriesFromAnchorTriplets($);

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

function extractEntriesFromRows(
  $: ReturnType<typeof loadHtml>,
): UserSolutionListEntry[] {
  const entries: UserSolutionListEntry[] = [];
  const seen = new Set<number>();

  $('table tr').each((_, row) => {
    const profileAnchor = $(row).find('a[href^="/profil/"]').first();
    const problemAnchor = $(row).find('a[href^="/probleme/"]').first();
    const evaluationAnchor = $(row).find('a[href^="/detalii-evaluare/"]').first();

    const profileHref = profileAnchor.attr('href');
    const problemHref = problemAnchor.attr('href');
    const evaluationHref = evaluationAnchor.attr('href');
    const profileMatch = profileHref?.match(/^\/profil\/([^/?#]+)$/);
    const problemMatch = problemHref?.match(/^\/probleme\/(\d+)\/([^/?#]+)$/);
    const evaluationMatch = evaluationHref?.match(/^\/detalii-evaluare\/(\d+)$/);
    if (!profileMatch?.[1] || !problemMatch?.[1] || !problemMatch[2] || !evaluationMatch?.[1]) {
      return;
    }

    const evaluationId = Number(evaluationMatch[1]);
    if (!Number.isFinite(evaluationId) || seen.has(evaluationId)) {
      return;
    }
    seen.add(evaluationId);

    entries.push({
      user: normalizeUserHandle(profileMatch[1], profileAnchor.text()),
      problemId: Number(problemMatch[1]),
      problemSlug: problemMatch[2],
      problemName: normalizeWhitespace(problemAnchor.text()),
      evaluationId,
    });
  });

  return entries;
}

function extractEntriesFromAnchorTriplets(
  $: ReturnType<typeof loadHtml>,
): UserSolutionListEntry[] {
  const anchors = $('a').toArray();
  const entries: UserSolutionListEntry[] = [];
  const seen = new Set<number>();

  for (let index = 0; index < anchors.length; index += 1) {
    const profileHref = $(anchors[index]).attr('href');
    const profileMatch = profileHref?.match(/^\/profil\/([^/?#]+)$/);
    if (!profileMatch?.[1]) {
      continue;
    }

    const problemHref = $(anchors[index + 1]).attr('href');
    const problemMatch = problemHref?.match(/^\/probleme\/(\d+)\/([^/?#]+)$/);
    const evaluationHref = $(anchors[index + 2]).attr('href');
    const evaluationMatch = evaluationHref?.match(/^\/detalii-evaluare\/(\d+)$/);
    if (!problemMatch?.[1] || !problemMatch[2] || !evaluationMatch?.[1]) {
      continue;
    }

    const evaluationId = Number(evaluationMatch[1]);
    if (!Number.isFinite(evaluationId) || seen.has(evaluationId)) {
      continue;
    }
    seen.add(evaluationId);

    entries.push({
      user: normalizeUserHandle(profileMatch[1], $(anchors[index]).text()),
      problemId: Number(problemMatch[1]),
      problemSlug: problemMatch[2],
      problemName: normalizeWhitespace($(anchors[index + 1]).text()),
      evaluationId,
    });
  }

  return entries;
}

function normalizeUserHandle(
  profileHandle: string,
  profileText: string,
): string {
  const normalizedText = normalizeWhitespace(profileText);
  const textHandle = normalizedText.match(/\(([^)]+)\)\s*$/)?.[1];
  return normalizeWhitespace(textHandle ?? profileHandle);
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
