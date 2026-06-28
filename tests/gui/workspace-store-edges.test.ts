import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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

function makeWorkspace(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function writeLocalConfig(workspaceRoot: string, config: unknown): void {
  mkdirSync(join(workspaceRoot, '.local'), { recursive: true });
  writeFileSync(join(workspaceRoot, '.local', 'pbinfo.local.json'), JSON.stringify(config), 'utf8');
}

const cookie = {
  key: 'PHPSESSID',
  value: 'c',
  domain: 'www.pbinfo.ro',
  path: '/',
  secure: true,
  httpOnly: true,
};

describe('workspace store edge cases', () => {
  test('initialize returns the existing state and read falls back to initialize', () => {
    const workspaceRoot = makeWorkspace('pbinfo-ws-init-');
    const first = initializeWorkspaceState(workspaceRoot, { now: new Date('2026-03-10T00:00:00.000Z') });
    const second = initializeWorkspaceState(workspaceRoot, { now: new Date('2026-03-11T00:00:00.000Z') });
    expect(second.createdAt).toBe(first.createdAt);

    const fresh = makeWorkspace('pbinfo-ws-read-');
    const state = readWorkspaceState(fresh);
    expect(state.profiles).toEqual([]);
  });

  test('upserting an existing profile updates it in place and preserves createdAt', () => {
    const workspaceRoot = makeWorkspace('pbinfo-ws-upsert-');
    upsertWorkspaceProfile(workspaceRoot, {
      profileId: 'beta',
      label: 'Other',
      userHandle: 'Other',
      provenance: { type: 'login' },
      sessionCookies: [cookie],
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    const created = upsertWorkspaceProfile(workspaceRoot, {
      profileId: 'alpha',
      label: 'First',
      userHandle: 'Prekzursil',
      provenance: { type: 'login' },
      sessionCookies: [cookie],
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    const updated = upsertWorkspaceProfile(workspaceRoot, {
      profileId: 'alpha',
      label: 'Renamed',
      userHandle: 'Prekzursil',
      provenance: { type: 'login' },
      sessionCookies: [cookie],
      now: new Date('2026-03-10T01:00:00.000Z'),
    });
    expect(updated.label).toBe('Renamed');
    expect(updated.createdAt).toBe(created.createdAt);
    expect(readWorkspaceState(workspaceRoot).profiles).toHaveLength(2);
  });

  test('activating a handle-less profile preserves array config values', () => {
    const workspaceRoot = makeWorkspace('pbinfo-ws-activate-');
    writeLocalConfig(workspaceRoot, { crawl: { publicStartUrls: ['https://www.pbinfo.ro/'] } });
    upsertWorkspaceProfile(workspaceRoot, {
      profileId: 'nohandle',
      label: 'No handle',
      provenance: { type: 'login' },
      sessionCookies: [cookie],
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    activateWorkspaceProfile(workspaceRoot, 'nohandle', { now: new Date('2026-03-10T01:00:00.000Z') });
    const config = JSON.parse(
      readFileSync(join(workspaceRoot, '.local', 'pbinfo.local.json'), 'utf8'),
    ) as { crawl: { publicStartUrls: string[]; userHandle?: string } };
    expect(config.crawl.publicStartUrls).toEqual(['https://www.pbinfo.ro/']);
    expect(config.crawl.userHandle).toBeUndefined();
  });

  test('deleting a non-active profile keeps the active marker', () => {
    const workspaceRoot = makeWorkspace('pbinfo-ws-delete-other-');
    for (const profileId of ['alpha', 'beta']) {
      upsertWorkspaceProfile(workspaceRoot, {
        profileId,
        label: profileId,
        userHandle: 'Prekzursil',
        provenance: { type: 'login' },
        sessionCookies: [cookie],
        now: new Date('2026-03-10T00:00:00.000Z'),
      });
    }
    activateWorkspaceProfile(workspaceRoot, 'alpha', { now: new Date('2026-03-10T01:00:00.000Z') });
    const state = deleteWorkspaceProfile(workspaceRoot, 'beta', { now: new Date('2026-03-10T02:00:00.000Z') });
    expect(state.activeProfileId).toBe('alpha');
    expect(state.profiles.map((profile) => profile.profileId)).toEqual(['alpha']);
  });

  test('deleting the active profile retains unrelated auth and crawl settings', () => {
    const workspaceRoot = makeWorkspace('pbinfo-ws-delete-keep-');
    writeLocalConfig(workspaceRoot, { auth: { extraKey: 'keep' }, crawl: { maxConcurrency: 4 } });
    upsertWorkspaceProfile(workspaceRoot, {
      profileId: 'alpha',
      label: 'Alpha',
      userHandle: 'Prekzursil',
      provenance: { type: 'login' },
      sessionCookies: [cookie],
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    activateWorkspaceProfile(workspaceRoot, 'alpha', { now: new Date('2026-03-10T01:00:00.000Z') });
    deleteWorkspaceProfile(workspaceRoot, 'alpha', { now: new Date('2026-03-10T02:00:00.000Z') });
    const config = JSON.parse(
      readFileSync(join(workspaceRoot, '.local', 'pbinfo.local.json'), 'utf8'),
    ) as { auth?: { extraKey?: string }; crawl?: { maxConcurrency?: number } };
    expect(config.auth?.extraKey).toBe('keep');
    expect(config.crawl?.maxConcurrency).toBe(4);
  });

  test('deleting the active profile tolerates a config without a crawl section', () => {
    const workspaceRoot = makeWorkspace('pbinfo-ws-delete-nocrawl-');
    upsertWorkspaceProfile(workspaceRoot, {
      profileId: 'alpha',
      label: 'Alpha',
      userHandle: 'Prekzursil',
      provenance: { type: 'login' },
      sessionCookies: [cookie],
      now: new Date('2026-03-10T00:00:00.000Z'),
    });
    // Hand-mark the profile active while leaving the local config without a crawl block.
    const statePath = join(workspaceRoot, '.local', 'gui', 'workspace-state.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, unknown>;
    state.activeProfileId = 'alpha';
    writeFileSync(statePath, JSON.stringify(state), 'utf8');
    writeLocalConfig(workspaceRoot, { auth: { strategy: 'cookie-import' } });

    const next = deleteWorkspaceProfile(workspaceRoot, 'alpha', { now: new Date('2026-03-10T02:00:00.000Z') });
    expect(next.activeProfileId).toBeUndefined();
    expect(next.profiles).toEqual([]);
  });
});
