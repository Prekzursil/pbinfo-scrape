import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { loadLocalConfig } from '../../src/config/local-config.js';
import { matchesConfiguredHandle, probePbinfoAuthStatus } from '../../src/auth/auth-status.js';

describe('matchesConfiguredHandle', () => {
  test('returns true when no configured handle is required', () => {
    expect(matchesConfiguredHandle(undefined, 'someone')).toBe(true);
    expect(matchesConfiguredHandle('', 'someone')).toBe(true);
  });

  test('returns false when a candidate handle is missing but configured exists', () => {
    expect(matchesConfiguredHandle('alice', undefined)).toBe(false);
    expect(matchesConfiguredHandle('alice', '')).toBe(false);
  });

  test('returns false when one normalized handle ends up empty', () => {
    expect(matchesConfiguredHandle('   ', 'alice')).toBe(false);
    expect(matchesConfiguredHandle('alice', '   ')).toBe(false);
  });

  test('matches a candidate that wraps the configured handle in parens', () => {
    expect(matchesConfiguredHandle('alice', 'Alice Wonderland (alice)')).toBe(true);
  });

  test('returns false when normalized strings differ and parens do not match', () => {
    expect(matchesConfiguredHandle('alice', 'bob')).toBe(false);
    expect(matchesConfiguredHandle('alice', 'Alice (other)')).toBe(false);
  });

  test('matches when both handles are the same after normalization', () => {
    expect(matchesConfiguredHandle('ALICE', 'alice')).toBe(true);
  });
});

describe('probePbinfoAuthStatus without a configured handle', () => {
  const tempDirs: string[] = [];
  const servers: Array<ReturnType<typeof createServer>> = [];

  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
          }),
      ),
    );
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('treats handleMatchesConfigured as true when no userHandle is configured', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-auth-status-no-handle-'));
    tempDirs.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, '.local'), { recursive: true });
    writeFileSync(
      join(workspaceRoot, '.local', 'session-cookies.json'),
      JSON.stringify([{ key: 'SSID', value: 'x', domain: '127.0.0.1', path: '/' }]),
      'utf8',
    );
    writeFileSync(
      join(workspaceRoot, '.local', 'pbinfo.local.json'),
      JSON.stringify({
        auth: { strategy: 'cookie-import', sessionCookiesPath: '.local/session-cookies.json' },
      }),
      'utf8',
    );

    const server = createServer((_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end('<script>user_autentificat = {"id":99,"username":"anyone"};</script>');
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new TypeError('no address');

    const result = await probePbinfoAuthStatus(loadLocalConfig(workspaceRoot), {
      probeUrl: `http://127.0.0.1:${address.port}/`,
    });
    expect(result.status).toBe('ok');
    expect(result.handleMatchesConfigured).toBe(true);
    expect(result.configuredHandle).toBeUndefined();
  });
});
