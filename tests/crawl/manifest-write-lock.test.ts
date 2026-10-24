import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { ArchiveCrawler } from '../../src/crawl/archive-crawler.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// writeManifestEntry serialises writes per manifest through a shared lock map and
// touches no instance state, so the prototype method can be driven directly.
type ManifestWriter = {
  writeManifestEntry(manifestPath: string, url: string, fileName: string): Promise<void>;
};

describe('manifest write lock', () => {
  test('a failed write neither blocks nor releases the lock held by the next write', async () => {
    const root = mkdtempSync(join(tmpdir(), 'pbinfo-manifest-lock-'));
    tempDirs.push(root);
    // A directory where the manifest file should be: every read and write of it fails.
    const manifestPath = join(root, 'manifest.json');
    mkdirSync(manifestPath);
    const writer = ArchiveCrawler.prototype as unknown as ManifestWriter;

    const results = await Promise.allSettled([
      writer.writeManifestEntry(manifestPath, 'https://x/a', 'a.html'),
      writer.writeManifestEntry(manifestPath, 'https://x/b', 'b.html'),
    ]);

    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
  });
});
