import makeFetchCookie from 'fetch-cookie';
import { CookieJar } from 'tough-cookie';

import { loadHtml, normalizeWhitespace } from '../pbinfo/parsers/shared.js';
import { persistSerializedCookies } from './session-store.js';

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

export interface LoginFormDescriptor {
  action: string;
  formToken: string;
}

interface AjaxLoginResponse {
  stare?: string;
  raspuns?: string;
  redirect?: string;
  url?: string;
}

export interface PbinfoAuthClientOptions {
  baseUrl: string;
  sessionCookiesPath: string;
}

export interface CredentialLoginInput {
  username: string;
  password: string;
  persistSessionCookies?: boolean;
}

export interface CredentialLoginResult {
  success: boolean;
  redirectUrl?: string;
  resolvedHandle?: string;
  failureReason?: string;
  sessionCookies: PersistedCookie[];
}

export function extractLoginForm(html: string): LoginFormDescriptor {
  const $ = loadHtml(html);
  const form = $('#form-login').first();
  if (form.length === 0) {
    throw new Error('PBInfo login form was not found');
  }

  const action = form.attr('action');
  const formToken = form.find('input[name="form_token"]').attr('value');
  if (!action || !formToken) {
    throw new Error('PBInfo login form is missing required fields');
  }

  return {
    action,
    formToken,
  };
}

export class PbinfoAuthClient {
  private readonly baseUrl: URL;
  private readonly sessionCookiesPath: string;
  private readonly jar: CookieJar;
  private readonly cookieFetch: typeof fetch;

  constructor(options: PbinfoAuthClientOptions) {
    this.baseUrl = new URL(options.baseUrl);
    this.sessionCookiesPath = options.sessionCookiesPath;
    this.jar = new CookieJar();
    this.cookieFetch = makeFetchCookie(fetch, this.jar);
  }

  async loginWithCredentials(input: CredentialLoginInput): Promise<CredentialLoginResult> {
    const loginPage = await this.cookieFetch(this.baseUrl, {
      redirect: 'follow',
    });
    const loginForm = extractLoginForm(await loginPage.text());
    const loginUrl = new URL('/ajx-module/php-login.php', this.baseUrl);
    const formData = new URLSearchParams({
      form_token: loginForm.formToken,
      user: input.username,
      parola: input.password,
      local_ip: '',
    });

    const loginResponse = await this.cookieFetch(loginUrl, {
      method: 'POST',
      body: formData,
      headers: {
        'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'x-requested-with': 'XMLHttpRequest',
        origin: this.baseUrl.origin,
        referer: this.baseUrl.toString(),
      },
      redirect: 'follow',
    });
    const loginPayload = parseAjaxLoginResponse(await loginResponse.text());
    const loginAccepted = loginPayload.stare === 'success';
    const redirectUrl = new URL(
      loginPayload.redirect ?? loginPayload.url ?? '/',
      this.baseUrl,
    ).toString();

    if (!loginAccepted) {
      return {
        success: false,
        redirectUrl,
        failureReason:
          loginPayload.raspuns ??
          `PBInfo credential login failed with ajax state "${loginPayload.stare ?? 'unknown'}".`,
        sessionCookies: await this.serializeCookies(),
      };
    }

    const verificationResponse = await this.cookieFetch(redirectUrl, {
      redirect: 'follow',
    });
    const verificationHtml = await verificationResponse.text();
    const resolvedHandle = extractResolvedHandle(verificationHtml);
    const authenticated = extractLoggedInState(verificationHtml);
    const sessionCookies = await this.serializeCookies();
    if (authenticated && input.persistSessionCookies !== false) {
      await this.persistCookies(sessionCookies);
    }

    return {
      success: authenticated,
      redirectUrl,
      resolvedHandle,
      failureReason: authenticated
        ? undefined
        : 'PBInfo credential login was accepted by the ajax endpoint, but the follow-up session still resolved to guest mode.',
      sessionCookies,
    };
  }

  private async serializeCookies(): Promise<PersistedCookie[]> {
    const serialized = await this.jar.serialize();
    return serialized.cookies;
  }

  private async persistCookies(cookies: PersistedCookie[]): Promise<void> {
    persistSerializedCookies(this.sessionCookiesPath, cookies);
  }
}

function parseAjaxLoginResponse(text: string): AjaxLoginResponse {
  try {
    return JSON.parse(text) as AjaxLoginResponse;
  } catch {
    return {};
  }
}

function extractLoggedInState(html: string): boolean {
  const sessionJson = extractUserSessionJson(html);
  const id = Number(sessionJson?.id ?? sessionJson?.user_id ?? 0);
  if (Number.isFinite(id) && id > 0) {
    return true;
  }

  const $ = loadHtml(html);
  return $('a[href*="logout"], form[action*="logout"]').length > 0;
}

function extractResolvedHandle(html: string): string | undefined {
  const sessionJson = extractUserSessionJson(html);
  const sessionId = Number(sessionJson?.id ?? sessionJson?.user_id ?? 0);
  const sessionIsAuthenticated = Number.isFinite(sessionId) && sessionId > 0;
  for (const key of ['username', 'user', 'utilizator', 'nick', 'nume_utilizator', 'name']) {
    const candidate = pickSessionHandle(sessionJson?.[key]);
    if (sessionIsAuthenticated && candidate) {
      return candidate;
    }
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
  return trailingHandle ?? normalized;
}
