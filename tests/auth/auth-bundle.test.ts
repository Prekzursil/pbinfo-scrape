import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import * as age from 'age-encryption';
import { afterEach, describe, expect, test } from 'vitest';

import {
  createEncryptedAuthBundle,
  restoreEncryptedAuthBundle,
} from '../../src/auth/auth-bundle.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('auth bundle', () => {
  test('encrypts and restores local auth config and session cookies through age bundles', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-auth-bundle-'));
    tempDirs.push(workspaceRoot);

    const localRoot = join(workspaceRoot, '.local');
    mkdirSync(localRoot, { recursive: true });
    writeFileSync(
      join(localRoot, 'pbinfo.local.json'),
      JSON.stringify(
        {
          auth: {
            strategy: 'credentials',
            username: 'Prekzursil',
            password: 'TEST_PASSWORD_123',
          },
        },
        null,
        2,
      ),
      'utf8',
    );
    writeFileSync(
      join(localRoot, 'session-cookies.json'),
      JSON.stringify(
        [{ key: 'SESSION_ID', value: 'abc123', domain: 'www.pbinfo.ro', path: '/' }],
        null,
        2,
      ),
      'utf8',
    );

    const identity = await age.generateIdentity();
    const recipient = await age.identityToRecipient(identity);
    const identityPath = join(localRoot, 'age.txt');
    writeFileSync(identityPath, identity, 'utf8');

    const created = await createEncryptedAuthBundle({
      workspaceRoot,
      recipient,
    });

    expect(created.bundlePath).toBe(join(workspaceRoot, 'archive', 'secrets', 'pbinfo-auth.age'));
    expect(readFileSync(created.bundlePath, 'utf8')).toContain('BEGIN AGE ENCRYPTED FILE');

    rmSync(join(localRoot, 'pbinfo.local.json'));
    rmSync(join(localRoot, 'session-cookies.json'));

    const restored = await restoreEncryptedAuthBundle({
      workspaceRoot,
      sourcePath: created.bundlePath,
      identityPath,
    });

    expect(restored.restored).toBe(true);
    expect(existsSync(join(localRoot, 'pbinfo.local.json'))).toBe(true);
    expect(JSON.parse(readFileSync(join(localRoot, 'session-cookies.json'), 'utf8'))).toEqual([
      expect.objectContaining({
        key: 'SESSION_ID',
        value: 'abc123',
      }),
    ]);
  });
});
