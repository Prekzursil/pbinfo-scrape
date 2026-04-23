import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { bootstrapAuth } from '../../src/auth/bootstrap.js';
import type { LoadedLocalConfig } from '../../src/config/local-config.js';
import type { CredentialLoginResult } from '../../src/auth/pbinfo-auth.js';
import type { PbinfoAuthStatusResult } from '../../src/auth/auth-status.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeWorkspace(configPayload?: Record<string, unknown>): string {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-bootstrap-'));
  tempDirs.push(workspaceRoot);
  mkdirSync(join(workspaceRoot, '.local'), { recursive: true });
  if (configPayload) {
    writeFileSync(
      join(workspaceRoot, '.local', 'pbinfo.local.json'),
      JSON.stringify(configPayload, null, 2),
      'utf8',
    );
  }
  return workspaceRoot;
}

function makeProbeResult(
  overrides: Partial<PbinfoAuthStatusResult>,
): PbinfoAuthStatusResult {
  return {
    status: 'guest',
    loggedIn: false,
    configuredHandle: 'prekzursil',
    resolvedHandle: undefined,
    handleMatchesConfigured: false,
    cookieFileExists: false,
    sessionCookiesPath: '/tmp/cookies.json',
    probeUrl: 'http://example.test/',
    checkedAt: new Date().toISOString(),
    remediation: [],
    ...overrides,
  };
}

function makeLoginResult(
  overrides: Partial<CredentialLoginResult>,
): CredentialLoginResult {
  return {
    success: true,
    resolvedHandle: 'Prekzursil',
    sessionCookies: [
      {
        key: 'SSID',
        value: 'fresh',
        domain: 'www.pbinfo.ro',
        path: '/',
      },
    ],
    ...overrides,
  };
}

