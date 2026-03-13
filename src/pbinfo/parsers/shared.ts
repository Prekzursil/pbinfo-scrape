import { load } from 'cheerio';

export function loadHtml(html: string) {
  return load(html);
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function parseNumber(value: string): number | undefined {
  const cleaned = value.replace(/[^\d.-]+/g, '');
  if (!cleaned) {
    return undefined;
  }

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseSeconds(value: string): number | undefined {
  const match = value.match(/(\d+(?:[.,]\d+)?)/);
  const numeric = match?.[1];
  if (!numeric) {
    return undefined;
  }

  return Number(numeric.replace(',', '.'));
}
