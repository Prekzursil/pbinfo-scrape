import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import {
  activateWorkspaceProfile,
  deleteWorkspaceProfile,
  initializeWorkspaceState,
  upsertWorkspaceProfile,
} from '../../src/gui/main/workspace-store.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('omitUserHandle with no crawl config (lines 278-280 of workspace-store.ts)', () => {
  test('deleteWorkspaceProfile handles absent crawl config without throwing', () => {
    // When localConfig.crawl is undefined, omitUserHandle's `if (!value)` guard fires (lines 278-280).
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-ws-no-crawl-'));
    tempDirs.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, '.local'), { recursive: true });
    // No "crawl" key in local config — localConfig.crawl will be undefined.
    writeFileSync(
      join(workspaceRoot, '.local', 'pbinfo.local.json'),
      JSON.stringify({}, null, 2),
      'utf8',
    );

    initializeWorkspaceState(workspaceRoot, { now: new Date('2026-03-10T12:00:00.000Z') });
    upsertWorkspaceProfile(workspaceRoot, {
      profileId: 'no-crawl-profile',
      label: 'No Crawl Profile',
      userHandle: 'SomeUser',
      provenance: { type: 'login' },
      sessionCookies: [{ key: 'PHPSESSID', value: 'cookie1', domain: 'www.pbinfo.ro', path: '/' }],
      now: new Date('2026-03-10T12:01:00.000Z'),
    });
    activateWorkspaceProfile(workspaceRoot, 'no-crawl-profile', {
      now: new Date('2026-03-10T12:02:00.000Z'),
    });
    // Deleting the active profile with no crawl config exercises the omitUserHandle null guard.
    const state = deleteWorkspaceProfile(workspaceRoot, 'no-crawl-profile', {
      now: new Date('2026-03-10T12:03:00.000Z'),
    });
    expect(state.profiles).not.toContain(
      expect.objectContaining({ profileId: 'no-crawl-profile' }),
    );
  });
});

describe('workspace store stripUndefined recursion branches', () => {
  test('persists nested array configuration without dropping array entries', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-ws-array-strip-'));
    tempDirs.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, '.local'), { recursive: true });
    writeFileSync(
      join(workspaceRoot, '.local', 'pbinfo.local.json'),
      JSON.stringify(
        {
          crawl: {
            // Arrays exercise the Array.isArray recursion in stripUndefined.
            publicStartUrls: ['https://www.pbinfo.ro/', 'https://www.pbinfo.ro/probleme'],
            maxConcurrency: 4,
          },
          mirror: {
            allowedHosts: ['pbinfo.ro', 'static.pbinfo.ro'],
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    initializeWorkspaceState(workspaceRoot, {
      now: new Date('2026-03-10T12:00:00.000Z'),
    });
    upsertWorkspaceProfile(workspaceRoot, {
      profileId: 'arr-profile',
      label: 'Arrays Profile',
      userHandle: 'arr-user',
      provenance: { type: 'login' },
      sessionCookies: [
        { key: 'PHPSESSID', value: 'arr-cookie', domain: 'www.pbinfo.ro', path: '/' },
      ],
      now: new Date('2026-03-10T12:01:00.000Z'),
    });
    activateWorkspaceProfile(workspaceRoot, 'arr-profile', {
      now: new Date('2026-03-10T12:02:00.000Z'),
    });
    const config = JSON.parse(
      readFileSync(join(workspaceRoot, '.local', 'pbinfo.local.json'), 'utf8'),
    ) as {
      crawl: { publicStartUrls: string[]; maxConcurrency: number };
      mirror: { allowedHosts: string[] };
    };
    expect(config.crawl.publicStartUrls).toEqual([
      'https://www.pbinfo.ro/',
      'https://www.pbinfo.ro/probleme',
    ]);
    expect(config.mirror.allowedHosts).toEqual(['pbinfo.ro', 'static.pbinfo.ro']);
  });
});
