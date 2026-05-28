import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const fsState = {
  files: new Map<string, string>(),
};

vi.mock('node:fs', () => ({
  existsSync: (path: string) => fsState.files.has(path),
  readFileSync: (path: string) => {
    const value = fsState.files.get(path);
    if (value === undefined) {
      throw new Error(`unexpected read of ${path}`);
    }
    return value;
  },
}));

const pageContent = vi.fn(async () => '<html>captured</html>');
const pageGoto = vi.fn(async () => undefined);
const pageWaitForLoadState = vi.fn(() => Promise.resolve(undefined));
const pageClose = vi.fn(async () => undefined);
const contextNewPage = vi.fn(async () => ({
  goto: pageGoto,
  waitForLoadState: pageWaitForLoadState,
  content: pageContent,
  close: pageClose,
}));
const contextAddCookies = vi.fn<(cookies: Array<Record<string, unknown>>) => Promise<void>>();
const browserClose = vi.fn(async () => undefined);
const newContext = vi.fn(async () => ({
  newPage: contextNewPage,
  addCookies: contextAddCookies,
}));
const launch = vi.fn(async () => ({
  newContext,
  close: browserClose,
}));

vi.mock('playwright', () => ({
  chromium: {
    launch: () => launch(),
  },
}));

const { createPlaywrightBrowserCapture } = await import('../../src/crawl/browser-capture.js');

beforeEach(() => {
  fsState.files.clear();
  pageWaitForLoadState.mockReturnValue(Promise.resolve(undefined));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('playwright browser capture', () => {
  test('captures page html and closes the page afterwards', async () => {
    const capture = await createPlaywrightBrowserCapture();
    const html = await capture.captureHtml('https://example.test/problem');

    expect(html).toBe('<html>captured</html>');
    expect(pageGoto).toHaveBeenCalledWith('https://example.test/problem', {
      waitUntil: 'domcontentloaded',
    });
    expect(pageClose).toHaveBeenCalledTimes(1);

    await capture.close();
    expect(browserClose).toHaveBeenCalledTimes(1);
  });

  test('swallows network-idle timeout failures and still returns content', async () => {
    pageWaitForLoadState.mockReturnValue(Promise.reject(new Error('idle timeout')));
    const capture = await createPlaywrightBrowserCapture();

    await expect(capture.captureHtml('https://example.test/x')).resolves.toBe(
      '<html>captured</html>',
    );
  });

  test('skips cookie seeding when no path is provided', async () => {
    await createPlaywrightBrowserCapture();
    expect(contextAddCookies).not.toHaveBeenCalled();
  });

  test('skips cookie seeding when the cookie file is missing', async () => {
    await createPlaywrightBrowserCapture('/missing/cookies.json');
    expect(contextAddCookies).not.toHaveBeenCalled();
  });

  test('seeds normalized cookies into the browser context', async () => {
    fsState.files.set(
      '/cookies.json',
      JSON.stringify([
        {
          key: 'session',
          value: 'abc',
          domain: '.pbinfo.ro',
          path: '/app',
          expires: 1893456000,
          httpOnly: true,
          secure: true,
          sameSite: 'Strict',
        },
        {
          // No sameSite provided exercises the `?? 'lax'` default.
          key: 'lax',
          value: 'v',
          domain: 'pbinfo.ro',
        },
        {
          key: 'none-site',
          value: 'v',
          domain: 'pbinfo.ro',
          sameSite: 'none',
          expires: 'never',
        },
        // Filtered out: missing value.
        { key: 'skip', domain: 'pbinfo.ro' },
      ]),
    );

    await createPlaywrightBrowserCapture('/cookies.json');

    expect(contextAddCookies).toHaveBeenCalledTimes(1);
    const cookies = (contextAddCookies.mock.calls[0]?.[0] ?? []) as Array<Record<string, unknown>>;
    expect(cookies).toHaveLength(3);
    expect(cookies[0]).toMatchObject({
      name: 'session',
      domain: '.pbinfo.ro',
      path: '/app',
      expires: 1893456000,
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      url: 'https://pbinfo.ro/app',
    });
    expect(cookies[1]).toMatchObject({
      name: 'lax',
      path: '/',
      sameSite: 'Lax',
      expires: undefined,
      url: 'https://pbinfo.ro/',
    });
    expect(cookies[2]).toMatchObject({ sameSite: 'None', expires: undefined });
  });

  test('does not call addCookies when every cookie is filtered out', async () => {
    fsState.files.set('/empty.json', JSON.stringify([{ key: 'x', domain: 'pbinfo.ro' }]));
    await createPlaywrightBrowserCapture('/empty.json');
    expect(contextAddCookies).not.toHaveBeenCalled();
  });
});
