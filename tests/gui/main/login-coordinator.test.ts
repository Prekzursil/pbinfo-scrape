import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, test, vi } from 'vitest';

vi.mock('../../../src/auth/bootstrap.js', () => ({
  bootstrapAuth: vi.fn(async () => ({
    status: 'logged-in-fresh',
    credentialsSource: 'file',
    resolvedHandle: 'Prekzursil',
    sealedBundle: true,
    checkedAt: '2026-04-24T00:00:00.000Z',
  })),
}));

import { bootstrapAuth } from '../../../src/auth/bootstrap.js';
import { operatorLogin } from '../../../src/gui/main/login-coordinator.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  (bootstrapAuth as unknown as ReturnType<typeof vi.fn>).mockClear();
});

describe('operatorLogin', () => {
  test('writes credentials to <workspaceRoot>/.local/pbinfo.local.json', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'pbinfo-login-'));
    tempDirs.push(workspace);
    const archiveRoot = join(workspace, 'archive');

    await operatorLogin(archiveRoot, {
      username: 'Prekzursil',
      password: 'secret',
    });

    const configPath = join(workspace, '.local', 'pbinfo.local.json');
    expect(existsSync(configPath)).toBe(true);
    const written = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(written.auth.username).toBe('Prekzursil');
    expect(written.auth.password).toBe('secret');
  });

  test('calls bootstrapAuth with the derived workspace root', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'pbinfo-login-'));
    tempDirs.push(workspace);
    const archiveRoot = join(workspace, 'archive');

    await operatorLogin(archiveRoot, { username: 'u', password: 'p' });

    expect(bootstrapAuth).toHaveBeenCalledWith({ workspaceRoot: workspace });
  });

  test('returns success=true on logged-in-fresh status', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'pbinfo-login-'));
    tempDirs.push(workspace);
    const result = await operatorLogin(join(workspace, 'archive'), {
      username: 'u',
      password: 'p',
    });
    expect(result.success).toBe(true);
    expect(result.resolvedHandle).toBe('Prekzursil');
  });

  test('returns success=false on login-failed status', async () => {
    (bootstrapAuth as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 'login-failed',
      credentialsSource: 'file',
      sealedBundle: false,
      checkedAt: '2026-04-24T00:00:00.000Z',
    });
    const workspace = mkdtempSync(join(tmpdir(), 'pbinfo-login-'));
    tempDirs.push(workspace);
    const result = await operatorLogin(join(workspace, 'archive'), {
      username: 'u',
      password: 'bad',
    });
    expect(result.success).toBe(false);
    expect(result.status).toBe('login-failed');
  });

  test('preserves other keys already in pbinfo.local.json', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'pbinfo-login-'));
    tempDirs.push(workspace);
    mkdirSync(join(workspace, '.local'), { recursive: true });
    writeFileSync(
      join(workspace, '.local', 'pbinfo.local.json'),
      JSON.stringify({ crawl: { maxConcurrency: 6 } }),
      'utf8',
    );

    await operatorLogin(join(workspace, 'archive'), {
      username: 'u',
      password: 'p',
    });

    const written = JSON.parse(
      readFileSync(join(workspace, '.local', 'pbinfo.local.json'), 'utf8'),
    );
    expect(written.crawl.maxConcurrency).toBe(6);
    expect(written.auth.username).toBe('u');
  });
});
