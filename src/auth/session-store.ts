import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import makeFetchCookie from 'fetch-cookie';
import { CookieJar } from 'tough-cookie';

type PersistedCookie = {
  key?: string;
  value?: string;
  domain?: string;
  path?: string;
  expires?: number | string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
};

function serializeCookieHeader(cookie: PersistedCookie): string {
  return [
    `${cookie.key}=${cookie.value}`,
    cookie.domain ? `Domain=${cookie.domain}` : '',
    `Path=${cookie.path ?? '/'}`,
    cookie.secure ? 'Secure' : '',
    cookie.httpOnly ? 'HttpOnly' : '',
  ]
    .filter(Boolean)
    .join('; ');
}

function cookieSetUrl(cookie: PersistedCookie): string {
  const protocol = cookie.secure ? 'https' : 'http';
  const cookieDomain = (cookie.domain ?? 'localhost').replace(/^\./, '');
  return `${protocol}://${cookieDomain}${cookie.path ?? '/'}`;
}

export async function loadCookieJarFromFile(sessionCookiesPath: string): Promise<CookieJar> {
  const jar = new CookieJar(undefined, {
    allowSpecialUseDomain: true,
    rejectPublicSuffixes: false,
  });
  if (!existsSync(sessionCookiesPath)) {
    return jar;
  }

  const cookies = JSON.parse(readFileSync(sessionCookiesPath, 'utf8')) as PersistedCookie[];
  for (const cookie of cookies) {
    if (!cookie.key || cookie.value === undefined) {
      continue;
    }

    await jar.setCookie(serializeCookieHeader(cookie), cookieSetUrl(cookie));
  }

  return jar;
}

export async function createCookieFetch(sessionCookiesPath: string): Promise<typeof fetch> {
  const jar = await loadCookieJarFromFile(sessionCookiesPath);
  return makeFetchCookie(fetch, jar);
}

export function persistSerializedCookies(
  sessionCookiesPath: string,
  cookies: PersistedCookie[],
): void {
  mkdirSync(dirname(sessionCookiesPath), { recursive: true });
  writeFileSync(sessionCookiesPath, JSON.stringify(cookies, null, 2), 'utf8');
}
