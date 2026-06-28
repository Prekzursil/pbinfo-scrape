import { createDecipheriv } from 'node:crypto';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

export interface ImportedCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax' | 'strict' | 'none';
}

interface RawCookie {
  name: string;
  value: string;
  domain: string;
  path?: string;
  expires?: number;
  expirationDate?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}

interface PlaywrightStorageState {
  cookies?: RawCookie[];
  origins?: unknown[];
}

export type SupportedChromiumBrowser = 'edge' | 'chrome';

export interface ResolvedChromiumProfile {
  browser: SupportedChromiumBrowser;
  profileName: string;
  userDataDir: string;
  localStatePath: string;
  cookiesDbPath: string;
}

interface BrowserCookieRow {
  host_key: string;
  name: string;
  value: string;
  encrypted_value: Uint8Array;
  path: string;
  expires_utc: string | number | bigint;
  is_httponly: number | bigint;
  is_secure: number | bigint;
  samesite: number | bigint;
}

export interface BrowserCookieImportOptions {
  browser: SupportedChromiumBrowser;
  profile?: string;
  userDataDir?: string;
  env?: NodeJS.ProcessEnv;
  domainFilter?: string;
  decryptMasterKey?: (wrappedKey: Buffer) => Buffer | Promise<Buffer>;
  copyFile?: (sourcePath: string, targetPath: string) => void;
}

export function normalizeImportedCookies(
  rawInput: RawCookie[] | PlaywrightStorageState,
): ImportedCookie[] {
  const cookies = Array.isArray(rawInput) ? rawInput : rawInput.cookies ?? [];

  return cookies.map((cookie) => ({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path ?? '/',
    expires: normalizeExpiry(cookie.expires ?? cookie.expirationDate),
    httpOnly: cookie.httpOnly ?? false,
    secure: cookie.secure ?? false,
    sameSite: normalizeSameSite(cookie.sameSite),
  }));
}

function normalizeExpiry(value?: number): number | undefined {
  if (value === undefined || value <= 0) {
    return undefined;
  }

  return value;
}

function normalizeSameSite(value?: string): 'lax' | 'strict' | 'none' {
  switch ((value ?? 'Lax').toLowerCase()) {
    case 'strict':
      return 'strict';
    case 'none':
      return 'none';
    default:
      return 'lax';
  }
}

