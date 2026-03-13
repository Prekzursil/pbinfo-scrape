import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { PbinfoAuthClient, extractLoginForm } from '../../src/auth/pbinfo-auth.js';

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

describe('pbinfo auth', () => {
  test('extracts the login form action and form token', () => {
    const form = extractLoginForm(`
      <form id="form-login" action="/login.php" method="post">
        <input type="hidden" name="form_token" value="abc123">
        <input type="text" name="user">
        <input type="password" name="parola">
      </form>
    `);

    expect(form).toEqual({
      action: '/login.php',
      formToken: 'abc123',
    });
  });

  test('logs in with credentials and persists the resulting cookies', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pbinfo-auth-'));
    tempDirs.push(dir);
    const sessionPath = join(dir, 'session-cookies.json');

    const server = createServer((request, response) => {
      if (request.method === 'GET' && request.url === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end(`
          <form id="form-login" action="/login.php" method="post">
            <input type="hidden" name="form_token" value="token-123">
            <input type="text" name="user">
            <input type="password" name="parola">
          </form>
        `);
        return;
      }

      if (request.method === 'POST' && request.url === '/login.php') {
        let body = '';
        request.on('data', (chunk) => {
          body += chunk.toString();
        });
        request.on('end', () => {
          expect(body).toContain('user=Prekzursil');
          expect(body).toContain('parola=TEST_PASSWORD_123');
          expect(body).toContain('form_token=token-123');
          response.statusCode = 302;
          response.setHeader('Set-Cookie', 'SESSION_ID=abc123; Path=/; HttpOnly');
          response.setHeader('Location', '/profil/Prekzursil');
          response.end();
        });
        return;
      }

      if (request.method === 'GET' && request.url === '/profil/Prekzursil') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<h1>Profil Prekzursil</h1>');
        return;
      }

      response.statusCode = 404;
      response.end('not found');
    });
    servers.push(server);

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new TypeError('server address is not available');
    }

    const client = new PbinfoAuthClient({
      baseUrl: `http://127.0.0.1:${address.port}`,
      sessionCookiesPath: sessionPath,
    });

    const result = await client.loginWithCredentials({
      username: 'Prekzursil',
      password: 'TEST_PASSWORD_123',
    });

    expect(result.success).toBe(true);
    expect(result.redirectUrl).toContain('/profil/Prekzursil');
    expect(JSON.parse(readFileSync(sessionPath, 'utf8'))).toEqual([
      expect.objectContaining({
        key: 'SESSION_ID',
        value: 'abc123',
        domain: '127.0.0.1',
        path: '/',
      }),
    ]);
  });
});
