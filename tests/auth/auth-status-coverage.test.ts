import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { loadLocalConfig, type LoadedLocalConfig } from '../../src/config/local-config.js';
import { matchesConfiguredHandle, probePbinfoAuthStatus } from '../../src/auth/auth-status.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeConfig(options: { handle?: string; cookieExists?: boolean }): LoadedLocalConfig {
  const root = mkdtempSync(join(tmpdir(), 'pbinfo-auth-cov-'));
  tempDirs.push(root);
  mkdirSync(join(root, '.local'), { recursive: true });
  if (options.handle !== undefined) {
    writeFileSync(
      join(root, '.local', 'pbinfo.local.json'),
      JSON.stringify({ crawl: { userHandle: options.handle } }),
      'utf8',
    );
  }
  const config = loadLocalConfig(root);
  if (options.cookieExists) {
    writeFileSync(config.auth.sessionCookiesPath, '[]', 'utf8');
  }
  return config;
}

function fetchReturning(html: string): typeof fetch {
  return (async () => ({ text: async () => html })) as unknown as typeof fetch;
}

describe('probePbinfoAuthStatus statuses', () => {
  test('reports cookie-missing', async () => {
    const config = makeConfig({ cookieExists: false });
    const result = await probePbinfoAuthStatus(config, { fetchImpl: fetchReturning('') });
    expect(result.status).toBe('cookie-missing');
    expect(result.handleMatchesConfigured).toBe(true);
  });

  test('reports guest for an anonymous session', async () => {
    const config = makeConfig({ cookieExists: true });
    const result = await probePbinfoAuthStatus(config, {
      fetchImpl: fetchReturning('<html><body>welcome guest</body></html>'),
      now: new Date('2026-01-01T00:00:00Z'),
    });
    expect(result.status).toBe('guest');
  });

  test('reports ok when the session handle matches via parenthetical username', async () => {
    const config = makeConfig({ handle: 'alice', cookieExists: true });
    const html = '<script>user_autentificat = {"id":5,"username":"Alice (alice)"};</script>';
    const result = await probePbinfoAuthStatus(config, { fetchImpl: fetchReturning(html) });
    expect(result.status).toBe('ok');
    expect(result.resolvedHandle).toBe('alice');
  });

  test('reports handle-mismatch when the resolved handle differs', async () => {
    const config = makeConfig({ handle: 'alice', cookieExists: true });
    const html = '<script>user_autentificat = {"id":7,"username":"Bob"};</script>';
    const result = await probePbinfoAuthStatus(config, { fetchImpl: fetchReturning(html) });
    expect(result.status).toBe('handle-mismatch');
    expect(result.resolvedHandle).toBe('bob');
  });

  test('reports handle-mismatch when no handle can be resolved from an authenticated session', async () => {
    const config = makeConfig({ handle: 'alice', cookieExists: true });
    const html = '<script>user_autentificat = {"id":9};</script>';
    const result = await probePbinfoAuthStatus(config, { fetchImpl: fetchReturning(html) });
    expect(result.status).toBe('handle-mismatch');
    expect(result.resolvedHandle).toBeUndefined();
  });

  test('resolves the handle from a profile link when logged in via a logout link', async () => {
    const config = makeConfig({ cookieExists: true });
    const html = '<html><a href="/logout">Logout</a><nav><a href="/profil/charlie">profile</a></nav></html>';
    const result = await probePbinfoAuthStatus(config, { fetchImpl: fetchReturning(html) });
    expect(result.status).toBe('ok');
    expect(result.resolvedHandle).toBe('charlie');
  });

  test('resolves the handle from profile anchor text when the href has no segment', async () => {
    const config = makeConfig({ cookieExists: true });
    const html = '<html><a href="/logout">Logout</a><nav><a href="/profil/">Name (dave)</a></nav></html>';
    const result = await probePbinfoAuthStatus(config, { fetchImpl: fetchReturning(html) });
    expect(result.resolvedHandle).toBe('dave');
  });

  test('returns no resolved handle when authenticated but no profile anchor exists', async () => {
    const config = makeConfig({ cookieExists: true });
    const html = '<html><a href="/logout">Logout</a></html>';
    const result = await probePbinfoAuthStatus(config, { fetchImpl: fetchReturning(html) });
    expect(result.status).toBe('ok');
    expect(result.resolvedHandle).toBeUndefined();
  });

  test('ignores malformed session json and non-string handle fields', async () => {
    const config = makeConfig({ cookieExists: true });
    const malformed = await probePbinfoAuthStatus(config, {
      fetchImpl: fetchReturning('<script>user_autentificat = {bad json};</script>'),
    });
    expect(malformed.status).toBe('guest');

    const nonString = '<script>user_autentificat = {"id":3,"username":3,"user":"   ","name":"Eve"};</script>';
    const result = await probePbinfoAuthStatus(config, { fetchImpl: fetchReturning(nonString) });
    expect(result.resolvedHandle).toBe('eve');
  });

  test('treats a non-numeric session id as not authenticated', async () => {
    const config = makeConfig({ cookieExists: true });
    const result = await probePbinfoAuthStatus(config, {
      fetchImpl: fetchReturning('<script>user_autentificat = {"id":"abc"};</script>'),
    });
    expect(result.status).toBe('guest');
  });

  test('treats a zero session id as not authenticated', async () => {
    const config = makeConfig({ cookieExists: true });
    const result = await probePbinfoAuthStatus(config, {
      fetchImpl: fetchReturning('<script>user_autentificat = {"id":0};</script>'),
    });
    expect(result.status).toBe('guest');
  });

  test('treats session json with neither id nor user_id as not authenticated', async () => {
    const config = makeConfig({ cookieExists: true });
    const result = await probePbinfoAuthStatus(config, {
      fetchImpl: fetchReturning('<script>user_autentificat = {"username":"ghost"};</script>'),
    });
    expect(result.status).toBe('guest');
  });

  test('resolves authentication from the user_id field', async () => {
    const config = makeConfig({ handle: 'frank', cookieExists: true });
    const result = await probePbinfoAuthStatus(config, {
      fetchImpl: fetchReturning('<script>user_autentificat = {"user_id":4,"username":"frank"};</script>'),
    });
    expect(result.status).toBe('ok');
  });

  test('treats a whitespace-only configured handle as unconfigured', async () => {
    const config = makeConfig({ handle: '   ', cookieExists: true });
    const result = await probePbinfoAuthStatus(config, {
      fetchImpl: fetchReturning('<script>user_autentificat = {"id":1,"username":"Someone"};</script>'),
    });
    expect(result.status).toBe('ok');
  });
});

describe('matchesConfiguredHandle', () => {
  test('covers all comparison branches', () => {
    expect(matchesConfiguredHandle(undefined, 'anything')).toBe(true);
    expect(matchesConfiguredHandle('alice', undefined)).toBe(false);
    expect(matchesConfiguredHandle('alice', '   ')).toBe(false);
    expect(matchesConfiguredHandle('alice', 'alice')).toBe(true);
    expect(matchesConfiguredHandle('alice', 'Alice Display (alice)')).toBe(true);
    expect(matchesConfiguredHandle('alice', 'Bob (bob)')).toBe(false);
    expect(matchesConfiguredHandle('alice', 'bob')).toBe(false);
  });
});
