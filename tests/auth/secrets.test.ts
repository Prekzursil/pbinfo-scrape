import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import * as age from 'age-encryption';
import { afterEach, describe, expect, test } from 'vitest';

import type { LoadedLocalConfig } from '../../src/config/local-config.js';
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

function makeConfig(root: string, overrides: Partial<LoadedLocalConfig['secrets']> = {}): LoadedLocalConfig {
  const localRoot = join(root, '.local');
  mkdirSync(localRoot, { recursive: true });
  return {
    paths: { localRoot },
    auth: { sessionCookiesPath: join(localRoot, 'session-cookies.json') },
    secrets: {
      bundlePath: join(root, 'secrets', 'bundle.age'),
      recipientPath: join(root, 'secrets', 'recipient.txt'),
      identityPath: join(root, 'secrets', 'identity.txt'),
      recipient: undefined,
      ...overrides,
    },
  } as unknown as LoadedLocalConfig;
}

describe('secret bundle bootstrap', () => {
  test('generates a fresh identity when none exists and omits absent cookie/config files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pbinfo-secrets-'));
    tempDirs.push(root);
    const config = makeConfig(root);

    const result = await bootstrapSecretBundle(config, new Date('2024-01-02T03:04:05.000Z'));

    expect(result.createdIdentity).toBe(true);
    expect(existsSync(config.secrets.identityPath)).toBe(true);
    expect(readFileSync(config.secrets.recipientPath, 'utf8')).toContain('age1');

    const payload = await decryptSecretBundle(config);
    expect(payload.exportedAt).toBe('2024-01-02T03:04:05.000Z');
    expect(payload.localConfig).toBeUndefined();
    expect(payload.sessionCookies).toBeUndefined();
  });

  test('reuses an existing identity and existing recipient file, embedding present cookie/config files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pbinfo-secrets-'));
    tempDirs.push(root);
    const config = makeConfig(root);

    const identity = await age.generateIdentity();
    const recipient = await age.identityToRecipient(identity);
    mkdirSync(join(root, 'secrets'), { recursive: true });
    writeFileSync(config.secrets.identityPath, `${identity}\n`, 'utf8');
    writeFileSync(config.secrets.recipientPath, `${recipient}\n`, 'utf8');
    writeFileSync(join(config.paths.localRoot, 'pbinfo.local.json'), JSON.stringify({ a: 1 }), 'utf8');
    writeFileSync(config.auth.sessionCookiesPath, JSON.stringify([{ key: 'k', value: 'v' }]), 'utf8');

    const result = await bootstrapSecretBundle(config);
    expect(result.createdIdentity).toBe(false);
    expect(result.recipient).toBe(recipient);

    const payload = await decryptSecretBundle(config);
    expect(payload.localConfig).toEqual({ a: 1 });
    expect(payload.sessionCookies).toEqual([{ key: 'k', value: 'v' }]);
  });

  test('uses an explicitly configured recipient without reading the recipient file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pbinfo-secrets-'));
    tempDirs.push(root);
    const identity = await age.generateIdentity();
    const recipient = await age.identityToRecipient(identity);
    const config = makeConfig(root, { recipient });
    mkdirSync(join(root, 'secrets'), { recursive: true });
    writeFileSync(config.secrets.identityPath, `${identity}\n`, 'utf8');

    const result = await bootstrapSecretBundle(config);
    expect(result.recipient).toBe(recipient);
  });

  test('restore writes back only the fields present in the decrypted payload', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pbinfo-secrets-'));
    tempDirs.push(root);
    const config = makeConfig(root);
    writeFileSync(join(config.paths.localRoot, 'pbinfo.local.json'), JSON.stringify({ keep: true }), 'utf8');
    await bootstrapSecretBundle(config);

    rmSync(join(config.paths.localRoot, 'pbinfo.local.json'));
    const restored = await restoreSecretBundle(config);
    expect(restored.localConfig).toEqual({ keep: true });
    expect(existsSync(join(config.paths.localRoot, 'pbinfo.local.json'))).toBe(true);
    expect(existsSync(config.auth.sessionCookiesPath)).toBe(false);
  });
});
