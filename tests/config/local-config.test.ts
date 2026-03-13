import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, test } from 'vitest';

import { loadLocalConfig } from '../../src/config/local-config.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pbinfo-config-'));
  tempDirs.push(dir);
  return dir;
}

describe('loadLocalConfig', () => {
  test('returns stable defaults when the local config file is absent', () => {
    const workspaceRoot = createWorkspace();

    const config = loadLocalConfig(workspaceRoot);

    expect(config.paths.localRoot).toBe(join(workspaceRoot, '.local'));
    expect(config.paths.outputRoot).toBe(join(workspaceRoot, 'output'));
    expect(config.paths.archiveRoot).toBe(join(workspaceRoot, 'archive'));
    expect(config.paths.snapshotsRoot).toBe(join(workspaceRoot, 'archive', 'snapshots'));
    expect(config.paths.artifactsRoot).toBe(join(workspaceRoot, 'output', 'artifacts'));
    expect(config.auth.strategy).toBe('none');
    expect(config.secrets.bundlePath).toBe(
      join(workspaceRoot, 'archive', 'secrets', 'pbinfo-auth.age'),
    );
    expect(config.secrets.identityPath).toBe(join(workspaceRoot, '.local', 'age-identity.txt'));
    expect(config.publish).toEqual({
      owner: 'Prekzursil',
      repo: 'pbinfo-scrape',
    });
    expect(config.crawl.publicStartUrls).toEqual([
      'https://www.pbinfo.ro/',
      'https://www.pbinfo.ro/probleme',
      'https://www.pbinfo.ro/probleme-categorii/9',
      'https://www.pbinfo.ro/probleme-categorii/10',
      'https://www.pbinfo.ro/probleme-categorii/11',
    ]);
  });

  test('merges persisted local overrides with defaults', () => {
    const workspaceRoot = createWorkspace();
    const localRoot = join(workspaceRoot, '.local');
    const configPath = join(localRoot, 'pbinfo.local.json');
    mkdirSync(localRoot, { recursive: true });

    writeFileSync(
      configPath,
      JSON.stringify(
        {
          auth: {
            strategy: 'credentials',
            username: 'Prekzursil',
          },
          paths: {
            outputRoot: 'archive-output',
          },
          secrets: {
            recipient: 'age1example',
            identityPath: '.local/age.txt',
            bundlePath: 'archive/secrets/custom.age',
          },
          crawl: {
            maxConcurrency: 2,
            userHandle: 'Prekzursil',
          },
          ranking: {
            overridesPath: '.local/ranking-overrides.json',
          },
          publish: {
            owner: 'Prekzursil',
            repo: 'pbinfo-private-archive',
          },
        },
        null,
        2,
      ),
      'utf8',
    );

    const config = loadLocalConfig(workspaceRoot);

    expect(config.auth).toMatchObject({
      strategy: 'credentials',
      username: 'Prekzursil',
    });
    expect(config.paths.outputRoot).toBe(join(workspaceRoot, 'archive-output'));
    expect(config.paths.archiveRoot).toBe(join(workspaceRoot, 'archive'));
    expect(config.paths.snapshotsRoot).toBe(join(workspaceRoot, 'archive', 'snapshots'));
    expect(config.crawl.maxConcurrency).toBe(2);
    expect(config.crawl.userHandle).toBe('Prekzursil');
    expect(config.ranking.overridesPath).toBe(
      join(workspaceRoot, '.local', 'ranking-overrides.json'),
    );
    expect(config.secrets).toEqual({
      recipient: 'age1example',
      identityPath: join(workspaceRoot, '.local', 'age.txt'),
      recipientPath: join(workspaceRoot, 'archive', 'secrets', 'age-recipient.txt'),
      bundlePath: join(workspaceRoot, 'archive', 'secrets', 'custom.age'),
    });
    expect(config.publish).toEqual({
      owner: 'Prekzursil',
      repo: 'pbinfo-private-archive',
    });
  });
});
