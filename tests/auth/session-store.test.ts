import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

function makeFile(contents: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'pbinfo-session-'));
  tempDirs.push(dir);
  const path = join(dir, 'session-cookies.json');
  writeFileSync(path, JSON.stringify(contents), 'utf8');
  return path;
}

describe('cookie jar loading', () => {
  test('returns an empty jar when the cookie file does not exist', async () => {
    const jar = await loadCookieJarFromFile(join(tmpdir(), 'pbinfo-missing-cookies-xyz.json'));
    expect(await jar.getCookies('https://www.pbinfo.ro/')).toEqual([]);
  });

  test('skips entries missing a key or value and loads the rest with secure/httpOnly flags', async () => {
    const path = makeFile([
      { value: 'no-key' },
      { key: 'no-value' },
      {
        key: 'SESSION_ID',
        value: 'abc',
        domain: '.pbinfo.ro',
        path: '/app',
        secure: true,
        httpOnly: true,
      },
    ]);

    const jar = await loadCookieJarFromFile(path);
    const cookies = await jar.getCookies('https://www.pbinfo.ro/app');
    expect(cookies).toHaveLength(1);
    expect(cookies[0]?.key).toBe('SESSION_ID');
    expect(cookies[0]?.secure).toBe(true);
  });

  test('applies http defaults when domain, path, secure and httpOnly are absent', async () => {
    const path = makeFile([{ key: 'PLAIN', value: 'v' }]);
    const jar = await loadCookieJarFromFile(path);
    const cookies = await jar.getCookies('http://localhost/');
    expect(cookies).toHaveLength(1);
    expect(cookies[0]?.secure).toBe(false);
  });

  test('createCookieFetch returns a fetch function bound to the persisted jar', async () => {
    const path = makeFile([{ key: 'X', value: 'y' }]);
    const fetcher = await createCookieFetch(path);
    expect(typeof fetcher).toBe('function');
  });

  test('persistSerializedCookies writes the cookies as pretty JSON, creating parent dirs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pbinfo-session-'));
    tempDirs.push(dir);
    const path = join(dir, 'nested', 'session.json');
    persistSerializedCookies(path, [{ key: 'A', value: 'B' }]);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual([{ key: 'A', value: 'B' }]);
  });
});