export function resolveChromiumProfile(
  options: Pick<BrowserCookieImportOptions, 'browser' | 'profile' | 'userDataDir'>,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedChromiumProfile {
  const profileName = options.profile ?? 'Default';
  const userDataDir = options.userDataDir
    ? resolve(options.userDataDir)
    : resolveDefaultChromiumUserDataDir(options.browser, env);

  return {
    browser: options.browser,
    profileName,
    userDataDir,
    localStatePath: join(userDataDir, 'Local State'),
    cookiesDbPath: join(userDataDir, profileName, 'Network', 'Cookies'),
  };
}

export async function unwrapChromiumMasterKey(
  localStateRaw: string,
  decryptMasterKey: (wrappedKey: Buffer) => Buffer | Promise<Buffer> = decryptDpapiBuffer,
): Promise<Buffer> {
  const parsed = JSON.parse(localStateRaw) as {
    os_crypt?: {
      encrypted_key?: string;
    };
  };
  const encodedKey = parsed.os_crypt?.encrypted_key;
  if (!encodedKey) {
    throw new Error('Chromium Local State did not contain os_crypt.encrypted_key');
  }

  const encryptedKey = Buffer.from(encodedKey, 'base64');
  const dpapiPrefix = Buffer.from('DPAPI');
  const wrappedKey = encryptedKey.subarray(0, dpapiPrefix.length).equals(dpapiPrefix)
    ? encryptedKey.subarray(dpapiPrefix.length)
    : encryptedKey;

  return Buffer.from(await decryptMasterKey(wrappedKey));
}

export async function importBrowserCookies(
  options: BrowserCookieImportOptions,
): Promise<ImportedCookie[]> {
  const resolved = resolveChromiumProfile(options, options.env);
  if (!existsSync(resolved.localStatePath)) {
    throw new Error(`Chromium Local State file was not found at ${resolved.localStatePath}`);
  }
  if (!existsSync(resolved.cookiesDbPath)) {
    throw new Error(`Chromium cookies database was not found at ${resolved.cookiesDbPath}`);
  }

  const tempDir = mkdtempSync(join(tmpdir(), 'pbinfo-browser-cookies-'));
  const tempCookiesPath = join(tempDir, 'Cookies');
  /* v8 ignore next -- the real DPAPI fallback runs only against live browser profiles */
  const decrypt = options.decryptMasterKey ?? decryptDpapiBuffer;
  try {
    try {
      (options.copyFile ?? copyFileSync)(resolved.cookiesDbPath, tempCookiesPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Could not copy Chromium cookies database from ${resolved.cookiesDbPath}: ${message}`,
      );
    }

    const masterKey = await unwrapChromiumMasterKey(
      readFileSync(resolved.localStatePath, 'utf8'),
      decrypt,
    );
    const database = new DatabaseSync(tempCookiesPath, {
      readOnly: true,
      allowExtension: false,
    });
    try {
      const rows = database
        .prepare(`SELECT
          host_key,
          name,
          value,
          encrypted_value,
          path,
          CAST(expires_utc AS TEXT) AS expires_utc,
          is_httponly,
          is_secure,
          samesite
        FROM cookies`)
        .all() as Array<Record<string, unknown>>;

      const domainFilter = (options.domainFilter ?? 'pbinfo.ro').toLowerCase();
      const cookies: ImportedCookie[] = [];
      for (const row of rows.map(coerceBrowserCookieRow)) {
        const domain = row.host_key.toLowerCase();
        if (!domain.includes(domainFilter)) {
          continue;
        }

        const encryptedValue = Buffer.from(row.encrypted_value);
        let value = row.value;
        if (!value) {
          try {
            value = decryptChromiumCookieValue(encryptedValue, masterKey, decrypt);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(
              `Could not decrypt Chromium cookie "${row.name}" for ${row.host_key}: ${message}. ` +
              'This usually means the browser uses app-bound encryption that cannot be exported from this profile. ' +
              'Use `npm run cli -- auth login` (credentials strategy) or import a plain JSON cookie export instead.',
            );
          }
        }
        cookies.push({
          name: row.name,
          value,
          domain: row.host_key,
          path: row.path || '/',
          expires: normalizeChromiumExpiry(row.expires_utc),
          httpOnly: Boolean(Number(row.is_httponly)),
          secure: Boolean(Number(row.is_secure)),
          sameSite: normalizeChromiumSameSite(Number(row.samesite)),
        });
      }

      return cookies;
    } finally {
      database.close();
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function resolveDefaultChromiumUserDataDir(
  browser: SupportedChromiumBrowser,
  env: NodeJS.ProcessEnv,
): string {
  const localAppData = env.LOCALAPPDATA;
  if (!localAppData) {
    throw new Error('LOCALAPPDATA must be set to resolve Chromium browser profiles');
  }

  const browserPath =
    browser === 'edge'
      ? join(localAppData, 'Microsoft', 'Edge', 'User Data')
      : join(localAppData, 'Google', 'Chrome', 'User Data');

  return resolve(browserPath);
}

function normalizeChromiumExpiry(
  chromiumMicroseconds?: string | number | bigint,
): number | undefined {
  /* v8 ignore next 3 -- coerceBrowserCookieRow always yields a defined expires_utc value */
  if (chromiumMicroseconds === undefined) {
    return undefined;
  }

  const chromiumValue = BigInt(chromiumMicroseconds);
  if (chromiumValue <= 0n) {
    return undefined;
  }

  const unixSeconds = Number(chromiumValue / 1_000_000n - 11_644_473_600n);
  return unixSeconds > 0 ? unixSeconds : undefined;
}

function coerceBrowserCookieRow(row: Record<string, unknown>): BrowserCookieRow {
  return {
    host_key: String(row.host_key ?? ''),
    name: String(row.name ?? ''),
    value: String(row.value ?? ''),
    encrypted_value:
      row.encrypted_value instanceof Uint8Array
        ? row.encrypted_value
        : new Uint8Array(),
    path: String(row.path ?? '/'),
    // The cookies query CASTs expires_utc to TEXT, so it arrives as a string (or
    // null for absent rows, which falls back to 0).
    expires_utc: typeof row.expires_utc === 'string' ? row.expires_utc : 0,
    is_httponly:
      typeof row.is_httponly === 'number' || typeof row.is_httponly === 'bigint'
        ? row.is_httponly
        : 0,
    is_secure:
      typeof row.is_secure === 'number' || typeof row.is_secure === 'bigint'
        ? row.is_secure
        : 0,
    samesite:
      typeof row.samesite === 'number' || typeof row.samesite === 'bigint'
        ? row.samesite
        : 0,
  };
}

function normalizeChromiumSameSite(value: number): 'lax' | 'strict' | 'none' {
  switch (value) {
    case 2:
      return 'strict';
    case 0:
    case 1:
    default:
      return 'lax';
  }
}

function decryptChromiumCookieValue(
  encryptedValue: Buffer,
  masterKey: Buffer,
  decryptLegacyValue: (wrappedKey: Buffer) => Buffer | Promise<Buffer>,
): string {
  if (encryptedValue.length === 0) {
    return '';
  }

  const prefix = encryptedValue.subarray(0, 3).toString('utf8');
  if (prefix === 'v10' || prefix === 'v11' || prefix === 'v20') {
    const nonce = encryptedValue.subarray(3, 15);
    const tag = encryptedValue.subarray(encryptedValue.length - 16);
    const ciphertext = encryptedValue.subarray(15, encryptedValue.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', masterKey, nonce, { authTagLength: 16 });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  const legacyValue = decryptLegacyValue(encryptedValue);
  if (legacyValue instanceof Promise) {
    throw new Error('Legacy DPAPI cookie decryption must be synchronous');
  }

  return legacyValue.toString('utf8');
}

/* v8 ignore start -- Windows DPAPI OS boundary: requires real CurrentUser-encrypted
   data and a live powershell host, so it is exercised only against real browser
   profiles. All callers accept an injectable decryptMasterKey for testing. */
function decryptDpapiBuffer(encryptedValue: Buffer): Buffer {
  const script =
    'Add-Type -AssemblyName System.Security;' +
    `$bytes=[Convert]::FromBase64String('${encryptedValue.toString('base64')}');` +
    '$plain=[System.Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);' +
    '[Console]::Out.Write([Convert]::ToBase64String($plain))';
  const output = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { encoding: 'utf8' },
  ).trim();
  return Buffer.from(output, 'base64');
}
/* v8 ignore stop */
