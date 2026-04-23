import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import {
  buildEvaluationDetailQueueEntries,
  buildUserSolutionsUrl,
  enumerateUserSubmissions,
  type UserSubmissionsEnumeratorCursor,
} from '../../src/crawl/user-submissions-enumerator.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function buildListingHtml(options: {
  totalMatches: number;
  currentOffset: number;
  pageSize: number;
  entries: Array<{ problemId: number; slug: string; name: string; evaluationId: number }>;
}): string {
  const rows = options.entries
    .map(
      (entry) => `
      <tr>
        <td><a href="/profil/Prekzursil">Andrei Visalon (Prekzursil)</a></td>
        <td><a href="/probleme/${entry.problemId}/${entry.slug}">${entry.name}</a></td>
        <td><a href="/detalii-evaluare/${entry.evaluationId}">detalii</a></td>
        <td>100</td>
      </tr>
    `,
    )
    .join('\n');

  return `
    <html>
      <body>
        <div class="bold mb-3">${options.totalMatches}</div>
        <table>${rows}</table>
        <script>
          Paginare(${options.totalMatches}, ${options.currentOffset}, ${options.pageSize});
        </script>
      </body>
    </html>
  `;
}

describe('buildUserSolutionsUrl', () => {
  test('builds a base URL without start for offset 0', () => {
    expect(
      buildUserSolutionsUrl({ userHandle: 'Prekzursil', start: 0 }),
    ).toBe('https://www.pbinfo.ro/solutii/user/Prekzursil');
  });

  test('appends start parameter for nonzero offset', () => {
    expect(
      buildUserSolutionsUrl({ userHandle: 'Prekzursil', start: 250 }),
    ).toBe('https://www.pbinfo.ro/solutii/user/Prekzursil?start=250');
  });

  test('URL-encodes handles containing reserved characters', () => {
    expect(
      buildUserSolutionsUrl({ userHandle: 'user with space' }),
    ).toContain('user%20with%20space');
  });
});

describe('buildEvaluationDetailQueueEntries', () => {
  test('builds evaluation-detail queue entries and dedupes by evaluationId', () => {
    const queue = buildEvaluationDetailQueueEntries([
      {
        user: 'Prekzursil',
        evaluationId: 111,
        problemId: 1,
        problemSlug: 'sum',
        problemName: 'sum',
      },
      {
        user: 'Prekzursil',
        evaluationId: 111,
        problemId: 1,
        problemSlug: 'sum',
        problemName: 'sum',
      },
      {
        user: 'Prekzursil',
        evaluationId: 222,
        problemId: 2,
        problemSlug: 'diff',
        problemName: 'diff',
      },
    ]);

    expect(queue).toHaveLength(2);
    expect(queue[0]).toEqual({
      key: 'evaluation-detail:111',
      url: 'https://www.pbinfo.ro/detalii-evaluare/111',
      kind: 'evaluation-detail',
    });
    expect(queue[1]?.key).toBe('evaluation-detail:222');
  });
});

