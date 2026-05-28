import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import {
  createCookieFetch,
  loadCookieJarFromFile,
  persistSerializedCookies,
} from '../../src/auth/session-store.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pbinfo-session-store-'));
  tempDirs.push(dir);
  return dir;
}

describe('session cookie store', () => {
  test('returns an empty jar when the cookie file is missing', async () => {
    const jar = await loadCookieJarFromFile(join(makeDir(), 'missing.json'));
    expect(await jar.getCookies('https://www.pbinfo.ro/')).toEqual([]);
  });

  test('loads serialized cookies and skips entries missing a key or value', async () => {
    const dir = makeDir();
    const cookiesPath = join(dir, 'cookies.json');
    writeFileSync(
      cookiesPath,
      JSON.stringify([
        {
          key: 'SECURE_ID',
          value: 'a',
          domain: 'www.pbinfo.ro',
          path: '/',
          secure: true,
          httpOnly: true,
        },
        { key: 'PLAIN_ID', value: 'b' },
        { value: 'no-key' },
        { key: 'no-value' },
      ]),
      'utf8',
    );

    const secureJar = await loadCookieJarFromFile(cookiesPath);
    const secureCookies = await secureJar.getCookies('https://www.pbinfo.ro/');
    expect(secureCookies.map((cookie) => cookie.key)).toContain('SECURE_ID');

    const plainCookies = await secureJar.getCookies('http://localhost/');
    expect(plainCookies.map((cookie) => cookie.key)).toContain('PLAIN_ID');
  });

  test('persists serialized cookies, creating parent directories', () => {
    const dir = makeDir();
    const cookiesPath = join(dir, 'nested', 'cookies.json');
    persistSerializedCookies(cookiesPath, [
      { key: 'SESSION', value: 'v', domain: 'www.pbinfo.ro', path: '/' },
    ]);
    expect(existsSync(cookiesPath)).toBe(true);
    expect(JSON.parse(readFileSync(cookiesPath, 'utf8'))).toEqual([
      { key: 'SESSION', value: 'v', domain: 'www.pbinfo.ro', path: '/' },
    ]);
  });

  test('creates a cookie-aware fetch wrapper bound to the loaded jar', async () => {
    const fetchWithCookies = await createCookieFetch(join(makeDir(), 'missing.json'));
    expect(fetchWithCookies).toBeTypeOf('function');
  });
});
