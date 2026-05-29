import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, test } from 'vitest';

import {
  importBrowserCookies,
  normalizeImportedCookies,
  resolveChromiumProfile,
  unwrapChromiumMasterKey,
} from '../../src/auth/cookie-import.js';

describe('normalizeImportedCookies sameSite branches', () => {
  test('honors the "none" sameSite hint', () => {
    const cookies = normalizeImportedCookies([
      {
        name: 'tracker',
        value: 'v',
        domain: 'pbinfo.ro',
        sameSite: 'None',
      },
    ]);
    expect(cookies[0]?.sameSite).toBe('none');
  });

  test('honors the "strict" sameSite hint', () => {
    const cookies = normalizeImportedCookies([
      {
        name: 'tracker',
        value: 'v',
        domain: 'pbinfo.ro',
        sameSite: 'STRICT',
      },
    ]);
    expect(cookies[0]?.sameSite).toBe('strict');
  });

  test('drops non-positive expiry hints', () => {
    const cookies = normalizeImportedCookies([
      {
        name: 'x',
        value: 'v',
        domain: 'pbinfo.ro',
        expires: -1,
      },
    ]);
    expect(cookies[0]?.expires).toBeUndefined();
  });
});

describe('unwrapChromiumMasterKey branches', () => {
  test('throws when os_crypt.encrypted_key is missing', async () => {
    const localState = JSON.stringify({ os_crypt: {} });
    await expect(
      unwrapChromiumMasterKey(localState, async () => Buffer.alloc(32)),
    ).rejects.toThrow(/os_crypt\.encrypted_key/);
  });

  test('uses the encrypted key as-is when it has no DPAPI prefix', async () => {
    const rawKey = Buffer.from('not-a-real-key-without-dpapi-prefix');
    const localState = JSON.stringify({
      os_crypt: { encrypted_key: rawKey.toString('base64') },
    });
    const result = await unwrapChromiumMasterKey(localState, async (buf) => buf);
    expect(result.equals(rawKey)).toBe(true);
  });
});

describe('resolveChromiumProfile branches', () => {
  test('throws when LOCALAPPDATA is missing and no userDataDir is given', () => {
    expect(() =>
      resolveChromiumProfile({ browser: 'chrome' }, {}),
    ).toThrow(/LOCALAPPDATA/);
  });

  test('uses an explicit userDataDir when supplied', () => {
    const resolved = resolveChromiumProfile({
      browser: 'edge',
      userDataDir: '/tmp/customprofile',
      profile: 'Profile 1',
    });
    expect(resolved.profileName).toBe('Profile 1');
    expect(resolved.userDataDir).toContain('customprofile');
  });
});

describe('importBrowserCookies sad paths', () => {
  test('throws when the Local State file is missing', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'pbinfo-no-local-state-'));
    await expect(
      importBrowserCookies({
        browser: 'chrome',
        userDataDir,
      }),
    ).rejects.toThrow(/Local State/);
  });

  test('throws when the cookies database is missing', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'pbinfo-no-cookies-db-'));
    writeFileSync(
      join(userDataDir, 'Local State'),
      JSON.stringify({ os_crypt: { encrypted_key: 'AAAA' } }),
      'utf8',
    );
    await expect(
      importBrowserCookies({
        browser: 'chrome',
        userDataDir,
      }),
    ).rejects.toThrow(/cookies database/);
  });

  test('returns plaintext cookie values without invoking the decryption path', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'pbinfo-cookies-plaintext-'));
    writeFileSync(
      join(userDataDir, 'Local State'),
      JSON.stringify({ os_crypt: { encrypted_key: Buffer.from('DPAPIkeyMaterial').toString('base64') } }),
      'utf8',
    );
    const profileDir = join(userDataDir, 'Default', 'Network');
    mkdirSync(profileDir, { recursive: true });

    const cookiesDb = join(profileDir, 'Cookies');
    const db = new DatabaseSync(cookiesDb);
    db.exec(
      `CREATE TABLE cookies (
        host_key TEXT,
        name TEXT,
        value TEXT,
        encrypted_value BLOB,
        path TEXT,
        expires_utc INTEGER,
        is_httponly INTEGER,
        is_secure INTEGER,
        samesite INTEGER
      )`,
    );
    db.prepare(
      'INSERT INTO cookies VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      '.pbinfo.ro',
      'PHPSESSID',
      'plain-value',
      new Uint8Array(),
      '/',
      // negative chromium expiry exercises the <=0n branch
      0,
      0,
      1,
      2,
    );
    db.close();

    const result = await importBrowserCookies({
      browser: 'chrome',
      userDataDir,
      decryptMasterKey: async () => Buffer.alloc(32),
    });
    expect(result[0]?.value).toBe('plain-value');
    expect(result[0]?.sameSite).toBe('strict');
    expect(result[0]?.expires).toBeUndefined();
  });
});
