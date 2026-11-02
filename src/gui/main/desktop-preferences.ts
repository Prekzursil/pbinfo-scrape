import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { type DesktopPreferencesRecord, desktopPreferencesRecordSchema } from '../shared/types.js';

export function readDesktopPreferences(userDataRoot: string): DesktopPreferencesRecord {
  const path = getDesktopPreferencesPath(userDataRoot);
  if (!existsSync(path)) {
    return {
      verbosityMode: 'normal',
    };
  }

  return desktopPreferencesRecordSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

export function writeDesktopPreferences(
  userDataRoot: string,
  preferences: DesktopPreferencesRecord,
): DesktopPreferencesRecord {
  const path = getDesktopPreferencesPath(userDataRoot);
  const parsed = desktopPreferencesRecordSchema.parse(preferences);
  mkdirSync(dirname(path), {
    recursive: true,
  });
  writeFileSync(path, JSON.stringify(parsed, null, 2), 'utf8');
  return parsed;
}

export function getDesktopPreferencesPath(userDataRoot: string): string {
  return join(userDataRoot, 'pbinfo-desktop.json');
}
