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

  test('logs in through the PBInfo ajax endpoint and persists the resulting cookies', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pbinfo-auth-'));
    tempDirs.push(dir);
    const sessionPath = join(dir, 'session-cookies.json');

    const server = createServer((request, response) => {
      if (request.method === 'GET' && request.url === '/') {
        response.setHeader('Content-Type', 'text/html');
        if (request.headers.cookie?.includes('SESSION_ID=abc123')) {
          response.end(`
            <script>var user_autentificat = {"id":123,"username":"Prekzursil"};</script>
            <nav>
              <a href="/profil/Prekzursil">Profil</a>
              <a href="/logout">Logout</a>
            </nav>
            <h1>Profil Prekzursil</h1>
          `);
          return;
        }
        response.end(`
          <form id="form-login" action="/login.php" method="post">
            <input type="hidden" name="form_token" value="token-123">
            <input type="text" name="user">
            <input type="password" name="parola">
          </form>
        `);
        return;
      }

      if (request.method === 'POST' && request.url === '/ajx-module/php-login.php') {
        let body = '';
        request.on('data', (chunk) => {
          body += chunk.toString();
        });
        request.on('end', () => {
          expect(request.headers['x-requested-with']).toBe('XMLHttpRequest');
          expect(body).toContain('user=Prekzursil');
          expect(body).toContain('parola=TEST_PASSWORD_123');
          expect(body).toContain('form_token=token-123');
          response.setHeader('Content-Type', 'application/json');
          response.setHeader('Set-Cookie', 'SESSION_ID=abc123; Path=/; HttpOnly');
          response.end(JSON.stringify({
            stare: 'success',
            raspuns: 'Autentificare cu success!',
          }));
        });
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
    expect(result.redirectUrl).toBe(`http://127.0.0.1:${address.port}/`);
    expect(JSON.parse(readFileSync(sessionPath, 'utf8'))).toEqual([
      expect.objectContaining({
        key: 'SESSION_ID',
        value: 'abc123',
        domain: '127.0.0.1',
        path: '/',
      }),
    ]);
  });

  test('treats ajax success that still resolves to guest as failed login and does not persist guest cookies', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pbinfo-auth-'));
    tempDirs.push(dir);
    const sessionPath = join(dir, 'session-cookies.json');

    const server = createServer((request, response) => {
      if (request.method === 'GET' && request.url === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end(`
          <script>var user_autentificat = {"id":0};</script>
          <form id="form-login" action="/login.php" method="post">
            <input type="hidden" name="form_token" value="token-guest">
            <input type="text" name="user">
            <input type="password" name="parola">
          </form>
        `);
        return;
      }

      if (request.method === 'POST' && request.url === '/ajx-module/php-login.php') {
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Set-Cookie', 'SESSION_ID=guest-cookie; Path=/; HttpOnly');
        response.end(JSON.stringify({
          stare: 'success',
          raspuns: 'Autentificare cu success!',
        }));
        return;
      }

      if (request.method === 'GET' && request.url === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end(`
          <script>var user_autentificat = {"id":0};</script>
          <form id="form-login" action="/login.php" method="post">
            <input type="hidden" name="form_token" value="token-guest">
            <input type="text" name="user">
            <input type="password" name="parola">
          </form>
        `);
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
      password: 'WRONG_PASSWORD',
    });

    expect(result.success).toBe(false);
    expect(result.failureReason).toContain('guest');
    expect(() => readFileSync(sessionPath, 'utf8')).toThrow();
  });

  test('does not accept ajax login when the follow-up page is still guest but contains unrelated profile links', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pbinfo-auth-'));
    tempDirs.push(dir);
    const sessionPath = join(dir, 'session-cookies.json');

    let loginCompleted = false;
    const server = createServer((request, response) => {
      if (request.method === 'GET' && request.url === '/') {
        response.setHeader('Content-Type', 'text/html');
        if (loginCompleted) {
          response.end(`
            <script>var user_autentificat = {"id":0};</script>
            <nav id="bara_navigare">
              <a href="/profil/SomeContestUser">Some Contest User</a>
            </nav>
          `);
          return;
        }

        response.end(`
          <script>var user_autentificat = {"id":0};</script>
          <form id="form-login" action="/login.php" method="post">
            <input type="hidden" name="form_token" value="token-false-positive">
            <input type="text" name="user">
            <input type="password" name="parola">
          </form>
        `);
        return;
      }

      if (request.method === 'POST' && request.url === '/ajx-module/php-login.php') {
        loginCompleted = true;
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Set-Cookie', 'SESSION_ID=guest-cookie; Path=/; HttpOnly');
        response.end(JSON.stringify({
          stare: 'success',
          raspuns: 'Autentificare cu success!',
        }));
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
      password: 'PASSWORD',
    });

    expect(result.success).toBe(false);
    expect(result.failureReason).toContain('guest');
    expect(result.resolvedHandle).toBeUndefined();
    expect(() => readFileSync(sessionPath, 'utf8')).toThrow();
  });

  test('surfaces ajax login failure messages without persisting cookies', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pbinfo-auth-'));
    tempDirs.push(dir);
    const sessionPath = join(dir, 'session-cookies.json');

    const server = createServer((request, response) => {
      if (request.method === 'GET' && request.url === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end(`
          <script>var user_autentificat = {"id":0};</script>
          <form id="form-login" action="/login.php" method="post">
            <input type="hidden" name="form_token" value="token-failure">
            <input type="text" name="user">
            <input type="password" name="parola">
          </form>
        `);
        return;
      }

      if (request.method === 'POST' && request.url === '/ajx-module/php-login.php') {
        response.setHeader('Content-Type', 'application/json');
        response.end(JSON.stringify({
          stare: 'danger',
          raspuns: 'Utilizator sau parola este greșită.',
          form_token: 'token-new',
        }));
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
      password: 'WRONG_PASSWORD',
    });

    expect(result.success).toBe(false);
    expect(result.failureReason).toContain('greșită');
    expect(() => readFileSync(sessionPath, 'utf8')).toThrow();
  });
});
