import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test, vi } from 'vitest';

import { runProblemIdSweepWorkflow } from '../../src/workflows/id-sweep-workflow.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const CHALLENGE_SHELL = `<!doctype html>
<html lang="en">
  <head><title>Verificare - pbinfo.ro</title></head>
  <body><div id="verificare">Verificare.</div></body>
</html>`;

interface SweepFetchOptions {
  liveIds: number[];
  canonicalShellIds?: Set<number>;
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html' },
  });
}

/**
 * Offline stand-in for www.pbinfo.ro implementing the URL semantics the
 * sweep depends on: bare /probleme/{id} answers 301 -> canonical slug for
 * live IDs and 200 + challenge shell for dead IDs; canonical pages and the
 * three detail-tab endpoints serve parseable fragments.
 */
function createSweepFetch(options: SweepFetchOptions): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;

    const noSlug = url.match(/^https:\/\/www\.pbinfo\.ro\/probleme\/(\d+)$/);
    if (noSlug) {
      const id = Number(noSlug[1]);
      if (options.liveIds.includes(id)) {
        return new Response(null, {
          status: 301,
          headers: {
            location: `https://www.pbinfo.ro/probleme/${id}/slug-${id}`,
          },
        });
      }
      return html(CHALLENGE_SHELL);
    }

    const canonical = url.match(/^https:\/\/www\.pbinfo\.ro\/probleme\/(\d+)\/([^/?#]+)$/);
    if (canonical) {
      const id = Number(canonical[1]);
      if (options.canonicalShellIds?.has(id)) {
        return html(CHALLENGE_SHELL);
      }
      return html(
        `<html><body><h1><a href="/probleme/${id}/slug-${id}">Problem ${id}</a></h1></body></html>`,
      );
    }

    const endpoint = url.match(
      /^https:\/\/www\.pbinfo\.ro\/ajx-module\/ajx-problema-afisare-(enunt|solutie|teste)\.php\?id=(\d+)$/,
    );
    if (endpoint) {
      const id = Number(endpoint[2]);
      if (options.canonicalShellIds?.has(id)) {
        // Same session gate as the canonical page: shells everywhere.
        return html(CHALLENGE_SHELL);
      }
      if (endpoint[1] === 'enunt') {
        return html(
          `<article id="enunt"><h1>Cerința</h1><p>Problem ${id} statement.</p></article>`,
        );
      }
      if (endpoint[1] === 'solutie') {
        return html(
          `<div><a href="#cpp">C++</a><div id="cpp"><pre>int main(){return 0;}</pre></div></div>`,
        );
      }
      return html(
        `<h3>Test 1</h3><p>Intrare</p><pre>10</pre><p>Ieșire</p><pre>20</pre>`,
      );
    }

    return new Response('not found', {
      status: 404,
      headers: { 'content-type': 'text/plain' },
    });
  }) as typeof fetch;
}

function createWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'pbinfo-sweep-workflow-'));
  tempDirs.push(root);
  mkdirSync(join(root, '.local'), { recursive: true });
  writeFileSync(
    join(root, '.local', 'pbinfo.local.json'),
    JSON.stringify(
      {
        crawl: {
          crossCheckWithBrowser: false,
          maxConcurrency: 2,
          idSweep: { deadStreakThreshold: 2 },
        },
      },
      null,
      2,
    ),
    'utf8',
  );
  return root;
}

