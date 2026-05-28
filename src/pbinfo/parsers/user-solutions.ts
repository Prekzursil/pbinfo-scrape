import { loadHtml, normalizeWhitespace } from './shared.js';
import {
  extractRowScore,
  isThrottledPage,
  matchProfileHref,
  parsePaginationMetadata,
  parseTotalMatches,
  resolveProblemListingMatch,
} from './problem-listing-shared.js';

export interface UserSolutionListEntry {
  user: string;
  problemId: number;
  problemSlug: string;
  problemName: string;
  evaluationId: number;
  score?: number;
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
  const totalMatches = parseTotalMatches($);
  const entriesFromRows = extractEntriesFromRows($);
  const entries =
    entriesFromRows.length > 0 ? entriesFromRows : extractEntriesFromAnchorTriplets($);
  const paginationMetadata = parsePaginationMetadata($, html, pageUrl, totalMatches);

  return {
    totalMatches,
    throttled: isThrottledPage($),
    pageSize: paginationMetadata?.pageSize,
    currentOffset: paginationMetadata?.currentOffset,
    nextPageUrls: paginationMetadata?.nextPageUrls ?? [],
    entries,
  };
}

function extractEntriesFromRows($: ReturnType<typeof loadHtml>): UserSolutionListEntry[] {
  const entries: UserSolutionListEntry[] = [];
  const seen = new Set<number>();

  $('table tr').each((_, row) => {
    const profileAnchor = $(row).find('a[href^="/profil/"]').first();
    const problemAnchor = $(row).find('a[href^="/probleme/"]').first();
    const evaluationAnchor = $(row).find('a[href^="/detalii-evaluare/"]').first();

    const profileMatch = matchProfileHref(profileAnchor.attr('href'));
    const match = resolveProblemListingMatch(
      problemAnchor.attr('href'),
      evaluationAnchor.attr('href'),
    );
    if (!profileMatch?.[1] || !match || seen.has(match.evaluationId)) {
      return;
    }
    seen.add(match.evaluationId);

    entries.push({
      user: normalizeUserHandle(profileMatch[1], profileAnchor.text()),
      problemId: match.problemId,
      problemSlug: match.problemSlug,
      problemName: normalizeWhitespace(problemAnchor.text()),
      evaluationId: match.evaluationId,
      score: extractRowScore($, row),
    });
  });

  return entries;
}

function extractEntriesFromAnchorTriplets($: ReturnType<typeof loadHtml>): UserSolutionListEntry[] {
  const anchors = $('a').toArray();
  const entries: UserSolutionListEntry[] = [];
  const seen = new Set<number>();

  for (let index = 0; index < anchors.length; index += 1) {
    const profileMatch = matchProfileHref($(anchors[index]).attr('href'));
    if (!profileMatch?.[1]) {
      continue;
    }

    const match = resolveProblemListingMatch(
      $(anchors[index + 1]).attr('href'),
      $(anchors[index + 2]).attr('href'),
    );
    if (!match || seen.has(match.evaluationId)) {
      continue;
    }
    seen.add(match.evaluationId);

    entries.push({
      user: normalizeUserHandle(profileMatch[1], $(anchors[index]).text()),
      problemId: match.problemId,
      problemSlug: match.problemSlug,
      problemName: normalizeWhitespace($(anchors[index + 1]).text()),
      evaluationId: match.evaluationId,
    });
  }

  return entries;
}

function normalizeUserHandle(profileHandle: string, profileText: string): string {
  const normalizedText = normalizeWhitespace(profileText);
  const textHandle = normalizedText.match(/\(([^)]+)\)\s*$/)?.[1];
  return normalizeWhitespace(textHandle ?? profileHandle);
}
