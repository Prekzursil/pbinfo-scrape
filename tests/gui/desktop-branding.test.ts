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
    const styles = readFileSync(
      join(repoRoot, 'src', 'gui', 'renderer', 'styles.css'),
      'utf8',
    );

    expect(rendererEntry).toContain("@fontsource/sora");
    expect(rendererEntry).toContain("@fontsource/manrope");
    expect(rendererEntry).toContain("@fontsource/ibm-plex-mono");
    expect(styles).toContain('"Sora"');
    expect(styles).toContain('"Manrope"');
    expect(styles).toContain('"IBM Plex Mono"');
  });
});
