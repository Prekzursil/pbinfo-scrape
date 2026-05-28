import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import {
  activateWorkspaceProfile,
  deleteWorkspaceProfile,
  initializeWorkspaceState,
  readWorkspaceState,
  upsertWorkspaceProfile,
} from '../../src/gui/main/workspace-store.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('workspace store', () => {
  test('initializes persistent workspace metadata for an arbitrary workspace root', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-gui-workspace-'));
    tempDirs.push(workspaceRoot);

    const state = initializeWorkspaceState(workspaceRoot, {
      now: new Date('2026-03-10T12:00:00.000Z'),
    });

    expect(state.workspaceRoot).toBe(workspaceRoot);
    expect(state.profiles).toEqual([]);
    expect(state.activeProfileId).toBeUndefined();
    expect(existsSync(join(workspaceRoot, '.local', 'gui', 'workspace-state.json'))).toBe(true);
  });

  test('stores multiple profiles and keeps exactly one active profile materialized for workflows', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-gui-profiles-'));
    tempDirs.push(workspaceRoot);
    mkdirSync(join(workspaceRoot, '.local'), { recursive: true });

    writeFileSync(
      join(workspaceRoot, '.local', 'pbinfo.local.json'),
      JSON.stringify(
        {
          crawl: {
            maxConcurrency: 4,
            retryDelayMs: 5000,
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

    const profileA = upsertWorkspaceProfile(workspaceRoot, {
      profileId: 'alpha',
      label: 'Primary account',
      userHandle: 'Prekzursil',
      provenance: {
        type: 'login',
      },
      sessionCookies: [
        {
          key: 'PHPSESSID',
          value: 'alpha-cookie',
          domain: 'www.pbinfo.ro',
          path: '/',
          secure: true,
          httpOnly: true,
        },
      ],
      now: new Date('2026-03-10T12:01:00.000Z'),
    });
    const profileB = upsertWorkspaceProfile(workspaceRoot, {
      profileId: 'beta',
      label: 'Imported browser session',
      userHandle: 'PrekzursilAlt',
      provenance: {
        type: 'browser-import',
        browser: 'edge',
      },
      sessionCookies: [
        {
          key: 'PHPSESSID',
          value: 'beta-cookie',
          domain: 'www.pbinfo.ro',
          path: '/',
          secure: true,
          httpOnly: true,
        },
      ],
      now: new Date('2026-03-10T12:02:00.000Z'),
    });

    activateWorkspaceProfile(workspaceRoot, 'beta', {
      now: new Date('2026-03-10T12:03:00.000Z'),
    });

    const state = readWorkspaceState(workspaceRoot);
    const activeConfig = JSON.parse(
      readFileSync(join(workspaceRoot, '.local', 'pbinfo.local.json'), 'utf8'),
    ) as {
      auth: {
        strategy: string;
        sessionCookiesPath: string;
      };
      crawl: {
        userHandle: string;
        maxConcurrency: number;
      };
    };
    const activeCookies = JSON.parse(
      readFileSync(join(workspaceRoot, '.local', 'session-cookies.json'), 'utf8'),
    ) as Array<{ key: string; value: string }>;

    expect(profileA.profileId).toBe('alpha');
    expect(profileB.profileId).toBe('beta');
    expect(state.activeProfileId).toBe('beta');
    expect(state.profiles.map((profile) => profile.profileId)).toEqual(['alpha', 'beta']);
    expect(activeConfig.auth).toEqual({
      strategy: 'cookie-import',
      sessionCookiesPath: '.local/session-cookies.json',
    });
    expect(activeConfig.crawl.userHandle).toBe('PrekzursilAlt');
    expect(activeConfig.crawl.maxConcurrency).toBe(4);
    expect(activeCookies).toEqual([
      expect.objectContaining({
        key: 'PHPSESSID',
        value: 'beta-cookie',
      }),
    ]);
  });

  test('deleting the active profile clears the active marker without deleting persisted archive settings', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-gui-delete-profile-'));
    tempDirs.push(workspaceRoot);

    initializeWorkspaceState(workspaceRoot, {
      now: new Date('2026-03-10T12:00:00.000Z'),
    });
    upsertWorkspaceProfile(workspaceRoot, {
      profileId: 'alpha',
      label: 'Primary account',
      userHandle: 'Prekzursil',
      provenance: {
        type: 'login',
      },
      sessionCookies: [
        {
          key: 'PHPSESSID',
          value: 'alpha-cookie',
          domain: 'www.pbinfo.ro',
          path: '/',
          secure: true,
          httpOnly: true,
        },
      ],
      now: new Date('2026-03-10T12:01:00.000Z'),
    });

    activateWorkspaceProfile(workspaceRoot, 'alpha', {
      now: new Date('2026-03-10T12:02:00.000Z'),
    });
    deleteWorkspaceProfile(workspaceRoot, 'alpha', {
      now: new Date('2026-03-10T12:03:00.000Z'),
    });

    const state = readWorkspaceState(workspaceRoot);

    expect(state.profiles).toEqual([]);
    expect(state.activeProfileId).toBeUndefined();
    expect(existsSync(join(workspaceRoot, '.local', 'session-cookies.json'))).toBe(false);
  });

  test('reuses existing state, updates an existing profile in place, and guards missing profiles', () => {
    const workspaceRoot = mkdtempSync(join(tmpdir(), 'pbinfo-gui-store-edge-'));
    tempDirs.push(workspaceRoot);

    const first = initializeWorkspaceState(workspaceRoot, {
      now: new Date('2026-03-10T12:00:00.000Z'),
    });
    // Re-initializing an already-initialized workspace returns the persisted state.
    const second = initializeWorkspaceState(workspaceRoot, {
      now: new Date('2026-03-10T13:00:00.000Z'),
    });
    expect(second.createdAt).toBe(first.createdAt);

    upsertWorkspaceProfile(workspaceRoot, {
      profileId: 'alpha',
      label: 'Original label',
      provenance: { type: 'login' },
      sessionCookies: [{ key: 'PHPSESSID', value: 'v1', domain: 'www.pbinfo.ro', path: '/' }],
      now: new Date('2026-03-10T12:01:00.000Z'),
    });
    const updated = upsertWorkspaceProfile(workspaceRoot, {
      profileId: 'alpha',
      label: 'Renamed label',
      provenance: { type: 'login' },
      sessionCookies: [{ key: 'PHPSESSID', value: 'v2', domain: 'www.pbinfo.ro', path: '/' }],
      now: new Date('2026-03-10T12:05:00.000Z'),
    });

    const state = readWorkspaceState(workspaceRoot);
    expect(state.profiles).toHaveLength(1);
    expect(updated.label).toBe('Renamed label');

    expect(() =>
      activateWorkspaceProfile(workspaceRoot, 'missing', {
        now: new Date('2026-03-10T12:06:00.000Z'),
      }),
    ).toThrow(/was not found/);

    const afterMissingDelete = deleteWorkspaceProfile(workspaceRoot, 'missing', {
      now: new Date('2026-03-10T12:07:00.000Z'),
    });
    expect(afterMissingDelete.profiles).toHaveLength(1);
  });
});
