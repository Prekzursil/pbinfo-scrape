import { existsSync, readFileSync } from 'node:fs';

import { chromium, type BrowserContext } from 'playwright';

interface PersistedCookie {
  key?: string;
  value?: string;
  domain?: string;
  path?: string;
  expires?: number | string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string;
}

export interface BrowserCapture {
  captureHtml: (url: string) => Promise<string>;
  close: () => Promise<void>;
}

export async function createPlaywrightBrowserCapture(
  sessionCookiesPath?: string,
): Promise<BrowserCapture> {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  await seedContextCookies(context, sessionCookiesPath);

  return {
    captureHtml: async (url: string) => {
      const page = await context.newPage();
      try {
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
        });
        await page
          .waitForLoadState('networkidle', {
            timeout: 10_000,
          })
          .catch(() => undefined);
        return await page.content();
      } finally {
        await page.close();
      }
    },
    close: async () => {
      await browser.close();
    },
  };
}

async function seedContextCookies(
  context: BrowserContext,
  sessionCookiesPath?: string,
): Promise<void> {
  if (!sessionCookiesPath || !existsSync(sessionCookiesPath)) {
    return;
  }

  const rawCookies = JSON.parse(readFileSync(sessionCookiesPath, 'utf8')) as PersistedCookie[];
  const cookies = rawCookies
    .filter((cookie) => cookie.key && cookie.value !== undefined && cookie.domain)
    .map((cookie) => ({
      name: cookie.key!,
      value: cookie.value!,
      domain: cookie.domain!,
      path: cookie.path ?? '/',
      expires: typeof cookie.expires === 'number' ? cookie.expires : undefined,
      httpOnly: cookie.httpOnly ?? false,
      secure: cookie.secure ?? false,
      sameSite: normalizeSameSite(cookie.sameSite),
      url: `https://${cookie.domain!.replace(/^\./, '')}${cookie.path ?? '/'}`,
    }));

  if (cookies.length > 0) {
    await context.addCookies(cookies);
  }
}

function normalizeSameSite(value?: string): 'Lax' | 'Strict' | 'None' {
  switch ((value ?? 'lax').toLowerCase()) {
    case 'strict':
      return 'Strict';
    case 'none':
      return 'None';
    default:
      return 'Lax';
  }
}
