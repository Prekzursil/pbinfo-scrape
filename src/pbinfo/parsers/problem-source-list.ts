import { loadHtml, normalizeWhitespace, parseNumber } from './shared.js';

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
  const totalMatchesText = normalizeWhitespace($('.bold.mb-3').first().text());
  const totalMatches = parseNumber(totalMatchesText);
  const fullText = normalizeWhitespace($.root().text()).toLowerCase();
  const authorHandle = extractAuthorHandle($);
  const throttled = fullText.includes('resursă indisponibilă temporar')
    || fullText.includes('resursa indisponibila temporar');
  const entriesFromRows = extractEntriesFromRows($);
  const entries =
    entriesFromRows.length > 0 ? entriesFromRows : extractEntriesFromAnchorTriplets($);
  const paginationMetadata = parsePaginationMetadata($, html, pageUrl, totalMatches);

  return {
    authorHandle,
    totalMatches,
    throttled,
    pageSize: paginationMetadata?.pageSize,
    currentOffset: paginationMetadata?.currentOffset,
    nextPageUrls: paginationMetadata?.nextPageUrls ?? [],
    entries,
  };
}

function extractAuthorHandle($: ReturnType<typeof loadHtml>): string | undefined {
  const preferredLink = $('*[title="Postată de"] a[href^="/profil/"], *[title="Postata de"] a[href^="/profil/"]').first();
  if (preferredLink.length > 0) {
    const handle = preferredLink.attr('href')?.match(/^\/profil\/([^/?#]+)$/)?.[1];
    const normalized = normalizeWhitespace(handle ?? '');
    return normalized || undefined;
  }

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

      const valueCell = values.eq(index);
      const handle = valueCell.find('a[href^="/profil/"]').first().attr('href')?.match(/^\/profil\/([^/?#]+)$/)?.[1];
      if (handle) {
        summaryHandle = handle;
      }
    });
  });

  const normalized = normalizeWhitespace(summaryHandle ?? '');
  return normalized || undefined;
}

function extractEntriesFromRows(
  $: ReturnType<typeof loadHtml>,
): ProblemSourceListEntry[] {
  const entries: ProblemSourceListEntry[] = [];
  const seen = new Set<number>();

  $('table tr').each((_, row) => {
    const profileAnchor = $(row).find('a[href^="/profil/"]').first();
    const problemAnchor = $(row).find('a[href^="/probleme/"]').first();
    const evaluationAnchor = $(row).find('a[href^="/detalii-evaluare/"]').first();

    const problemMatch = problemAnchor.attr('href')?.match(/^\/probleme\/(\d+)\/([^/?#]+)$/);
    const evaluationMatch = evaluationAnchor.attr('href')?.match(/^\/detalii-evaluare\/(\d+)$/);
    if (!problemMatch?.[1] || !problemMatch[2] || !evaluationMatch?.[1]) {
      return;
    }

    const evaluationId = Number(evaluationMatch[1]);
    if (!Number.isFinite(evaluationId) || seen.has(evaluationId)) {
      return;
    }
    seen.add(evaluationId);

    entries.push({
      user: normalizeProfileHandle(profileAnchor.attr('href'), profileAnchor.text()),
      problemId: Number(problemMatch[1]),
      problemSlug: problemMatch[2],
      problemName: normalizeWhitespace(problemAnchor.text()),
      evaluationId,
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
    const problemHref = $(anchors[index]).attr('href');
    const problemMatch = problemHref?.match(/^\/probleme\/(\d+)\/([^/?#]+)$/);
    if (!problemMatch?.[1] || !problemMatch[2]) {
      continue;
    }

    let evaluationAnchorIndex = index + 1;
    if ($(anchors[index + 1]).attr('href')?.startsWith('/profil/')) {
      evaluationAnchorIndex = index + 2;
    }

    const evaluationHref = $(anchors[evaluationAnchorIndex]).attr('href');
    const evaluationMatch = evaluationHref?.match(/^\/detalii-evaluare\/(\d+)$/);
    if (!evaluationMatch?.[1]) {
      continue;
    }

    const evaluationId = Number(evaluationMatch[1]);
    if (!Number.isFinite(evaluationId) || seen.has(evaluationId)) {
      continue;
    }
    seen.add(evaluationId);

    const maybeProfileHref = $(anchors[index + 1]).attr('href');
    entries.push({
      user: normalizeProfileHandle(maybeProfileHref, $(anchors[index + 1]).text()),
      problemId: Number(problemMatch[1]),
      problemSlug: problemMatch[2],
      problemName: normalizeWhitespace($(anchors[index]).text()),
      evaluationId,
    });
  }

  return entries;
}

function normalizeProfileHandle(
  profileHref: string | undefined,
  profileText: string,
): string | undefined {
  const hrefHandle = profileHref?.match(/^\/profil\/([^/?#]+)$/)?.[1];
  const normalizedText = normalizeWhitespace(profileText);
  const textHandle = normalizedText.match(/\(([^)]+)\)\s*$/)?.[1];
  const handle = textHandle ?? hrefHandle ?? normalizedText;
  const normalizedHandle = normalizeWhitespace(handle);
  return normalizedHandle || undefined;
}

function extractRowScore(
  $: ReturnType<typeof loadHtml>,
  row: any,
): number | undefined {
  const cells = $(row).find('td');
  if (cells.length === 0) {
    return undefined;
  }

  return parseNumber(normalizeWhitespace(cells.last().text())) ?? undefined;
}

function parsePaginationMetadata(
  $: ReturnType<typeof loadHtml>,
  html: string,
  pageUrl: string | undefined,
  totalMatches: number | undefined,
): {
  pageSize: number;
  currentOffset: number;
  nextPageUrls: string[];
} | undefined {
  const explicitPaginationUrls = extractExplicitPaginationUrls($, pageUrl);
  if (explicitPaginationUrls.length > 0) {
    return {
      pageSize: explicitPaginationUrls.length,
      currentOffset: extractCurrentOffset(pageUrl),
      nextPageUrls: explicitPaginationUrls,
    };
  }

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
    for (let offset = currentOffset + pageSize; offset < resolvedTotal; offset += pageSize) {
      const nextPage = new URL(base.toString());
      nextPage.searchParams.set('start', String(offset));
      nextPageUrls.push(nextPage.toString());
    }
  }

  return {
    pageSize,
    currentOffset,
    nextPageUrls,
  };
}

function extractExplicitPaginationUrls(
  $: ReturnType<typeof loadHtml>,
  pageUrl: string | undefined,
): string[] {
  if (!pageUrl) {
    return [];
  }

  const base = new URL(pageUrl);
  const currentOffset = extractCurrentOffset(pageUrl);
  const urls = new Set<string>();

  $('.pagination a[href], a[href*="start="]').each((_, link) => {
    const href = $(link).attr('href');
    /* v8 ignore next 3 -- the a[href]/a[href*=...] selectors guarantee attr('href') is present */
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

function extractCurrentOffset(pageUrl: string | undefined): number {
  /* v8 ignore next 3 -- only ever called with a defined pageUrl (callers guard first) */
  if (!pageUrl) {
    return 0;
  }

  const value = Number(new URL(pageUrl).searchParams.get('start') ?? '0');
  return Number.isFinite(value) && value >= 0 ? value : 0;
}
