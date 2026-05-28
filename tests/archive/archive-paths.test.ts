import { describe, expect, test } from 'vitest';

import {
  buildAssetFilename,
  buildPageFilename,
  buildPageRecordFilename,
  buildRawAssetLocalPath,
  sanitizeSegment,
} from '../../src/archive/archive-paths.js';

describe('archive path builders', () => {
  test('sanitizes path segments and defaults empty segments to root', () => {
    expect(sanitizeSegment('/probleme/3171/water.reserve')).toBe('probleme-3171-water-reserve');
    expect(sanitizeSegment('///')).toBe('root');
    expect(sanitizeSegment('/!!!')).toBe('root');
  });

  test('builds page filenames including a stable query suffix', () => {
    expect(buildPageFilename('https://www.pbinfo.ro/')).toBe('page-https-www-pbinfo-ro-root.html');
    const withQuery = buildPageFilename('https://www.pbinfo.ro/probleme?grad=11&pagina=2');
    expect(withQuery).toMatch(/^page-https-www-pbinfo-ro-probleme-q[0-9a-f]{10}\.html$/);
  });

  test('derives page record filenames from page filenames', () => {
    expect(buildPageRecordFilename('https://www.pbinfo.ro/')).toBe(
      'page-https-www-pbinfo-ro-root.json',
    );
  });

  test('infers asset extensions from explicit path extensions', () => {
    expect(buildAssetFilename('https://cdn.pbinfo.ro/app/main.css')).toMatch(/\.css$/);
    expect(buildAssetFilename('https://cdn.pbinfo.ro/app/main.weird!ext')).toMatch(/\.weirdext$/);
    // An extension consisting solely of non-alphanumerics falls back to `bin`.
    expect(buildAssetFilename('https://cdn.pbinfo.ro/app/icon.!!!')).toMatch(/\.bin$/);
  });

  test('falls back to content-type when the path has no usable extension', () => {
    expect(buildAssetFilename('https://cdn.pbinfo.ro/styles', 'text/css')).toMatch(/\.css$/);
    expect(buildAssetFilename('https://cdn.pbinfo.ro/script', 'application/javascript')).toMatch(
      /\.js$/,
    );
    expect(buildAssetFilename('https://cdn.pbinfo.ro/data', 'application/json')).toMatch(/\.json$/);
    expect(buildAssetFilename('https://cdn.pbinfo.ro/blob', 'application/octet-stream')).toMatch(
      /\.bin$/,
    );
    expect(buildAssetFilename('https://cdn.pbinfo.ro/blob')).toMatch(/\.bin$/);
  });

  test('builds raw asset local paths under the raw-assets directory', () => {
    expect(buildRawAssetLocalPath('https://cdn.pbinfo.ro/app/main.css')).toBe(
      'raw-assets/asset-https-cdn-pbinfo-ro-app-main-css.css',
    );
  });
});