function readSnapshotJson(snapshotId: string, workspaceRoot: string, ...segments: string[]): unknown {
  const path = join(
    workspaceRoot,
    'archive',
    'snapshots',
    snapshotId,
    'normalized',
    ...segments,
  );
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('runProblemIdSweepWorkflow', () => {
  test('probes an explicit id range, captures live problems, and writes sweep records', async () => {
    const workspaceRoot = createWorkspace();
    const result = await runProblemIdSweepWorkflow(workspaceRoot, {
      minId: 1,
      maxId: 4,
      now: new Date('2026-03-10T00:00:00.000Z'),
      fetchImpl: createSweepFetch({ liveIds: [1, 2] }),
    });

    expect(result.ceiling).toBe(4);
    expect(result.probed).toBe(4);
    expect(result.skippedAlreadyProbed).toBe(0);
    expect(result.liveCount).toBe(2);
    expect(result.deadCount).toBe(2);
    expect(result.cookieShellCount).toBe(0);
    expect(result.completed).toBe(true);

    const snapshotId = result.snapshotId;
    for (const id of [1, 2]) {
      expect(readSnapshotJson(snapshotId, workspaceRoot, 'id-sweep', `id-${id}.json`)).toMatchObject({
        problemId: id,
        classification: 'live',
        captureStatus: 'content',
        slug: `slug-${id}`,
      });
    }
    for (const id of [3, 4]) {
      expect(readSnapshotJson(snapshotId, workspaceRoot, 'id-sweep', `id-${id}.json`)).toMatchObject({
        problemId: id,
        classification: 'dead',
        probe: 'dead',
      });
    }

    const index = readSnapshotJson(snapshotId, workspaceRoot, 'id-sweep', 'index.json') as {
      ceiling: number;
      totals: { probed: number; liveCount: number; deadCount: number };
      liveIds: number[];
      deadIds: number[];
    };
    expect(index.ceiling).toBe(4);
    expect(index.totals).toMatchObject({ probed: 4, liveCount: 2, deadCount: 2 });
    expect(index.liveIds).toEqual([1, 2]);
    expect(index.deadIds).toEqual([3, 4]);

    // Live problems were captured regardless of category: statement,
    // editorial, and tests fragments all normalized for problem 1.
    const problem = readSnapshotJson(snapshotId, workspaceRoot, 'problems', 'problem-1.json') as {
      sections: unknown[];
      officialSolutions: Record<string, string>;
      visibleTests: unknown[];
    };
    expect(problem.sections.length).toBeGreaterThan(0);
    expect(Object.keys(problem.officialSolutions)).toContain('C++');
    expect(problem.visibleTests.length).toBeGreaterThan(0);
    expect(
      existsSync(join(workspaceRoot, 'archive', 'snapshots', snapshotId, 'normalized', 'tests', 'problem-1.json')),
    ).toBe(true);
  });

  test('auto-detects the ceiling when maxId is omitted', async () => {
    const workspaceRoot = createWorkspace();
    const result = await runProblemIdSweepWorkflow(workspaceRoot, {
      now: new Date('2026-03-10T00:00:00.000Z'),
      fetchImpl: createSweepFetch({ liveIds: [1, 2, 3, 4, 5] }),
    });

    expect(result.ceiling).toBe(5);
    expect(result.liveCount).toBe(5);
    expect(result.deadCount).toBe(0);
  });

  test('writes an empty index when the auto-detected ceiling is zero', async () => {
    const workspaceRoot = createWorkspace();
    const result = await runProblemIdSweepWorkflow(workspaceRoot, {
      now: new Date('2026-03-10T00:00:00.000Z'),
      fetchImpl: createSweepFetch({ liveIds: [] }),
    });

    expect(result.ceiling).toBe(0);
    expect(result.probed).toBe(0);
    const index = readSnapshotJson(result.snapshotId, workspaceRoot, 'id-sweep', 'index.json') as {
      totals: { probed: number };
    };
    expect(index.totals.probed).toBe(0);
  });

  test('classifies live problems whose capture hits a cookie shell', async () => {
    const workspaceRoot = createWorkspace();
    const result = await runProblemIdSweepWorkflow(workspaceRoot, {
      minId: 1,
      maxId: 3,
      now: new Date('2026-03-10T00:00:00.000Z'),
      fetchImpl: createSweepFetch({
        liveIds: [1, 2, 3],
        canonicalShellIds: new Set([3]),
      }),
    });

    expect(result.liveCount).toBe(2);
    expect(result.cookieShellCount).toBe(1);
    expect(
      readSnapshotJson(result.snapshotId, workspaceRoot, 'id-sweep', 'id-3.json'),
    ).toMatchObject({
      classification: 'cookie-shell',
      captureStatus: 'cookie-shell',
      probe: 'live',
    });
    expect(
      existsSync(
        join(workspaceRoot, 'archive', 'snapshots', result.snapshotId, 'normalized', 'problems', 'problem-3.json'),
      ),
    ).toBe(false);
  });

  test('skips already-probed ids on an incremental rerun of the same snapshot', async () => {
    const workspaceRoot = createWorkspace();
    const fetchImpl = createSweepFetch({ liveIds: [1] });
    const first = await runProblemIdSweepWorkflow(workspaceRoot, {
      minId: 1,
      maxId: 2,
      now: new Date('2026-03-10T00:00:00.000Z'),
      fetchImpl,
    });

    const second = await runProblemIdSweepWorkflow(workspaceRoot, {
      minId: 1,
      maxId: 2,
      now: new Date('2026-03-10T01:00:00.000Z'),
      snapshotId: first.snapshotId,
      fetchImpl,
    });

    expect(second.snapshotId).toBe(first.snapshotId);
    expect(second.probed).toBe(0);
    expect(second.skippedAlreadyProbed).toBe(2);
    expect(second.liveCount).toBe(1);
    expect(second.deadCount).toBe(1);
  });

  test('falls back to the cookie-aware fetch when none is injected', async () => {
    const workspaceRoot = createWorkspace();
    // Stub the global fetch that createCookieFetch wraps, keeping the
    // fallback path fully offline. `now` is intentionally omitted so the
    // workflow's own clock fallback is exercised too.
    const stubbedFetch = vi.fn(createSweepFetch({ liveIds: [1] }));
    vi.stubGlobal('fetch', stubbedFetch);
    try {
      const result = await runProblemIdSweepWorkflow(workspaceRoot, {
        minId: 1,
        maxId: 2,
      });

      expect(stubbedFetch).toHaveBeenCalled();
      expect(result.probed).toBe(2);
      expect(result.liveCount).toBe(1);
      expect(result.deadCount).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
