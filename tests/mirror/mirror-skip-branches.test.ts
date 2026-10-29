import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import {
  rebuildRawManifests,
  renderCoverageIndex,
  rewriteMirrorHtml,
} from '../../src/mirror/build-mirror.js';
import { makeCoverageIndex, makeCoverageRecord } from '../_fixtures/coverage.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('mirror rewriting keeps what it does not need to change', () => {
  test('a same-origin asset missing from the manifest is kept in place', () => {
    const out = rewriteMirrorHtml(
      '<html><head><link rel="stylesheet" href="/local-only.css"></head><body><img src="/local-only.png"></body></html>',
      'https://www.pbinfo.ro/page',
      {},
      {},
    );
    expect(out).toContain('/local-only.css');
    expect(out).toContain('/local-only.png');
  });

  test('an existing coverage stylesheet is reused when the strip is injected', () => {
    const out = rewriteMirrorHtml(
      '<html><head><style data-archive-coverage-style></style></head><body></body></html>',
      'https://www.pbinfo.ro/p',
      {},
      {},
      makeCoverageRecord({ problemId: 4 }),
    );
    expect(out.match(/data-archive-coverage-style/g)).toHaveLength(1);
    expect(out).toContain('archive-coverage-strip');
  });

  test('a page record whose body is neither a raw page nor a raw asset is not indexed', () => {
    const root = mkdtempSync(join(tmpdir(), 'pbinfo-rebuild-other-'));
    tempDirs.push(root);
    mkdirSync(join(root, 'pages'), { recursive: true });
    writeFileSync(
      join(root, 'pages', 'z.json'),
      JSON.stringify({ url: 'https://x/z', bodyPath: 'other/z.bin' }),
      'utf8',
    );
    expect(rebuildRawManifests(root)).toEqual({ pageManifest: {}, assetManifest: {} });
  });

  test('the coverage index renders records from several grades', () => {
    const html = renderCoverageIndex(
      'SNAP',
      makeCoverageIndex([
        makeCoverageRecord({ problemId: 1, name: 'Alpha', grade: 10 }),
        makeCoverageRecord({ problemId: 2, name: 'Beta', grade: 9 }),
      ]),
    );
    expect(html).toContain('#1 Alpha');
    expect(html).toContain('#2 Beta');
  });
});
