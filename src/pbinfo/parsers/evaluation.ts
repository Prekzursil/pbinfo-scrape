import type { EvaluationTestResult } from '../../types/records.js';
import {
  loadHtml,
  normalizeWhitespace,
  parseNumber,
  parseSeconds,
  type HtmlNode,
} from './shared.js';

export interface ParsedEvaluationPage {
  evaluationId: number;
  problemId: number;
  problemSlug: string;
  problemName: string;
  user: string;
  language: string;
  score: number;
  verdictSummary: string;
  runtimeSeconds?: number;
  memoryKb?: number;
  sourceAvailable: boolean;
  sourceCode?: string;
  compileLog?: string;
  tests: EvaluationTestResult[];
}

export function parseEvaluationPage(html: string, evaluationId: number): ParsedEvaluationPage {
  const $ = loadHtml(html);
  const summaryMap = extractSummaryMap($);
  const problemLink = resolveProblemLink($);
  const problemMatch = problemLink.attr('href')?.match(/^\/probleme\/(\d+)\/([^/]+)$/);
  if (!problemMatch) {
    throw new Error(`Could not find problem link for evaluation ${evaluationId}.`);
  }

  const problemSlug = problemMatch[2];
  /* v8 ignore next 3 -- regex capture group always present when regex matches */
  if (!problemSlug) {
    throw new Error(`Could not infer problem slug for evaluation ${evaluationId}.`);
  }

  const sourceCode = extractSourceCode($);
  const compileLog = extractCompileLog($);

  return {
    evaluationId,
    problemId: Number(problemMatch[1]),
    problemSlug,
    problemName: summaryMap.get('problema') ?? normalizeWhitespace(problemLink.text()),
    user: resolveSubmissionOwner($, summaryMap),
    tests: extractTests($),
    sourceAvailable: Boolean(sourceCode),
    sourceCode: sourceCode || undefined,
    compileLog: compileLog || undefined,
    ...buildEvaluationMetrics(summaryMap),
  };
}

type EvaluationMetrics = Pick<
  ParsedEvaluationPage,
  'language' | 'score' | 'verdictSummary' | 'runtimeSeconds' | 'memoryKb'
>;

function firstSummaryValue(summaryMap: Map<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = summaryMap.get(key);
    if (value) {
      return value;
    }
  }
  return '';
}

function buildEvaluationMetrics(summaryMap: Map<string, string>): EvaluationMetrics {
  return {
    language:
      summaryMap.get('limbaj') ?? inferLanguageFromFilename(summaryMap.get('fisier')) ?? 'unknown',
    score: parseNumber(firstSummaryValue(summaryMap, ['punctaj', 'scor/rezultat'])) ?? 0,
    verdictSummary: firstSummaryValue(summaryMap, ['verdict', 'scor/rezultat']),
    runtimeSeconds: parseSeconds(firstSummaryValue(summaryMap, ['timp maxim', 'limita timp'])),
    memoryKb: parseFirstNumber(firstSummaryValue(summaryMap, ['memorie maxima', 'limita memorie'])),
  };
}

function resolveProblemLink($: ReturnType<typeof loadHtml>) {
  const isProblemDetailHref = (href?: string) => /^\/probleme\/(\d+)\/([^/]+)$/.test(href ?? '');

  const preferredLink = $('#detalii a[href], #rezumat a[href]')
    .filter((_, element) => isProblemDetailHref($(element).attr('href')))
    .first();
  if (preferredLink.length > 0) {
    return preferredLink;
  }

  return $('a[href]')
    .filter((_, element) => isProblemDetailHref($(element).attr('href')))
    .first();
}

function resolveSubmissionOwner(
  $: ReturnType<typeof loadHtml>,
  summaryMap: Map<string, string>,
): string {
  const fromSummary = normalizeWhitespace(summaryMap.get('utilizator') ?? '');
  if (fromSummary) {
    return fromSummary;
  }

  const profileLink = $(
    '#detalii a[href^="/profil/"], #rezumat a[href^="/profil/"], a[href^="/profil/"]',
  ).first();
  const fromProfile = normalizeWhitespace(profileLink.text());
  if (fromProfile) {
    return fromProfile;
  }

  return 'unknown';
}

function extractSummaryMap($: ReturnType<typeof loadHtml>): Map<string, string> {
  const summaryMap = new Map<string, string>();

  $('#rezumat tr, #detalii table tr').each((_, row) => {
    const cells = $(row).children('th,td');
    if (cells.length < 2) {
      return;
    }

    for (let index = 0; index < cells.length - 1; index += 2) {
      const headerCell = cells.eq(index);
      const valueCell = cells.eq(index + 1);
      if (headerCell.prop('tagName')?.toLowerCase() !== 'th') {
        continue;
      }

      const header = normalizeLabel(headerCell.text());
      const value = normalizeWhitespace(valueCell.text());
      if (header && value) {
        summaryMap.set(header, value);
      }
    }
  });

  return summaryMap;
}