describe('enumerateUserSubmissions', () => {
  test('walks multiple pages via Paginare metadata and collects all entries', async () => {
    const pages = new Map<string, string>([
      [
        'https://www.pbinfo.ro/solutii/user/Prekzursil',
        buildListingHtml({
          totalMatches: 5,
          currentOffset: 0,
          pageSize: 2,
          entries: [
            { problemId: 1, slug: 'sum', name: 'sum', evaluationId: 101 },
            { problemId: 2, slug: 'diff', name: 'diff', evaluationId: 102 },
          ],
        }),
      ],
      [
        'https://www.pbinfo.ro/solutii/user/Prekzursil?start=2',
        buildListingHtml({
          totalMatches: 5,
          currentOffset: 2,
          pageSize: 2,
          entries: [
            { problemId: 3, slug: 'mul', name: 'mul', evaluationId: 103 },
            { problemId: 4, slug: 'div', name: 'div', evaluationId: 104 },
          ],
        }),
      ],
      [
        'https://www.pbinfo.ro/solutii/user/Prekzursil?start=4',
        buildListingHtml({
          totalMatches: 5,
          currentOffset: 4,
          pageSize: 2,
          entries: [{ problemId: 5, slug: 'mod', name: 'mod', evaluationId: 105 }],
        }),
      ],
    ]);

    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      const html = pages.get(url);
      if (html === undefined) {
        throw new Error(`unexpected URL ${url}`);
      }
      return new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    };

    const result = await enumerateUserSubmissions({
      userHandle: 'Prekzursil',
      fetchImpl,
    });

    expect(result.pagesVisited).toBe(3);
    expect(result.entries.map((entry) => entry.evaluationId)).toEqual([
      101, 102, 103, 104, 105,
    ]);
    expect(result.throttled).toBe(false);
    expect(result.cursor.nextUrl).toBeNull();
    expect(result.totalMatches).toBe(5);
  });

  test('dedupes evaluationIds across overlapping pages', async () => {
    const pages = new Map<string, string>([
      [
        'https://www.pbinfo.ro/solutii/user/Prekzursil',
        buildListingHtml({
          totalMatches: 3,
          currentOffset: 0,
          pageSize: 2,
          entries: [
            { problemId: 1, slug: 'sum', name: 'sum', evaluationId: 101 },
            { problemId: 2, slug: 'diff', name: 'diff', evaluationId: 102 },
          ],
        }),
      ],
      [
        'https://www.pbinfo.ro/solutii/user/Prekzursil?start=2',
        buildListingHtml({
          totalMatches: 3,
          currentOffset: 2,
          pageSize: 2,
          entries: [
            { problemId: 2, slug: 'diff', name: 'diff', evaluationId: 102 },
            { problemId: 3, slug: 'mul', name: 'mul', evaluationId: 103 },
          ],
        }),
      ],
    ]);

    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      const html = pages.get(url);
      if (html === undefined) {
        throw new Error(`unexpected URL ${url}`);
      }
      return new Response(html, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    };

    const result = await enumerateUserSubmissions({
      userHandle: 'Prekzursil',
      fetchImpl,
    });

    const ids = result.entries.map((entry) => entry.evaluationId);
    expect(ids).toEqual([101, 102, 103]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('short-circuits and reports throttled: true when pbinfo returns the throttle page', async () => {
    const throttleHtml = `
      <html><body><div>resursă indisponibilă temporar</div></body></html>
    `;

    const fetchImpl: typeof fetch = async () =>
      new Response(throttleHtml, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });

    const result = await enumerateUserSubmissions({
      userHandle: 'Prekzursil',
      fetchImpl,
    });

    expect(result.throttled).toBe(true);
    expect(result.entries).toHaveLength(0);
  });

  test('persists a durable cursor and can resume from it', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-enum-cursor-'));
    tempDirs.push(workspaceRoot);
    const cursorPath = join(workspaceRoot, '.enum-cursor.json');

    const pages = new Map<string, string>([
      [
        'https://www.pbinfo.ro/solutii/user/Prekzursil',
        buildListingHtml({
          totalMatches: 4,
          currentOffset: 0,
          pageSize: 2,
          entries: [
            { problemId: 1, slug: 'sum', name: 'sum', evaluationId: 101 },
            { problemId: 2, slug: 'diff', name: 'diff', evaluationId: 102 },
          ],
        }),
      ],
      [
        'https://www.pbinfo.ro/solutii/user/Prekzursil?start=2',
        buildListingHtml({
          totalMatches: 4,
          currentOffset: 2,
          pageSize: 2,
          entries: [
            { problemId: 3, slug: 'mul', name: 'mul', evaluationId: 103 },
            { problemId: 4, slug: 'div', name: 'div', evaluationId: 104 },
          ],
        }),
      ],
    ]);

    // First run: only the first page is reachable; simulate an interruption by
    // making the second-page fetch throw after the cursor has been persisted.
    let firstRunPageCount = 0;
    const firstFetchImpl: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      firstRunPageCount += 1;
      if (firstRunPageCount > 1) {
        throw new Error('simulated network interruption');
      }
      const html = pages.get(url);
      return new Response(html ?? '', { status: 200 });
    };

    await expect(
      enumerateUserSubmissions({
        userHandle: 'Prekzursil',
        fetchImpl: firstFetchImpl,
        cursorPath,
      }),
    ).rejects.toThrow(/simulated/);

    const persisted = JSON.parse(
      readFileSync(cursorPath, 'utf8'),
    ) as UserSubmissionsEnumeratorCursor;
    expect(persisted.nextUrl).toBe(
      'https://www.pbinfo.ro/solutii/user/Prekzursil?start=2',
    );
    expect(persisted.evaluationIdsSeen).toEqual([101, 102]);
    expect(persisted.pagesVisited).toBe(1);

    // Second run: resume from cursor, should fetch only the remaining page.
    const visited: string[] = [];
    const resumeFetchImpl: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      visited.push(url);
      const html = pages.get(url);
      if (html === undefined) {
        throw new Error(`unexpected URL ${url}`);
      }
      return new Response(html, { status: 200 });
    };

    const resumed = await enumerateUserSubmissions({
      userHandle: 'Prekzursil',
      fetchImpl: resumeFetchImpl,
      cursorPath,
    });

    expect(visited).toEqual([
      'https://www.pbinfo.ro/solutii/user/Prekzursil?start=2',
    ]);
    // New entries from page 2 only (103, 104); already-seen 101, 102 remain
    // tracked in the cursor but are not re-yielded.
    expect(resumed.entries.map((entry) => entry.evaluationId)).toEqual([103, 104]);
    expect(resumed.cursor.evaluationIdsSeen).toEqual([101, 102, 103, 104]);
    expect(resumed.cursor.nextUrl).toBeNull();
  });

  test('honors maxPages as a safety cap', async () => {
    // Synthetic listing with enough rows to produce more pages than maxPages
    // allows, but finite enough that the parser's next-page-url expansion stays
    // cheap (pbinfo's Paginare() generates one url per page slot).
    const fetchImpl: typeof fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.toString();
      const match = url.match(/start=(\d+)/);
      const currentOffset = match ? Number(match[1]) : 0;
      return new Response(
        buildListingHtml({
          totalMatches: 20,
          currentOffset,
          pageSize: 2,
          entries: [
            {
              problemId: currentOffset + 1,
              slug: `p${currentOffset + 1}`,
              name: `p${currentOffset + 1}`,
              evaluationId: currentOffset + 1,
            },
            {
              problemId: currentOffset + 2,
              slug: `p${currentOffset + 2}`,
              name: `p${currentOffset + 2}`,
              evaluationId: currentOffset + 2,
            },
          ],
        }),
        { status: 200 },
      );
    };

    const result = await enumerateUserSubmissions({
      userHandle: 'Prekzursil',
      fetchImpl,
      maxPages: 3,
    });

    expect(result.pagesVisited).toBe(3);
    expect(result.cursor.nextUrl).not.toBeNull();
  });

  test('also writes persisted cursor alongside a temp cursor path that did not exist', async () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-enum-newcursor-'));
    tempDirs.push(workspaceRoot);
    const cursorPath = join(workspaceRoot, 'nested', 'dir', '.enum-cursor.json');

    const fetchImpl: typeof fetch = async () =>
      new Response(
        buildListingHtml({
          totalMatches: 1,
          currentOffset: 0,
          pageSize: 2,
          entries: [{ problemId: 1, slug: 'sum', name: 'sum', evaluationId: 999 }],
        }),
        { status: 200 },
      );

    const result = await enumerateUserSubmissions({
      userHandle: 'Prekzursil',
      fetchImpl,
      cursorPath,
    });

    expect(result.entries).toHaveLength(1);
    expect(result.cursor.evaluationIdsSeen).toEqual([999]);
    // Cursor persisted through a freshly-created nested directory
    writeFileSync(cursorPath, readFileSync(cursorPath, 'utf8'));
  });
});
