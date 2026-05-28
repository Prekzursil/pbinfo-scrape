import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import * as age from 'age-encryption';
import { afterEach, describe, expect, test } from 'vitest';

import { loadLocalConfig } from '../../src/config/local-config.js';
import {
  bootstrapSecretBundle,
  decryptSecretBundle,
  restoreSecretBundle,
} from '../../src/auth/secrets.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pbinfo-secrets-'));
  tempDirs.push(dir);
  return dir;
}

describe('secret bundle bootstrap', () => {
  test('generates a fresh identity and recipient when none exist, and skips missing cookies', async () => {
    const workspaceRoot = makeWorkspace();
    const config = loadLocalConfig(workspaceRoot);

    const result = await bootstrapSecretBundle(config, new Date('2026-03-10T00:00:00.000Z'));

    expect(result.createdIdentity).toBe(true);
    expect(existsSync(result.identityPath)).toBe(true);
    expect(existsSync(result.recipientPath)).toBe(true);
    expect(readFileSync(result.bundlePath, 'utf8')).toContain('BEGIN AGE ENCRYPTED FILE');

    const payload = await decryptSecretBundle(config);
    // No session cookies file was present, so it is omitted from the payload.
    expect(payload.sessionCookies).toBeUndefined();
    // No local config json present either.
    expect(payload.localConfig).toBeUndefined();
  });

  test('reuses an existing identity and recipient file and bundles existing files', async () => {
    const workspaceRoot = makeWorkspace();
    const config = loadLocalConfig(workspaceRoot);
    mkdirSync(config.paths.localRoot, { recursive: true });
    writeFileSync(
      join(config.paths.localRoot, 'pbinfo.local.json'),
      JSON.stringify({ auth: { strategy: 'token' } }, null, 2),
      'utf8',
    );
    writeFileSync(
      config.auth.sessionCookiesPath,
      JSON.stringify([{ key: 'SESSION_ID', value: 'v' }], null, 2),
      'utf8',
    );

    const identity = await age.generateIdentity();
    const recipient = await age.identityToRecipient(identity);
    mkdirSync(dirname(config.secrets.identityPath), { recursive: true });
    mkdirSync(dirname(config.secrets.recipientPath), { recursive: true });
    writeFileSync(config.secrets.identityPath, `${identity}\n`, 'utf8');
    writeFileSync(config.secrets.recipientPath, `${recipient}\n`, 'utf8');

    const result = await bootstrapSecretBundle(config);
    expect(result.createdIdentity).toBe(false);
    expect(result.recipient).toBe(recipient);

    const payload = await decryptSecretBundle(config);
    expect(payload.sessionCookies).toEqual([{ key: 'SESSION_ID', value: 'v' }]);
    expect(payload.localConfig).toMatchObject({ auth: { strategy: 'token' } });
  });

  test('derives a recipient from an existing identity when no recipient file or override exists', async () => {
    const workspaceRoot = makeWorkspace();
    const config = loadLocalConfig(workspaceRoot);
    const identity = await age.generateIdentity();
    const expectedRecipient = await age.identityToRecipient(identity);
    mkdirSync(dirname(config.secrets.identityPath), { recursive: true });
    writeFileSync(config.secrets.identityPath, `${identity}\n`, 'utf8');

    const result = await bootstrapSecretBundle(config);
    expect(result.createdIdentity).toBe(false);
    expect(result.recipient).toBe(expectedRecipient);
  });

  test('restores config and cookies from the encrypted bundle', async () => {
    const workspaceRoot = makeWorkspace();
    const config = loadLocalConfig(workspaceRoot);
    mkdirSync(config.paths.localRoot, { recursive: true });
    writeFileSync(
      join(config.paths.localRoot, 'pbinfo.local.json'),
      JSON.stringify({ auth: { strategy: 'token' } }, null, 2),
      'utf8',
    );
    writeFileSync(
      config.auth.sessionCookiesPath,
      JSON.stringify([{ key: 'SESSION_ID', value: 'restored' }], null, 2),
      'utf8',
    );
    await bootstrapSecretBundle(config);

    rmSync(join(config.paths.localRoot, 'pbinfo.local.json'));
    rmSync(config.auth.sessionCookiesPath);

    const payload = await restoreSecretBundle(config);
    expect(payload.sessionCookies).toEqual([{ key: 'SESSION_ID', value: 'restored' }]);
    expect(existsSync(join(config.paths.localRoot, 'pbinfo.local.json'))).toBe(true);
    expect(JSON.parse(readFileSync(config.auth.sessionCookiesPath, 'utf8'))).toEqual([
      { key: 'SESSION_ID', value: 'restored' },
    ]);
  });

  test('restore tolerates a bundle without config or cookies payloads', async () => {
    const workspaceRoot = makeWorkspace();
    const config = loadLocalConfig(workspaceRoot);
    await bootstrapSecretBundle(config);

    const payload = await restoreSecretBundle(config);
    expect(payload.localConfig).toBeUndefined();
    expect(payload.sessionCookies).toBeUndefined();
  });
});
