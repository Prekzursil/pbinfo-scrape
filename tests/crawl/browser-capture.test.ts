import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const addCookies = vi.fn(async () => undefined);
  const pageClose = vi.fn(async () => undefined);
  const content = vi.fn(async () => '<html>captured</html>');
  const waitForLoadState = vi.fn(async () => undefined);
  const goto = vi.fn(async () => undefined);
  const browserClose = vi.fn(async () => undefined);
  return { addCookies, pageClose, content, waitForLoadState, goto, browserClose };
});

vi.mock('playwright', () => {
  const page = {
    goto: mocks.goto,
    waitForLoadState: mocks.waitForLoadState,
    content: mocks.content,
    close: mocks.pageClose,
  };
  const context = {
    newPage: async () => page,
    addCookies: mocks.addCookies,
  };
  const browser = {
    newContext: async () => context,
    close: mocks.browserClose,
  };
  return { chromium: { launch: async () => browser } };
});

const { createPlaywrightBrowserCapture } = await import('../../src/crawl/browser-capture.js');

const tempDirs: string[] = [];

beforeEach(() => {
  mocks.addCookies.mockClear();
  mocks.waitForLoadState.mockReset();
  mocks.waitForLoadState.mockResolvedValue(undefined);
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function cookieFile(value: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), 'pbinfo-browser-'));
  tempDirs.push(dir);
  const path = join(dir, 'cookies.json');
  writeFileSync(path, JSON.stringify(value), 'utf8');
  return path;
}

describe('createPlaywrightBrowserCapture', () => {
  test('captures page html and closes without seeding cookies', async () => {
    const capture = await createPlaywrightBrowserCapture();
    const html = await capture.captureHtml('https://example.com');
    expect(html).toBe('<html>captured</html>');
    await capture.close();
    expect(mocks.addCookies).not.toHaveBeenCalled();
  });

  test('seeds cookies from a session file across same-site and expiry variants', async () => {
    const path = cookieFile([
      { key: 'a', value: '1', domain: 'x.com', expires: 123, sameSite: 'strict', httpOnly: true, secure: true, path: '/p' },
      { key: 'b', value: '2', domain: '.y.com', expires: 'never', sameSite: 'none' },
      { key: 'c', value: '3', domain: 'z.com', sameSite: 'lax' },
      { key: 'd', value: '4', domain: 'w.com' },
      { value: '5', domain: 'no-key.com' },
      { key: 'e', domain: 'no-val.com' },
      { key: 'f', value: '6' },
    ]);
    await createPlaywrightBrowserCapture(path);
    expect(mocks.addCookies).toHaveBeenCalledTimes(1);
    const seeded = (mocks.addCookies.mock.calls[0] as unknown[] | undefined)?.[0] as Array<{ name: string; sameSite: string; expires?: number }>;
    expect(seeded.map((c) => c.name)).toEqual(['a', 'b', 'c', 'd']);
    expect(seeded[0]?.sameSite).toBe('Strict');
    expect(seeded[1]?.sameSite).toBe('None');
    expect(seeded[3]?.sameSite).toBe('Lax');
    expect(seeded[0]?.expires).toBe(123);
    expect(seeded[1]?.expires).toBeUndefined();
  });

  test('does not call addCookies when every cookie is invalid', async () => {
    const path = cookieFile([{ value: 'x', domain: 'd.com' }]);
    await createPlaywrightBrowserCapture(path);
    expect(mocks.addCookies).not.toHaveBeenCalled();
  });

  test('ignores a missing session cookie file', async () => {
    await createPlaywrightBrowserCapture(join(tmpdir(), 'does-not-exist-cookies.json'));
    expect(mocks.addCookies).not.toHaveBeenCalled();
  });

  test('swallows a load-state timeout during capture', async () => {
    mocks.waitForLoadState.mockRejectedValueOnce(new Error('timeout'));
    const capture = await createPlaywrightBrowserCapture();
    await expect(capture.captureHtml('https://example.com')).resolves.toBe('<html>captured</html>');
  });
});
