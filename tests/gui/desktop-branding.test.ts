import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

const repoRoot = resolve(__dirname, '..', '..');

describe('desktop branding assets', () => {
  test('ships generated local logo and icon assets for the desktop app', () => {
    expect(
      existsSync(join(repoRoot, 'src', 'gui', 'renderer', 'assets', 'problem-archive-crawler-logo.svg')),
    ).toBe(true);
    expect(
      existsSync(join(repoRoot, 'src', 'gui', 'renderer', 'assets', 'problem-archive-crawler-mark.svg')),
    ).toBe(true);
    expect(
      existsSync(join(repoRoot, 'assets', 'desktop', 'problem-archive-crawler.ico')),
    ).toBe(true);
    expect(
      existsSync(join(repoRoot, 'assets', 'desktop', 'problem-archive-crawler-notification.png')),
    ).toBe(true);
  });

  test('points packaging at the Problem Archive Crawler brand assets', () => {
    const builder = JSON.parse(
      readFileSync(join(repoRoot, 'electron-builder.json'), 'utf8'),
    ) as {
      productName?: string;
      appId?: string;
      asar?: boolean;
      win?: {
        icon?: string;
      };
      extraResources?: Array<{ from?: string }>;
    };
    const packageJson = JSON.parse(
      readFileSync(join(repoRoot, 'package.json'), 'utf8'),
    ) as {
      scripts?: Record<string, string>;
    };

    expect(builder.productName).toBe('Problem Archive Crawler');
    expect(builder.appId).toBe('ro.pbinfo.problemarchivecrawler.desktop');
    expect(builder.asar).toBe(true);
    expect(builder.win?.icon).toBe('assets/desktop/problem-archive-crawler.ico');
    expect(builder.extraResources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'assets/desktop',
        }),
      ]),
    );
    expect(packageJson.scripts?.['desktop:assets']).toContain('generate-brand-assets');
    expect(packageJson.scripts?.['desktop:build']).toContain('desktop:assets');
  });

  test('bundles local desktop fonts instead of relying on generic system stacks only', () => {
    const rendererEntry = readFileSync(
      join(repoRoot, 'src', 'gui', 'renderer', 'main.tsx'),
      'utf8',
    );
    const rendererHtml = readFileSync(
      join(repoRoot, 'src', 'gui', 'renderer', 'index.html'),
      'utf8',
    );
    // styles.css was retired in Task 11 together with the legacy AppShell.
    // The library-shell now imports fonts + tokens from theme/global.css.
    const tokens = readFileSync(
      join(
        repoRoot,
        'src',
        'gui',
        'renderer',
        'library-shell',
        'theme',
        'tokens.css',
      ),
      'utf8',
    );

    expect(rendererEntry).toContain("@fontsource/sora");
    expect(rendererEntry).toContain("@fontsource/manrope");
    expect(rendererEntry).toContain("@fontsource/ibm-plex-mono");
    expect(rendererHtml).toContain("<title>Problem Archive Crawler</title>");
    expect(tokens).toContain("'Manrope'");
    expect(tokens).toContain("'IBM Plex Mono'");
  });
});
