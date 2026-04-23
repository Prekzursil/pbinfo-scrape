import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import {
  readDesktopPreferences,
  writeDesktopPreferences,
} from '../../src/gui/main/desktop-preferences.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, {
      recursive: true,
      force: true,
    });
  }
});

describe('desktop preferences', () => {
  test('defaults to normal verbosity and no workspace when preferences are missing', () => {
    const userDataRoot = mkdtempSync(join(tmpdir(), 'pbinfo-desktop-preferences-'));
    tempDirs.push(userDataRoot);

    const preferences = readDesktopPreferences(userDataRoot);

    expect(preferences).toEqual({
      verbosityMode: 'normal',
    });
  });

  test('persists workspace root and verbosity mode outside workspace state', () => {
    const userDataRoot = mkdtempSync(join(tmpdir(), 'pbinfo-desktop-preferences-'));
    tempDirs.push(userDataRoot);

    writeDesktopPreferences(userDataRoot, {
      workspaceRoot: 'C:/archive-workspace',
      verbosityMode: 'raw',
    });

    const preferencesPath = join(userDataRoot, 'pbinfo-desktop.json');

    expect(existsSync(preferencesPath)).toBe(true);
    expect(readDesktopPreferences(userDataRoot)).toEqual({
      workspaceRoot: 'C:/archive-workspace',
      verbosityMode: 'raw',
    });
    expect(readFileSync(preferencesPath, 'utf8')).toContain('"verbosityMode": "raw"');
  });

  test('persists and reads back themePreference', () => {
    const userDataRoot = mkdtempSync(
      join(tmpdir(), 'pbinfo-theme-pref-'),
    );
    tempDirs.push(userDataRoot);

    writeDesktopPreferences(userDataRoot, {
      verbosityMode: 'normal',
      themePreference: 'dark',
    });

    const preferences = readDesktopPreferences(userDataRoot);
    expect(preferences.themePreference).toBe('dark');
  });

  test('tolerates legacy preference file that omits themePreference', () => {
    const userDataRoot = mkdtempSync(
      join(tmpdir(), 'pbinfo-theme-legacy-'),
    );
    tempDirs.push(userDataRoot);
    const path = join(userDataRoot, 'pbinfo-desktop.json');
    // Write a legacy file with no themePreference field
    writeFileSync(path, JSON.stringify({ verbosityMode: 'raw' }), 'utf8');

    const prefs = readDesktopPreferences(userDataRoot);
    expect(prefs.themePreference).toBeUndefined();
    expect(prefs.verbosityMode).toBe('raw');
  });
});
