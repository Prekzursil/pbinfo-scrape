import { createHash } from 'node:crypto';

import type {
  CategoryLink,
  ProblemAssetRecord,
  ProblemRecord,
  ProblemExample,
  ProblemStatementSection,
  ProblemVisibleTest,
} from '../../types/records.js';
import { buildRawAssetLocalPath, sanitizeSegment } from '../../archive/archive-paths.js';
import { loadHtml, normalizeWhitespace, parseNumber, parseSeconds } from './shared.js';

export interface ProblemExecutionHints {
  timeLimitSeconds?: number;
  memoryLimitMb?: number;
}

export interface ParsedProblemStatement {
  sections: ProblemStatementSection[];
  constraints: string[];
  examples: ProblemExample[];
  executionHints: ProblemExecutionHints;
}

export interface ParsedProblemEndpointFragment {
  access: 'visible' | 'restricted' | 'hidden';
  message?: string;
  visibleTests: ProblemVisibleTest[];
}

export interface ParsedOfficialSolutionFragment {
  access: 'visible' | 'restricted' | 'hidden';
  message?: string;
  solutions: Record<string, string>;
  /** SHA-256 hex per language label. Stable for dedup when the same
   *  solution body is shown on multiple problem source-list pages. */
  solutionHashes: Record<string, string>;
}

export interface ParsedEditorialFragment {
  access: 'visible' | 'restricted' | 'hidden';
  message?: string;
  /** Editorial body HTML when access==='visible'. Trimmed. */
  html?: string;
  /** Plain-text extraction of the editorial body for quick search / indexing. */
  text?: string;
  /** SHA-256 of the raw body HTML when present. Stable for change detection. */
  contentHash?: string;
}