function extractTests($: ReturnType<typeof loadHtml>): EvaluationTestResult[] {
  const resultsTable = $('#evaluare table')
    .filter((_, table) =>
      $(table)
        .find('tr')
        .first()
        .find('th')
        .toArray()
        .some((cell) => normalizeLabel($(cell).text()) === 'test'),
    )
    .first();

  const fallbackTable = $('#detalii table.table-bordered').first();
  const targetTable = resultsTable.length > 0 ? resultsTable : fallbackTable;
  if (targetTable.length === 0) {
    return [];
  }

  const headerCells = targetTable.find('tr').first().find('th');
  const headers = headerCells.toArray().map((cell) => normalizeLabel($(cell).text()));
  const timeIndex = headers.findIndex((header) => header.includes('timp'));
  const verdictIndex = headers.findIndex(
    (header) => header.includes('mesaj evaluare') || header === 'verdict',
  );
  const maxScoreIndex = headers.findIndex(
    (header) => header.includes('scor posibil') || header.includes('scor maxim'),
  );
  const scoreIndex = headers.findIndex(
    (header) =>
      header.includes('scor obtinut') ||
      (header === 'scor' && !headers.some((candidate) => candidate.includes('scor obtinut'))),
  );
  const columns: TestColumnIndices = {
    timeIndex,
    verdictIndex,
    maxScoreIndex,
    scoreIndex,
    detailsIndex: headers.findIndex((header) => header.includes('detalii')),
  };

  const tests: EvaluationTestResult[] = [];
  targetTable
    .find('tr')
    .slice(1)
    .each((_, row) => {
      const test = parseTestRow($, row, columns);
      if (test) {
        tests.push(test);
      }
    });

  return tests;
}

interface TestColumnIndices {
  timeIndex: number;
  verdictIndex: number;
  maxScoreIndex: number;
  scoreIndex: number;
  detailsIndex: number;
}

type CheerioSelection = ReturnType<ReturnType<typeof loadHtml>>;

function cellText($: ReturnType<typeof loadHtml>, cells: CheerioSelection, index: number): string {
  return index >= 0 ? normalizeWhitespace($(cells[index]).text()) : '';
}

function cellNumber(
  $: ReturnType<typeof loadHtml>,
  cells: CheerioSelection,
  index: number,
): number {
  return index >= 0 ? (parseNumber($(cells[index]).text()) ?? 0) : 0;
}

function parseTestRow(
  $: ReturnType<typeof loadHtml>,
  row: HtmlNode,
  columns: TestColumnIndices,
): EvaluationTestResult | undefined {
  const cells = $(row).children('td');
  if (cells.length === 0) {
    return undefined;
  }

  const index = parseNumber($(cells[0]).text());
  if (index === undefined) {
    return undefined;
  }

  const resolvedDetailsIndex =
    columns.detailsIndex >= 0 ? columns.detailsIndex : cells.length > 5 ? cells.length - 1 : -1;

  return {
    index,
    runtimeSeconds:
      columns.timeIndex >= 0 ? parseSeconds($(cells[columns.timeIndex]).text()) : undefined,
    verdict: cellText($, cells, columns.verdictIndex),
    score: cellNumber($, cells, columns.scoreIndex),
    maxScore: cellNumber($, cells, columns.maxScoreIndex),
    details: cellText($, cells, resolvedDetailsIndex),
  };
}

function extractSourceCode($: ReturnType<typeof loadHtml>): string | undefined {
  const textarea = $('textarea').first();
  if (textarea.length > 0) {
    const value = textarea.text().trim();
    return value || undefined;
  }

  const sourceSectionPre = $('#sursa pre').first();
  if (sourceSectionPre.length > 0) {
    const value = sourceSectionPre.text().trim();
    return value || undefined;
  }

  const pre = $(
    'pre[data-source], pre.source-code, pre.code-source, pre[class^="code_"], pre[class*=" code_"]',
  ).first();
  if (pre.length > 0) {
    const value = pre.text().trim();
    return value || undefined;
  }

  return undefined;
}

function extractCompileLog($: ReturnType<typeof loadHtml>): string | undefined {
  const compileNode = $(
    '#compilare pre, #evaluare pre, .compile-log pre, .compilation-log pre',
  ).first();
  if (compileNode.length === 0) {
    return undefined;
  }

  const value = compileNode.text().trim();
  return value || undefined;
}

function normalizeLabel(value: string): string {
  return normalizeWhitespace(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

const EXTENSION_LANGUAGE: Readonly<Record<string, string>> = {
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  c: 'c',
  pas: 'pas',
  cs: 'cs',
  php: 'php',
  py: 'py',
  py3: 'py3',
  java: 'java',
};

function inferLanguageFromFilename(fileName?: string): string | undefined {
  if (!fileName) {
    return undefined;
  }

  const extension = fileName.trim().split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_LANGUAGE[extension];
}

function parseFirstNumber(value: string): number | undefined {
  const match = value.match(/\d+(?:[.,]\d+)?/);
  if (!match?.[0]) {
    return undefined;
  }

  return Number(match[0].replace(',', '.'));
}
