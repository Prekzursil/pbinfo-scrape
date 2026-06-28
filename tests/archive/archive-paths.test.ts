import { describe, expect, test } from 'vitest';

import {
  buildAssetFilename,
  buildPageFilename,
  buildPageRecordFilename,
  buildRawAssetLocalPath,
  sanitizeSegment,
} from '../../src/archive/archive-paths.js';

describe('sanitizeSegment', () => {
  test('collapses unsafe characters and falls back to root for empty input', () => {
    expect(sanitizeSegment('/probleme/categorii/9')).toBe('probleme-categorii-9');
    expect(sanitizeSegment('/')).toBe('root');
    expect(sanitizeSegment('a.b.c')).toBe('a-b-c');
  });
});

describe('buildPageFilename', () => {
  test('builds a stable html filename and a json record variant', () => {
    const html = buildPageFilename('https://www.pbinfo.ro/probleme/12');
    expect(html).toBe('page-https-www-pbinfo-ro-probleme-12.html');
    expect(buildPageRecordFilename('https://www.pbinfo.ro/probleme/12')).toBe(
      'page-https-www-pbinfo-ro-probleme-12.json',
    );
  });

  test('uses the root token for the site root and appends a query hash suffix', () => {
    expect(buildPageFilename('https://www.pbinfo.ro/')).toBe('page-https-www-pbinfo-ro-root.html');
    const withQuery = buildPageFilename('https://www.pbinfo.ro/probleme?page=2');
    expect(withQuery).toMatch(/page-https-www-pbinfo-ro-probleme-q[0-9a-f]{10}\.html$/);
  });
});

describe('buildAssetFilename', () => {
  test('uses the explicit extension when the path has one', () => {
    expect(buildAssetFilename('https://www.pbinfo.ro/static/app.css')).toBe(
      'asset-https-www-pbinfo-ro-static-app-css.css',
    );
  });

  test('infers the extension from the content type when the path has none', () => {
    expect(buildAssetFilename('https://www.pbinfo.ro/style', 'text/css')).toMatch(/\.css$/);
    expect(buildAssetFilename('https://www.pbinfo.ro/script', 'application/javascript')).toMatch(
      /\.js$/,
    );
    expect(buildAssetFilename('https://www.pbinfo.ro/data', 'application/json')).toMatch(/\.json$/);
    expect(buildAssetFilename('https://www.pbinfo.ro/blob', 'application/octet-stream')).toMatch(
      /\.bin$/,
    );
    expect(buildAssetFilename('https://www.pbinfo.ro/blob')).toMatch(/\.bin$/);
  });

  test('falls back to bin when the explicit extension has no alphanumeric characters', () => {
    expect(buildAssetFilename('https://www.pbinfo.ro/file.+++')).toMatch(/\.bin$/);
  });

  test('buildRawAssetLocalPath nests the asset under raw-assets', () => {
    expect(buildRawAssetLocalPath('https://www.pbinfo.ro/static/app.css')).toBe(
      'raw-assets/asset-https-www-pbinfo-ro-static-app-css.css',
    );
  });
});