export function parseProblemPage(html: string, pageUrl: string): ProblemRecord {
  const $ = loadHtml(html);
  const page = new URL(pageUrl);
  const pathnameMatch = page.pathname.match(/^\/probleme\/(\d+)\/([^/?#]+)/);
  const titleLink = $('h1 a[href^="/probleme/"]').first();
  const recordId = Number(pathnameMatch?.[1] ?? titleLink.attr('href')?.match(/\/(\d+)\//)?.[1]);
  const slug = pathnameMatch?.[2] ?? titleLink.attr('href')?.split('/').filter(Boolean).at(-1);
  if (!Number.isFinite(recordId) || !slug) {
    throw new Error(`Could not infer problem identity from ${pageUrl}`);
  }

  const statement = parseProblemStatementFragment(html);
  const summaryMap = extractSummaryMap($);
  const linkedAssets = extractLinkedAssets($, page);
  const authorHandle = extractAuthorHandle($, summaryMap);
  const timeLimitSeconds =
    parseSeconds(summaryMap.get('limită timp') ?? '')
    ?? parseSeconds(summaryMap.get('limita timp') ?? '');
  const memoryLimitMb = extractMemoryLimitMb(summaryMap);

  return {
    id: recordId,
    slug,
    name: normalizeWhitespace(titleLink.text()) || slug,
    canonicalUrl: page.toString(),
    grade: extractGrade(summaryMap, $),
    categoryChain: extractCategoryChain($),
    tags: extractTags($),
    sections: statement.sections,
    examples: statement.examples,
    constraints: statement.constraints,
    timeLimitSeconds: timeLimitSeconds ?? statement.executionHints.timeLimitSeconds,
    memoryLimitMb: memoryLimitMb ?? statement.executionHints.memoryLimitMb,
    author: normalizeOptional(summaryMap.get('autor')),
    sourceAttribution: normalizeOptional(summaryMap.get('sursa problemei')),
    editorialAvailability: 'unknown',
    officialSolutions: {},
    visibleTests: [],
    linkedAssets,
    sourceListUrl: $('a[href^="/solutii/problema/"]').first().attr('href')
      ? new URL($('a[href^="/solutii/problema/"]').first().attr('href')!, page).toString()
      : undefined,
    metadata: {
      ...Object.fromEntries(summaryMap.entries()),
      ...(authorHandle ? { authorHandle } : {}),
    },
  };
}

export function parseProblemStatementFragment(html: string): ParsedProblemStatement {
  const $ = loadHtml(html);
  const root = $('#enunt').first().length > 0 ? $('#enunt').first() : $('article').first();
  const sections: ProblemStatementSection[] = [];
  const constraints: string[] = [];
  const examples: ProblemExample[] = [];
  let currentTitle: string | undefined;
  let currentNodes: string[] = [];

  const flushSection = () => {
    if (!currentTitle) {
      return;
    }

    const htmlContent = currentNodes.join('').trim();
    const text = normalizeWhitespace(loadHtml(`<div>${htmlContent}</div>`).root().text());
    sections.push({
      title: currentTitle,
      html: htmlContent,
      text,
    });

    if (currentTitle.toLowerCase().startsWith('restric')) {
      const sectionDom = loadHtml(`<div>${htmlContent}</div>`);
      sectionDom('li').each((_, item) => {
        const value = normalizeWhitespace(sectionDom(item).text());
        if (value) {
          constraints.push(value);
        }
      });
    }

    if (currentTitle.toLowerCase().startsWith('exempl')) {
      examples.push(...extractExamples(htmlContent));
    }
  };

  root.children().each((_, element) => {
    const node = $(element);
    const tag = node.prop('tagName')?.toLowerCase();
    if (tag === 'h1') {
      flushSection();
      currentTitle = normalizeWhitespace(node.text());
      currentNodes = [];
      return;
    }

    currentNodes.push($.html(node));
  });

  flushSection();

  return {
    sections,
    constraints,
    examples,
    executionHints: extractExecutionHints(constraints),
  };
}

export function parseProblemEndpointFragment(html: string): ParsedProblemEndpointFragment {
  const $ = loadHtml(html);
  const alert = $('.alert.alert-danger').first();
  const message = alert.length > 0 ? normalizeWhitespace(alert.text()) : undefined;
  const visibleTests = extractVisibleTests(html);

  if (message?.toLowerCase().includes('nu sunt vizibile')) {
    return {
      access: 'hidden',
      message,
      visibleTests: [],
    };
  }

  if (message?.toLowerCase().includes('n-ai voie') || message?.toLowerCase().includes('nu ai voie')) {
    return {
      access: 'restricted',
      message,
      visibleTests: [],
    };
  }

  return {
    access: 'visible',
    message,
    visibleTests,
  };
}

export function parseOfficialSolutionFragment(html: string): ParsedOfficialSolutionFragment {
  const endpoint = parseProblemEndpointFragment(html);
  if (endpoint.access !== 'visible') {
    return {
      access: endpoint.access,
      message: endpoint.message,
      solutions: {},
      solutionHashes: {},
    };
  }

  const $ = loadHtml(html);
  const tabLabels = new Map<string, string>();
  const solutions: Record<string, string> = {};

  $('[data-bs-target], [data-target], a[href^="#"]').each((_, element) => {
    const target = $(element).attr('data-bs-target')
      ?? $(element).attr('data-target')
      ?? $(element).attr('href');
    if (!target?.startsWith('#')) {
      return;
    }

    const label = normalizeWhitespace($(element).text());
    if (label) {
      tabLabels.set(target.slice(1), label);
    }
  });

  $('[id]').each((_, element) => {
    const id = $(element).attr('id');
    if (!id) {
      return;
    }

    const code = $(element).find('pre, textarea').first().text().trim();
    if (!code) {
      return;
    }

    const label =
      tabLabels.get(id)
      ?? normalizeWhitespace($(element).find('h3, h4, h5').first().text())
      ?? 'unknown';
    solutions[label || 'unknown'] = code;
  });

  if (Object.keys(solutions).length === 0) {
    const code = $('pre, textarea').first().text().trim();
    if (code) {
      solutions.unknown = code;
    }
  }

  const solutionHashes: Record<string, string> = {};
  for (const [label, code] of Object.entries(solutions)) {
    solutionHashes[label] = hashSource(code);
  }

  return {
    access: 'visible',
    message: endpoint.message,
    solutions,
    solutionHashes,
  };
}

function hashSource(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function parseEditorialFragment(html: string): ParsedEditorialFragment {
  const $ = loadHtml(html);
  const alert = $('.alert.alert-danger, .alert.alert-warning').first();
  const alertText = alert.length > 0 ? normalizeWhitespace(alert.text()) : undefined;

  if (alertText) {
    const lower = alertText.toLowerCase();
    if (
      lower.includes('n-ai voie')
      || lower.includes('nu ai voie')
      || lower.includes('trebuie sa trimi')
      || lower.includes('trebuie să trimi')
    ) {
      return {
        access: 'restricted',
        message: alertText,
      };
    }
    if (lower.includes('nu sunt vizibile') || lower.includes('nu este vizibil')) {
      return {
        access: 'hidden',
        message: alertText,
      };
    }
  }

  const body =
    $('#indicatii, #editorial, #continut, article').first().length > 0
      ? $('#indicatii, #editorial, #continut, article').first()
      : $('body, main, .container').first();
  const bodyHtml = body.html()?.trim();
  const bodyText = normalizeWhitespace(body.text());

  if (!bodyHtml || bodyText.length === 0) {
    return {
      access: 'hidden',
      message: alertText,
    };
  }

  return {
    access: 'visible',
    message: alertText,
    html: bodyHtml,
    text: bodyText,
    contentHash: hashSource(bodyHtml),
  };
}

function extractExamples(sectionHtml: string): ProblemExample[] {
  const $ = loadHtml(`<div>${sectionHtml}</div>`);
  const nodes = $('div').first().contents().toArray();
  const examples: ProblemExample[] = [];
  let current: ProblemExample = { input: '', output: '' };
  let mode: 'input' | 'output' | 'explanation' | undefined;

  const commit = () => {
    if (current.input || current.output || current.explanation) {
      examples.push(current);
      current = { input: '', output: '' };
      mode = undefined;
    }
  };

  for (const element of nodes) {
    const node = $(element);
    const tag = node.prop('tagName')?.toLowerCase();
    const text = normalizeWhitespace(node.text());
    if (!text && tag !== 'pre') {
      continue;
    }

    if (tag === 'p' || tag === 'h3') {
      const normalized = normalizeCueLabel(text);
      if (
        normalized.includes('intrare')
        || normalized.includes('input')
        || /\.in\b/.test(normalized)
      ) {
        mode = 'input';
        continue;
      }
      if (
        normalized.includes('iesire')
        || normalized.includes('output')
        || /\.out\b/.test(normalized)
      ) {
        mode = 'output';
        continue;
      }
      if (normalized.includes('explica')) {
        mode = 'explanation';
        continue;
      }
    }

    if (tag === 'pre') {
      const value = node.text().trim();
      if (mode === 'input') {
        current.input = value;
      } else if (mode === 'output') {
        current.output = value;
      }
      continue;
    }

    if (mode === 'explanation') {
      current.explanation = text;
      commit();
    }
  }

  commit();
  return examples;
}

function extractAuthorHandle(
  $: ReturnType<typeof loadHtml>,
  summaryMap: Map<string, string>,
): string | undefined {
  const preferredLink = $('*[title="Postată de"] a[href^="/profil/"], *[title="Postata de"] a[href^="/profil/"]').first();
  if (preferredLink.length > 0) {
    const handle = preferredLink.attr('href')?.match(/^\/profil\/([^/?#]+)$/)?.[1];
    return normalizeOptional(handle);
  }

  const summaryTextHandle = extractHandleFromSummaryText(
    summaryMap.get('postată de') ?? summaryMap.get('postata de'),
  );
  if (summaryTextHandle) {
    return summaryTextHandle;
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
  if (summaryHandle) {
    return normalizeOptional(summaryHandle);
  }

  const handle = $('article, main, .container, body').first().find('a[href^="/profil/"]').first().attr('href')?.match(/^\/profil\/([^/?#]+)$/)?.[1];
  return normalizeOptional(handle);
}

function extractHandleFromSummaryText(value: string | undefined): string | undefined {
  const normalized = normalizeWhitespace(value ?? '');
  if (!normalized) {
    return undefined;
  }

  const parenMatch = normalized.match(/\(([^()]+)\)\s*$/);
  if (parenMatch?.[1]) {
    return normalizeOptional(parenMatch[1]);
  }

  return undefined;
}

function extractExecutionHints(constraints: string[]): ProblemExecutionHints {
  const hints: ProblemExecutionHints = {};

  for (const constraint of constraints) {
    const lower = constraint.toLowerCase();
    const numericMatch = constraint.match(/(\d+(?:[.,]\d+)?)/);
    if (!numericMatch) {
      continue;
    }

    const numericToken = numericMatch[1];
    if (!numericToken) {
      continue;
    }

    const numericValue = Number(numericToken.replace(',', '.'));
    if (!Number.isFinite(numericValue)) {
      continue;
    }

    if (lower.includes('timp') || lower.includes('secunde') || lower.includes('executare')) {
      hints.timeLimitSeconds = hints.timeLimitSeconds ?? numericValue;
    }

    if (lower.includes('memorie') || lower.includes('memory')) {
      if (lower.includes('kb')) {
        hints.memoryLimitMb = hints.memoryLimitMb ?? numericValue / 1024;
      } else if (lower.includes('gb')) {
        hints.memoryLimitMb = hints.memoryLimitMb ?? numericValue * 1024;
      } else {
        hints.memoryLimitMb = hints.memoryLimitMb ?? numericValue;
      }
    }
  }

  return hints;
}

function extractVisibleTests(html: string): ProblemVisibleTest[] {
  const $ = loadHtml(html);
  const tableTests = extractVisibleTestsFromTable($);
  if (tableTests.length > 0) {
    return tableTests;
  }

  const tests: ProblemVisibleTest[] = [];
  $('h3').each((_, heading) => {
    const title = normalizeWhitespace($(heading).text());
    if (!title.toLowerCase().startsWith('test')) {
      return;
    }

    let input = '';
    let output = '';
    let mode: 'input' | 'output' | undefined;
    let sibling = $(heading).next();

    while (sibling.length > 0 && sibling.prop('tagName')?.toLowerCase() !== 'h3') {
      const tag = sibling.prop('tagName')?.toLowerCase();
      const text = normalizeWhitespace(sibling.text());
      if (tag === 'p') {
        const lower = normalizeCueLabel(text);
        if (lower.includes('intrare')) {
          mode = 'input';
        } else if (lower.includes('iesire')) {
          mode = 'output';
        }
      } else if (tag === 'pre') {
        if (mode === 'input') {
          input = sibling.text().trim();
        } else if (mode === 'output') {
          output = sibling.text().trim();
        }
      }
      sibling = sibling.next();
    }

    tests.push({
      title,
      input,
      output,
    });
  });

  return tests;
}

function extractVisibleTestsFromTable(
  $: ReturnType<typeof loadHtml>,
): ProblemVisibleTest[] {
  const tests: ProblemVisibleTest[] = [];

  $('table tbody tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length < 5) {
      return;
    }

    const index = normalizeWhitespace($(cells[0]!).text());
    const input = $(cells[2]!).find('textarea').first().text().trim();
    const output = $(cells[3]!).find('textarea').first().text().trim();
    if (!index || (!input && !output)) {
      return;
    }

    tests.push({
      title: `Testul ${index}`,
      input,
      output,
      score: parseNumber(normalizeWhitespace($(cells[1]!).text())) ?? undefined,
      exampleLike: normalizeCueLabel($(cells[4]!).text()).includes('da'),
    });
  });

  return tests;
}

function normalizeCueLabel(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[șş]/g, 's')
    .replace(/[țţ]/g, 't');
}

function extractSummaryMap($: ReturnType<typeof loadHtml>): Map<string, string> {
  const headers = $('table tr').first().find('th').toArray();
  const values = $('table tr').eq(1).find('td').toArray();
  const summaryMap = new Map<string, string>();

  if (headers.length > 0 && values.length > 0) {
    headers.forEach((header, index) => {
      const key = normalizeWhitespace($(header).text()).toLowerCase();
      const value = normalizeWhitespace($(values[index] ?? '').text());
      if (key && value) {
        summaryMap.set(key, value);
      }
    });
  }

  $('#rezumat tr').each((_, row) => {
    const header = normalizeWhitespace($(row).find('th').first().text()).toLowerCase();
    const value = normalizeWhitespace($(row).find('td').first().text());
    if (header && value) {
      summaryMap.set(header, value);
    }
  });

  return summaryMap;
}

function extractMemoryLimitMb(summaryMap: Map<string, string>): number | undefined {
  const rawValue = summaryMap.get('limită memorie') ?? summaryMap.get('limita memorie');
  if (!rawValue) {
    return undefined;
  }

  const firstSegment = rawValue.split('/')[0]?.trim() ?? rawValue;
  return parseNumber(firstSegment);
}

function extractGrade(
  summaryMap: Map<string, string>,
  $: ReturnType<typeof loadHtml>,
): number | undefined {
  const direct = parseNumber(summaryMap.get('clasa') ?? '');
  if (direct !== undefined) {
    return direct;
  }

  const classLink = $('a[href*="clasa="]').first();
  return parseNumber(classLink.text());
}

function extractCategoryChain($: ReturnType<typeof loadHtml>): CategoryLink[] {
  const chain: CategoryLink[] = [];

  $('a[href*="?pagina=probleme-lista"]').each((_, anchor) => {
    const href = $(anchor).attr('href');
    if (!href) {
      return;
    }

    const resolved = new URL(href, 'https://www.pbinfo.ro');
    const name = normalizeWhitespace($(anchor).text());
    if (!name) {
      return;
    }

    const clasa = resolved.searchParams.get('clasa');
    const tag = resolved.searchParams.get('tag');
    const rawId = clasa ?? tag;
    if (!rawId) {
      return;
    }

    chain.push({
      id: Number(rawId),
      name,
      slug: sanitizeSegment(name).toLowerCase(),
      href,
    });
  });

  return chain;
}

function extractTags($: ReturnType<typeof loadHtml>): string[] {
  const tags = new Set<string>();
  $('a[href*="/probleme/eticheta/"]').each((_, anchor) => {
    const value = normalizeWhitespace($(anchor).text());
    if (value) {
      tags.add(value);
    }
  });

  return [...tags];
}

function extractLinkedAssets(
  $: ReturnType<typeof loadHtml>,
  page: URL,
): ProblemAssetRecord[] {
  const assets = new Map<string, ProblemAssetRecord>();
  const candidates: Array<{
    selector: string;
    attribute: 'href' | 'src';
    kind: ProblemAssetRecord['kind'];
    mimeType?: string;
  }> = [
    { selector: 'link[rel="stylesheet"][href]', attribute: 'href', kind: 'stylesheet', mimeType: 'text/css' },
    { selector: 'script[src]', attribute: 'src', kind: 'script', mimeType: 'application/javascript' },
    { selector: 'img[src]', attribute: 'src', kind: 'image' },
  ];

  for (const candidate of candidates) {
    $(candidate.selector).each((_, element) => {
      const rawUrl = $(element).attr(candidate.attribute);
      if (!rawUrl) {
        return;
      }

      const normalized = new URL(rawUrl, page);
      if (normalized.origin !== page.origin) {
        return;
      }

      assets.set(normalized.toString(), {
        url: normalized.toString(),
        localPath: buildRawAssetLocalPath(normalized.toString(), candidate.mimeType),
        mimeType: candidate.mimeType,
        kind: candidate.kind,
      });
    });
  }

  return [...assets.values()];
}

function normalizeOptional(value?: string): string | undefined {
  const normalized = normalizeWhitespace(value ?? '');
  return normalized && normalized !== '-' ? normalized : undefined;
}
