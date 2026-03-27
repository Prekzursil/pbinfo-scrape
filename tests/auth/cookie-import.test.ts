import { randomBytes, createCipheriv } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { describe, expect, test, vi } from 'vitest';

import {
  importBrowserCookies,
  normalizeImportedCookies,
  resolveChromiumProfile,
  unwrapChromiumMasterKey,
} from '../../src/auth/cookie-import.js';

describe('normalizeImportedCookies', () => {
  test('accepts a plain cookie array export', () => {
    const cookies = normalizeImportedCookies([
      {
        name: 'PHPSESSID',
        value: 'abc123',
        domain: '.pbinfo.ro',
        path: '/',
        expires: 1893456000,
        httpOnly: true,
        secure: true,
      },
    ]);

    expect(cookies).toEqual([
      {
        name: 'PHPSESSID',
        value: 'abc123',
        domain: '.pbinfo.ro',
        path: '/',
        expires: 1893456000,
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
      },
    ]);
  });

  test('accepts Playwright storage-state exports', () => {
    const cookies = normalizeImportedCookies({
      cookies: [
        {
          name: 'csrftoken',
          value: 'xyz',
          domain: 'www.pbinfo.ro',
          path: '/',
          expires: -1,
          httpOnly: false,
          secure: false,
          sameSite: 'Strict',
        },
      ],
      origins: [],
    });

    expect(cookies).toEqual([
      {
        name: 'csrftoken',
        value: 'xyz',
        domain: 'www.pbinfo.ro',
        path: '/',
        expires: undefined,
        httpOnly: false,
        secure: false,
        sameSite: 'strict',
      },
    ]);
  });

  test('resolves the default Chromium profile paths for Edge and Chrome', () => {
    const env = {
      LOCALAPPDATA: 'C:\\Users\\Test\\AppData\\Local',
    } as NodeJS.ProcessEnv;

    expect(resolveChromiumProfile({ browser: 'edge' }, env)).toEqual({
      browser: 'edge',
      profileName: 'Default',
      userDataDir: 'C:\\Users\\Test\\AppData\\Local\\Microsoft\\Edge\\User Data',
      localStatePath: 'C:\\Users\\Test\\AppData\\Local\\Microsoft\\Edge\\User Data\\Local State',
      cookiesDbPath:
        'C:\\Users\\Test\\AppData\\Local\\Microsoft\\Edge\\User Data\\Default\\Network\\Cookies',
    });

    expect(
      resolveChromiumProfile(
        {
          browser: 'chrome',
          profile: 'Profile 2',
        },
        env,
      ),
    ).toEqual({
      browser: 'chrome',
      profileName: 'Profile 2',
      userDataDir: 'C:\\Users\\Test\\AppData\\Local\\Google\\Chrome\\User Data',
      localStatePath: 'C:\\Users\\Test\\AppData\\Local\\Google\\Chrome\\User Data\\Local State',
      cookiesDbPath:
        'C:\\Users\\Test\\AppData\\Local\\Google\\Chrome\\User Data\\Profile 2\\Network\\Cookies',
    });
  });

  test('unwraps the Chromium master key from Local State via an injected DPAPI decryptor', async () => {
    const wrappedKey = Buffer.from('wrapped-master-key');
    const decryptedKey = Buffer.alloc(32, 7);
    const decryptMasterKey = vi.fn(async (buffer: Buffer) => {
      expect(buffer.equals(wrappedKey)).toBe(true);
      return decryptedKey;
    });

    const result = await unwrapChromiumMasterKey(
      JSON.stringify({
        os_crypt: {
          encrypted_key: Buffer.concat([Buffer.from('DPAPI'), wrappedKey]).toString('base64'),
        },
      }),
      decryptMasterKey,
    );

    expect(result.equals(decryptedKey)).toBe(true);
    expect(decryptMasterKey).toHaveBeenCalledOnce();
  });

  test('imports Chromium cookies from a copied cookie DB, decrypts them, and filters to pbinfo.ro', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pbinfo-cookie-import-'));
    const profileDir = join(root, 'Edge', 'User Data', 'Default', 'Network');
    mkdirSync(profileDir, { recursive: true });

    const masterKey = randomBytes(32);
    const localStatePath = join(root, 'Edge', 'User Data', 'Local State');
    writeFileSync(
      localStatePath,
      JSON.stringify({
        os_crypt: {
          encrypted_key: Buffer.concat([Buffer.from('DPAPI'), Buffer.from('wrapped-key')]).toString(
            'base64',
          ),
        },
      }),
      'utf8',
    );

    const cookiesDbPath = join(profileDir, 'Cookies');
    const database = new DatabaseSync(cookiesDbPath);
    database.exec(`
      CREATE TABLE cookies (
        host_key TEXT NOT NULL,
        name TEXT NOT NULL,
        value TEXT NOT NULL,
        encrypted_value BLOB NOT NULL,
        path TEXT NOT NULL,
        expires_utc INTEGER NOT NULL,
        is_httponly INTEGER NOT NULL,
        is_secure INTEGER NOT NULL,
        samesite INTEGER NOT NULL
      )
    `);
    database.prepare(
      `INSERT INTO cookies (
        host_key,
        name,
        value,
        encrypted_value,
        path,
        expires_utc,
        is_httponly,
        is_secure,
        samesite
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      '.pbinfo.ro',
      'PHPSESSID',
      '',
      encryptChromiumCookieValue(masterKey, 'secret-session'),
      '/',
      toChromiumEpochSeconds(1_893_456_000),
      1,
      1,
      0,
    );
    database.prepare(
      `INSERT INTO cookies (
        host_key,
        name,
        value,
        encrypted_value,
        path,
        expires_utc,
        is_httponly,
        is_secure,
        samesite
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      '.example.com',
      'OTHER',
      '',
      encryptChromiumCookieValue(masterKey, 'ignore-me'),
      '/',
      0,
      0,
      0,
      0,
    );
    database.close();

    const cookies = await importBrowserCookies({
      browser: 'edge',
      userDataDir: join(root, 'Edge', 'User Data'),
      decryptMasterKey: async () => masterKey,
    });

    expect(cookies).toEqual([
      {
        name: 'PHPSESSID',
        value: 'secret-session',
        domain: '.pbinfo.ro',
        path: '/',
        expires: 1_893_456_000,
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
      },
    ]);
  });

  test('reports locked or inaccessible Chromium cookie stores clearly', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pbinfo-cookie-import-'));
    const userDataDir = join(root, 'Chrome', 'User Data');
    const networkDir = join(userDataDir, 'Default', 'Network');
    mkdirSync(networkDir, { recursive: true });
    writeFileSync(
      join(userDataDir, 'Local State'),
      JSON.stringify({
        os_crypt: {
          encrypted_key: Buffer.concat([Buffer.from('DPAPI'), Buffer.from('wrapped-key')]).toString(
            'base64',
          ),
        },
      }),
      'utf8',
    );
    writeFileSync(join(networkDir, 'Cookies'), '', 'utf8');

    await expect(
      importBrowserCookies({
        browser: 'chrome',
        userDataDir,
        decryptMasterKey: async () => Buffer.alloc(32, 1),
        copyFile: () => {
          const error = new Error('database is locked');
          (error as NodeJS.ErrnoException).code = 'EBUSY';
          throw error;
        },
      }),
    ).rejects.toThrow(/Could not copy Chromium cookies database/i);
  });

  test('reports app-bound or undecryptable Chromium cookies with actionable remediation', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pbinfo-cookie-import-'));
    const userDataDir = join(root, 'Edge', 'User Data');
    const networkDir = join(userDataDir, 'Default', 'Network');
    mkdirSync(networkDir, { recursive: true });
    writeFileSync(
      join(userDataDir, 'Local State'),
      JSON.stringify({
        os_crypt: {
          encrypted_key: Buffer.concat([Buffer.from('DPAPI'), Buffer.from('wrapped-key')]).toString(
            'base64',
          ),
        },
      }),
      'utf8',
    );

    const cookiesDbPath = join(networkDir, 'Cookies');
    const database = new DatabaseSync(cookiesDbPath);
    database.exec(`
      CREATE TABLE cookies (
        host_key TEXT NOT NULL,
        name TEXT NOT NULL,
        value TEXT NOT NULL,
        encrypted_value BLOB NOT NULL,
        path TEXT NOT NULL,
        expires_utc INTEGER NOT NULL,
        is_httponly INTEGER NOT NULL,
        is_secure INTEGER NOT NULL,
        samesite INTEGER NOT NULL
      )
    `);
    database.prepare(
      `INSERT INTO cookies (
        host_key,
        name,
        value,
        encrypted_value,
        path,
        expires_utc,
        is_httponly,
        is_secure,
        samesite
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      '.pbinfo.ro',
      'FCCDCF',
      '',
      encryptChromiumCookieValue(Buffer.alloc(32, 7), 'cmp-consent-token'),
      '/',
      0,
      1,
      1,
      0,
    );
    database.close();

    await expect(
      importBrowserCookies({
        browser: 'edge',
        userDataDir,
        decryptMasterKey: async () => Buffer.alloc(32, 9),
      }),
    ).rejects.toThrow(/app-bound encryption|auth login|plain JSON cookie export/i);
  });
});

function encryptChromiumCookieValue(masterKey: Buffer, value: string): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey, nonce);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from('v10'), nonce, ciphertext, tag]);
}

function toChromiumEpochSeconds(unixSeconds: number): number {
  return (unixSeconds + 11_644_473_600) * 1_000_000;
}
