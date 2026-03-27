import { existsSync } from 'node:fs';

import type { LoadedLocalConfig } from '../config/local-config.js';
import { loadHtml, normalizeWhitespace } from '../pbinfo/parsers/shared.js';
import { createCookieFetch } from './session-store.js';

export type PbinfoAuthProbeStatus = 'ok' | 'guest' | 'handle-mismatch' | 'cookie-missing';

export interface PbinfoAuthStatusResult {
  status: PbinfoAuthProbeStatus;
  loggedIn: boolean;
  configuredHandle?: string;
  resolvedHandle?: string;
  handleMatchesConfigured: boolean;
  cookieFileExists: boolean;
  sessionCookiesPath: string;
  probeUrl: string;
  checkedAt: string;
  remediation: string[];
}

export async function probePbinfoAuthStatus(
  config: LoadedLocalConfig,
  options: {
    fetchImpl?: typeof fetch;
    probeUrl?: string;
    now?: Date;
  } = {},
): Promise<PbinfoAuthStatusResult> {
  const configuredHandle = normalizeHandle(config.crawl.userHandle);
  const cookieFileExists = existsSync(config.auth.sessionCookiesPath);
  const probeUrl = options.probeUrl ?? 'https://www.pbinfo.ro/';
  const fetchImpl = options.fetchImpl
    ?? await createCookieFetch(config.auth.sessionCookiesPath);
  const checkedAt = (options.now ?? new Date()).toISOString();

  if (!cookieFileExists) {
    return {
      status: 'cookie-missing',
      loggedIn: false,
      configuredHandle: configuredHandle ?? undefined,
      resolvedHandle: undefined,
      handleMatchesConfigured: configuredHandle === undefined,
      cookieFileExists,
      sessionCookiesPath: config.auth.sessionCookiesPath,
      probeUrl,
      checkedAt,
      remediation: [
        `Session cookie jar is missing at ${config.auth.sessionCookiesPath}.`,
        'Run `npm run cli -- auth login` or import browser cookies before crawling authenticated pages.',
      ],
    };
  }

  const response = await fetchImpl(probeUrl, {
    redirect: 'follow',
  });
  const html = await response.text();
  const loggedIn = extractLoggedInState(html);
  const resolvedHandle = loggedIn
    ? normalizeHandle(extractResolvedHandle(html))
    : undefined;
  const handleMatchesConfigured =
    configuredHandle === undefined
      ? true
      : matchesConfiguredHandle(configuredHandle, resolvedHandle);

  if (!loggedIn) {
    return {
      status: 'guest',
      loggedIn,
      configuredHandle: configuredHandle ?? undefined,
      resolvedHandle: resolvedHandle ?? undefined,
      handleMatchesConfigured,
      cookieFileExists,
      sessionCookiesPath: config.auth.sessionCookiesPath,
      probeUrl,
      checkedAt,
      remediation: [
        'PBInfo probe resolved to an anonymous session (guest mode).',
        'Refresh cookies with `npm run cli -- auth login` or `npm run cli -- auth import-browser --browser edge`.',
      ],
    };
  }

  if (!handleMatchesConfigured) {
    return {
      status: 'handle-mismatch',
      loggedIn,
      configuredHandle: configuredHandle ?? undefined,
      resolvedHandle: resolvedHandle ?? undefined,
      handleMatchesConfigured,
      cookieFileExists,
      sessionCookiesPath: config.auth.sessionCookiesPath,
      probeUrl,
      checkedAt,
      remediation: [
        `Configured crawl handle "${configuredHandle ?? 'unknown'}" does not match authenticated session "${resolvedHandle ?? 'unknown'}".`,
        'Update `.local/pbinfo.local.json` (`crawl.userHandle`) or import the correct account cookies.',
      ],
    };
  }

  return {
    status: 'ok',
    loggedIn,
    configuredHandle: configuredHandle ?? undefined,
    resolvedHandle: resolvedHandle ?? undefined,
    handleMatchesConfigured,
    cookieFileExists,
    sessionCookiesPath: config.auth.sessionCookiesPath,
    probeUrl,
    checkedAt,
    remediation: [],
  };
}

export function matchesConfiguredHandle(
  configuredHandle: string | undefined,
  candidateHandle: string | undefined,
): boolean {
  if (!configuredHandle) {
    return true;
  }
  if (!candidateHandle) {
    return false;
  }

  const normalizedConfigured = normalizeHandle(configuredHandle);
  const normalizedCandidate = normalizeHandle(candidateHandle);
  if (!normalizedConfigured || !normalizedCandidate) {
    return false;
  }

  if (normalizedConfigured === normalizedCandidate) {
    return true;
  }

  const withParenthesesMatch = normalizedCandidate.match(/\(([^)]+)\)\s*$/u);
  if (withParenthesesMatch?.[1]) {
    return normalizeHandle(withParenthesesMatch[1]) === normalizedConfigured;
  }

  return false;
}

function extractLoggedInState(html: string): boolean {
  const sessionJson = extractUserSessionJson(html);
  if (sessionJson) {
    const id = Number(sessionJson.id ?? sessionJson.user_id ?? 0);
    if (Number.isFinite(id) && id > 0) {
      return true;
    }
  }

  const $ = loadHtml(html);
  const logoutLinks = $('a[href*="logout"], form[action*="logout"]');
  return logoutLinks.length > 0;
}

function extractResolvedHandle(html: string): string | undefined {
  const sessionJson = extractUserSessionJson(html);
  const sessionId = Number(sessionJson?.id ?? sessionJson?.user_id ?? 0);
  const sessionIsAuthenticated = Number.isFinite(sessionId) && sessionId > 0;
  const sessionCandidate =
    pickSessionHandle(sessionJson?.username)
    ?? pickSessionHandle(sessionJson?.user)
    ?? pickSessionHandle(sessionJson?.utilizator)
    ?? pickSessionHandle(sessionJson?.nick)
    ?? pickSessionHandle(sessionJson?.nume_utilizator)
    ?? pickSessionHandle(sessionJson?.name);
  if (sessionIsAuthenticated && sessionCandidate) {
    return sessionCandidate;
  }

  const $ = loadHtml(html);
  const hasLogoutLink = $('a[href*="logout"], form[action*="logout"]').length > 0;
  if (!sessionIsAuthenticated && !hasLogoutLink) {
    return undefined;
  }

  const profileAnchors = $('#bara_navigare a[href^="/profil/"], nav a[href^="/profil/"]');
  for (const anchor of profileAnchors.toArray()) {
    const href = $(anchor).attr('href');
    const fromHref = href?.match(/^\/profil\/([^/?#]+)/u)?.[1];
    if (fromHref) {
      return fromHref;
    }

    const text = normalizeWhitespace($(anchor).text());
    const match = text.match(/\(([^)]+)\)\s*$/u);
    if (match?.[1]) {
      return match[1];
    }
  }

  return undefined;
}

function extractUserSessionJson(html: string): Record<string, unknown> | undefined {
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

function pickSessionHandle(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = normalizeWhitespace(value);
  if (!normalized) {
    return undefined;
  }

  const trailingHandle = normalized.match(/\(([^)]+)\)\s*$/u)?.[1];
  if (trailingHandle) {
    return trailingHandle;
  }

  return normalized;
}

function normalizeHandle(value: string | undefined): string | undefined {
  const normalized = normalizeWhitespace(value ?? '').toLowerCase();
  return normalized || undefined;
}
