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

/**
 * pbinfo links attachment downloads (`descarca-fisier.php?id=...`) either
 * root-relative (`/descarca-fisier.php?...`) or bare-relative
 * (`descarca-fisier.php?...`). Bare hrefs would resolve against the problem
 * page path, which is wrong: attachments live at the site root. Normalize
 * bare attachment hrefs to root-relative form; scheme-absolute and
 * already-root-relative values pass through unchanged.
 */
export function normalizeAttachmentHref(candidate: string): string {
  const trimmed = candidate.trim();
  if (/^(?:[a-z]+:|\/\/|\/)/i.test(trimmed)) {
    return trimmed;
  }

  return /^descarca-fisier\.php/i.test(trimmed) ? `/${trimmed}` : trimmed;
}
