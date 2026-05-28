import { loadHtml, normalizeWhitespace } from './shared.js';
import {
  extractRowScore,
  isThrottledPage,
  matchProfileHref,
  parsePaginationMetadata,
  parseTotalMatches,
  resolveProblemListingMatch,
} from './problem-listing-shared.js';

export interface ProblemSourceListEntry {
  user?: string;
  problemId: number;
  problemSlug: string;
  problemName: string;
  evaluationId: number;
  score?: number;
}

export interface ParsedProblemSourceListPage {
  authorHandle?: string;
  totalMatches?: number;
  throttled: boolean;
  pageSize?: number;
  currentOffset?: number;
  nextPageUrls: string[];
  entries: ProblemSourceListEntry[];
}

export function parseProblemSourceListPage(
  html: string,
  pageUrl?: string,
): ParsedProblemSourceListPage {
  const $ = loadHtml(html);
  const totalMatches = parseTotalMatches($);
  const authorHandle = extractAuthorHandle($);
  const entriesFromRows = extractEntriesFromRows($);
  const entries =
    entriesFromRows.length > 0 ? entriesFromRows : extractEntriesFromAnchorTriplets($);
  const paginationMetadata = parsePaginationMetadata($, html, pageUrl, totalMatches);

  return {
    authorHandle,
    totalMatches,
    throttled: isThrottledPage($),
    pageSize: paginationMetadata?.pageSize,
    currentOffset: paginationMetadata?.currentOffset,
    nextPageUrls: paginationMetadata?.nextPageUrls ?? [],
    entries,
  };
}

function extractAuthorHandle($: ReturnType<typeof loadHtml>): string | undefined {
  const preferredLink = $(
    '*[title="Postată de"] a[href^="/profil/"], *[title="Postata de"] a[href^="/profil/"]',
  ).first();
  if (preferredLink.length > 0) {
    const handle = matchProfileHref(preferredLink.attr('href'))?.[1];
    return normalizeWhitespace(handle ?? '') || undefined;
  }

  const summaryHandle = extractAuthorHandleFromSummaryRows($);
  return normalizeWhitespace(summaryHandle ?? '') || undefined;
}

function extractAuthorHandleFromSummaryRows($: ReturnType<typeof loadHtml>): string | undefined {
  let summaryHandle: string | undefined;
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

      const handle = matchProfileHref(
        values.eq(index).find('a[href^="/profil/"]').first().attr('href'),
      )?.[1];
      if (handle) {
        summaryHandle = handle;
      }
    });
  });

  return summaryHandle;
}

function extractEntriesFromRows($: ReturnType<typeof loadHtml>): ProblemSourceListEntry[] {
  const entries: ProblemSourceListEntry[] = [];
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

    entries.push({
      user: normalizeProfileHandle(profileAnchor.attr('href'), profileAnchor.text()),
      problemId: match.problemId,
      problemSlug: match.problemSlug,
      problemName: normalizeWhitespace(problemAnchor.text()),
      evaluationId: match.evaluationId,
      score: extractRowScore($, row),
    });
  });

  return entries;
}

function extractEntriesFromAnchorTriplets(
  $: ReturnType<typeof loadHtml>,
): ProblemSourceListEntry[] {
  const anchors = $('a').toArray();
  const entries: ProblemSourceListEntry[] = [];
  const seen = new Set<number>();

  for (let index = 0; index < anchors.length; index += 1) {
    const problemMatch = $(anchors[index]).attr('href')?.match(/^\/probleme\/(\d+)\/([^/?#]+)$/);
    if (!problemMatch?.[1] || !problemMatch[2]) {
      continue;
    }

    const evaluationAnchorIndex = $(anchors[index + 1])
      .attr('href')
      ?.startsWith('/profil/')
      ? index + 2
      : index + 1;

    const match = resolveProblemListingMatch(
      $(anchors[index]).attr('href'),
      $(anchors[evaluationAnchorIndex]).attr('href'),
    );
    if (!match || seen.has(match.evaluationId)) {
      continue;
    }
    seen.add(match.evaluationId);

    entries.push({
      user: normalizeProfileHandle(
        $(anchors[index + 1]).attr('href'),
        $(anchors[index + 1]).text(),
      ),
      problemId: match.problemId,
      problemSlug: match.problemSlug,
      problemName: normalizeWhitespace($(anchors[index]).text()),
      evaluationId: match.evaluationId,
    });
  }

  return entries;
}

function normalizeProfileHandle(
  profileHref: string | undefined,
  profileText: string,
): string | undefined {
  const hrefHandle = matchProfileHref(profileHref)?.[1];
  const normalizedText = normalizeWhitespace(profileText);
  const textHandle = normalizedText.match(/\(([^)]+)\)\s*$/)?.[1];
  const handle = textHandle ?? hrefHandle ?? normalizedText;
  return normalizeWhitespace(handle) || undefined;
}
