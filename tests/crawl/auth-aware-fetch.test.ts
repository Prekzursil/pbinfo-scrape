import { describe, expect, test } from 'vitest';

import { createAuthAwareFetch } from '../../src/crawl/auth-aware-fetch.js';

describe('createAuthAwareFetch', () => {
  test('passes responses through unchanged when session is healthy', async () => {
    let baseCalls = 0;
    let reauthCalls = 0;
    const aware = createAuthAwareFetch({
      baseFetch: async () => {
        baseCalls += 1;
        return new Response('<html>ok</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
      },
      reauth: async () => {
        reauthCalls += 1;
        return true;
      },
    });

    const response = await aware.fetch('https://www.pbinfo.ro/probleme/1/sum');
    expect(response.status).toBe(200);
    expect(baseCalls).toBe(1);
    expect(reauthCalls).toBe(0);
  });

  test('triggers reauth and retries when final URL contains pagina=login', async () => {
    let call = 0;
    let reauthCalls = 0;
    const aware = createAuthAwareFetch({
      baseFetch: async () => {
        call += 1;
        if (call === 1) {
          const loggedOut = new Response('<html>please log in</html>', {
            status: 200,
            headers: { 'content-type': 'text/html' },
          });
          // Simulate fetch's redirect-follow chain — response.url becomes the
          // final URL after following the 302 to the login page.
          Object.defineProperty(loggedOut, 'url', {
            value: 'https://www.pbinfo.ro/?pagina=login',
          });
          return loggedOut;
        }
        return new Response('<html>restored</html>', { status: 200 });
      },
      reauth: async () => {
        reauthCalls += 1;
        return true;
      },
    });

    const response = await aware.fetch('https://www.pbinfo.ro/detalii-evaluare/1');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<html>restored</html>');
    expect(call).toBe(2);
    expect(reauthCalls).toBe(1);
    expect(aware.getReauthCount()).toBe(1);
  });

  test('does not retry when reauth fails; returns the original logged-out response', async () => {
    let call = 0;
    const aware = createAuthAwareFetch({
      baseFetch: async () => {
        call += 1;
        return new Response('<html>login</html>', { status: 200 });
      },
      reauth: async () => false,
      detectLoggedOut: () => true,
    });

    const response = await aware.fetch('https://www.pbinfo.ro/x');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('<html>login</html>');
    expect(call).toBe(1);
    expect(aware.getReauthCount()).toBe(1);
  });

  test('parallel logged-out requests share a single reauth', async () => {
    let reauthCalls = 0;
    let resolveReauth: (() => void) | null = null;
    const reauthDone = new Promise<void>((resolve) => {
      resolveReauth = resolve;
    });

    let baseCalls = 0;
    const aware = createAuthAwareFetch({
      baseFetch: async () => {
        baseCalls += 1;
        if (baseCalls <= 3) {
          return new Response('login', { status: 200 });
        }
        return new Response('ok', { status: 200 });
      },
      reauth: async () => {
        reauthCalls += 1;
        await reauthDone;
        return true;
      },
      detectLoggedOut: ({ response }) =>
        baseCalls <= 3 && response.status === 200,
    });

    const pending = Promise.all([
      aware.fetch('https://www.pbinfo.ro/a'),
      aware.fetch('https://www.pbinfo.ro/b'),
      aware.fetch('https://www.pbinfo.ro/c'),
    ]);

    // Let the in-flight reauth run.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(reauthCalls).toBe(1);
    resolveReauth!();

    const responses = await pending;
    expect(responses.every((r) => r.status === 200)).toBe(true);
    expect(reauthCalls).toBe(1);
  });

  test('body-based detection finds user_autentificat id:0 when readBody is true', async () => {
    let call = 0;
    const aware = createAuthAwareFetch({
      baseFetch: async () => {
        call += 1;
        if (call === 1) {
          return new Response(
            '<script>user_autentificat = {"id":0};</script>',
            { status: 200 },
          );
        }
        return new Response('<script>user_autentificat = {"id":42};</script>', {
          status: 200,
        });
      },
      reauth: async () => true,
      readBody: true,
    });

    const response = await aware.fetch('https://www.pbinfo.ro/detalii-evaluare/1');
    const text = await response.text();
    expect(text).toContain('"id":42');
    expect(call).toBe(2);
  });

  test('body-based detection finds form-login marker when readBody is true', async () => {
    let call = 0;
    const aware = createAuthAwareFetch({
      baseFetch: async () => {
        call += 1;
        if (call === 1) {
          return new Response('<form id="form-login">...</form>', { status: 200 });
        }
        return new Response('<html>post-login</html>', { status: 200 });
      },
      reauth: async () => true,
      readBody: true,
    });

    const response = await aware.fetch('https://www.pbinfo.ro/detalii-evaluare/1');
    expect(await response.text()).toBe('<html>post-login</html>');
    expect(call).toBe(2);
  });
});
