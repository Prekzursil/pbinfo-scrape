import { existsSync } from 'node:fs';

import type { LoadedLocalConfig } from '../config/local-config.js';
import { normalizeWhitespace } from '../pbinfo/parsers/shared.js';
import { createCookieFetch } from './session-store.js';
import { extractLoggedInState, extractResolvedHandle } from './session-handle.js';

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

interface AuthProbeContext {
  configuredHandle?: string;
  cookieFileExists: boolean;
  sessionCookiesPath: string;
  probeUrl: string;
  checkedAt: string;
}

function buildAuthStatusResult(
  context: AuthProbeContext,
  fields: {
    status: PbinfoAuthProbeStatus;
    loggedIn: boolean;
    resolvedHandle?: string;
    handleMatchesConfigured: boolean;
    remediation: string[];
  },
): PbinfoAuthStatusResult {
  return {
    status: fields.status,
    loggedIn: fields.loggedIn,
    configuredHandle: context.configuredHandle ?? undefined,
    resolvedHandle: fields.resolvedHandle ?? undefined,
    handleMatchesConfigured: fields.handleMatchesConfigured,
    cookieFileExists: context.cookieFileExists,
    sessionCookiesPath: context.sessionCookiesPath,
    probeUrl: context.probeUrl,
    checkedAt: context.checkedAt,
    remediation: fields.remediation,
  };
}

async function fetchAuthProbe(
  config: LoadedLocalConfig,
  context: AuthProbeContext,
  fetchImpl?: typeof fetch,
): Promise<{ loggedIn: boolean; resolvedHandle?: string }> {
  const effectiveFetch =
    fetchImpl ?? (await createCookieFetch(config.auth.sessionCookiesPath));
  const response = await effectiveFetch(context.probeUrl, { redirect: 'follow' });
  const html = await response.text();
  const loggedIn = extractLoggedInState(html);
  return {
    loggedIn,
    resolvedHandle: loggedIn ? normalizeHandle(extractResolvedHandle(html)) : undefined,
  };
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
  const context: AuthProbeContext = {
    configuredHandle,
    cookieFileExists: existsSync(config.auth.sessionCookiesPath),
    sessionCookiesPath: config.auth.sessionCookiesPath,
    probeUrl: options.probeUrl ?? 'https://www.pbinfo.ro/',
    checkedAt: (options.now ?? new Date()).toISOString(),
  };

  if (!context.cookieFileExists) {
    return buildAuthStatusResult(context, {
      status: 'cookie-missing',
      loggedIn: false,
      handleMatchesConfigured: configuredHandle === undefined,
      remediation: [
        `Session cookie jar is missing at ${config.auth.sessionCookiesPath}.`,
        'Run `npm run cli -- auth login` or import browser cookies before crawling authenticated pages.',
      ],
    });
  }

  const probe = await fetchAuthProbe(config, context, options.fetchImpl);
  const { loggedIn, resolvedHandle } = probe;
  const handleMatchesConfigured =
    configuredHandle === undefined
      ? true
      : matchesConfiguredHandle(configuredHandle, resolvedHandle);

  if (!loggedIn) {
    return buildAuthStatusResult(context, {
      status: 'guest',
      loggedIn,
      resolvedHandle,
      handleMatchesConfigured,
      remediation: [
        'PBInfo probe resolved to an anonymous session (guest mode).',
        'Refresh cookies with `npm run cli -- auth login` or `npm run cli -- auth import-browser --browser edge`.',
      ],
    });
  }

  if (!handleMatchesConfigured) {
    return buildAuthStatusResult(context, {
      status: 'handle-mismatch',
      loggedIn,
      resolvedHandle,
      handleMatchesConfigured,
      remediation: [
        `Configured crawl handle "${configuredHandle ?? 'unknown'}" does not match authenticated session "${resolvedHandle ?? 'unknown'}".`,
        'Update `.local/pbinfo.local.json` (`crawl.userHandle`) or import the correct account cookies.',
      ],
    });
  }

  return buildAuthStatusResult(context, {
    status: 'ok',
    loggedIn,
    resolvedHandle,
    handleMatchesConfigured,
    remediation: [],
  });
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

function normalizeHandle(value: string | undefined): string | undefined {
  const normalized = normalizeWhitespace(value ?? '').toLowerCase();
  return normalized || undefined;
}
