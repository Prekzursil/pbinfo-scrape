import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { loadLocalConfig } from '../../src/config/local-config.js';
import { probePbinfoAuthStatus } from '../../src/auth/auth-status.js';

const tempDirs: string[] = [];
const servers: Array<ReturnType<typeof createServer>> = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        }),
    ),
  );

  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('pbinfo auth status probe', () => {
  test('reports cookie-missing when no session cookie file exists', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-auth-status-missing-'));
    tempDirs.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, '.local'), { recursive: true });
    writeFileSync(
      join(workspaceRoot, '.local', 'pbinfo.local.json'),
      JSON.stringify(
        {
          auth: {
            strategy: 'cookie-import',
            sessionCookiesPath: '.local/session-cookies.json',
          },
          crawl: {
            userHandle: 'Prekzursil',
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const result = await probePbinfoAuthStatus(loadLocalConfig(workspaceRoot));

    expect(result.status).toBe('cookie-missing');
    expect(result.loggedIn).toBe(false);
    expect(result.cookieFileExists).toBe(false);
  });

  test('detects guest mode from user_autentificat id 0', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-auth-status-guest-'));
    tempDirs.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, '.local'), { recursive: true });
    writeFileSync(
      join(workspaceRoot, '.local', 'session-cookies.json'),
      JSON.stringify([{ key: 'SSID', value: 'guest', domain: '127.0.0.1', path: '/' }], null, 2),
      'utf8',
    );
    writeFileSync(
      join(workspaceRoot, '.local', 'pbinfo.local.json'),
      JSON.stringify(
        {
          auth: {
            strategy: 'cookie-import',
            sessionCookiesPath: '.local/session-cookies.json',
          },
          crawl: {
            userHandle: 'Prekzursil',
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end('<script>user_autentificat = {"id":0};</script>');
    });
    servers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new TypeError('server address is not available');
    }

    const result = await probePbinfoAuthStatus(loadLocalConfig(workspaceRoot), {
      probeUrl: `http://127.0.0.1:${address.port}/`,
    });

    expect(result.status).toBe('guest');
    expect(result.loggedIn).toBe(false);
    expect(result.resolvedHandle).toBeUndefined();
  });

  test('does not treat unrelated profile links on a guest page as an authenticated session', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-auth-status-guest-profile-link-'));
    tempDirs.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, '.local'), { recursive: true });
    writeFileSync(
      join(workspaceRoot, '.local', 'session-cookies.json'),
      JSON.stringify([{ key: 'SSID', value: 'guest', domain: '127.0.0.1', path: '/' }], null, 2),
      'utf8',
    );
    writeFileSync(
      join(workspaceRoot, '.local', 'pbinfo.local.json'),
      JSON.stringify(
        {
          auth: {
            strategy: 'cookie-import',
            sessionCookiesPath: '.local/session-cookies.json',
          },
          crawl: {
            userHandle: 'Prekzursil',
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end(`
        <script>user_autentificat = {"id":0};</script>
        <nav id="bara_navigare">
          <a href="/profil/SomeContestUser">Some Contest User</a>
        </nav>
      `);
    });
    servers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new TypeError('server address is not available');
    }

    const result = await probePbinfoAuthStatus(loadLocalConfig(workspaceRoot), {
      probeUrl: `http://127.0.0.1:${address.port}/`,
    });

    expect(result.status).toBe('guest');
    expect(result.loggedIn).toBe(false);
    expect(result.resolvedHandle).toBeUndefined();
  });

  test('returns ok for logged-in matching handle', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-auth-status-ok-'));
    tempDirs.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, '.local'), { recursive: true });
    writeFileSync(
      join(workspaceRoot, '.local', 'session-cookies.json'),
      JSON.stringify([{ key: 'SSID', value: 'live', domain: '127.0.0.1', path: '/' }], null, 2),
      'utf8',
    );
    writeFileSync(
      join(workspaceRoot, '.local', 'pbinfo.local.json'),
      JSON.stringify(
        {
          auth: {
            strategy: 'cookie-import',
            sessionCookiesPath: '.local/session-cookies.json',
          },
          crawl: {
            userHandle: 'Prekzursil',
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end(`
        <script>user_autentificat = {"id":42,"username":"Prekzursil"};</script>
        <nav id="bara_navigare"><a href="/profil/Prekzursil">Prekzursil</a></nav>
      `);
    });
    servers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new TypeError('server address is not available');
    }

    const result = await probePbinfoAuthStatus(loadLocalConfig(workspaceRoot), {
      probeUrl: `http://127.0.0.1:${address.port}/`,
    });

    expect(result.status).toBe('ok');
    expect(result.loggedIn).toBe(true);
    expect(result.resolvedHandle).toBe('prekzursil');
    expect(result.handleMatchesConfigured).toBe(true);
  });

  test('reports handle mismatch when authenticated session differs from configured handle', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-auth-status-mismatch-'));
    tempDirs.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, '.local'), { recursive: true });
    writeFileSync(
      join(workspaceRoot, '.local', 'session-cookies.json'),
      JSON.stringify([{ key: 'SSID', value: 'live', domain: '127.0.0.1', path: '/' }], null, 2),
      'utf8',
    );
    writeFileSync(
      join(workspaceRoot, '.local', 'pbinfo.local.json'),
      JSON.stringify(
        {
          auth: {
            strategy: 'cookie-import',
            sessionCookiesPath: '.local/session-cookies.json',
          },
          crawl: {
            userHandle: 'Prekzursil',
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const server = createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end(`
        <script>user_autentificat = {"id":42};</script>
        <nav id="bara_navigare"><a href="/profil/OtherUser">Other User</a></nav>
      `);
    });
    servers.push(server);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new TypeError('server address is not available');
    }

    const result = await probePbinfoAuthStatus(loadLocalConfig(workspaceRoot), {
      probeUrl: `http://127.0.0.1:${address.port}/`,
    });

    expect(result.status).toBe('handle-mismatch');
    expect(result.loggedIn).toBe(true);
    expect(result.resolvedHandle).toBe('otheruser');
    expect(result.handleMatchesConfigured).toBe(false);
  });
});
