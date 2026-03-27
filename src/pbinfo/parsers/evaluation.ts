import type { EvaluationTestResult } from '../../types/records.js';
import { loadHtml, normalizeWhitespace, parseNumber, parseSeconds } from './shared.js';

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

  const user = resolveSubmissionOwner($, summaryMap);
  const tests = extractTests($);

  const sourceCode = extractSourceCode($);
  const compileLog = extractCompileLog($);
  const fileName = summaryMap.get('fisier');

  const problemSlug = problemMatch[2];
  if (!problemSlug) {
    throw new Error(`Could not infer problem slug for evaluation ${evaluationId}.`);
  }

  return {
    evaluationId,
    problemId: Number(problemMatch[1]),
    problemSlug,
    problemName: summaryMap.get('problema') ?? normalizeWhitespace(problemLink.text()),
    user,
    language: summaryMap.get('limbaj') ?? inferLanguageFromFilename(fileName) ?? 'unknown',
    score: parseNumber(summaryMap.get('punctaj') ?? summaryMap.get('scor/rezultat') ?? '') ?? 0,
    verdictSummary: summaryMap.get('verdict') ?? summaryMap.get('scor/rezultat') ?? '',
    runtimeSeconds: parseSeconds(summaryMap.get('timp maxim') ?? summaryMap.get('limita timp') ?? ''),
    memoryKb: parseFirstNumber(summaryMap.get('memorie maxima') ?? summaryMap.get('limita memorie') ?? ''),
    sourceAvailable: Boolean(sourceCode),
    sourceCode: sourceCode || undefined,
    tests,
    compileLog: compileLog || undefined,
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

  const profileLink = $('#detalii a[href^="/profil/"], #rezumat a[href^="/profil/"], a[href^="/profil/"]').first();
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
  const headers = headerCells
    .toArray()
    .map((cell) => normalizeLabel($(cell).text()));
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
  const detailsIndex = headers.findIndex((header) => header.includes('detalii'));

  const tests: EvaluationTestResult[] = [];
  targetTable.find('tr').slice(1).each((_, row) => {
    const cells = $(row).children('td');
    if (cells.length === 0) {
      return;
    }

    const index = parseNumber($(cells[0]).text());
    if (index === undefined) {
      return;
    }

    const resolvedDetailsIndex =
      detailsIndex >= 0 ? detailsIndex : cells.length > 5 ? cells.length - 1 : -1;

    tests.push({
      index,
      runtimeSeconds:
        timeIndex >= 0 ? parseSeconds($(cells[timeIndex]).text()) : undefined,
      verdict:
        verdictIndex >= 0 ? normalizeWhitespace($(cells[verdictIndex]).text()) : '',
      score: scoreIndex >= 0 ? parseNumber($(cells[scoreIndex]).text()) ?? 0 : 0,
      maxScore: maxScoreIndex >= 0 ? parseNumber($(cells[maxScoreIndex]).text()) ?? 0 : 0,
      details:
        resolvedDetailsIndex >= 0
          ? normalizeWhitespace($(cells[resolvedDetailsIndex]).text())
          : '',
    });
  });

  return tests;
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

  const pre = $('pre[data-source], pre.source-code, pre.code-source, pre[class^="code_"], pre[class*=" code_"]').first();
  if (pre.length > 0) {
    const value = pre.text().trim();
    return value || undefined;
  }

  return undefined;
}

function extractCompileLog($: ReturnType<typeof loadHtml>): string | undefined {
  const compileNode = $('#compilare pre, #evaluare pre, .compile-log pre, .compilation-log pre').first();
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

function inferLanguageFromFilename(fileName?: string): string | undefined {
  if (!fileName) {
    return undefined;
  }

  const extension = fileName.trim().split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'cpp':
    case 'cc':
    case 'cxx':
      return 'cpp';
    case 'c':
      return 'c';
    case 'pas':
      return 'pas';
    case 'cs':
      return 'cs';
    case 'php':
      return 'php';
    case 'py':
      return 'py';
    case 'py3':
      return 'py3';
    case 'java':
      return 'java';
    default:
      return undefined;
  }
}

function parseFirstNumber(value: string): number | undefined {
  const match = value.match(/\d+(?:[.,]\d+)?/);
  if (!match?.[0]) {
    return undefined;
  }

  return Number(match[0].replace(',', '.'));
}
