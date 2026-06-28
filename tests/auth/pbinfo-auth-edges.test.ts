import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { PbinfoAuthClient, extractLoginForm } from '../../src/auth/pbinfo-auth.js';

const tempDirs: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) => new Promise<void>((resolve) => server.close(() => resolve())),
    ),
  );
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const LOGIN_HTML = `
  <form id="form-login" action="/login.php" method="post">
    <input type="hidden" name="form_token" value="tok">
  </form>`;

async function login(options: {
  ajaxBody: string;
  ajaxContentType?: string;
  verifyHtml?: string;
}): Promise<Awaited<ReturnType<PbinfoAuthClient['loginWithCredentials']>>> {
  const dir = mkdtempSync(join(tmpdir(), 'pbinfo-auth-edges-'));
  tempDirs.push(dir);
  const server = createServer((request, response) => {
    if (request.method === 'GET') {
      response.setHeader('Content-Type', 'text/html');
      if (request.headers.cookie?.includes('SESSION_ID=ok') && options.verifyHtml) {
        response.end(options.verifyHtml);
        return;
      }
      response.end(LOGIN_HTML);
      return;
    }
    response.setHeader('Content-Type', options.ajaxContentType ?? 'application/json');
    if (options.verifyHtml) {
      response.setHeader('Set-Cookie', 'SESSION_ID=ok; Path=/');
    }
    response.end(options.ajaxBody);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new TypeError('no address');
  }
  const client = new PbinfoAuthClient({
    baseUrl: `http://127.0.0.1:${address.port}`,
    sessionCookiesPath: join(dir, 'session.json'),
  });
  return client.loginWithCredentials({ username: 'u', password: 'p' });
}

describe('extractLoginForm', () => {
  test('throws when the login form is absent', () => {
    expect(() => extractLoginForm('<html></html>')).toThrow(/login form was not found/);
  });

  test('throws when required fields are missing', () => {
    expect(() => extractLoginForm('<form id="form-login"></form>')).toThrow(/missing required fields/);
  });
});

describe('loginWithCredentials helper branches', () => {
  test('handles a non-JSON ajax response with a generic failure reason', async () => {
    const result = await login({ ajaxBody: 'not json at all', ajaxContentType: 'text/plain' });
    expect(result.success).toBe(false);
    expect(result.failureReason).toContain('ajax state "unknown"');
  });

  test('resolves the handle from a profile link when session json lacks a username', async () => {
    const result = await login({
      ajaxBody: JSON.stringify({ stare: 'success' }),
      verifyHtml: '<script>user_autentificat = {"id":5};</script><nav><a href="/profil/heralt">x</a></nav>',
    });
    expect(result.success).toBe(true);
    expect(result.resolvedHandle).toBe('heralt');
  });

  test('resolves the handle from a parenthetical username', async () => {
    const result = await login({
      ajaxBody: JSON.stringify({ stare: 'success' }),
      verifyHtml: '<script>user_autentificat = {"user_id":6,"username":"Display (geo)"};</script>',
    });
    expect(result.resolvedHandle).toBe('geo');
  });

  test('skips blank usernames and reads the profile anchor text', async () => {
    const result = await login({
      ajaxBody: JSON.stringify({ stare: 'success' }),
      verifyHtml:
        '<script>user_autentificat = {"id":7,"username":"   "};</script><nav><a href="/profil/">Name (ana)</a></nav>',
    });
    expect(result.resolvedHandle).toBe('ana');
  });

  test('detects login via a logout link when no session json is present', async () => {
    const result = await login({
      ajaxBody: JSON.stringify({ stare: 'success' }),
      verifyHtml: '<a href="/logout">Logout</a><nav><a href="/profil/leo">x</a></nav>',
    });
    expect(result.success).toBe(true);
    expect(result.resolvedHandle).toBe('leo');
  });

  test('tolerates malformed session json on the verification page', async () => {
    const result = await login({
      ajaxBody: JSON.stringify({ stare: 'success' }),
      verifyHtml: '<script>user_autentificat = {bad};</script><a href="/logout">Logout</a>',
    });
    expect(result.success).toBe(true);
    expect(result.resolvedHandle).toBeUndefined();
  });
});
