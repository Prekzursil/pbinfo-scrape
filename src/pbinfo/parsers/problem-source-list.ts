import { loadHtml, normalizeWhitespace } from './shared.js';
import {
  buildProblemListingEntry,
  extractPostedByHandleFromRows,
  forEachProblemListingRow,
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

  const summaryHandle = extractPostedByHandleFromRows($);
  return normalizeWhitespace(summaryHandle ?? '') || undefined;
}

function extractEntriesFromRows($: ReturnType<typeof loadHtml>): ProblemSourceListEntry[] {
  const entries: ProblemSourceListEntry[] = [];
  forEachProblemListingRow($, ({ match, profileAnchor, problemAnchor, score }) => {
    const user = normalizeProfileHandle(profileAnchor.attr('href'), profileAnchor.text());
    entries.push({
      ...buildProblemListingEntry(match, user, problemAnchor.text()),
      score,
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
    const problemMatch = $(anchors[index])
      .attr('href')
      ?.match(/^\/probleme\/(\d+)\/([^/?#]+)$/);
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

    const user = normalizeProfileHandle(
      $(anchors[index + 1]).attr('href'),
      $(anchors[index + 1]).text(),
    );
    entries.push(buildProblemListingEntry(match, user, $(anchors[index]).text()));
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