describe('bootstrapAuth', () => {
  test('returns already-authenticated when probe reports ok', async () => {
    const workspaceRoot = makeWorkspace({
      auth: {
        strategy: 'credentials',
        username: 'Prekzursil',
        password: 'hunter2',
        sessionCookiesPath: '.local/session-cookies.json',
      },
      crawl: { userHandle: 'Prekzursil' },
    });

    let loginCalls = 0;
    let sealCalls = 0;
    const result = await bootstrapAuth({
      workspaceRoot,
      env: {},
      probe: async () =>
        makeProbeResult({
          status: 'ok',
          loggedIn: true,
          resolvedHandle: 'prekzursil',
          handleMatchesConfigured: true,
        }),
      authClientFactory: () => ({
        loginWithCredentials: async () => {
          loginCalls += 1;
          return makeLoginResult({});
        },
      }),
      sealBundle: async () => {
        sealCalls += 1;
        return { bundlePath: '' };
      },
    });

    expect(result.status).toBe('already-authenticated');
    expect(result.resolvedHandle).toBe('prekzursil');
    expect(result.sealedBundle).toBe(false);
    expect(loginCalls).toBe(0);
    expect(sealCalls).toBe(0);
  });

  test('returns skipped-no-credentials when no env vars and no file creds', async () => {
    const workspaceRoot = makeWorkspace({
      auth: {
        strategy: 'cookie-import',
        sessionCookiesPath: '.local/session-cookies.json',
      },
      crawl: { userHandle: 'Prekzursil' },
    });

    const result = await bootstrapAuth({
      workspaceRoot,
      env: {},
      probe: async () => makeProbeResult({ status: 'cookie-missing' }),
      authClientFactory: () => ({
        loginWithCredentials: async () => {
          throw new Error('must not be called without credentials');
        },
      }),
      sealBundle: async () => ({ bundlePath: '' }),
    });

    expect(result.status).toBe('skipped-no-credentials');
    expect(result.credentialsSource).toBe('none');
    expect(result.sealedBundle).toBe(false);
    expect(result.failureReason).toMatch(/No PBInfo credentials/);
  });

  test('logs in with file credentials when probe returns guest, seals bundle', async () => {
    const workspaceRoot = makeWorkspace({
      auth: {
        strategy: 'credentials',
        username: 'Prekzursil',
        password: 'Prekzursil1234',
        sessionCookiesPath: '.local/session-cookies.json',
      },
      crawl: { userHandle: 'Prekzursil' },
    });

    const loginCalls: Array<{ username: string; password: string }> = [];
    let sealCalls = 0;
    const result = await bootstrapAuth({
      workspaceRoot,
      env: {},
      probe: async () => makeProbeResult({ status: 'guest' }),
      authClientFactory: () => ({
        loginWithCredentials: async (input) => {
          loginCalls.push(input);
          return makeLoginResult({ resolvedHandle: 'Prekzursil' });
        },
      }),
      sealBundle: async () => {
        sealCalls += 1;
        return { bundlePath: 'archive/secrets/auth-bundle.age' };
      },
    });

    expect(result.status).toBe('logged-in-fresh');
    expect(result.credentialsSource).toBe('file');
    expect(result.sealedBundle).toBe(true);
    expect(result.resolvedHandle).toBe('Prekzursil');
    expect(loginCalls.length).toBe(1);
    expect(loginCalls[0]?.username).toBe('Prekzursil');
    expect(loginCalls[0]?.password).toBe('Prekzursil1234');
    expect(sealCalls).toBe(1);
  });

  test('prefers env vars over file credentials', async () => {
    const workspaceRoot = makeWorkspace({
      auth: {
        strategy: 'credentials',
        username: 'file-user',
        password: 'file-pass',
        sessionCookiesPath: '.local/session-cookies.json',
      },
      crawl: { userHandle: 'Prekzursil' },
    });

    const seen: Array<{ username: string; password: string }> = [];
    const result = await bootstrapAuth({
      workspaceRoot,
      env: {
        PBINFO_USERNAME: 'env-user',
        PBINFO_PASSWORD: 'env-pass',
      },
      probe: async () => makeProbeResult({ status: 'guest' }),
      authClientFactory: () => ({
        loginWithCredentials: async (input) => {
          seen.push(input);
          return makeLoginResult({ resolvedHandle: 'env-user' });
        },
      }),
      sealBundle: async () => ({ bundlePath: '' }),
    });

    expect(result.credentialsSource).toBe('env');
    expect(seen[0]?.username).toBe('env-user');
    expect(seen[0]?.password).toBe('env-pass');
    expect(result.status).toBe('logged-in-fresh');
  });

  test('returns login-failed when PbinfoAuthClient reports failure', async () => {
    const workspaceRoot = makeWorkspace({
      auth: {
        strategy: 'credentials',
        username: 'Prekzursil',
        password: 'wrong',
        sessionCookiesPath: '.local/session-cookies.json',
      },
      crawl: { userHandle: 'Prekzursil' },
    });

    let sealCalls = 0;
    const result = await bootstrapAuth({
      workspaceRoot,
      env: {},
      probe: async () => makeProbeResult({ status: 'guest' }),
      authClientFactory: () => ({
        loginWithCredentials: async () =>
          makeLoginResult({
            success: false,
            failureReason: 'bad password',
          }),
      }),
      sealBundle: async () => {
        sealCalls += 1;
        return { bundlePath: '' };
      },
    });

    expect(result.status).toBe('login-failed');
    expect(result.sealedBundle).toBe(false);
    expect(result.failureReason).toBe('bad password');
    expect(sealCalls).toBe(0);
  });

  test('never includes password in the result object', async () => {
    const workspaceRoot = makeWorkspace({
      auth: {
        strategy: 'credentials',
        username: 'Prekzursil',
        password: 'super-secret',
        sessionCookiesPath: '.local/session-cookies.json',
      },
      crawl: { userHandle: 'Prekzursil' },
    });

    const result = await bootstrapAuth({
      workspaceRoot,
      env: {},
      probe: async () => makeProbeResult({ status: 'guest' }),
      authClientFactory: () => ({
        loginWithCredentials: async () => makeLoginResult({}),
      }),
      sealBundle: async () => ({ bundlePath: '' }),
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('super-secret');
  });
});
