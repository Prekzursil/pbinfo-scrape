import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');

describe('maintainer documentation', () => {
  test('documents the blessed canonical snapshot ownership policy', () => {
    const maintaining = readFileSync(resolve(repoRoot, 'MAINTAINING.md'), 'utf8');

    expect(maintaining).toContain('acceptance-20260310b');
    expect(maintaining).toContain('blessed tracked canonical snapshot');
    expect(maintaining).toContain('.local/archive-backups/');
    expect(maintaining).toContain('npm run verify:canonical-snapshot');
    expect(maintaining).toContain('npm run smoke:desktop-packaged');
  });

  test('README points maintainers at the canonical archive ownership and viewing paths', () => {
    const readme = readFileSync(resolve(repoRoot, 'README.md'), 'utf8');

    expect(readme).toContain('Canonical snapshot policy');
    expect(readme).toContain('archive/snapshots/acceptance-20260310b/normalized/');
    expect(readme).toContain('archive/snapshots/acceptance-20260310b/mirror/');
    expect(readme).toContain('npm run cli -- serve --snapshot acceptance-20260310b --port 4173');
    expect(readme).toContain('MAINTAINING.md');
  });
});
