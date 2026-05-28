import { loadHtml, normalizeWhitespace } from './shared.js';
import {
  buildProblemListingEntry,
  forEachProblemListingRow,
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
  forEachProblemListingRow($, ({ match, profileAnchor, problemAnchor, score }) => {
    const profileMatch = matchProfileHref(profileAnchor.attr('href'));
    if (!profileMatch?.[1]) {
      return;
    }
    const user = normalizeUserHandle(profileMatch[1], profileAnchor.text());
    entries.push({
      ...buildProblemListingEntry(match, user, problemAnchor.text()),
      user,
      score,
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

    const user = normalizeUserHandle(profileMatch[1], $(anchors[index]).text());
    entries.push({
      ...buildProblemListingEntry(match, user, $(anchors[index + 1]).text()),
      user,
    });
  }

  return entries;
}

function normalizeUserHandle(profileHandle: string, profileText: string): string {
  const normalizedText = normalizeWhitespace(profileText);
  const textHandle = normalizedText.match(/\(([^)]+)\)\s*$/)?.[1];
  return normalizeWhitespace(textHandle ?? profileHandle);
}
