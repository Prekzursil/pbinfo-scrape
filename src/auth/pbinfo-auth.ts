import makeFetchCookie from 'fetch-cookie';
import { CookieJar } from 'tough-cookie';

import { loadHtml } from '../pbinfo/parsers/shared.js';
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

  async loginWithCredentials(
    input: CredentialLoginInput,
  ): Promise<CredentialLoginResult> {
    const loginPage = await this.cookieFetch(this.baseUrl, {
      redirect: 'follow',
    });
    const loginForm = extractLoginForm(await loginPage.text());
    const loginUrl = new URL(loginForm.action, this.baseUrl);
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
        'content-type': 'application/x-www-form-urlencoded',
      },
      redirect: 'manual',
    });

    const sessionCookies = await this.serializeCookies();
    if (input.persistSessionCookies !== false) {
      await this.persistCookies(sessionCookies);
    }

    const redirectUrl = loginResponse.headers.get('location')
      ? new URL(loginResponse.headers.get('location')!, this.baseUrl).toString()
      : undefined;

    return {
      success: loginResponse.status >= 300 && loginResponse.status < 400,
      redirectUrl,
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
