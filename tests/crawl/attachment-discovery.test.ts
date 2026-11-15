import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { loadLocalConfig } from '../../src/config/local-config.js';
import {
  discoverFollowUps,
  normalizeAttachmentUrl,
} from '../../src/crawl/archive-crawler.js';
import { parseProblemPage } from '../../src/pbinfo/parsers/problem.js';
import { normalizeAttachmentHref } from '../../src/pbinfo/parsers/shared.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeConfig() {
  const root = mkdtempSync(join(tmpdir(), 'pbinfo-attach-'));
  tempDirs.push(root);
  return loadLocalConfig(root);
}

const PROBLEM_PAGE_URL = 'https://www.pbinfo.ro/probleme/4242/perle';

describe('normalizeAttachmentUrl', () => {
  const base = new URL(PROBLEM_PAGE_URL);

  test('accepts root-relative and bare-relative descarca-fisier hrefs, keeping the query', () => {
    expect(normalizeAttachmentUrl(base, '/descarca-fisier.php?id=42')).toBe(
      'https://www.pbinfo.ro/descarca-fisier.php?id=42',
    );
    expect(normalizeAttachmentUrl(base, 'descarca-fisier.php?id=42&pid=7')).toBe(
      'https://www.pbinfo.ro/descarca-fisier.php?id=42&pid=7',
    );
  });

  test('rejects non-attachment paths, cross-origin links, and unsafe schemes', () => {
    expect(normalizeAttachmentUrl(base, '/some-page.php?id=1')).toBeNull();
    expect(normalizeAttachmentUrl(base, 'https://evil.example/descarca-fisier.php?id=1')).toBeNull();
    expect(normalizeAttachmentUrl(base, 'javascript:alert(1)')).toBeNull();
    expect(normalizeAttachmentUrl(base, 'vbscript:x')).toBeNull();
    expect(normalizeAttachmentUrl(base, 'mailto:a@b.c')).toBeNull();
    expect(normalizeAttachmentUrl(base, 'tel:+40')).toBeNull();
    expect(normalizeAttachmentUrl(base, 'data:text/html,x')).toBeNull();
    expect(normalizeAttachmentUrl(base, '#anchor')).toBeNull();
    expect(normalizeAttachmentUrl(base, undefined)).toBeNull();
    expect(normalizeAttachmentUrl(base, '   ')).toBeNull();
  });

  test('strips the fragment but tolerates mixed-case schemes and paths', () => {
    expect(normalizeAttachmentUrl(base, '/descarca-fisier.php?id=42#sec')).toBe(
      'https://www.pbinfo.ro/descarca-fisier.php?id=42',
    );
    expect(normalizeAttachmentUrl(base, 'JavaScript:void(0)')).toBeNull();
    expect(normalizeAttachmentUrl(base, '/DESCARCA-FISIER.PHP?id=42')).toBe(
      'https://www.pbinfo.ro/DESCARCA-FISIER.PHP?id=42',
    );
  });
});

describe('normalizeAttachmentHref', () => {
  test('passes through scheme-absolute, protocol-relative, and root-relative hrefs', () => {
    expect(normalizeAttachmentHref('https://www.pbinfo.ro/descarca-fisier.php?id=1')).toBe(
      'https://www.pbinfo.ro/descarca-fisier.php?id=1',
    );
    expect(normalizeAttachmentHref('//www.pbinfo.ro/descarca-fisier.php?id=1')).toBe(
      '//www.pbinfo.ro/descarca-fisier.php?id=1',
    );
    expect(normalizeAttachmentHref('/descarca-fisier.php?id=1')).toBe('/descarca-fisier.php?id=1');
  });

  test('roots bare attachment hrefs and leaves other bare hrefs alone', () => {
    expect(normalizeAttachmentHref('descarca-fisier.php?id=1')).toBe('/descarca-fisier.php?id=1');
    expect(normalizeAttachmentHref('  descarca-fisier.php?id=1  ')).toBe('/descarca-fisier.php?id=1');
    expect(normalizeAttachmentHref('altceva.php?id=1')).toBe('altceva.php?id=1');
  });
});

describe('discoverFollowUps attachment harvest', () => {
  test('queues descarca-fisier anchors as public assets without queueing them as pages', () => {
    const config = makeConfig();
    const followUps = discoverFollowUps(config, 'all', PROBLEM_PAGE_URL, 'public-page', `
      <html><body>
        <h1><a href="/probleme/4242/perle">Perle</a></h1>
        <a href="/descarca-fisier.php?id=42">atasament.pdf</a>
        <a href="descarca-fisier.php?id=43">alt-atribut.zip</a>
        <a href="/probleme/100/nrapprime">altă problemă</a>
      </body></html>
    `);

    const urls = followUps.map((item) => item.url);
    expect(urls).toContain('https://www.pbinfo.ro/descarca-fisier.php?id=42');
    expect(urls).toContain('https://www.pbinfo.ro/descarca-fisier.php?id=43');
    const attachmentItems = followUps.filter((item) => item.url.includes('descarca-fisier.php'));
    expect(attachmentItems).toHaveLength(2);
    for (const item of attachmentItems) {
      expect(item.kind).toBe('public-asset');
    }

    // The query-carrying download URLs must not be queued as navigable pages.
    const pageItems = followUps.filter((item) => item.kind === 'public-page');
    expect(pageItems.map((item) => item.url)).not.toContain('https://www.pbinfo.ro/descarca-fisier.php?id=42');
  });

  test('does not harvest attachments for kinds with suppressed asset discovery', () => {
    const config = makeConfig();
    const followUps = discoverFollowUps(
      config,
      'all',
      'https://www.pbinfo.ro/solutii/user/prekzursil',
      'user-solutions',
      '<a href="/descarca-fisier.php?id=42">atasament.pdf</a>',
    );
    expect(followUps.filter((item) => item.url.includes('descarca-fisier.php'))).toHaveLength(0);
  });
});

describe('parseProblemPage linked attachments', () => {
  test('records attachment anchors as linked assets of kind other', () => {
    const record = parseProblemPage(
      `<html><body>
        <h1><a href="/probleme/4242/perle">Perle</a></h1>
        <a href="/descarca-fisier.php?id=42">atasament.pdf</a>
        <a href="descarca-fisier.php?id=43">alt-atribut.zip</a>
      </body></html>`,
      PROBLEM_PAGE_URL,
    );

    const attachmentUrls = record.linkedAssets
      .filter((asset) => asset.kind === 'other')
      .map((asset) => asset.url);
    expect(attachmentUrls).toContain('https://www.pbinfo.ro/descarca-fisier.php?id=42');
    // Bare-relative hrefs resolve against the site root, not the page path.
    expect(attachmentUrls).toContain('https://www.pbinfo.ro/descarca-fisier.php?id=43');
    expect(record.linkedAssets.find((asset) => asset.url.endsWith('?id=42'))?.localPath).toContain(
      'raw-assets/',
    );
  });

  test('ignores cross-origin attachment links', () => {
    const record = parseProblemPage(
      `<html><body>
        <h1><a href="/probleme/4242/perle">Perle</a></h1>
        <a href="https://evil.example/descarca-fisier.php?id=42">phishing</a>
      </body></html>`,
      PROBLEM_PAGE_URL,
    );
    expect(
      record.linkedAssets.filter((asset) => asset.url.includes('descarca-fisier.php')),
    ).toHaveLength(0);
  });
});
