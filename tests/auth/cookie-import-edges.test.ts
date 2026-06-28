import { createCipheriv, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, test } from 'vitest';

import {
  importBrowserCookies,
  normalizeImportedCookies,
  resolveChromiumProfile,
  unwrapChromiumMasterKey,
} from '../../src/auth/cookie-import.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const MASTER_KEY = randomBytes(32);
const WRAPPED = Buffer.from('wrapped-key');

function encrypt(value: string, prefix: string): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', MASTER_KEY, nonce);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([Buffer.from(prefix), nonce, ciphertext, cipher.getAuthTag()]);
}

interface CookieRow {
  host_key?: unknown;
  name?: unknown;
  value?: unknown;
  encrypted_value?: unknown;
  path?: unknown;
  expires_utc?: unknown;
  is_httponly?: unknown;
  is_secure?: unknown;
  samesite?: unknown;
}

function buildProfile(rows: CookieRow[], options: { nullable?: boolean; writeDb?: boolean; localState?: string } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'pbinfo-cookie-edges-'));
  tempDirs.push(root);
  const userDataDir = join(root, 'Edge', 'User Data');
  const networkDir = join(userDataDir, 'Default', 'Network');
  mkdirSync(networkDir, { recursive: true });
  writeFileSync(
    join(userDataDir, 'Local State'),
    options.localState ??
      JSON.stringify({ os_crypt: { encrypted_key: Buffer.concat([Buffer.from('DPAPI'), WRAPPED]).toString('base64') } }),
    'utf8',
  );
  if (options.writeDb !== false) {
    const db = new DatabaseSync(join(networkDir, 'Cookies'));
    const cols = options.nullable
      ? 'host_key TEXT, name TEXT, value TEXT, encrypted_value BLOB, path TEXT, expires_utc INTEGER, is_httponly INTEGER, is_secure INTEGER, samesite INTEGER'
      : 'host_key TEXT NOT NULL, name TEXT NOT NULL, value TEXT NOT NULL, encrypted_value BLOB NOT NULL, path TEXT NOT NULL, expires_utc INTEGER NOT NULL, is_httponly INTEGER NOT NULL, is_secure INTEGER NOT NULL, samesite INTEGER NOT NULL';
    db.exec(`CREATE TABLE cookies (${cols})`);
    const stmt = db.prepare(
      'INSERT INTO cookies (host_key, name, value, encrypted_value, path, expires_utc, is_httponly, is_secure, samesite) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const pick = <T>(row: CookieRow, key: keyof CookieRow, fallback: T): T =>
      (key in row ? (row[key] as T) : fallback);
    for (const row of rows) {
      stmt.run(
        pick(row, 'host_key', '.pbinfo.ro') as string,
        pick(row, 'name', 'C') as string,
        pick(row, 'value', '') as string,
        pick(row, 'encrypted_value', new Uint8Array()) as Uint8Array,
        pick(row, 'path', '/') as string,
        pick(row, 'expires_utc', 0) as number,
        pick(row, 'is_httponly', 0) as number,
        pick(row, 'is_secure', 0) as number,
        pick(row, 'samesite', 0) as number,
      );
    }
    db.close();
  }
  return userDataDir;
}

const syncDecrypt = (buf: Buffer): Buffer => (buf.equals(WRAPPED) ? MASTER_KEY : Buffer.from('legacy-plain'));

describe('cookie-import normalization edges', () => {
  test('normalizes the none same-site value and drops non-positive expiries', () => {
    const cookies = normalizeImportedCookies([
      { name: 'a', value: '1', domain: 'd', sameSite: 'None', expirationDate: 100 },
      { name: 'b', value: '2', domain: 'd', expires: 0 },
    ]);
    expect(cookies[0]?.sameSite).toBe('none');
    expect(cookies[0]?.expires).toBe(100);
    expect(cookies[1]?.expires).toBeUndefined();
  });

  test('handles a storage-state export without a cookies array', () => {
    expect(normalizeImportedCookies({ origins: [] })).toEqual([]);
  });
});

describe('unwrapChromiumMasterKey edges', () => {
  test('throws when the encrypted key is absent', async () => {
    await expect(unwrapChromiumMasterKey(JSON.stringify({ os_crypt: {} }))).rejects.toThrow(/encrypted_key/);
  });

  test('passes the key through unchanged when no DPAPI prefix is present', async () => {
    const result = await unwrapChromiumMasterKey(
      JSON.stringify({ os_crypt: { encrypted_key: WRAPPED.toString('base64') } }),
      syncDecrypt,
    );
    expect(result.equals(MASTER_KEY)).toBe(true);
  });
});

