import { describe, expect, test, vi } from 'vitest';

import { createRateLimitedFetch } from '../../src/workflows/crawl-workflow.js';

describe('createRateLimitedFetch / resolveFetchUrl branches', () => {
  test('passes through a non-pbinfo URL instance without rate-limiting delay', async () => {
    const inner = vi.fn(async () => new Response('ok', { status: 200 }));
    const rateFetch = createRateLimitedFetch(inner as unknown as typeof fetch, 0);

    // URL instance pointing to a non-pbinfo host → bypasses rate-limit queue
    const url = new URL('https://example.com/path');
    await rateFetch(url);

    expect(inner).toHaveBeenCalledWith(url, undefined);
  });

  test('rate-limits a pbinfo URL instance', async () => {
    const inner = vi.fn(async () => new Response('ok', { status: 200 }));
    const rateFetch = createRateLimitedFetch(inner as unknown as typeof fetch, 0);

    const pbUrl = new URL('https://www.pbinfo.ro/some-page');
    await rateFetch(pbUrl);

    expect(inner).toHaveBeenCalledWith(pbUrl, undefined);
  });

  test('resolves URL from a Request object (url property)', async () => {
    const inner = vi.fn(async () => new Response('ok', { status: 200 }));
    const rateFetch = createRateLimitedFetch(inner as unknown as typeof fetch, 0);

    // A Request object has a .url property (non-pbinfo host bypasses queue)
    const req = new Request('https://cdn.example.com/resource');
    await rateFetch(req);

    expect(inner).toHaveBeenCalledWith(req, undefined);
  });

  test('rate-limits a pbinfo Request object', async () => {
    const inner = vi.fn(async () => new Response('ok', { status: 200 }));
    const rateFetch = createRateLimitedFetch(inner as unknown as typeof fetch, 0);

    const req = new Request('https://pbinfo.ro/api/data');
    await rateFetch(req);

    expect(inner).toHaveBeenCalledWith(req, undefined);
  });

  test('bypasses rate-limiting when input has no resolvable URL', async () => {
    const inner = vi.fn(async () => new Response('ok', { status: 200 }));
    const rateFetch = createRateLimitedFetch(inner as unknown as typeof fetch, 0);

    // An object that satisfies RequestInfo but has no url property → return undefined path
    const weirdInput = { url: undefined } as unknown as RequestInfo;
    await rateFetch(weirdInput);

    expect(inner).toHaveBeenCalledWith(weirdInput, undefined);
  });
});
