import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  computeContrastRatio,
  parseTokenFile,
} from '../../src/gui/renderer/library-shell/theme/contrast-check.js';

const tokensPath = join(
  process.cwd(),
  'src/gui/renderer/library-shell/theme/tokens.css',
);
const tokens = parseTokenFile(readFileSync(tokensPath, 'utf8'));

const pinnedPairs: ReadonlyArray<{
  readonly fg: string;
  readonly bg: string;
  readonly min: number;
}> = [
  { fg: '--pac-fg', bg: '--pac-bg', min: 7.0 },
  { fg: '--pac-fg', bg: '--pac-bg-panel', min: 7.0 },
  { fg: '--pac-fg-muted', bg: '--pac-bg', min: 4.5 },
  { fg: '--pac-fg-subtle', bg: '--pac-bg', min: 3.0 },
  { fg: '--pac-accent-fg', bg: '--pac-accent', min: 4.5 },
  { fg: '--pac-accent-fg', bg: '--pac-accent-hover', min: 4.5 },
  { fg: '--pac-status-ok', bg: '--pac-bg', min: 3.0 },
  { fg: '--pac-status-locked', bg: '--pac-bg', min: 3.0 },
  { fg: '--pac-status-gap', bg: '--pac-bg', min: 3.0 },
];

describe.each(['light', 'dark'] as const)(
  'theme contrast · %s palette',
  (palette) => {
    test.each(pinnedPairs)(
      '$fg on $bg >= $min:1',
      ({ fg, bg, min }) => {
        const fgColor = tokens[palette][fg];
        const bgColor = tokens[palette][bg];
        expect(fgColor, `${fg} missing in ${palette}`).toBeDefined();
        expect(bgColor, `${bg} missing in ${palette}`).toBeDefined();
        if (typeof fgColor !== 'string' || typeof bgColor !== 'string') {
          throw new Error('missing token');
        }
        const ratio = computeContrastRatio(fgColor, bgColor);
        expect(ratio).toBeGreaterThanOrEqual(min);
      },
    );
  },
);