describe('resolveChromiumProfile / importBrowserCookies guards', () => {
  test('throws when LOCALAPPDATA is unset', () => {
    expect(() => resolveChromiumProfile({ browser: 'edge' }, {} as NodeJS.ProcessEnv)).toThrow(/LOCALAPPDATA/);
  });

  test('throws when the Local State file is missing', async () => {
    const userDataDir = buildProfile([], { writeDb: true });
    rmSync(join(userDataDir, 'Local State'));
    await expect(importBrowserCookies({ browser: 'edge', userDataDir, decryptMasterKey: syncDecrypt })).rejects.toThrow(
      /Local State file was not found/,
    );
  });

  test('throws when the cookies database is missing', async () => {
    const userDataDir = buildProfile([], { writeDb: false });
    await expect(importBrowserCookies({ browser: 'edge', userDataDir, decryptMasterKey: syncDecrypt })).rejects.toThrow(
      /cookies database was not found/,
    );
  });

  test('stringifies a non-Error copy failure', async () => {
    const userDataDir = buildProfile([{ name: 'c', encrypted_value: encrypt('v', 'v10') }]);
    await expect(
      importBrowserCookies({
        browser: 'edge',
        userDataDir,
        decryptMasterKey: syncDecrypt,
        copyFile: () => {
          throw 'string-failure';
        },
      }),
    ).rejects.toThrow(/string-failure/);
  });
});

describe('importBrowserCookies decryption variants', () => {
  test('decrypts v11, v20, legacy and empty values and honors same-site and expiry', async () => {
    const userDataDir = buildProfile([
      { name: 'v11c', encrypted_value: encrypt('v11-value', 'v11'), samesite: 2, expires_utc: (1_893_456_000 + 11_644_473_600) * 1_000_000 },
      { name: 'v20c', encrypted_value: encrypt('v20-value', 'v20'), is_httponly: 1, is_secure: 1 },
      { name: 'legacyc', encrypted_value: Buffer.concat([Buffer.from('leg'), randomBytes(8)]) },
      { name: 'emptyc', encrypted_value: new Uint8Array(), expires_utc: 0, path: '' },
      { name: 'tinyexp', encrypted_value: encrypt('t', 'v10'), expires_utc: 1_000_000 },
    ]);
    const cookies = await importBrowserCookies({ browser: 'edge', userDataDir, decryptMasterKey: syncDecrypt });
    const byName = Object.fromEntries(cookies.map((c) => [c.name, c]));
    expect(byName.v11c?.value).toBe('v11-value');
    expect(byName.v11c?.sameSite).toBe('strict');
    expect(byName.v11c?.expires).toBe(1_893_456_000);
    expect(byName.v20c?.value).toBe('v20-value');
    expect(byName.legacyc?.value).toBe('legacy-plain');
    expect(byName.emptyc?.value).toBe('');
    expect(byName.emptyc?.path).toBe('/');
    expect(byName.emptyc?.expires).toBeUndefined();
    expect(byName.tinyexp?.expires).toBeUndefined();
  });

  test('stringifies a non-Error cookie decryption failure', async () => {
    const userDataDir = buildProfile([
      { name: 'legacyc', encrypted_value: Buffer.concat([Buffer.from('leg'), randomBytes(8)]) },
    ]);
    await expect(
      importBrowserCookies({
        browser: 'edge',
        userDataDir,
        decryptMasterKey: (buf) => {
          if (buf.equals(WRAPPED)) {
            return MASTER_KEY;
          }
          throw 'decrypt-string-failure';
        },
      }),
    ).rejects.toThrow(/decrypt-string-failure/);
  });

  test('rejects when legacy decryption resolves asynchronously', async () => {
    const userDataDir = buildProfile([
      { name: 'legacyc', encrypted_value: Buffer.concat([Buffer.from('leg'), randomBytes(8)]) },
    ]);
    await expect(
      importBrowserCookies({
        browser: 'edge',
        userDataDir,
        decryptMasterKey: async (buf) => (buf.equals(WRAPPED) ? MASTER_KEY : Buffer.from('x')),
      }),
    ).rejects.toThrow(/app-bound encryption|synchronous|auth login/i);
  });

  test('coerces malformed cookie rows with null columns', async () => {
    const userDataDir = buildProfile(
      [
        {
          host_key: '.pbinfo.ro',
          name: 'plain',
          value: 'present',
          encrypted_value: null,
          path: null,
          expires_utc: null,
          is_httponly: null,
          is_secure: null,
          samesite: null,
        },
        {
          host_key: null,
          name: null,
          value: null,
          encrypted_value: null,
          path: null,
          expires_utc: null,
          is_httponly: null,
          is_secure: null,
          samesite: null,
        },
      ],
      { nullable: true },
    );
    const cookies = await importBrowserCookies({ browser: 'edge', userDataDir, decryptMasterKey: syncDecrypt });
    expect(cookies[0]).toMatchObject({
      name: 'plain',
      value: 'present',
      path: '/',
      expires: undefined,
      httpOnly: false,
      secure: false,
      sameSite: 'lax',
    });
  });
});
