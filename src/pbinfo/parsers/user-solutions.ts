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
  entries: UserSolutionListEntry[];
}

export function parseUserSolutionsListPage(html: string): ParsedUserSolutionsListPage {
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
      user: normalizeWhitespace($(anchors[index]).text()),
      problemId: Number(problemMatch[1]),
      problemSlug: problemMatch[2] ?? '',
      problemName: normalizeWhitespace($(anchors[index + 1]).text()),
      evaluationId: Number(evaluationMatch[1]),
    });
  }

  return {
    totalMatches,
    throttled,
    entries,
  };
}
