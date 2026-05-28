import { loadHtml, normalizeWhitespace } from '../pbinfo/parsers/shared.js';

const SESSION_HANDLE_KEYS = [
  'username',
  'user',
  'utilizator',
  'nick',
  'nume_utilizator',
  'name',
] as const;

const LOGOUT_SELECTOR = 'a[href*="logout"], form[action*="logout"]';
const PROFILE_ANCHOR_SELECTOR = '#bara_navigare a[href^="/profil/"], nav a[href^="/profil/"]';

export function extractUserSessionJson(html: string): Record<string, unknown> | undefined {
  const match = html.match(/user_autentificat\s*=\s*(\{[\s\S]*?\})\s*;/u);
  if (!match?.[1]) {
    return undefined;
  }

  try {
    return JSON.parse(match[1]) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function pickSessionHandle(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return undefined;
  }

  return normalized.match(/\(([^)]+)\)\s*$/u)?.[1] ?? normalized;
}

function sessionUserId(sessionJson: Record<string, unknown> | undefined): number {
  return Number(sessionJson?.id ?? sessionJson?.user_id ?? 0);
}

function isAuthenticatedSession(sessionJson: Record<string, unknown> | undefined): boolean {
  const id = sessionUserId(sessionJson);
  return Number.isFinite(id) && id > 0;
}

export function extractLoggedInState(html: string): boolean {
  if (isAuthenticatedSession(extractUserSessionJson(html))) {
    return true;
  }
  return loadHtml(html)(LOGOUT_SELECTOR).length > 0;
}

function resolveHandleFromSession(
  sessionJson: Record<string, unknown> | undefined,
): string | undefined {
  if (!isAuthenticatedSession(sessionJson)) {
    return undefined;
  }
  for (const key of SESSION_HANDLE_KEYS) {
    const candidate = pickSessionHandle(sessionJson?.[key]);
    if (candidate) {
      return candidate;
    }
  }
  return undefined;
}

function resolveHandleFromAnchors(html: string): string | undefined {
  const $ = loadHtml(html);
  for (const anchor of $(PROFILE_ANCHOR_SELECTOR).toArray()) {
    const fromHref = $(anchor)
      .attr('href')
      ?.match(/^\/profil\/([^/?#]+)/u)?.[1];
    if (fromHref) {
      return fromHref;
    }

    const fromText = normalizeWhitespace($(anchor).text()).match(/\(([^)]+)\)\s*$/u)?.[1];
    if (fromText) {
      return fromText;
    }
  }
  return undefined;
}

export function extractResolvedHandle(html: string): string | undefined {
  const sessionJson = extractUserSessionJson(html);
  const fromSession = resolveHandleFromSession(sessionJson);
  if (fromSession) {
    return fromSession;
  }

  const hasLogoutLink = loadHtml(html)(LOGOUT_SELECTOR).length > 0;
  if (!isAuthenticatedSession(sessionJson) && !hasLogoutLink) {
    return undefined;
  }

  return resolveHandleFromAnchors(html);
}
