import { readFileSync } from 'node:fs';

import { describe, expect, test } from 'vitest';

describe('security and archive visibility docs', () => {
  test('tracks a repository security policy at the root', () => {
    const body = readFileSync('SECURITY.md', 'utf8');

    expect(body).toContain('# Security Policy');
    expect(body).toContain('private');
    expect(body).toContain('security report');
  });

  test('README explains where to find the local archive and mirror', () => {
    const body = readFileSync('README.md', 'utf8');

    expect(body).toContain('Where is the archive locally?');
    expect(body).toContain('serve --snapshot acceptance-20260310b --port 4173');
    expect(body).toContain(
      'archive/snapshots/acceptance-20260310b/normalized/',
    );
    expect(body).toContain(
      'archive/snapshots/acceptance-20260310b/mirror/',
    );
  });
});
